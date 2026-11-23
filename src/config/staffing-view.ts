// The staffing step's view (onboarding v2 pass 5, MVP: ROLE-WEIGHT.md, UI-GUIDELINE.md): the
// arrangement the user chose and its consequences PER LIMIT, never one bar per account, with the
// user-typed limits kept as the user typed them. aristoteles does not choose the arrangement; it
// shows what an arrangement means and previews a change before it is applied. The MVP has no
// usage evidence yet, so every workload and fit is `unknown` with its reason; limit-time
// forecasts come later, per provider (ROLE-WEIGHT.md section 3). Pure: no file, no clock.
import type { Staffing } from './staffing.ts'

// How a role's work is reviewed under its staffing (Nanda section 9: never claimed stronger).
export type ReviewMode =
  | 'fresh subagent' // a child in the background: the worker yields while it runs
  | 'self-review turns' // no child allowed: make <-> review turns in one context

export type Unknown = { readonly known: false; readonly why: string }

export interface ArrangedRole {
  readonly role: string
  readonly account: string
  readonly cli: string
  readonly model: string
  // The other allowed models: alternative scenarios in the preview (OV2-7).
  readonly alternatives: ReadonlyArray<string>
  readonly persistent: boolean
  // The worker the role runs on, a tagged key: `group:<workerGroup>`, or `role:<role>` for a private
  // worker (persistent roles only; a disposable role runs as a subagent of the role that starts it).
  readonly worker: string | null
  // the explicit group as the staffing names it (null: none)
  readonly workerGroup: string | null
  readonly concurrency: number
  readonly subagentAllowance: number
  readonly review: ReviewMode
  // Does an attempt fit the model's window? Unknown until the model's window and the role's
  // peak context are evidenced (ROLE-WEIGHT.md section 1).
  readonly fit: Unknown
}

export interface LimitConsequence {
  readonly account: string
  readonly limit: string
  readonly typed: string // as the user typed it
  readonly roles: ReadonlyArray<string> // the roles whose work this limit counts
  // The sessions of the account the engine runs: one per worker (a group of persistent roles, or a
  // private one); makers are subagents in their worker's session.
  readonly peakSessions: number
  readonly workload: Unknown
}

export interface StaffingWarning {
  readonly role: string
  readonly says: string
}

export interface StaffingView {
  readonly accounts: ReadonlyArray<{
    readonly account: string
    readonly limits: ReadonlyArray<{ readonly limit: string; readonly typed: string }>
    readonly roles: ReadonlyArray<string>
    // the managed sessions this dir may run at once (pass 9 enforces it for this dir only), or null
    readonly sessionLimit: number | null
  }>
  // The workers: each a session with one wait over its roles' identities.
  readonly workers: ReadonlyArray<{
    readonly worker: string
    readonly roles: ReadonlyArray<string>
    readonly account: string
    readonly shared: boolean
  }>
  readonly arrangement: ReadonlyArray<ArrangedRole>
  readonly consequences: ReadonlyArray<LimitConsequence>
  readonly warnings: ReadonlyArray<StaffingWarning>
}

const NO_EVIDENCE: Unknown = {
  known: false,
  why: 'No usage evidence yet: it is measured from the first tasks',
}
const NO_WINDOW: Unknown = {
  known: false,
  why: "The model's context window and the role's peak context are not evidenced yet",
}

const reviewOf = (staffing: Staffing, role: Staffing['roles'][string]): ReviewMode =>
  role.subagentAllowance > 0 && staffing.clis[role.cli]?.backgroundChildren === true
    ? 'fresh subagent'
    : 'self-review turns'

const sorted = <A>(xs: ReadonlyArray<A>, key: (a: A) => string): ReadonlyArray<A> =>
  [...xs].sort((a, b) => key(a).localeCompare(key(b)))

