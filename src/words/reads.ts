// The reads that the brief and the next steps share (package P5a): the kinds of acts of an
// assignment, the file queue of makers, why a maker is idle, and the outside facts read at once.
// Not re-exported by index.ts: brief.ts re-exports what the CLI imports.
//
// The words are sync (renderBrief is also the engine's measure), but a few old reads touch the
// dir: the digest of a result now, a git revision, the settings file. They run the Effects of
// src/config and outsideOf at once with the live layers, whose work is sync.
import { Effect, Layer } from 'effect'
import type { AssignmentId, ResultId, TaskId, Time } from '../domain/ids.ts'
import type { Assignment, Result, Role, Rule, Tier } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import {
  actsOf,
  checksOf,
  isDo,
  mayChange,
  openDo,
  rulesOf,
  taskAccepted,
  workStop,
} from '../engine/queries.ts'
import { attemptOf } from '../engine/status.ts'
import { readSettings, readSettingsOf } from '../config/settings.ts'
import { type Files, FilesLive, type Spawn, SpawnLive } from '../services/outside.ts'
import { type Outside, outsideOf, type StaleSource } from './common.ts'

// --- the outside, read at once ------------------------------------------------------------------

const OUTSIDE = Layer.mergeAll(FilesLive, SpawnLive)
export const outsideNow = <A>(effect: Effect.Effect<A, never, Files | Spawn>): A =>
  Effect.runSync(effect.pipe(Effect.provide(OUTSIDE)))

// What lives on disk or in git for some results: changed after the report, or made from an
// outside source that moved (P5b's outsideOf).
export const outsideFor = (w: Work, cwd: string, results: ReadonlyArray<Result>): Outside =>
  outsideNow(outsideOf(w, cwd || '.', results))

// A result made from a revision of a source that is no longer the one that an agent recorded
// with work source (two revisions are the same when git resolves them to one commit).
export const staleOf = (w: Work, result: ResultId, cwd: string): StaleSource | undefined => {
  const r = w.results.get(result)
  if (r === undefined) throw new Error(`the work has no result ${result}`)
  return outsideFor(w, cwd, [r]).stale.get(result)
}

// How long a revision of an outside source holds, from aristoteles.yaml (outsideSourceHours). A
// file that the settings refuse is the UI's to report (work ui refuses it, and no command of an
// agent reads the settings): the step then uses the default of readSettingsOf.
export const outsideSourceHours = (cwd: string): number =>
  outsideNow(
    readSettings(cwd || '.').pipe(
      Effect.map((s) => s.outsideSourceHours),
      Effect.catch(() => Effect.succeed(readSettingsOf({}).outsideSourceHours)),
    ),
  )

// --- assignments and their roles -----------------------------------------------------------------

export const assignmentOf = (w: Work, id: AssignmentId): Assignment => {
  const a = w.assignments.get(id)
  if (a === undefined) throw new Error(`the work has no assignment ${id}`)
  return a
}
export const roleOfAssignment = (w: Work, a: Assignment): Role => {
  const role = w.workflow.roles.get(a.role)
  if (role === undefined) throw new Error(`the work has no role ${a.role}`)
  return role
}
// The tier of an assignment's role; a program has none.
export const tierOfAssignment = (w: Work, a: Assignment): Tier | undefined => {
  const role = roleOfAssignment(w, a)
  return role._tag === 'Model' ? role.tier : undefined
}
export const finishedAssignment = (a: Assignment): boolean => a.end._tag !== 'NotEnded'
export const parentId = (a: Assignment): AssignmentId | undefined =>
  a.parent._tag === 'Parent' ? a.parent.id : undefined
// Assignment `x` is above `a`: its parent, at any depth.
export const isAbove = (w: Work, x: AssignmentId, a: Assignment): boolean => {
  for (let y = parentId(a); y !== undefined; y = parentId(assignmentOf(w, y))) {
    if (y === x) return true
  }
  return false
}
// The claim of an assignment now: since when it holds its brief; undefined: it holds none.
export const claimedSince = (w: Work, a: AssignmentId): Time | undefined => {
  const claim = w.meta.get(a)?.claim
  return claim === undefined || claim._tag === 'Free' ? undefined : claim.since
}

export const RANK: { readonly [T in Tier]: number } = { low: 1, medium: 2, high: 3 }

// The roles of a lower tier than the assignment's, in the order of aristoteles.yaml (a program
// has no tier, so it gives none).
export const lowerRoles = (
  w: Work,
  a: Assignment,
): ReadonlyArray<Extract<Role, { readonly _tag: 'Model' }>> => {
  const own = tierOfAssignment(w, a)
  if (own === undefined) return []
  return [...w.workflow.roles.values()].flatMap((r) =>
    r._tag === 'Model' && RANK[r.tier] < RANK[own] ? [r] : [],
  )
}

