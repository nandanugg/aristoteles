// The Work as the old engine read it: one review record per point of a Reject (v4.1, v4.2), a
// resolve with the result of its escalation, and the small getters that every rule uses. The old
// engine compared objects; here an id names each record (rule 1), and these helpers keep the
// comparisons that the old identity made. Internal to src/engine.
import { type Actor, human } from '../domain/actor.ts'
import { pointsOf } from '../domain/derived.ts'
import type {
  AssignmentId,
  DirectionId,
  EscalationId,
  EvaluationId,
  PointId,
  RejectId,
  ResultId,
  ReviewId,
  RevisionId,
  RoleName,
  RuleEntry,
  StandardEntry,
  TaskId,
  Time,
} from '../domain/ids.ts'
import type {
  Answerer,
  Assignment,
  By,
  Direction,
  Evidence,
  Limit,
  OfficialDirection,
  Result,
  Review,
  Revision,
  Role,
  Rule,
  Standard,
  Task,
  Under,
  Version,
} from '../domain/model.ts'
import type { Work } from '../domain/work.ts'

// --- getters: a missing record here is a bug (the checks look ids up first) ----------------------

const need = <K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V => {
  const value = map.get(key)
  if (value === undefined) throw new Error(`the work has no ${what} ${String(key)}`)
  return value
}
export const taskAt = (w: Work, id: TaskId): Task => need(w.tasks, id, 'task')
export const assignmentAt = (w: Work, id: AssignmentId): Assignment =>
  need(w.assignments, id, 'assignment')
export const resultAt = (w: Work, id: ResultId): Result => need(w.results, id, 'result')
export const roleAt = (w: Work, name: RoleName): Role => need(w.workflow.roles, name, 'role')
export const draftAt = (w: Work, id: RevisionId): Revision<Direction> => need(w.drafts, id, 'draft')
export const directionAt = (w: Work, id: DirectionId): Direction =>
  need(w.directions, id, 'direction')
export const standardAt = (w: Work, entry: StandardEntry): Standard =>
  need(w.standards, entry, 'standard')
export const ruleAt = (w: Work, entry: RuleEntry): Rule => need(w.rules, entry, 'rule')

export const isOpen = (t: Task): boolean => t.end._tag === 'NotEnded'
export const finished = (a: Assignment): boolean => a.end._tag !== 'NotEnded'
export const maxOf = (limit: Limit): number | undefined =>
  limit._tag === 'AtMost' ? limit.max : undefined
export const atOrBefore = (a: Time, b: Time): boolean => Date.parse(a) <= Date.parse(b)

// --- who acts -----------------------------------------------------------------------------------

export const isAssignment = (by: By): by is AssignmentId => typeof by === 'string'
// The actor of an act: an assignment's run, a person, or a model run outside any task.
export const actorOf = (w: Work, by: By): Actor =>
  isAssignment(by) ? assignmentAt(w, by).actor : by
export const isPerson = (w: Work, by: By): boolean => actorOf(w, by)._tag === 'Human'
// Two actors are the same when they are one person, or one run.
export const sameActor = (w: Work, a: By, b: By): boolean => {
  const [x, y] = [actorOf(w, a), actorOf(w, b)]
  if (x._tag === 'Human' || y._tag === 'Human') return x.name === y.name
  return x.run === y.run
}
// The role of an act's actor: an assignment's role; a person or a run has none.
export const roleOf = (w: Work, by: By): Role | undefined =>
  isAssignment(by) ? roleAt(w, assignmentAt(w, by).role) : undefined
export const roleNameOf = (w: Work, by: By): RoleName | undefined =>
  isAssignment(by) ? assignmentAt(w, by).role : undefined
export const tierOf = (role: Role | undefined): string | undefined =>
  role?._tag === 'Model' ? role.tier : undefined
