// The reads of the facts of a Work that the states are made from: the review items (one per point
// of a Reject), the rules and versions, who may act, the deciders of a result, the answers of a
// Reject, the stops, and the blockers of a result. Nothing here reads an assignment's end (the
// states do: C1).
// A missing record is a bug here: callers look ids up first (canAct does).
import {
  type Counted,
  leavesOf,
  type Matches,
  metAt,
  nextLeaves,
  type Tree,
  waitsForWords,
} from './deciders.ts'
import type { DraftLeaf, OwnerAcceptWhy } from './types.ts'
import {
  type Act,
  type Actor,
  type Answerer,
  type Assignment,
  applies,
  type AssignmentId,
  type Blocker,
  type By,
  type DeciderLeaf,
  type Deciders,
  type Direction,
  type DirectionId,
  type EscalationId,
  type Evaluation,
  type EventRef,
  type EvaluationId,
  type Evidence,
  type Exhaustion,
  type Limit,
  type Meta,
  type OfficialDirection,
  type Permission,
  type PointId,
  pointId,
  type Problem,
  pointsOf,
  type Question,
  type RejectId,
  type ReportedWork,
  type Result,
  type ResultId,
  type Review,
  type ReviewId,
  type Revision,
  type RevisionId,
  type Role,
  type RoleName,
  type Rule,
  type Run,
  type RunId,
  type RuleEntry,
  type Standard,
  type StandardEntry,
  type Stop,
  type Task,
  type TaskId,
  type Time,
  type Under,
  type Version,
  type VersionId,
  type Where,
  type Work,
} from '../schema/index.ts'

// --- getters -------------------------------------------------------------------------------------

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
export const standardAt = (w: Work, e: StandardEntry): Standard => need(w.standards, e, 'standard')
export const ruleAt = (w: Work, e: RuleEntry): Rule => need(w.rules, e, 'rule')

// A task's end is a fact of its record; the TaskState of an ended task is Closed or Replaced.
export const isOpenTask = (t: Task): boolean => t.end._tag === 'NotEnded'
export const maxOf = (limit: Limit): number | undefined =>
  limit._tag === 'AtMost' ? limit.max : undefined
const atOrBefore = (a: Time, b: Time): boolean => Date.parse(a) <= Date.parse(b)

// --- who acts ------------------------------------------------------------------------------------

export const isAssignment = (by: By): by is AssignmentId => typeof by === 'string'
export const actorOf = (w: Work, by: By): Actor =>
  isAssignment(by) ? assignmentAt(w, by).actor : by
export const isPerson = (w: Work, by: By): boolean => actorOf(w, by)._tag === 'Human'
// Two actors are the same when they are one person, or one run.
export const sameActor = (w: Work, a: By, b: By): boolean => {
  const [x, y] = [actorOf(w, a), actorOf(w, b)]
  if (x._tag === 'Human' || y._tag === 'Human') return x.name === y.name
  return x.run === y.run
}
export const roleOf = (w: Work, by: By): Role | undefined =>
  isAssignment(by) ? roleAt(w, assignmentAt(w, by).role) : undefined
export const roleNameOf = (w: Work, by: By): RoleName | undefined =>
  isAssignment(by) ? assignmentAt(w, by).role : undefined
export const tierOf = (role: Role | undefined): string | undefined =>
  role?._tag === 'Model' ? role.tier : undefined
// How a refusal names who acts: "a3 (linter)", or the actor's name.
export const labelOf = (w: Work, by: By): string =>
  isAssignment(by) ? `${by} (${assignmentAt(w, by).role})` : by.name
export const labelWithRole = (w: Work, by: By): string =>
  isAssignment(by) ? labelOf(w, by) : `${by.name} (${by._tag === 'Human' ? 'person' : by.name})`
export const answererLabel = (w: Work, a: Answerer): string =>
  typeof a === 'string' ? labelOf(w, a) : a.name
export const parentOf = (w: Work, a: AssignmentId): AssignmentId | undefined => {
  const p = assignmentAt(w, a).parent
  return p._tag === 'Parent' ? p.id : undefined
}
// An assignment below another: the other is its parent, at any depth.
export const below = (w: Work, a: By, root: By): boolean => {
  if (!isAssignment(a) || !isAssignment(root)) return false
  for (let x = parentOf(w, a); x !== undefined; x = parentOf(w, x)) if (x === root) return true
  return false
}

// --- versions ------------------------------------------------------------------------------------

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
export const versionNumberOf = (id: VersionId): number => Number(id.slice(id.lastIndexOf('@') + 1))

// --- the review items: one per point of a Reject, a resolve as an Accept of its result ----------

export type Target =
  | { readonly _tag: 'Result'; readonly id: ResultId }
  | { readonly _tag: 'Task'; readonly id: TaskId }
  | { readonly _tag: 'Revision'; readonly id: RevisionId }
  | { readonly _tag: 'Evaluation'; readonly id: EvaluationId }

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
  readonly under: Under
  readonly when: Time
  readonly at: number
  // The Reject of a point, and the first point of that Reject (one act, one stop).
  readonly group: RejectId | undefined
  readonly first: PointId | undefined
}