export const staffingView = (staffing: Staffing): StaffingView => {
  const roles = Object.entries(staffing.roles)
  const arrangement: ReadonlyArray<ArrangedRole> = sorted(
    roles.map(([name, r]) => ({
      role: name,
      account: r.account,
      cli: r.cli,
      model: r.model,
      alternatives: r.allowedModels.filter((m) => m !== r.model),
      persistent: r.persistent,
      worker: !r.persistent ? null : r.workerGroup !== undefined ? `group:${r.workerGroup}` : `role:${name}`,
      workerGroup: r.workerGroup ?? null,
      concurrency: r.concurrency,
      subagentAllowance: r.subagentAllowance,
      review: reviewOf(staffing, r),
      fit: NO_WINDOW,
    })),
    (x) => x.role,
  )
  const rolesOf = (account: string) =>
    arrangement.filter((r) => r.account === account).map((r) => r.role)
  const accounts = sorted(
    Object.entries(staffing.accounts).map(([account, a]) => ({
      account,
      limits: sorted(
        Object.entries(a.limits).map(([limit, typed]) => ({ limit, typed })),
        (x) => x.limit,
      ),
      roles: rolesOf(account),
      sessionLimit: a.sessionLimit ?? null,
    })),
    (x) => x.account,
  )
  const workerNames = [...new Set(arrangement.flatMap((r) => (r.worker === null ? [] : [r.worker])))]
  const workers = workerNames.sort().map((worker) => {
    const roles = arrangement.filter((r) => r.worker === worker)
    return {
      worker,
      roles: roles.map((r) => r.role),
      account: roles[0]?.account ?? '',
      shared: worker.startsWith('group:'),
    }
  })
  const peak = (account: string) => workers.filter((w) => w.account === account).length
  const consequences = accounts.flatMap((a) =>
    a.limits.map((l) => ({
      account: a.account,
      limit: l.limit,
      typed: l.typed,
      roles: a.roles,
      peakSessions: peak(a.account),
      workload: NO_EVIDENCE,
    })),
  )
  const warnings: Array<StaffingWarning> = []
  for (const r of arrangement) {
    if (r.review === 'self-review turns') {
      const reason = r.subagentAllowance === 0
        ? 'the subagent allowance is zero'
        : `${r.cli} does not support background children`
      warnings.push({ role: r.role, says: `its checks are not independent: it reviews its own work in turns (${reason})` })
    }
  }
  for (const a of accounts) {
    if (a.sessionLimit !== null && peak(a.account) > a.sessionLimit) {
      warnings.push({
        role: a.roles.join(', '),
        says: `account ${a.account} runs ${peak(a.account)} workers but its session limit is ` +
          `${a.sessionLimit}: some wait for a free session`,
      })
    }
    if (a.limits.length === 0 && a.roles.length > 0) {
      warnings.push({
        role: a.roles.join(', '),
        says: `account ${a.account} has no limits typed: no consequence can be shown for it`,
      })
    }
  }
  return { accounts, workers, arrangement, consequences, warnings }
}

// The preview of a change: the same view before and after, and what changed, before it is applied.
export interface StaffingPreview {
  readonly before: StaffingView
  readonly after: StaffingView
  readonly changed: ReadonlyArray<string> // "<role>.<field>: <before> -> <after>", sorted
}

const FIELDS = [
  'account',
  'cli',
  'model',
  'persistent',
  'worker',
  'concurrency',
  'subagentAllowance',
  'review',
] as const

export const staffingPreview = (before: Staffing, after: Staffing): StaffingPreview => {
  const b = staffingView(before)
  const a = staffingView(after)
  const changed: Array<string> = []
  const names = new Set([...b.arrangement, ...a.arrangement].map((r) => r.role))
  for (const name of [...names].sort()) {
    const x = b.arrangement.find((r) => r.role === name)
    const y = a.arrangement.find((r) => r.role === name)
    if (x === undefined) changed.push(`${name}: added`)
    else if (y === undefined) changed.push(`${name}: removed`)
    else {
      for (const f of FIELDS) {
        if (x[f] !== y[f]) changed.push(`${name}.${f}: ${String(x[f])} -> ${String(y[f])}`)
      }
    }
  }
  const limitsOf = (v: StaffingView) =>
    new Map(v.consequences.map((c) => [`${c.account}.${c.limit}`, c.typed] as const))
  const lb = limitsOf(b)
  const la = limitsOf(a)
  for (const k of [...new Set([...lb.keys(), ...la.keys()])].sort()) {
    if (lb.get(k) !== la.get(k)) {
      changed.push(`limit ${k}: ${lb.get(k) ?? 'none'} -> ${la.get(k) ?? 'none'}`)
    }
  }
  for (const x of a.accounts) {
    const y = b.accounts.find((acc) => acc.account === x.account)
    if (y !== undefined && y.sessionLimit !== x.sessionLimit) {
      changed.push(`sessions ${x.account}: ${y.sessionLimit ?? 'no limit'} -> ${x.sessionLimit ?? 'no limit'}`)
    }
  }
  return { before: b, after: a, changed }
}