// How a refusal names who acts: "a3 (linter)", or the actor's name.
export const labelOf = (w: Work, by: By): string =>
  isAssignment(by) ? `${by} (${assignmentAt(w, by).role})` : by.name
// The same with the role of a person or a run, as Review.decide and Result.report name it.
export const labelWithRole = (w: Work, by: By): string =>
  isAssignment(by) ? labelOf(w, by) : `${by.name} (${by._tag === 'Human' ? 'person' : by.name})`
// An answerer as a refusal names it.
export const answererLabel = (w: Work, a: Answerer): string =>
  typeof a === 'string' ? labelOf(w, a) : a.name
// An assignment below another: the other is its parent, at any depth.
export const below = (w: Work, a: By, root: By): boolean => {
  if (!isAssignment(a) || !isAssignment(root)) return false
  for (let x = parentOf(w, a); x !== undefined; x = parentOf(w, x)) if (x === root) return true
  return false
}
export const parentOf = (w: Work, a: AssignmentId): AssignmentId | undefined => {
  const p = assignmentAt(w, a).parent
  return p._tag === 'Parent' ? p.id : undefined
}
// A question or an escalation goes to the nearest open assignment above; else to the owner.
export const openAncestorOf = (w: Work, a: AssignmentId): AssignmentId | undefined => {
  for (let x = parentOf(w, a); x !== undefined; x = parentOf(w, x)) {
    if (!finished(assignmentAt(w, x))) return x
  }
  return undefined
}
export const personBy = (name: string): By => human(name)

// --- versions -----------------------------------------------------------------------------------

export const officialAt = (w: Work, d: DirectionId): OfficialDirection | undefined => {
  const direction = w.directions.get(d)
  return direction?._tag === 'Official' ? direction : undefined
}
export const versionAt = (w: Work, d: DirectionId, n: number): Version<Direction> => {
  const v = officialAt(w, d)?.versions[n - 1]
  if (v === undefined) throw new Error(`the work has no version ${d}@${n}`)
  return v
}
export const currentOf = (w: Work, d: DirectionId): Version<Direction> => {
  const official = officialAt(w, d)
  const v = official?.versions[official.versions.length - 1]
  if (v === undefined) throw new Error(`the work has no official direction ${d}`)
  return v
}
// The versions of a task's directions now: a snapshot of a brief, and the person's review.
export const underNowOf = (w: Work, task: Task): Under =>
  new Map(
    task.descriptionAi.directions.flatMap((d) => {
      const official = officialAt(w, d)
      return official ? [[d, currentOf(w, d).number] as const] : []
    }),
  )

// --- the reviews as the old engine kept them -----------------------------------------------------

// What a review is about: a result, a task, a draft or an evaluation; a resolve is about the
// result of its escalation.
export type Target =
  | { readonly _tag: 'Result'; readonly id: ResultId }
  | { readonly _tag: 'Task'; readonly id: TaskId }
  | { readonly _tag: 'Revision'; readonly id: RevisionId }
  | { readonly _tag: 'Evaluation'; readonly id: EvaluationId }

// One old review record: a point of a Reject is one, with the at that its own decide had.
export interface Item {
  readonly id: ReviewId | PointId
  readonly review: Review
  readonly decision: 'Accept' | 'Reject' | 'Escalate'
  readonly of: Target
  readonly by: By
  readonly reason: string | undefined
  readonly evidence: ReadonlyArray<Evidence>
  readonly breaks: RuleEntry | undefined
  readonly redo: boolean
  readonly resolves: EscalationId | undefined
  readonly answerBy: Answerer | undefined
  readonly under: Under
  readonly when: Time
  readonly at: number
  // The Reject of a point, and the first point of that Reject (one act, one stop).
  readonly group: RejectId | undefined
  readonly first: PointId | undefined
}

