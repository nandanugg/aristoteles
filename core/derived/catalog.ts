// The derived catalog (plan/rebuild/BUILD.md 3.4): one function per state, in the order of
// derive(). A dependent takes the state of its dependency as a parameter (R1: no cascade event).
import {
  directionAt,
  draftAt,
  madeBy,
  ruleAt,
  vetoOf,
  versionAt,
  versionNumberOf,
} from './reads.ts'
import type {
  Derive,
  DirectionState,
  DirectionStateOf,
  RevisionState,
  RevisionStateOf,
  SendState,
  SendStateOf,
  States,
} from './types.ts'
import {
  type Direction,
  type EventRef,
  type Revision,
  type RevisionId,
  type SessionId,
  versionIdOf,
  type VersionId,
  type Work,
} from '../schema/index.ts'

const need = <K, V>(value: V | undefined, what: string, key: K): V => {
  if (value === undefined) throw new Error(`the work has no ${what} ${String(key)}`)
  return value
}

// --- 1. DirectionState ---------------------------------------------------------------------------
export const directionStateOf: DirectionStateOf = (m, id) => {
  const d = directionAt(m.work, id)
  if (d._tag === 'NewDirection') return { _tag: 'Drafted' }
  const current = d.versions[d.versions.length - 1] ?? d.versions[0]
  return { _tag: 'Official', current: versionIdOf(current) }
}

// --- 2. RevisionState (S2, S6, S7) ---------------------------------------------------------------
// S7: a rule id that this draft adds and that the current version of another direction has, or
// that an earlier pending draft of another direction adds (the earlier one keeps it); or an id
// that the draft names twice.
const conflictOf = (
  w: Work,
  x: Revision<Direction>,
): { readonly rule: string; readonly with: RevisionId | VersionId } | undefined => {
  const base = x._tag === 'Change' ? versionAt(w, x.of, versionNumberOf(x.base)) : undefined
  const before = new Set((base?.standards ?? []).flatMap((e) => w.standards.get(e)?.rules ?? []))
  const rulesOf = (standards: ReadonlyArray<string>) =>
    standards.flatMap((e) => w.standards.get(e as never)?.rules ?? [])
  const added = rulesOf(x.standards)
    .filter((r) => !before.has(r))
    .map((r) => ruleAt(w, r).id)
  for (const d of w.directions.values()) {
    if (d._tag !== 'Official' || d.id === x.of) continue
    const now = d.versions[d.versions.length - 1] ?? d.versions[0]
    const ids = new Set(rulesOf(now.standards).map((r) => ruleAt(w, r).id))
    const twin = added.find((id) => ids.has(id))
    if (twin !== undefined) return { rule: twin, with: versionIdOf(now) }
  }
  for (const y of w.drafts.values()) {
    if (y.of === x.of || y.at >= x.at || !pending(w, y)) continue
    const ids = new Set(rulesOf(y.standards).map((r) => ruleAt(w, r).id))
    const twin = added.find((id) => ids.has(id))
    if (twin !== undefined) return { rule: twin, with: y.id }
  }
  const all = rulesOf(x.standards).map((r) => ruleAt(w, r).id)
  const repeated = all.find((id, i) => all.indexOf(id) !== i)
  return repeated === undefined ? undefined : { rule: repeated, with: x.id }
}
// A draft that may still become official: not official, not vetoed, built on the current version.
const pending = (w: Work, y: Revision<Direction>): boolean => {
  if (madeBy(w, y.id) !== undefined || vetoOf(w, y.id) !== undefined) return false
  const d = w.directions.get(y.of)
  if (d?._tag !== 'Official') return y._tag === 'New'
  const now = d.versions[d.versions.length - 1] ?? d.versions[0]
  return y._tag === 'Change' && y.base === versionIdOf(now)
}
export const revisionStateOf: RevisionStateOf = (m, id, { direction }) => {
  const w = m.work
  const x = draftAt(w, id)
  const made = madeBy(w, id)
  if (made !== undefined) return { _tag: 'Official', version: versionIdOf(made) }
  // S6: Outdated before Vetoed: a draft on an old base is not revised again.
  if (direction._tag === 'Official' && (x._tag === 'New' || x.base !== direction.current)) {
    return { _tag: 'Outdated', current: direction.current }
  }
  const conflict = conflictOf(w, x)
  if (conflict !== undefined) return { _tag: 'Conflicted', ...conflict }
  const veto = vetoOf(w, id)
  if (veto !== undefined) return { _tag: 'Vetoed', by: veto.id }
  return { _tag: 'Waiting' }
}

// --- 3. SendState (C5) ---------------------------------------------------------------------------
export const sendStateOf: SendStateOf = (m, id) => {
  const send = need(
    m.work.sends.find((s) => s.id === id),
    'send',
    id,
  )
  if (send.state._tag === 'Delivered') return { _tag: 'Delivered', at: send.state.at }
  if (send.state._tag === 'Dropped') {
    return { _tag: 'Dropped', at: send.state.at, why: send.state.why }
  }
  return { _tag: 'Pending' }
}

// The terminal that a send goes into: the one that the person named.
export const sendSessionOf = (send: Work['sends'][number]): SessionId => send.from.to.session

// derive: each state once, in the order of the edges.
export const derive: Derive = (m) => {
  const w = m.work
  const directions = new Map<Direction['id'], DirectionState>()
  for (const d of w.directions.keys()) directions.set(d, directionStateOf(m, d))

  const revisions = new Map<RevisionId, RevisionState>()
  for (const x of w.drafts.values()) {
    const direction = need(directions.get(x.of), 'direction', x.of)
    revisions.set(x.id, revisionStateOf(m, x.id, { direction }))
  }

  const sends = new Map<EventRef, SendState>()
  for (const s of w.sends) sends.set(s.id, sendStateOf(m, s.id))

  const states: States = { directions, revisions, sends }
  return { moment: m, states }
}
