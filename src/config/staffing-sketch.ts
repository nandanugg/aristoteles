import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchExecutable, type StaffArrangement } from '../domain/staffing-sketch.ts'
import { NonBlank } from '../domain/ids.ts'
import type { ConfigFile } from '../domain/files.ts'
import { refuse } from '../domain/errors.ts'
import { type Staffing, staffingOf } from './staffing.ts'

interface Plan {
  provider: string
  name: string
  price: number
  cli: string
  monthlyTokens: number
}
const data = Bun.YAML.parse(readFileSync(join(import.meta.dir, 'plans.yaml'), 'utf8')) as {
  planSource: string
  planChecked: string
  windowsPerMonth: number
  plans: Record<string, Plan>
  models: Record<string, { factor: number; source: string; checked: string }>
}
export const planCatalog = Object.entries(data.plans).map(([id, plan]) => ({ id, ...plan }))
export const estimateBasis = { windows: data.windowsPerMonth, source: data.planSource, checked: data.planChecked }
export const modelCosts = Object.entries(data.models).map(([model, cost]) => ({ model, ...cost }))

export function staffRoles(config: ConfigFile, staffing: Staffing) {
  const roles = Object.entries(config.roles).flatMap(([role, file]) => file.kind !== 'agent' ? [] : [{
    role,
    assigns: file.acts.flatMap((act) => typeof act === 'object' && 'assign' in act ? act.assign.map(String) : []),
    persistent: staffing.roles[role]?.persistent,
    needsSession: Boolean(file.pipeline) || file.acts.includes('split'),
    allowance: staffing.roles[role]?.subagentAllowance ?? 0,
  }])
  return roles.map(({ needsSession, ...role }) => ({
    ...role, persistent: role.persistent ?? (needsSession || role.assigns.length > 0 ||
      !roles.some((other) => other.assigns.includes(role.role))),
  }))
}

export function launchClis(staffing: Staffing) {
  const pairs = new Map<string, Set<string>>([
    ['claude', new Set(['claude'])], ['codex', new Set(['codex'])],
  ])
  for (const { launch, cli } of Object.values(staffing.roles)) {
    const command = launchExecutable(launch)
    if (!command || command === 'claude' || command === 'codex') continue
    const known = pairs.get(command) ?? new Set<string>()
    known.add(cli)
    pairs.set(command, known)
  }
  return [...pairs].flatMap(([command, clis]) => clis.size === 1 ? [{ command, cli: [...clis][0]! }] : [])
}

export function staffAccounts(staffing: Staffing) {
  return Object.entries(staffing.accounts).map(([account, value]) => ({
    account, plan: value.plan ?? null,
    clis: [...new Set(Object.values(staffing.roles).filter((r) => r.account === account).map((r) => r.cli))],
  }))
}

export function sketchOf(config: ConfigFile, staffing: Staffing): StaffArrangement {
  const staff = new Map<string, StaffArrangement['staff'][number]>()
  const groups = new Set<string>(Object.values(staffing.roles).flatMap(({ workerGroup }) => workerGroup ? [workerGroup] : []))
  const assignments = staffRoles(config, staffing).filter((role) => role.persistent).map(({ role, allowance }) => {
    const binding = staffing.roles[role]
    let id = binding?.workerGroup ?? role
    while (!binding?.workerGroup && (groups.has(id) || staff.has(id))) id = `staff-${id}`
    const previous = staff.get(id)
    staff.set(id, {
      id, model: binding?.model ?? '', launch: binding?.launch ?? '',
      allowance: Math.max(previous?.allowance ?? 0, allowance),
      account: binding?.account ?? null,
    })
    return { role, staff: id }
  })
  return { staff: [...staff.values()], assignments, subscriptions: [] }
}