// What an assignment may do at a time: the old actKinds, by the `when` of the tier guides.
export interface ActKinds {
  readonly do: boolean
  readonly review: boolean
  readonly approve: boolean
  readonly change: boolean
  readonly lower: boolean
  readonly top: boolean
  readonly evaluate: boolean
  readonly any: boolean
}
export const actKinds = (w: Work, a: Assignment, at: Time): ActKinds => {
  const acts = actsOf(w, a.id, at)
  const tier = tierOfAssignment(w, a)
  return {
    do: acts.some((x) => x._tag === 'Do'),
    review: acts.some((x) => x._tag === 'Review' || x._tag === 'Approve'),
    approve: acts.some((x) => x._tag === 'Approve'),
    change: mayChange(w, a.id, a.task, at),
    lower: lowerRoles(w, a).length > 0,
    top: a.parent._tag === 'GivenByPerson' && tier !== 'low',
    evaluate: tier === 'high',
    any: true,
  }
}
// A low role that makes nothing: it checks the checks of its role on one result.
export const lowChecker = (w: Work, a: Assignment, at: Time): boolean =>
  tierOfAssignment(w, a) === 'low' && !actKinds(w, a, at).do

// A low checker checks its checks; everyone else reads every rule of the task.
export const rulesForAt = (w: Work, a: Assignment, at: Time): ReadonlyArray<Rule> =>
  tierOfAssignment(w, a) === 'low' && actKinds(w, a, at).review
    ? checksOf(w, a.id)
    : rulesOf(w, a.task)

// The attempt of a maker in words: the try it is on, never above its limit (bug 9: one count for
// the brief, the card and work next).
export const attemptWords = (w: Work, a: AssignmentId): string => {
  const { number, max } = attemptOf(w, a)
  return `attempt ${number}${max._tag === 'AtMost' ? ` of ${max.max}` : ''}`
}

// --- the file queue of makers --------------------------------------------------------------------

// A maker that reports a commit works in its own git worktree. Any other maker writes the files of
// its workspace in the dir, which all makers share.
const writesInPlace = (w: Work, a: Assignment): ReadonlyArray<string> =>
  w.config.roles[a.role]?.output?.includes('@')
    ? []
    : (w.tasks.get(a.task)?.descriptionAi.workspace ?? []).map((x) => x.path)
export const overlap = (x: string, y: string): boolean =>
  x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)

// One maker for each file at a time (Nanda, 2026-11-08): makers that write one file of the dir
// take turns in the order of their assigns, and a turn ends when its maker finishes. The file
// that maker `a` waits for and the earliest open maker before it; undefined: it is a's turn.
export const fileTurn = (
  w: Work,
  a: AssignmentId,
  _at: Time,
): { readonly before: AssignmentId; readonly file: string } | undefined => {
  const me = assignmentOf(w, a)
  if (!isDo(w, me.role)) return undefined
  const files = writesInPlace(w, me)
  for (const x of w.assignments.values()) {
    if (x.id === a) return undefined
    if (finishedAssignment(x) || !isDo(w, x.role)) continue
    for (const f of writesInPlace(w, x)) {
      const file = files.find((g) => overlap(f, g))
      if (file !== undefined) return { before: x.id, file }
    }
  }
  return undefined
}
// The makers that wait for maker x to finish.
export const waitersOf = (w: Work, x: AssignmentId, at: Time): ReadonlyArray<AssignmentId> =>
  [...w.assignments.values()].filter((y) => fileTurn(w, y.id, at)?.before === x).map((y) => y.id)

// Why a maker makes no result now (so that its parent finishes it when another maker waits for
// its file); undefined while it can work.
export type Idle =
  | { readonly _tag: 'TaskClosed'; readonly task: TaskId }
  | { readonly _tag: 'TaskAccepted'; readonly task: TaskId }
  | { readonly _tag: 'NoAttemptsLeft' }
  | { readonly _tag: 'WaitsForEvaluation'; readonly task: TaskId }
  | { readonly _tag: 'NeedsTask'; readonly task: TaskId; readonly need: TaskId }
export const idleOf = (w: Work, x: AssignmentId, at: Time): Idle | undefined => {
  const maker = assignmentOf(w, x)
  const task = w.tasks.get(maker.task)
  if (task === undefined) throw new Error(`the work has no task ${maker.task}`)
  if (task.end._tag !== 'NotEnded') return { _tag: 'TaskClosed', task: task.id }
  if (taskAccepted(w, task.id, at)) return { _tag: 'TaskAccepted', task: task.id }
  if (!openDo(w, x)) return { _tag: 'NoAttemptsLeft' }
  if (workStop(w, task.id, at)) return { _tag: 'WaitsForEvaluation', task: task.id }
  const need = task.needs.find((n) => !taskAccepted(w, n, at))
  if (need !== undefined) return { _tag: 'NeedsTask', task: task.id, need }
  return undefined
}
export const idleWords = (w: Work, idle: Idle): string => {
  switch (idle._tag) {
    case 'TaskClosed':
      return `its task ${idle.task} is closed`
    case 'TaskAccepted':
      return `${idle.task} is accepted`
    case 'NoAttemptsLeft':
      return 'it has no attempts left'
    case 'WaitsForEvaluation':
      return `${idle.task} waits for an evaluation, so it cannot report`
    case 'NeedsTask':
      return (
        `${idle.task} needs ${idle.need} (${w.tasks.get(idle.need)?.name}), which is not ` +
        'accepted, so it cannot report'
      )
  }
}