const itemsOfReview = (w: Work, v: Review): ReadonlyArray<Item> => {
  const base = { review: v, by: v.by as By, under: v.under, when: v.when }
  const plain = {
    ...base,
    id: v.id as ReviewId,
    reason: undefined,
    evidence: [],
    breaks: undefined,
    redo: false,
    resolves: undefined,
    answerBy: undefined,
    at: v.at,
    group: undefined,
    first: undefined,
  }
  switch (v._tag) {
    case 'Accept':
      return [
        {
          ...plain,
          decision: 'Accept',
          of: { _tag: v.of._tag, id: v.of.id } as Target,
          reason: v.reason ?? undefined,
          evidence: v.of.evidence,
        },
      ]
    case 'Reject': {
      const of = v.of
      if (of._tag === 'Revision' || of._tag === 'Evaluation') {
        const target: Target =
          of._tag === 'Revision'
            ? { _tag: 'Revision', id: of.id }
            : { _tag: 'Evaluation', id: of.id }
        return [{ ...plain, decision: 'Reject', of: target, reason: of.reason }]
      }
      const target: Target =
        of._tag === 'Result' ? { _tag: 'Result', id: of.id } : { _tag: 'Task', id: of.id }
      const points = pointsOf(v)
      const first = points[0]?.id
      return points.map(({ id, point }, i) => ({
        ...plain,
        id,
        decision: 'Reject' as const,
        of: target,
        reason: point.text,
        breaks: 'breaks' in point && point.breaks._tag === 'Rule' ? point.breaks.rule : undefined,
        at: v.at + i,
        group: v.id,
        first,
      }))
    }
    case 'Recheck':
      return [
        {
          ...plain,
          decision: 'Reject',
          of: { _tag: 'Result', id: v.of },
          reason: v.reason,
          redo: true,
        },
      ]
    case 'Escalate':
      return [
        {
          ...plain,
          decision: 'Escalate',
          of: { _tag: 'Result', id: v.of },
          reason: v.reason,
          answerBy: v.answerBy,
        },
      ]
    case 'Resolve': {
      const escalated = w.reviews.get(v.escalation)
      const result = escalated?._tag === 'Escalate' ? escalated.of : undefined
      if (result === undefined)
        throw new Error(`${v.id} resolves ${v.escalation}, which is no escalation`)
      // The engine reads a resolve as an Accept of its result; resolves keeps it from counting
      // as an accept.
      return [
        {
          ...plain,
          decision: 'Accept',
          of: { _tag: 'Result', id: result },
          reason: v.resolution,
          evidence: v.evidence,
          resolves: v.escalation,
        },
      ]
    }
  }
}

export interface View {
  readonly items: ReadonlyArray<Item>
  readonly byId: ReadonlyMap<string, Item>
  readonly byTarget: ReadonlyMap<string, ReadonlyArray<Item>>
}

// A Work never changes, so its view is made once.
const views = new WeakMap<Work, View>()
export const viewOf = (w: Work): View => {
  const cached = views.get(w)
  if (cached) return cached
  const items = [...w.reviews.values()].flatMap((v) => itemsOfReview(w, v))
  const byTarget = new Map<string, Array<Item>>()
  for (const item of items) {
    const list = byTarget.get(item.of.id) ?? []
    list.push(item)
    byTarget.set(item.of.id, list)
  }
  const view = { items, byId: new Map(items.map((i) => [i.id as string, i])), byTarget }
  views.set(w, view)
  return view
}
export const reviewItems = (w: Work): ReadonlyArray<Item> => viewOf(w).items
export const itemsOf = (w: Work, target: string): ReadonlyArray<Item> =>
  viewOf(w).byTarget.get(target) ?? []
export const itemAt = (w: Work, id: string): Item | undefined => viewOf(w).byId.get(id)
// The task of a review's target: a result's task, or the task itself; none for a draft.
export const taskOfTarget = (w: Work, of: Target): TaskId | undefined =>
  of._tag === 'Task' ? of.id : of._tag === 'Result' ? resultAt(w, of.id).task : undefined
