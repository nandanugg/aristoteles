// The drafted adjustments of roles and directions (ruling 14), as role-words.ts reads the drafts
// of role words: the log holds each draft (Adjustment.Drafted), and the person's accept or reject
// of it, named by its event. No state is stored: this reads it from the log, in its order. It
// also holds the one check of an adjustment against the work, which the draft and the accept run.
import type { Refusal } from '../schema/errors.ts'
import { refusal } from '../schema/errors.ts'
import {
  type Adjustment,
  type Author,
  type DirectionId,
  type EventRef,
  type NonBlank,
  type RoleName,
  type Suggestion,
  type Tier,
  type Time,
  type Work,
} from '../schema/index.ts'
import { refOf } from './reads.ts'
import type { Derived } from './types.ts'

export interface AdjustmentDraft {
  readonly ref: EventRef
  readonly adjustment: Adjustment
  readonly by: Author
  readonly at: Time
}
// Waiting: for the person's accept or reject. Accepted and Rejected: by that event. Replaced: a
// newer draft for the same role or direction came while it waited.
export type AdjustmentState =
  | { readonly _tag: 'Waiting' }
  | { readonly _tag: 'Accepted'; readonly by: EventRef }
  | { readonly _tag: 'Rejected'; readonly by: EventRef; readonly reason: NonBlank }
  | { readonly _tag: 'Replaced'; readonly by: EventRef }

// Every drafted adjustment, in the order of the log.
export const adjustmentDrafts = (w: Work): ReadonlyArray<AdjustmentDraft> =>
  w.events.flatMap(({ recorded: r }) => {
    const e = r.event
    if (e._tag !== 'Adjustment' || !('create' in e)) return []
    return [{ ref: refOf(r.seq), adjustment: e.create.adjustment, by: r.author, at: r.at }]
  })
export const adjustmentDraftAt = (w: Work, ref: EventRef): AdjustmentDraft | undefined =>
  adjustmentDrafts(w).find((x) => x.ref === ref)

// What an adjustment is about: one role, or one direction. A newer draft about it replaces one
// that waits.
export const subjectOf = (a: Adjustment): string =>
  'role' in a ? `role ${a.role}` : `direction ${a.direction}`

export const adjustmentStates = (w: Work): ReadonlyMap<EventRef, AdjustmentState> => {
  const states = new Map<EventRef, AdjustmentState>()
  const waiting = new Map<string, EventRef>()
  for (const { recorded: r } of w.events) {
    const e = r.event
    if (e._tag !== 'Adjustment') continue
    const ref = refOf(r.seq)
    if ('create' in e) {
      const subject = subjectOf(e.create.adjustment)
      const before = waiting.get(subject)
      if (before !== undefined) states.set(before, { _tag: 'Replaced', by: ref })
      waiting.set(subject, ref)
      states.set(ref, { _tag: 'Waiting' })
      continue
    }
    const decided: AdjustmentState =
      e.move._tag === 'Accepted'
        ? { _tag: 'Accepted', by: ref }
        : { _tag: 'Rejected', by: ref, reason: e.move.reason }
    states.set(e.id, decided)
    for (const [subject, x] of waiting) if (x === e.id) waiting.delete(subject)
  }
  return states
}

// The accept of the adjustment that retired a direction; undefined: not retired.
export const retiredBy = (w: Work, direction: DirectionId): EventRef | undefined => {
  const states = adjustmentStates(w)
  for (const x of adjustmentDrafts(w)) {
    const state = states.get(x.ref)
    const retires = x.adjustment._tag === 'RetireDirection' && x.adjustment.direction === direction
    if (retires && state?._tag === 'Accepted') return state.by
  }
  return undefined
}

// The person's words about the roles (P7) that no adjustment of a role answers yet: a model drafts
// one after them.
export const rolesSuggestionsWaiting = (w: Work): ReadonlyArray<Suggestion> => {
  const drafts = adjustmentDrafts(w).filter((x) => 'role' in x.adjustment)
  return [...w.suggestions.values()].filter(
    (y) =>
      y.about._tag === 'Roles' && !drafts.some((x) => Date.parse(x.at) >= Date.parse(y.when)),
  )
}

// --- the check of an adjustment ------------------------------------------------------------------

const no = (message: string, words: string): Refusal =>
  refusal(message, 'Pick', words as NonBlank)

// The model roles after a role adjustment: each one's tier and persistence.
interface ModelRole {
  readonly tier: Tier
  readonly persistent: boolean
}
const modelRolesAfter = (w: Work, a: Adjustment): ReadonlyMap<string, ModelRole> => {
  const roles = new Map<string, ModelRole>()
  for (const r of w.workflow.roles.values()) {
    if (r._tag !== 'Model') continue
    roles.set(r.role, { tier: r.tier, persistent: r.persistence._tag === 'Persistent' })
  }
  const was = roles.get('role' in a ? a.role : '')
  switch (a._tag) {
    case 'AddRole':
      if (a.file.kind === 'agent') {
        roles.set(a.role, { tier: a.file.tier, persistent: a.file.persistence.persistent })
      }
      break
    case 'RemoveRole':
      roles.delete(a.role)
      break
    case 'SetTier':
      if (was !== undefined) roles.set(a.role, { ...was, tier: a.tier })
      break
    case 'SetPersistence':
      if (was !== undefined) roles.set(a.role, { ...was, persistent: a.persistence.persistent })
      break
    default:
      break
  }
  return roles
}

