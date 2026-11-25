import { cliOfProvider, launchExecutable, type StaffArrangement } from '../domain/staffing-sketch.ts'
import { NonBlank } from '../domain/ids.ts'
import type { ConfigFile } from '../domain/files.ts'
import { refuse } from '../domain/errors.ts'
import { persistentStaffIds, type Staffing, staffingOf, subscriptionOf } from './staffing.ts'

export function staffRoles(config: ConfigFile, staffing: Staffing) {
  const roles = Object.entries(config.roles).map(([role, file]) => ({
    role, program: file.kind === 'program',
    assigns: file.acts.flatMap((act) => typeof act === 'object' && 'assign' in act ? act.assign.map(String) : []),
    persistent: staffing.roles[role]?.persistent,
    needsSession: file.kind === 'agent' && (Boolean(file.pipeline) || file.acts.includes('split')),
    allowance: staffing.roles[role]?.subagentAllowance ?? 0,
  }))
  return roles.map(({ needsSession, ...role }) => ({
    ...role, persistent: !role.program && (needsSession || (role.persistent ?? (role.assigns.length > 0 ||
      !roles.some((other) => other.assigns.includes(role.role))))),
  }))
}

export const staffSubscriptions = (staffing: Staffing) =>
  Object.entries(staffing.accounts).flatMap(([account, entry]) => {
    const subscription = subscriptionOf(account, entry)
    return subscription ? [subscription] : []
  })

export function sketchOf(config: ConfigFile, staffing: Staffing): StaffArrangement {
  const roles = staffRoles(config, staffing)
  const staff = new Map<string, StaffArrangement['staff'][number]>()
  const persisted = persistentStaffIds(staffing.roles)
  const owners = new Map<string, string>()
  const subscriptions = staffSubscriptions(staffing)
  for (const { role, allowance } of roles.filter((r) => r.persistent)) {
    const binding = staffing.roles[role]
    let id = persisted.get(role) ?? role
    if (!binding) {
      while (staff.has(id) || [...persisted.values()].includes(id)) id = `staff-${id}`
    }
    owners.set(role, id)
    staff.set(id, {
      id, model: binding?.model ?? '', launch: binding?.launch ?? '', allowance,
      account: subscriptions.find(({ account }) => account === binding?.account)?.account ?? null,
    })
  }
  // A draft always has a splitting role. Its staff is the fallback for old files without an arrow.
  const fallback = staff.keys().next().value!
  const assignments = roles.map(({ role, program }) => {
    const suggested = (program ? staffing.programStaff?.[role] : staffing.roles[role]?.subagentOf)
    const assigningRole = roles.find((parent) => parent.persistent && parent.assigns.includes(role))
    return { role, staff: owners.get(role) ?? (suggested && staff.has(suggested) ? suggested
      : (assigningRole && owners.get(assigningRole.role)) ?? fallback) }
  })
  return { staff: [...staff.values()], assignments, subscriptions }
}

export function checkAssignments(config: ConfigFile, draft: StaffArrangement) {
  const workers = new Map(draft.staff.map((s) => [s.id, s]))
  const assignments = new Map(draft.assignments.map((r) => [r.role, r.staff]))
  if (workers.size !== draft.staff.length || draft.staff.some((s) => !s.id.trim())) throw refuse('Give each staff card a distinct name.')
  if (assignments.size !== Object.keys(config.roles).length || draft.assignments.length !== assignments.size ||
    Object.keys(config.roles).some((role) => !workers.has(assignments.get(role) ?? ''))) {
    throw refuse('Assign every configured role to exactly one staff card.')
  }
  return { workers, assignments }
}

export function staffingFromSketch(config: ConfigFile, before: Staffing, draft: StaffArrangement): Staffing {
  const roles = staffRoles(config, before)
  const { assignments, workers } = checkAssignments(config, draft)
  const persistentStaff = new Set(roles.filter((role) => role.persistent).map(({ role }) => assignments.get(role)))
  for (const staff of workers.keys()) {
    if (![...assignments.values()].includes(staff)) throw refuse('Remove staff cards with no assigned roles.')
    if (!persistentStaff.has(staff)) throw refuse(`Staff ${staff} needs a persistent role to run its session.`)
  }
  const accounts = new Map<string, Staffing['accounts'][string]>()
  const clis = new Map(Object.entries(before.clis))
  for (const { account, provider, plan, estimate } of draft.subscriptions) {
    if (!account.trim() || accounts.has(account) || !plan.trim()) {
      throw refuse('Give each subscription a distinct account and a plan.')
    }
    // Estimates belong to the host's proposal, never to a page edit.
    const proposal = before.accounts[account]
    const existing = proposal && subscriptionOf(account, proposal)
    const hostEstimate = existing && existing.provider === provider && existing.plan === plan ? existing.estimate : undefined
    accounts.set(account, { limits: proposal?.limits ?? {}, ...(proposal?.sessionLimit === undefined ? {} : { sessionLimit: proposal.sessionLimit }),
      provider, plan: NonBlank.make(plan), ...(hostEstimate === undefined || !Bun.deepEquals(estimate, hostEstimate)
        ? {} : { estimate: hostEstimate }) })
  }
  const bound = new Map<string, { account: string; cli: string; model: string; launch: string; allowance: number }>()
  const models = new Map<string, unknown>(Object.entries(before.models ?? {}))
  for (const staff of draft.staff) {
    const cli = launchExecutable(staff.launch)
    if (!staff.model.trim() || !staff.launch.includes('{session}') || staff.allowance < 0) {
      throw refuse(`Staff ${staff.id} needs a model and a launch command containing {session}.`)
    }
    const options = draft.subscriptions.filter(({ provider }) => cliOfProvider(provider) === cli)
    const account = (options.length === 1 ? options[0] : options.find((item) => item.account === staff.account))?.account
    if (!cli || !account) throw refuse(`Staff ${staff.id} needs a subscription matching its launch CLI.`)
    if (!clis.has(cli)) clis.set(cli, { backgroundChildren: cli === 'claude', canPark: false })
    if (!models.has(staff.model)) models.set(staff.model, { launch: staff.launch })
    bound.set(staff.id, { cli, account, model: staff.model, launch: staff.launch, allowance: staff.allowance })
  }
  const programStaff = Object.fromEntries(roles.filter(({ program }) => program).map(({ role }) => [role, assignments.get(role)]))
  const bindings = roles.filter(({ program }) => !program).map(({ role, persistent: own }) => {
    const group = assignments.get(role)!
    const staff = bound.get(group)!
    const prior = before.roles[role]
    const preserve = !own && prior?.account === staff.account && prior.cli === staff.cli &&
      launchExecutable(prior.launch) === staff.cli
    const model = preserve ? prior.model : staff.model
    const launch = preserve ? prior.launch : staff.launch
    return [role, {
      account: staff.account, cli: staff.cli, model, launch, persistent: own,
      allowedModels: [...new Set([model, ...(prior?.allowedModels ?? [])])],
      ...(own ? { workerGroup: group } : { subagentOf: group }),
      concurrency: own ? Math.max(1, staff.allowance) : prior?.concurrency ?? 1,
      subagentAllowance: own ? staff.allowance : prior?.subagentAllowance ?? 0,
    }] as const
  })
  return staffingOf({ accounts: Object.fromEntries(accounts), clis: Object.fromEntries(clis),
    models: Object.fromEntries(models), roles: Object.fromEntries(bindings), programStaff })
}