export function staffingFromSketch(config: ConfigFile, before: Staffing, draft: StaffArrangement): Staffing {
  const roles = staffRoles(config, before)
  const persistent = roles.filter((r) => r.persistent)
  const workers = new Map(draft.staff.map((s) => [s.id, s]))
  const assignments = new Map(draft.assignments.map((r) => [r.role, r.staff]))
  if (workers.size !== draft.staff.length || draft.staff.some((s) => !s.id.trim())) throw refuse('Give each staff card a distinct name.')
  if (assignments.size !== persistent.length || draft.assignments.length !== persistent.length ||
    persistent.some(({ role }) => !workers.has(assignments.get(role) ?? ''))) {
    throw refuse('Assign every persistent role to one staff card.')
  }
  if (draft.staff.some(({ id }) => ![...assignments.values()].includes(id))) throw refuse('Remove staff cards with no assigned roles.')
  const accounts = new Map<string, Staffing['accounts'][string]>(Object.entries(before.accounts))
  const accountClis = new Map<string, readonly string[]>(staffAccounts(before).map(({ account, clis }) => [account, clis]))
  const clis = new Map(Object.entries(before.clis))
  for (const { account, plan: planId } of draft.subscriptions) {
    const plan = planCatalog.find(({ id }) => id === planId)
    if (!account.trim() || accounts.has(account) || !plan) throw refuse('Choose a plan for each subscription and give it a distinct name.')
    accounts.set(account, { plan: NonBlank.make(planId), limits: {} })
    accountClis.set(account, [plan.cli])
  }
  for (const [account, entry] of accounts) {
    const plan = planCatalog.find(({ id }) => id === entry.plan)
    if (plan) accountClis.set(account, [plan.cli])
  }
  const commands: readonly { command: string; cli: string }[] = launchClis(before)
  const bound = new Map<string, { account: string; cli: string; model: string; launch: string; allowance: number }>()
  const models = new Map<string, unknown>(Object.entries(before.models ?? {}))
  for (const staff of draft.staff) {
    const cli = commands.find(({ command }) => command === launchExecutable(staff.launch))?.cli
    if (!cli) throw refuse(`Staff ${staff.id}: enter a launch command with a recognized CLI.`)
    if (!staff.model.trim() || !staff.launch.includes('{session}') || staff.allowance < 0) {
      throw refuse(`Staff ${staff.id}: enter a model and a launch command containing {session}.`)
    }
    const options = [...accountClis].filter(([, names]) => names.includes(cli)).map(([name]) => name)
    const account = options.length === 1 ? options[0] : options.find((name) => name === staff.account)
    if (!account) throw refuse(`Staff ${staff.id}: choose a subscription for ${cli}.`)
    if (!clis.has(cli)) clis.set(cli, { backgroundChildren: cli === 'claude', canPark: false })
    if (!models.has(staff.model)) models.set(staff.model, { launch: staff.launch })
    bound.set(staff.id, { cli, account, model: staff.model, launch: staff.launch, allowance: staff.allowance })
  }
  const bindings = roles.map(({ role, persistent: own }) => {
    const owner = own ? role : persistent.find((r) => r.assigns.includes(role))?.role
    const group = owner === undefined ? undefined : assignments.get(owner)
    const staff = group === undefined ? undefined : bound.get(group)
    if (!staff) throw refuse(`Give ${role} an assigning role with a staff card.`)
    const prior = before.roles[role]
    const preserve = !own && prior?.account === staff.account && prior.cli === staff.cli
    const model = preserve ? prior.model : staff.model
    const launch = preserve ? prior.launch : staff.launch
    return [role, {
      account: staff.account, cli: staff.cli, model, launch, persistent: own,
      allowedModels: [...new Set([model, ...(prior?.allowedModels ?? [])])],
      ...(own ? { workerGroup: group } : {}),
      concurrency: own ? Math.max(1, staff.allowance) : prior?.concurrency ?? 1,
      subagentAllowance: own ? staff.allowance : prior?.subagentAllowance ?? 0,
    }] as const
  })
  return staffingOf({ accounts: Object.fromEntries(accounts), clis: Object.fromEntries(clis),
    models: Object.fromEntries(models), roles: Object.fromEntries(bindings) })
}