const itemsOfReview = (w: Work, v: Review): ReadonlyArray<Item> => {
  const plain = {
    review: v,
    by: v.by as By,
    under: v.under,
    when: v.when,
    id: v.id as ReviewId,
    reason: undefined,
    evidence: [],
    breaks: undefined,
    redo: false,
    resolves: undefined,
    at: v.at,
    group: undefined,
    first: undefined,
  }
  switch (v._tag) {
    case 'Accept': {
      const of: Target = { _tag: v.of._tag, id: v.of.id } as Target
      const evidence = v.of.evidence
      return [{ ...plain, decision: 'Accept', of, reason: v.reason ?? undefined, evidence }]
    }
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
    case 'Recheck': {
      const of: Target = { _tag: 'Result', id: v.of }
      return [{ ...plain, decision: 'Reject', of, reason: v.reason, redo: true }]
    }
    case 'Escalate':
      return [
        { ...plain, decision: 'Escalate', of: { _tag: 'Result', id: v.of }, reason: v.reason },
      ]
    case 'Resolve': {
      const escalated = w.reviews.get(v.escalation)
      if (escalated?._tag !== 'Escalate') {
        throw new Error(`${v.id} resolves ${v.escalation}, which is no escalation`)
      }
      // A resolve reads as an Accept of its result; resolves keeps it from counting as one.
      return [
        {
          ...plain,
          decision: 'Accept',
          of: { _tag: 'Result', id: escalated.of },
          reason: v.resolution,
          evidence: v.evidence,
          resolves: v.escalation,
        },
      ]
    }
  }
}

