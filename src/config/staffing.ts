// User-owned staffing for one project directory. Responsibility files can be read separately.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { NonBlank, PositiveInt } from '../domain/ids.ts'
import { cliOfProvider, launchExecutable, type Subscription, SubscriptionEstimate, SubscriptionProvider } from '../domain/staffing-sketch.ts'
import { Files } from '../services/outside.ts'
import { fail, parseYaml, refusing } from './core.ts'

export const STAFFING = '.work/staffing.yaml'

const RoleStaffing = Schema.Struct({
  account: NonBlank,
  cli: NonBlank,
  allowedModels: Schema.Array(NonBlank),
  model: NonBlank,
  persistent: Schema.Boolean,
  concurrency: PositiveInt,
  // Pass 9 (decision 1): persistent roles that name the same group share one worker (one session,
  // one wait); omitted: a private worker (a group of one).
  workerGroup: Schema.optionalKey(NonBlank),
  subagentOf: Schema.optionalKey(NonBlank),
  subagentAllowance: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  launch: NonBlank,
})

const Staffing = Schema.Struct({
  models: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  // canPark: the CLI can checkpoint and resume a session (pass 9: a parked worker frees its slot);
  // without it a fresh recheck that needs the slot is deferred.
  clis: Schema.Record(Schema.String, Schema.Struct({
    backgroundChildren: Schema.Boolean,
    canPark: Schema.Boolean,
  })),
  // limits: as the user typed them (shown, never parsed); sessionLimit: the managed sessions this
  // dir may run at once on the account (pass 9 enforces it for THIS dir only); none: no limit given.
  accounts: Schema.Record(Schema.String, Schema.Struct({
    limits: Schema.Record(Schema.String, NonBlank),
    plan: Schema.optionalKey(NonBlank),
    provider: Schema.optionalKey(SubscriptionProvider),
    estimate: Schema.optionalKey(SubscriptionEstimate),
    sessionLimit: Schema.optionalKey(PositiveInt),
  })),
  roles: Schema.Record(Schema.String, RoleStaffing),
  programStaff: Schema.optionalKey(Schema.Record(Schema.String, NonBlank)),
})
export type Staffing = typeof Staffing.Type

export function subscriptionOf(account: string, entry: Staffing['accounts'][string]): Subscription | undefined {
  if (!entry.plan) return undefined
  if (entry.provider) return { account, provider: entry.provider, plan: entry.plan,
    ...(entry.estimate === undefined ? {} : { estimate: entry.estimate }) }
  // Round 55 saved catalog IDs without a provider. Read them as subscriptions on the new page.
  const legacy = /^(claude|chatgpt)-(.+)$/.exec(entry.plan)
  if (!legacy) return undefined
  const plan = legacy[2]!
  return { account, provider: legacy[1] === 'claude' ? 'Claude' : 'ChatGPT', plan: plan[0]!.toUpperCase() + plan.slice(1) }
}

export function persistentStaffIds(roles: Staffing['roles']) {
  const groups = new Set<string>(Object.values(roles).flatMap(({ workerGroup }) => workerGroup ? [workerGroup] : []))
  const used = new Set(groups)
  return new Map(Object.entries(roles).flatMap(([name, role]) => {
    if (!role.persistent) return []
    if (role.workerGroup) return [[name, role.workerGroup] as const]
    let id = name
    while (used.has(id)) id = `staff-${id}`
    used.add(id)
    return [[name, id] as const]
  }))
}