// The roles that host a run: the host plays the high role of each top task (ruling 15).
const hostRoles = (w: Work): ReadonlySet<string> =>
  new Set([
    ...[...w.assignments.values()].filter((a) => a.runs._tag === 'Host').map((a) => a.role),
    ...[...w.taskDrafts.values()].map((t) => t.role),
  ])

// Why a role is in use, so that it cannot be removed; undefined: it is not.
const roleInUse = (d: Derived, role: RoleName): string | undefined => {
  const w = d.moment.work
  const open = [...w.assignments.values()].find(
    (a) => a.role === role && d.states.assignments.get(a.id)?._tag !== 'Ended',
  )
  if (open !== undefined) return `${open.id} plays it`
  const agent = [...w.agents.values()].find(
    (x) => x.role === role && d.states.agents.get(x.id)?._tag !== 'Ended',
  )
  if (agent !== undefined) return `the agent ${agent.id} plays it`
  const names = (r: (typeof w.config.roles)[string]) =>
    r.acts.some((act) =>
      [...('review' in act ? act.review : []), ...('approve' in act ? act.approve : [])].includes(
        role,
      ),
    )
  const actor = Object.entries(w.config.roles).find(([name, r]) => name !== role && names(r))
  if (actor !== undefined) return `an act of ${actor[0]} names it`
  const decide = Object.entries(w.config.decide).find(
    ([maker, by]) => maker === role || JSON.stringify(by).includes(`"${role}"`),
  )
  if (decide !== undefined) return `the decide entry of ${decide[0]} names it`
  for (const dir of w.directions.values()) {
    if (dir._tag !== 'Official') continue
    const current = dir.versions[dir.versions.length - 1]
    const rules = (current?.standards ?? []).flatMap((s) => w.standards.get(s)?.rules ?? [])
    const checked = rules
      .map((e) => w.rules.get(e))
      .find((r) => r?.checkedBy._tag === 'Role' && r.checkedBy.role === role)
    if (checked !== undefined) return `it checks the rule ${checked.id} of ${dir.id}`
  }
  const draft = [...w.taskDrafts.values()].find(
    (t) => t.role === role && d.states.taskDrafts.get(t.id)?._tag === 'Waiting',
  )
  if (draft !== undefined) return `the task draft ${draft.id} waits for it`
  return undefined
}

// What keeps an adjustment out now: the draft and the accept run the same check (ruling 14).
// undefined: it fits the work.
export const adjustmentProblem = (d: Derived, a: Adjustment): Refusal | undefined => {
  const w = d.moment.work
  if (a._tag === 'RetireDirection' || a._tag === 'SetCases') {
    const state = d.states.directions.get(a.direction)
    if (state === undefined) return no(`there is no direction ${a.direction}`, 'name a direction')
    if (state._tag === 'Retired') {
      return no(`${a.direction} is retired (${state.by})`, 'name a direction that is not retired')
    }
    if (state._tag !== 'Official') {
      return no(
        `${a.direction} has no version yet; its draft waits for its accept`,
        'decide its draft first',
      )
    }
    return undefined
  }
  const role = w.workflow.roles.get(a.role)
  if (a._tag === 'AddRole') {
    if (role !== undefined) {
      return no(`there is a role ${a.role} already`, 'give the role a new name')
    }
  } else if (role === undefined) {
    return no(`there is no role ${a.role}`, 'name a role of the workflow')
  } else if (role._tag === 'Program' && a._tag !== 'RemoveRole') {
    return no(`${a.role} is a program; it has no tier and no persistence`, 'name a role of a model')
  }
  if (a._tag === 'RemoveRole') {
    const used = roleInUse(d, a.role)
    if (used !== undefined) {
      return no(`${a.role} is in use: ${used}`, 'remove a role that is not used')
    }
  }
  if (a._tag === 'SetPersistence' && !a.persistence.persistent && hostRoles(w).has(a.role)) {
    return no(
      `${a.role} is the role of the host, which plays the high role of each top task; the host ` +
        'is a terminal, so its role stays persistent',
      'keep the role of the host persistent',
    )
  }
  const after = [...modelRolesAfter(w, a).values()]
  if (a._tag === 'SetTier' || a._tag === 'RemoveRole') {
    const empty = (['high', 'medium', 'low'] as const).find((t) => !after.some((r) => r.tier === t))
    if (empty !== undefined) {
      return no(
        `the workflow would have no ${empty} role; every workflow has the three tiers`,
        `keep a ${empty} role`,
      )
    }
  }
  if (!after.some((r) => r.tier === 'high' && r.persistent)) {
    return no(
      'the workflow would have no persistent high role; the host plays the high role of each top ' +
        'task, and the host is a terminal',
      'keep a persistent high role',
    )
  }
  return undefined
}