interface View {
  readonly items: ReadonlyArray<Item>
  readonly byId: ReadonlyMap<string, Item>
  readonly byTarget: ReadonlyMap<string, ReadonlyArray<Item>>
}
// A Work never changes, so its view is made once.
const views = new WeakMap<Work, View>()
const viewOf = (w: Work): View => {
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
export const taskOfTarget = (w: Work, of: Target): TaskId | undefined =>
  of._tag === 'Task' ? of.id : of._tag === 'Result' ? resultAt(w, of.id).task : undefined
export const isAcceptItem = (r: Item): boolean =>
  r.decision === 'Accept' && r.resolves === undefined
export const isRejectItem = (r: Item): boolean => r.decision === 'Reject'
export const hasEvidence = (evidence: ReadonlyArray<Evidence>): boolean =>
  evidence.some((e) => e.at !== '' && e.says !== '')
// The records of a target's reviews, each once, in their order.
export const reviewsOf = (w: Work, target: string): ReadonlyArray<Review> => [
  ...new Set(itemsOf(w, target).map((i) => i.review)),
]

// --- what a direction says -----------------------------------------------------------------------

// A version, or a draft's proposal: what one direction says. number: null for a proposal.
export interface Content {
  readonly of: DirectionId
  readonly number: number | null
  readonly says: string
  readonly standards: ReadonlyArray<StandardEntry>
}
const contentOf = (v: Version<Direction>): Content => ({
  of: v.of,
  number: v.number,
  says: v.says,
  standards: v.standards,
})
const contentAt = (w: Work, d: DirectionId, n: number): Content => contentOf(versionAt(w, d, n))
const contentNow = (w: Work, d: DirectionId): Content => contentOf(currentOf(w, d))

// A draft is official when a version has it as its revision.
export const madeBy = (w: Work, draft: RevisionId): Version<Direction> | undefined => {
  const d = w.directions.get(draftAt(w, draft).of)
  return d?._tag === 'Official' ? d.versions.find((v) => v.revision === draft) : undefined
}
// The directions that a task follows: the official ones that it names.
export const directionIdsOf = (w: Work, task: TaskId): ReadonlyArray<DirectionId> =>
  taskAt(w, task).descriptionAi.directions.filter((d) => officialAt(w, d) !== undefined)
const applicableIn = (w: Work, content: Content, task: TaskId): ReadonlyArray<Standard> => {
  const context = taskAt(w, task).descriptionAi.context
  return content.standards.map((e) => standardAt(w, e)).filter((s) => applies(s.where, context))
}
export const rulesOfStandard = (w: Work, s: Standard): ReadonlyArray<Rule> =>
  s.rules.map((e) => ruleAt(w, e))
// The rules of a task: those of its directions that apply to it, each once.
export const rulesOf = (w: Work, task: TaskId): ReadonlyArray<Rule> => {
  const entries = directionIdsOf(w, task).flatMap((d) =>
    applicableIn(w, contentNow(w, d), task).flatMap((s) => s.rules),
  )
  return [...new Set(entries)].map((e) => ruleAt(w, e))
}
const sameWhere = (a: Where, b: Where): boolean => {
  if (a._tag === 'Everywhere' || b._tag === 'Everywhere') return a._tag === b._tag
  return (
    a.conditions.size === b.conditions.size &&
    [...a.conditions].every(([k, values]) => {
      const others = b.conditions.get(k)
      return (
        others !== undefined &&
        others.length === values.length &&
        values.every((v) => others.includes(v))
      )
    })
  )
}
const sameStandard = (x: Standard, y: Standard): boolean =>
  x.entry === y.entry ||
  (x.id === y.id &&
    x.says === y.says &&
    sameWhere(x.where, y.where) &&
    x.rules.length === y.rules.length &&
    x.rules.every((r) => y.rules.includes(r)))
// Two versions say the same to a task when the spirit and the standards that apply are the same.
const sameFor = (w: Work, v: Content, now: Content, task: TaskId): boolean => {
  if (v.of === now.of && v.number !== null && v.number === now.number) return true
  const [a, b] = [applicableIn(w, v, task), applicableIn(w, now, task)]
  return (
    v.says === now.says &&
    a.length === b.length &&
    a.every((s) => b.some((t) => sameStandard(s, t)))
  )
}

// --- acts and who may do them --------------------------------------------------------------------

// A grant covers an act from its own time to its until, and before its revoke.
const covers = (x: Permission, when: Time): boolean =>
  atOrBefore(x.when, when) &&
  atOrBefore(when, x.until) &&
  (x.revoked._tag === 'NotRevoked' || Date.parse(when) < Date.parse(x.revoked.at))

// The acts of an actor at a time: the standing acts of its role, and the permissions that cover.
export const actsOf = (w: Work, by: By, when: Time): ReadonlyArray<Act> => {
  const role = roleOf(w, by)
  if (role === undefined) return []
  const granted = [...w.permissions.values()].filter((x) => x.to === role.role && covers(x, when))
  return [...role.acts, ...granted.map((x) => x.act)]
}
const targetsOf = (act: Act): ReadonlyArray<string> =>
  act._tag === 'Do' ? [] : act._tag === 'Change' ? act.changesOf : act.resultsOf
// An act names a target; a direction counts only when it is official.
const names = (w: Work, act: Act, target: string): boolean =>
  targetsOf(act).includes(target) &&
  (act._tag !== 'Change' ||
    !w.directions.has(target as DirectionId) ||
    officialAt(w, target as DirectionId) !== undefined)
export const can = (
  w: Work,
  by: By,
  act: 'Review' | 'Approve' | 'Change',
  target: string,
  when: Time,
): boolean => actsOf(w, by, when).some((a) => a._tag === act && names(w, a, target))
// Nobody gives more than they may do: the giver owns each target, or has that act on it.
export const mayGive = (w: Work, by: By, act: Act, when: Time): boolean => {
  const name = actorOf(w, by).name
  const own: ReadonlyArray<Act> = isPerson(w, by)
    ? [...w.assignments.values()]
        .filter((a) => a.actor.name === name)
        .flatMap((a) => roleAt(w, a.role).acts)
    : actsOf(w, by, when)
  const ownerOf = (t: string) =>
    act._tag === 'Change'
      ? (w.tasks.get(t as TaskId)?.owner ?? w.directions.get(t as DirectionId)?.owner)
      : w.workflow.owner
  return targetsOf(act).every(
    (t) => ownerOf(t)?.name === name || own.some((x) => x._tag === act._tag && names(w, x, t)),
  )
}
export const isDo = (w: Work, role: string): boolean =>
  w.workflow.roles.get(role as RoleName)?.acts.some((a) => a._tag === 'Do') ?? false

// --- tasks ---------------------------------------------------------------------------------------

// A task is in the tree of another when it is that task or serves it, at any depth.
export const within = (w: Work, task: TaskId, root: TaskId): boolean => {
  for (let t: TaskId | undefined = task; t !== undefined;) {
    if (t === root) return true
    const serves: Task['serves'] | undefined = w.tasks.get(t)?.serves
    t = serves?._tag === 'Serves' ? serves.task : undefined
  }
  return false
}
export const partsOf = (w: Work, task: TaskId): ReadonlyArray<Task> =>
  [...w.tasks.values()].filter((t) => t.serves._tag === 'Serves' && t.serves.task === task)
// The top of a task's tree as it was opened: the task that serves no other.
export const rootOf = (w: Work, task: TaskId): TaskId => {
  let t = task
  for (let s = w.tasks.get(t)?.serves; s?._tag === 'Serves'; s = w.tasks.get(t)?.serves) {
    t = s.task
  }
  return t
}
// A remade task is replaced by its remake: the task of now.
export const currentTask = (w: Work, task: TaskId): TaskId => {
  let t = task
  for (let end = w.tasks.get(t)?.end; end?._tag === 'Replaced'; end = w.tasks.get(t)?.end) {
    t = end.next
  }
  return t
}
// An open task outside the tree of a task that needs the task or one of its open parts.
export const neederOf = (w: Work, task: TaskId): Task | undefined =>
  [...w.tasks.values()].find(
    (t) =>
      isOpenTask(t) &&
      !within(w, t.id, task) &&
      t.needs.some((n) => isOpenTask(taskAt(w, n)) && within(w, n, task)),
  )
export const resultsOf = (w: Work, task: TaskId): ReadonlyArray<Result> =>
  [...w.results.values()].filter((r) => r.task === task)
export const latestResultOf = (w: Work, task: TaskId): Result | undefined =>
  resultsOf(w, task).at(-1)
// A Change act on a task covers the parts of that task too; the owner may always change it.
export const mayChange = (w: Work, by: By, target: DirectionId | TaskId, when: Time): boolean => {
  const task = w.tasks.get(target as TaskId)
  const owner = task?.owner ?? w.directions.get(target as DirectionId)?.owner
  if (owner !== undefined && actorOf(w, by).name === owner.name) return true
  if (can(w, by, 'Change', target, when)) return true
  return (
    task !== undefined &&
    actsOf(w, by, when).some(
      (a) =>
        a._tag === 'Change' &&
        a.changesOf.some((t) => w.tasks.has(t as TaskId) && within(w, task.id, t as TaskId)),
    )
  )
}
// The question is a fact while its status is Open; QuestionState adds Irrelevant for its readers.
export const openQuestions = (w: Work, target: TaskId | ResultId): ReadonlyArray<Question> =>
  [...w.questions.values()].filter((q) => q.status._tag === 'Open' && q.stops === target)

// --- who decides a result ------------------------------------------------------------------------

const makerRole = (w: Work, result: ResultId): RoleName =>
  assignmentAt(w, resultAt(w, result).by).role
export const deciderOf = (w: Work, result: ResultId): Deciders | undefined =>
  w.workflow.decide.get(makerRole(w, result))
export const sameRole =
  (w: Work): Matches =>
  (leaf, act) =>
    leaf._tag === 'Role' && roleNameOf(w, act.by) === leaf.role
const isLeafOf = (w: Work, by: By) => (leaf: DeciderLeaf) =>
  leaf._tag === 'Role' && leaf.role === roleNameOf(w, by)
export const coversMaker = (w: Work, by: By, r: ResultId, when: Time): boolean =>
  can(w, by, 'Review', makerRole(w, r), when) || can(w, by, 'Approve', makerRole(w, r), when)
export const decidesResults = (w: Work, by: By, r: ResultId, when: Time): boolean => {
  const who = deciderOf(w, r)
  return who
    ? leavesOf<DeciderLeaf>(who).some(isLeafOf(w, by))
    : can(w, by, 'Approve', makerRole(w, r), when)
}
// A decider's accept says where it read the result; it counts with the acts of its time.
const decides = (w: Work, a: Item, r: ResultId): boolean =>
  decidesResults(w, a.by, r, a.when) && hasEvidence(a.evidence)
const lastTaskReject = (w: Work, task: TaskId): number =>
  itemsOf(w, task).filter(isRejectItem).at(-1)?.at ?? 0
// The accepts of deciders that count now: after the latest Reject of the task, under versions
// that say the same to the task as the current ones.
export const decidingNow = (w: Work, r: ResultId): ReadonlyArray<Item> => {
  const task = resultAt(w, r).task
  return itemsOf(w, r).filter(
    (a) =>
      isAcceptItem(a) &&
      decides(w, a, r) &&
      a.at > lastTaskReject(w, task) &&
      directionIdsOf(w, task).every((d) => {
        const n = a.under.get(d)
        return n !== undefined && sameFor(w, contentAt(w, d, n), contentNow(w, d), task)
      }),
  )
}
export const decisionMet = (w: Work, r: ResultId, accepts: ReadonlyArray<Counted>): boolean => {
  const who = deciderOf(w, r)
  return who ? metAt(who, accepts, sameRole(w)) !== undefined : accepts.length > 0
}
// Whether the decision of a result waits for the accept of `by` now (B3: the turn of an Order).
export const decidesNow = (w: Work, by: By, r: ResultId, when: Time): boolean => {
  const who = deciderOf(w, r)
  return who
    ? nextLeaves(who, decidingNow(w, r), sameRole(w)).some(isLeafOf(w, by))
    : decidesResults(w, by, r, when)
}
export const decisionWaitsOn = (w: Work, r: ResultId): ReadonlyArray<DeciderLeaf> => {
  const who = deciderOf(w, r)
  return who ? nextLeaves(who, decidingNow(w, r), sameRole(w)) : []
}
export const decisionWaitsFor = (w: Work, r: ResultId, accepts: ReadonlyArray<Counted>): string => {
  const who = deciderOf(w, r)
  return who ? waitsForWords(who, accepts, sameRole(w)) : 'a role that decides it'
}

// A recorded review counts with the acts that its reviewer had at its own time.
const rightChecker = (w: Work, rule: Rule, a: Item, r: ResultId): boolean =>
  rule.checkedBy._tag === 'Role'
    ? roleNameOf(w, a.by) === rule.checkedBy.role && coversMaker(w, a.by, r, a.when)
    : decidesResults(w, a.by, r, a.when)
export const evidenceFor = (
  w: Work,
  rule: Rule,
  r: ResultId,
  accepts: ReadonlyArray<Item>,
): ReadonlyArray<Evidence> =>
  accepts
    .filter((a) => rightChecker(w, rule, a, r))
    .flatMap((a) => a.evidence)
    .filter((e) => e.meets === rule.entry && e.at !== '')

// --- attempts ------------------------------------------------------------------------------------

// The person criticises as the owner; a person in a role that reviews the maker is a reviewer.
export const isCriticism = (w: Work, r: Pick<Item, 'by' | 'of' | 'when'>): boolean =>
  isPerson(w, r.by) && !(r.of._tag === 'Result' && coversMaker(w, r.by, r.of.id, r.when))
// Only a fault uses an attempt: a Reject of a reviewer or a decider.
const isFault = (w: Work, r: Item): boolean => isRejectItem(r) && !r.redo && !isCriticism(w, r)
// A result made under versions that still say the same to its task.
const underNow = (w: Work, result: Result): boolean =>
  directionIdsOf(w, result.task).every((d) => {
    const n = result.under.get(d)
    return n === undefined || sameFor(w, contentAt(w, d, n), contentNow(w, d), result.task)
  })
const decided = (w: Work, r: ResultId): boolean =>
  decisionMet(
    w,
    r,
    itemsOf(w, r).filter((a) => isAcceptItem(a) && decides(w, a, r)),
  ) || itemsOf(w, r).some((v) => isRejectItem(v) && !isFault(w, v))
const decidedBefore = (w: Work, r: ResultId, at: number): boolean =>
  decisionMet(
    w,
    r,
    itemsOf(w, r).filter((a) => isAcceptItem(a) && decides(w, a, r) && a.at < at),
  )
// The tries that count against a maker: a result under versions that still say the same, with a
// fault before its deciders decided it, or not decided yet.
export const usedBy = (w: Work, a: AssignmentId): number =>
  [...w.results.values()].filter(
    (r) =>
      r.by === a &&
      underNow(w, r) &&
      (itemsOf(w, r.id).some((v) => isFault(w, v) && !decidedBefore(w, r.id, v.at)) ||
        !decided(w, r.id)),
  ).length

// --- the answers of a Reject ---------------------------------------------------------------------

const answersInclude = (ids: ReadonlyArray<string>, r: Item): boolean =>
  ids.includes(r.id) || (r.group !== undefined && ids.includes(r.group))
export const answeredByVersion = (w: Work, r: Item): boolean =>
  [...w.drafts.values()].some((d) => answersInclude(d.answers, r) && madeBy(w, d.id) !== undefined)
// Two results are the same work: the same change (patch, for a commit), else the same digest.
const sameWork = (x: ReportedWork, y: ReportedWork): boolean =>
  x._tag === 'Commit' && y._tag === 'Commit' && x.patch !== '' && y.patch !== ''
    ? x.patch === y.patch
    : x.digest !== '' && x.digest === y.digest
// The rule of a task now that stands for the rule of a point: itself, its id, or a superseder.
const ruleNowFor = (w: Work, task: TaskId, entry: RuleEntry): Rule | undefined => {
  const old = ruleAt(w, entry)
  const now = rulesOf(w, task)
  return (
    now.find((x) => x.entry === entry) ??
    now.find((x) => x.id === old.id) ??
    now.find((x) => x.supersedes.includes(entry))
  )
}
// An official draft, a split, or a remake answers a Reject; a Reject that names a rule is also
// answered by a later, changed result with evidence for that rule; a recheck by any later result.
export const answeredItem = (w: Work, r: Item): boolean => {
  if (w.changes.some((c) => answersInclude(c.answers, r)) || answeredByVersion(w, r)) return true
  const task = taskOfTarget(w, r.of)
  if (task === undefined) return false
  const later = resultsOf(w, task).filter((x) => x.at > r.at)
  if (r.redo) return later.length > 0
  const rejected = r.of._tag === 'Result' ? resultAt(w, r.of.id) : undefined
  const changed = (x: Result) => !(rejected !== undefined && sameWork(x.work, rejected.work))
  const breaks = r.breaks
  if (breaks === undefined) return false
  const rules = [ruleAt(w, breaks), ruleNowFor(w, task, breaks)].filter((x) => x !== undefined)
  return later.some((x) => {
    const accepts = itemsOf(w, x.id).filter(isAcceptItem)
    return changed(x) && rules.some((rule) => evidenceFor(w, rule, x.id, accepts).length > 0)
  })
}
export const answered = (w: Work, review: ReviewId | PointId): boolean => {
  const r = itemAt(w, review)
  if (r !== undefined) return answeredItem(w, r)
  const points = reviewItems(w).filter((i) => i.group === review)
  return points.length > 0 && points.every((p) => answeredItem(w, p))
}
// The first Reject of a task itself that no change answered.
export const openTaskReject = (w: Work, task: TaskId): Item | undefined =>
  itemsOf(w, task).find((r) => isRejectItem(r) && !answeredItem(w, r))

// --- stops and evaluations -----------------------------------------------------------------------

// The person's Reject of a task, or the person's criticism of one of its results.
export const isPersonStop = (w: Work, r: Item): boolean =>
  isRejectItem(r) &&
  !r.redo &&
  (r.of._tag === 'Task' ? isPerson(w, r.by) : r.of._tag === 'Result' && isCriticism(w, r))
// The person's open Rejects of a task or its results; with tree, anywhere under the task.
// C4: a Reject of a part that ended (closed or replaced) does not count (open: false skips it).
export const personRejectItems = (w: Work, task: TaskId, tree: boolean): ReadonlyArray<Item> =>
  reviewItems(w).filter((r) => {
    if (!isRejectItem(r) || !isPerson(w, r.by) || answeredItem(w, r)) return false
    const of = taskOfTarget(w, r.of)
    if (of === undefined) return false
    if (!tree) return of === task
    return within(w, of, task) && (of === task || isOpenTask(taskAt(w, of)))
  })
export const exhaustionResult = (w: Work, x: Exhaustion): Result => {
  const fault = itemAt(w, x.fault)
  if (fault?.of._tag !== 'Result') throw new Error(`${x.id} names ${x.fault}, no fault of a result`)
  return resultAt(w, fault.of.id)
}
const exhaustionTask = (w: Work, x: Exhaustion): TaskId => exhaustionResult(w, x).task

// A stop: an exhaustion, or the first point of a person's Reject (one act, one stop).
export type StopRef =
  | { readonly _tag: 'Exhaustion'; readonly exhaustion: Exhaustion; readonly at: number }
  | { readonly _tag: 'Item'; readonly item: Item; readonly at: number }
const stopOfItem = (r: Item): StopRef => ({ _tag: 'Item', item: r, at: r.at })
const stopRefKey = (s: StopRef): string =>
  s._tag === 'Exhaustion' ? s.exhaustion.id : (s.item.first ?? s.item.id)
export const stopValue = (s: StopRef): Stop => {
  if (s._tag === 'Exhaustion') return { _tag: 'Exhaustion', id: s.exhaustion.id }
  return { _tag: 'PersonReject', id: s.item.group ?? (s.item.id as RejectId) }
}
export const stopRefOf = (w: Work, stop: Stop): StopRef | undefined => {
  if (stop._tag === 'Exhaustion') {
    const x = w.exhaustions.get(stop.id)
    return x ? { _tag: 'Exhaustion', exhaustion: x, at: x.at } : undefined
  }
  const id = stop.id as string
  const item = itemAt(w, id) ?? itemAt(w, pointId(id as RejectId, 1))
  if (item === undefined) return undefined
  const first = item.first === undefined ? item : (itemAt(w, item.first) ?? item)
  return stopOfItem(first)
}
export const stopKey = (w: Work, stop: Stop): string => {
  const ref = stopRefOf(w, stop)
  return ref === undefined ? stop.id : stopRefKey(ref)
}
export const stopRefTask = (w: Work, s: StopRef): TaskId => {
  if (s._tag === 'Exhaustion') return exhaustionTask(w, s.exhaustion)
  const task = taskOfTarget(w, s.item.of)
  if (task === undefined) throw new Error(`the stop ${s.item.id} has no task`)
  return task
}
export const stopTask = (w: Work, stop: Stop): TaskId => {
  const ref = stopRefOf(w, stop)
  if (ref === undefined) throw new Error(`there is no stop ${stop.id}`)
  return stopRefTask(w, ref)
}
// The stops of a task, made once per Work and task (a Work never changes): fileTurn asks for
// the stops of each working maker's task once for each other maker.
const stopRefsCache = new WeakMap<Work, Map<TaskId, ReadonlyArray<StopRef>>>()
const stopRefsOf = (w: Work, task: TaskId): ReadonlyArray<StopRef> => {
  const cache = stopRefsCache.get(w) ?? new Map<TaskId, ReadonlyArray<StopRef>>()
  stopRefsCache.set(w, cache)
  const cached = cache.get(task)
  if (cached !== undefined) return cached
  const made = stopRefsNow(w, task)
  cache.set(task, made)
  return made
}
const stopRefsNow = (w: Work, task: TaskId): ReadonlyArray<StopRef> => {
  const exhausted: ReadonlyArray<StopRef> = [...w.exhaustions.values()]
    .filter((x) => exhaustionTask(w, x) === task)
    .map((x) => ({ _tag: 'Exhaustion', exhaustion: x, at: x.at }))
  const rejects = reviewItems(w)
    .filter(
      (r) =>
        taskOfTarget(w, r.of) === task &&
        r.of._tag !== 'Revision' &&
        isPersonStop(w, r) &&
        (r.first ?? r.id) === r.id,
    )
    .map(stopOfItem)
  return [...exhausted, ...rejects].sort((x, y) => x.at - y.at)
}
export const stopsOf = (w: Work, task: TaskId): ReadonlyArray<Stop> =>
  stopRefsOf(w, task).map(stopValue)
// The review of the owner that decides an evaluation, if any.
export const evaluationDecision = (w: Work, e: Evaluation): Review | undefined =>
  itemsOf(w, e.id).find((r) => r.decision === 'Accept' || r.decision === 'Reject')?.review
// At the level of a task or a standard an evaluation counts when written; at the level of a
// direction or a principle, after the owner accepts it. The person's own counts when written.
export const countsWhenWritten = (e: Evaluation): boolean =>
  typeof e.by !== 'string' ||
  (e.after._tag === 'FirstTry' && (e.level === 'task' || e.level === 'standard'))
export const evaluationCounts = (w: Work, e: Evaluation): boolean =>
  countsWhenWritten(e) || evaluationDecision(w, e)?._tag === 'Accept'
const answeredStop = (w: Work, key: string): boolean =>
  [...w.evaluations.values()].some((e) => stopKey(w, e.answers) === key && evaluationCounts(w, e))
export const stopRefAnswered = (w: Work, s: StopRef): boolean => answeredStop(w, stopRefKey(s))
export const stopAnswered = (w: Work, stop: Stop): boolean => answeredStop(w, stopKey(w, stop))
// The first stop of a task that no counted evaluation answers.
export const evaluationWaitsRef = (w: Work, task: TaskId): StopRef | undefined =>
  stopRefsOf(w, task).find((s) => !stopRefAnswered(w, s))
export const evaluationWaits = (w: Work, task: TaskId): Stop | undefined => {
  const s = evaluationWaitsRef(w, task)
  return s === undefined ? undefined : stopValue(s)
}
export const stopText = (w: Work, s: StopRef): string =>
  s._tag === 'Exhaustion'
    ? `the last try of ${labelOf(w, exhaustionResult(w, s.exhaustion).by)}, which ended on a fault`
    : `the person's Reject "${s.item.reason ?? ''}"`

// After a maker's last try, the next try works only on inputs that differ from the failed ones.
const sameInputs = (w: Work, x: Exhaustion): boolean => {
  const result = exhaustionResult(w, x)
  const task = result.task
  const sameVersions = directionIdsOf(w, task).every((d) => {
    const n = result.under.get(d)
    return n !== undefined && sameFor(w, contentAt(w, d, n), contentNow(w, d), task)
  })
  const needChanged = taskAt(w, task).needs.some((n) => {
    const usedThen = resultsOf(w, n)
      .filter((r) => r.at < result.at)
      .at(-1)
    const now = resultsOf(w, n)
      .filter((r) => blockersOfResult(w, r.id).length === 0)
      .at(-1)
    return now !== undefined && (usedThen === undefined || !sameWork(now.work, usedThen.work))
  })
  return sameVersions && !needChanged
}
// page: workStop(task): why no new maker starts on a task, in words; undefined: nothing.
export const workStop = (w: Work, task: TaskId): string | undefined => {
  const waits = evaluationWaitsRef(w, task)
  if (waits) {
    return (
      `${task} waits for an evaluation of ${stopText(w, waits)}: what is wrong, why, and what to ` +
      'improve; the high role of its tree writes it, or the person'
    )
  }
  const last = [...w.exhaustions.values()].filter((x) => exhaustionTask(w, x) === task).at(-1)
  if (last && sameInputs(w, last)) {
    const maker = labelOf(w, exhaustionResult(w, last).by)
    return (
      `${task} has the inputs that failed in the last try of ${maker}; its evaluation asks for a ` +
      'change first: a direction version that says something new to it, a newer accepted result ' +
      'of a task that it needs, or a remake or a split'
    )
  }
  return undefined
}

// --- the blockers of a result --------------------------------------------------------------------

// Rejects of the task, or of earlier attempts, saved before this result.
const rejectsBefore = (w: Work, result: Result): ReadonlyArray<Item> =>
  reviewItems(w).filter(
    (r) =>
      isRejectItem(r) &&
      r.at < result.at &&
      ((r.of._tag === 'Task' && r.of.id === result.task) ||
        (r.of._tag === 'Result' &&
          r.of.id !== result.id &&
          resultAt(w, r.of.id).task === result.task)),
  )
// The rules to check again under the current version: each rule of a new or replaced standard
// that applies needs evidence from an accept made while that standard was in force.
export const recheckRules = (w: Work, r: ResultId, d: DirectionId): ReadonlyArray<Rule> => {
  const result = resultAt(w, r)
  const now = contentNow(w, d)
  const then = result.under.get(d)
  if (then === undefined || then === now.number) return []
  const accepts = itemsOf(w, r).filter(isAcceptItem)
  const before = applicableIn(w, contentAt(w, d, then), result.task)
  const fresh = applicableIn(w, now, result.task).filter(
    (s) => !before.some((t) => sameStandard(s, t)),
  )
  const inForce = (s: Standard) =>
    accepts.filter((a) => {
      const n = a.under.get(d)
      return (
        n !== undefined &&
        contentAt(w, d, n).standards.some((t) => sameStandard(standardAt(w, t), s))
      )
    })
  return fresh.flatMap((s) =>
    rulesOfStandard(w, s).filter((rule) => evidenceFor(w, rule, r, inForce(s)).length === 0),
  )
}
const isOld = (w: Work, used: ResultId): boolean =>
  resultsOf(w, resultAt(w, used).task).at(-1)?.id !== used
// An escalation is open while no Resolve names it (a fact; EscalationState adds Irrelevant).
export const unresolvedEscalationItems = (w: Work, r: ResultId): ReadonlyArray<Item> =>
  itemsOf(w, r).filter(
    (e) => e.decision === 'Escalate' && !reviewItems(w).some((x) => x.resolves === e.id),
  )

const blockerCache = new WeakMap<Work, Map<ResultId, ReadonlyArray<Blocker>>>()
// What still stops a result, in the old order (blockerItems). An open question and an
// unresolved escalation are read as facts here: ResultState comes before their states (3.4).
export const blockersOfResult = (w: Work, r: ResultId): ReadonlyArray<Blocker> => {
  const cache = blockerCache.get(w) ?? new Map<ResultId, ReadonlyArray<Blocker>>()
  blockerCache.set(w, cache)
  const cached = cache.get(r)
  if (cached !== undefined) return cached
  const made = blockersNow(w, r)
  cache.set(r, made)
  return made
}
const blockersNow = (w: Work, r: ResultId): ReadonlyArray<Blocker> => {
  const result = resultAt(w, r)
  const task = taskAt(w, result.task)
  const reviews = itemsOf(w, r)
  const accepts = reviews.filter(isAcceptItem)
  const rules = rulesOf(w, task.id)
  const unanswered = rejectsBefore(w, result).filter((x) => !answeredItem(w, x))
  const standing = (x: Item): Rule | undefined =>
    x.breaks === undefined ? undefined : ruleNowFor(w, task.id, x.breaks)
  const missing = (rule: Rule): ReadonlyArray<Blocker> => {
    const found = evidenceFor(w, rule, r, accepts)
    const rejects = unanswered
      .filter((x) => standing(x)?.entry === rule.entry)
      .map((x) => x.id as PointId)
    if (found.length === 0) return [{ _tag: 'Evidence', ref: rule.entry, rejects }]
    if (found.every((e) => e.uses.some((u) => isOld(w, u)))) {
      return [{ _tag: 'OldEvidence', ref: rule.entry }]
    }
    return []
  }
  const who = deciderOf(w, r)
  const now = decidingNow(w, r)
  const waitingLeaves = who === undefined ? [] : nextLeaves(who, now, sameRole(w))
  const [leaf, ...more] = waitingLeaves
  const decider: ReadonlyArray<Blocker> = decisionMet(w, r, now)
    ? []
    : decisionMet(
          w,
          r,
          accepts.filter((a) => decides(w, a, r)),
        )
      ? [{ _tag: 'DeciderAcceptedUnderOld' }]
      : who === undefined || leaf === undefined
        ? [{ _tag: 'DeciderAnyApprover' }]
        : [{ _tag: 'DeciderWaits', leaves: [leaf, ...more] }]
  return [
    ...directionIdsOf(w, task.id)
      .filter((d) => recheckRules(w, r, d).length > 0)
      .map((d): Blocker => ({
        _tag: 'OldVersion',
        ref: d,
        rules: recheckRules(w, r, d).map((x) => x.entry),
      })),
    ...rules.flatMap(missing),
    ...decider,
    ...task.needs.flatMap((n): ReadonlyArray<Blocker> => {
      const all = resultsOf(w, n)
      const latest = all.at(-1)
      const used = all.filter((x) => x.at < result.at).at(-1)
      const same =
        used !== undefined && latest !== undefined && latest.work.digest === used.work.digest
      return latest === undefined || latest.id === used?.id || same
        ? []
        : [{ _tag: 'OldNeed', ref: n, newer: latest.id }]
    }),
    // The maker's own escalation asks for help; it is not a review.
    ...reviews
      .filter((x) => x.decision !== 'Escalate' && sameActor(w, x.by, result.by))
      .map((x): Blocker => ({ _tag: 'Maker', ref: x.id })),
    // The person's criticism that a version answered is checked, not made again.
    ...reviews
      .filter((x) => isRejectItem(x) && !(isPersonStop(w, x) && answeredByVersion(w, x)))
      .map((x): Blocker =>
        x.redo
          ? { _tag: 'Recheck', ref: x.id as ReviewId }
          : { _tag: 'Reject', ref: x.id as PointId },
      ),
    ...unanswered
      .filter((x) => {
        const rule = standing(x)
        return rule !== undefined && evidenceFor(w, rule, r, accepts).length > 0
      })
      .map((x): Blocker => ({ _tag: 'Unchanged', ref: x.id as PointId })),
    ...unanswered
      .filter((x) => x.redo)
      .map((x): Blocker => ({ _tag: 'Recheck', ref: x.id as ReviewId })),
    ...unanswered
      .filter((x) => !x.redo && standing(x) === undefined)
      .map((x): Blocker => ({ _tag: 'Change', ref: x.id as PointId })),
    ...unresolvedEscalationItems(w, r).map((x): Blocker => ({
      _tag: 'Escalation',
      ref: x.id as EscalationId,
    })),
    ...openQuestions(w, r).map((q): Blocker => ({ _tag: 'Question', ref: q.id })),
  ]
}

// --- drafts --------------------------------------------------------------------------------------

// Who accepts a draft by the direction's file: approvedBy, or the owner. The first version has
// only its owner. Their Order is the turn of a review, and their Reject is a veto.
export const approvedByOfDraft = (w: Work, draft: RevisionId): Deciders => {
  const x = draftAt(w, draft)
  const d = directionAt(w, x.of)
  if (x._tag === 'New' || d.approvedBy._tag === 'Owner') return d.owner
  return d.approvedBy.deciders
}
// S2: why the owner accepts a change too, as the person: it changes what the direction says, or
// a Reject came before (a veto ends the draft, so only a Reject of another reviewer is left).
export const ownerWhy = (w: Work, x: Revision<Direction>): OwnerAcceptWhy | undefined => {
  if (x._tag !== 'Change') return undefined
  const base = versionAt(w, x.of, versionNumberOf(x.base))
  if (base.says !== x.says) return 'SaysChanged'
  return itemsOf(w, x.id).some(isRejectItem) ? 'AfterReject' : undefined
}
// Who accepts a draft (A1-1): approvedBy, and the owner's own accept as a leaf when the owner
// rule applies. And, not Order: the owner may accept before the others, as before, and one
// accept of an owner inside approvedBy meets both items.
export const decidersOfDraft = (w: Work, draft: RevisionId): Tree<DraftLeaf> => {
  const x = draftAt(w, draft)
  const base = approvedByOfDraft(w, draft)
  const why = ownerWhy(w, x)
  if (why === undefined) return base
  const owner: DraftLeaf = { _tag: 'OwnerAccept', owner: directionAt(w, x.of).owner, why }
  return { _tag: 'And', items: [base, owner] }
}
// The owner's leaf also matches a high role with a Change act on the direction at its time.
const standsInForOwner = (w: Work, by: By, direction: DirectionId, when: Time): boolean => {
  const tier = tierOf(roleOf(w, by))
  return (tier === undefined || tier === 'high') && can(w, by, 'Change', direction, when)
}
// The OwnerAccept leaf matches only the owner as the person: a stand-in does not count (S2).
export const draftMatches =
  (w: Work, direction: DirectionId): Matches<DraftLeaf> =>
  (leaf, act) => {
    switch (leaf._tag) {
      case 'Role':
        return roleNameOf(w, act.by) === leaf.role
      case 'OwnerAccept':
        return isPerson(w, act.by) && actorOf(w, act.by).name === leaf.owner.name
      default:
        return (
          actorOf(w, act.by).name === leaf.name ||
          standsInForOwner(w, act.by, direction, act.when)
        )
    }
  }
// The person, not a model: their accept of a draft counts with no evidence.
const byPerson = (w: Work, by: By): boolean => !isAssignment(by) && isPerson(w, by)
export const draftAcceptItems = (w: Work, draft: RevisionId): ReadonlyArray<Item> =>
  itemsOf(w, draft).filter((r) => isAcceptItem(r) && (hasEvidence(r.evidence) || byPerson(w, r.by)))
// A Reject by an item of approvedBy ends the draft: its reviser revises again.
export const vetoItem = (w: Work, draft: RevisionId): Item | undefined => {
  const matches = draftMatches(w, draftAt(w, draft).of)
  const leaves = leavesOf<DeciderLeaf>(approvedByOfDraft(w, draft))
  return itemsOf(w, draft).find((r) => isRejectItem(r) && leaves.some((l) => matches(l, r)))
}
// The leaves whose accept a draft still waits for, in the turn of its deciders.
export const draftWaitsFor = (w: Work, draft: RevisionId): ReadonlyArray<DraftLeaf> =>
  nextLeaves(
    decidersOfDraft(w, draft),
    draftAcceptItems(w, draft),
    draftMatches(w, draftAt(w, draft).of),
  )

// The files of a task as its first brief saw them (a fact that the brief stored): the actions
// read it for a first brief and for untouched work, so they read no state field (BUILD.md 4.1).
export const untouchedOf = (w: Work, task: TaskId): Task['untouched'] => taskAt(w, task).untouched

// --- runs and trees ------------------------------------------------------------------------------

// The task that a run's host opened from one of its drafts (the old topOfRun).
export const openedTopOf = (w: Work, run: RunId): TaskId | undefined => {
  for (const d of w.taskDrafts.values()) {
    if (d.run === run && d.opened._tag === 'Opened') return d.opened.task
  }
  return undefined
}
// The run whose top task, after its remakes, is the top of a task's tree.
export const runOfTree = (w: Work, task: TaskId): Run | undefined => {
  const top = rootOf(w, task)
  return [...w.runs.values()].find((r) => {
    const opened = openedTopOf(w, r.id)
    return opened !== undefined && (opened === top || currentTask(w, opened) === top)
  })
}
// Where a system problem shows: the parent of the task that it stops, else that task.
export const problemTask = (w: Work, problem: Problem): TaskId => {
  const serves = w.tasks.get(problem.stopped)?.serves
  return serves?._tag === 'Serves' ? serves.task : problem.stopped
}
// The seq of an event ref (e12).
export const seqOf = (ref: EventRef): number => Number(ref.slice(1))
export const refOf = (seq: number): EventRef => `e${seq}` as EventRef

// Additive (P8): two facts of a record that the words print and no state carries. An adapter reads
// them here, not on the record (the architecture test reads `.claim` and `.end` as state fields).
// The claim of an assignment now: Free when it holds none.
export const claimOf = (w: Work, a: AssignmentId): Meta['claim'] =>
  w.meta.get(a)?.claim ?? { _tag: 'Free' }
// The reason that a task was closed with; '' for any other end.
export const closeReasonOf = (w: Work, task: TaskId): string => {
  const end = taskAt(w, task).end
  return end._tag === 'Closed' ? end.reason : ''
}