export const staffingOf = (raw: unknown): Staffing => {
  const result = Schema.decodeUnknownResult(Staffing, { onExcessProperty: 'error' })(raw)
  if (result._tag === 'Failure') return fail(STAFFING, String(result.failure).replace(/\s*\n\s*/g, ' '))
  const staffing = result.success
  const staffByRole = persistentStaffIds(staffing.roles)
  const staff = new Set(staffByRole.values())
  for (const [account, entry] of Object.entries(staffing.accounts)) {
    if ((entry.provider || entry.estimate || staffing.programStaff !== undefined) && !subscriptionOf(account, entry)) {
      fail(STAFFING, `accounts.${account} needs a subscription provider and plan`)
    }
  }
  for (const [name, group] of Object.entries(staffing.programStaff ?? {})) {
    if (Object.hasOwn(staffing.roles, name)) fail(STAFFING, `roles.${name} has two staff assignments`)
    if (!staff.has(group)) fail(STAFFING, `programStaff.${name} names an unknown staff card`)
  }
  for (const [name, role] of Object.entries(staffing.roles)) {
    const path = `roles.${name}`
    if (!Object.hasOwn(staffing.accounts, role.account)) {
      fail(STAFFING, `${path}.account names an unknown account`)
    }
    const subscription = subscriptionOf(role.account, staffing.accounts[role.account]!)
    if (subscription && (role.cli !== cliOfProvider(subscription.provider) ||
      launchExecutable(role.launch) !== role.cli)) {
      fail(STAFFING, `${path}.launch CLI must match its subscription provider`)
    }
    if (role.subagentOf !== undefined && (role.persistent || !staff.has(role.subagentOf))) {
      fail(STAFFING, `${path}.subagentOf needs an existing staff card for a disposable role`)
    }
    if (!role.persistent && role.subagentOf === undefined && staffing.programStaff !== undefined) {
      fail(STAFFING, `${path} needs a staff card in subagentOf`)
    }
    if (!Object.hasOwn(staffing.clis, role.cli)) {
      fail(STAFFING, `${path}.cli names an unknown CLI`)
    }
    if (!role.launch.includes('{session}')) {
      fail(STAFFING, `${path}.launch needs {session}`)
    }
    if (!role.allowedModels.includes(role.model)) {
      fail(STAFFING, `${path}.model must be one of its allowed models`)
    }
    if (new Set(role.allowedModels).size !== role.allowedModels.length) {
      fail(STAFFING, `${path}.allowedModels lists a model twice`)
    }
    if (role.workerGroup !== undefined && !role.persistent) {
      fail(STAFFING, `${path}.workerGroup: only a persistent role runs on a worker`)
    }
  }
  for (const [name, role] of Object.entries(staffing.roles)) {
    if (role.subagentOf === undefined) continue
    const owner = [...staffByRole].find(([, group]) => group === role.subagentOf)?.[0]
    const parent = owner === undefined ? undefined : staffing.roles[owner]
    if (parent && (role.account !== parent.account || role.cli !== parent.cli)) {
      fail(STAFFING, `roles.${name} must use the account and CLI of its staff`)
    }
  }
  // Roles sharing a session also share its execution settings and child allowance.
  const groups = new Map<string, Array<[string, Staffing['roles'][string]]>>()
  for (const [name, role] of Object.entries(staffing.roles)) {
    if (role.workerGroup === undefined) continue
    groups.set(role.workerGroup, [...(groups.get(role.workerGroup) ?? []), [name, role]])
  }
  for (const [group, members] of groups) {
    const [first, ...rest] = members
    if (first === undefined) continue
    for (const [name, role] of rest) {
      for (const key of ['account', 'cli', 'model', 'launch', 'subagentAllowance', 'concurrency'] as const) {
        if (role[key] !== first[1][key]) {
          fail(STAFFING, `workerGroup ${group}: roles.${name}.${key} differs from roles.${first[0]}.${key}; ` +
            'roles on one worker share its account, CLI, model, launch, subagent allowance and concurrency')
        }
      }
    }
  }
  return staffing
}

export const staffingOfText = (text: string | null): Staffing | null =>
  text === null ? null : staffingOf(parseYaml(text))

export const readStaffing = (dir: string) =>
  Effect.gen(function* () {
    const text = yield* (yield* Files).read(join(dir, STAFFING))
    return yield* refusing(() => staffingOfText(text))
  })
