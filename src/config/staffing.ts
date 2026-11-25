// User-owned staffing for one project directory. Responsibility files can be read separately.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { NonBlank, PositiveInt } from '../domain/ids.ts'
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
    sessionLimit: Schema.optionalKey(PositiveInt),
  })),
  roles: Schema.Record(Schema.String, RoleStaffing),
})
export type Staffing = typeof Staffing.Type

export const staffingOf = (raw: unknown): Staffing => {
  const result = Schema.decodeUnknownResult(Staffing, { onExcessProperty: 'error' })(raw)
  if (result._tag === 'Failure') return fail(STAFFING, String(result.failure).replace(/\s*\n\s*/g, ' '))
  const staffing = result.success
  for (const [name, role] of Object.entries(staffing.roles)) {
    const path = `roles.${name}`
    if (!Object.hasOwn(staffing.accounts, role.account)) {
      fail(STAFFING, `${path}.account names an unknown account`)
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
