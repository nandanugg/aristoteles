// The reads of the engine (engine.read and the helpers of the page's acceptRule), over the Work and
// by id. Words, the CLI and the views use these. Where an engine compares objects, these compare
// ids (the review items of view.ts stand for its review records).
import { applies } from '../domain/context.ts'
import type { RejectPoint } from '../domain/derived.ts'
import { pointOf } from '../domain/derived.ts'
import type {
  AssignmentId,
  CheckpointId,
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
  VersionId,
} from '../domain/ids.ts'
import { pointId } from '../domain/ids.ts'
import type {
  Act,
  Assignment,
  Blocker,
  By,
  CheckpointPart,
  Deciders,
  Direction,
  Escalate,
  Evaluation,
  Evidence,
  Exhaustion,
  Note,
  Permission,
  Question,
  Reject,
  Result,
  Review,
  Rule,
  Source,
  Standard,
  Stop,
  Task,
  Version,
  Where,
} from '../domain/model.ts'
import type { ReportedWork } from '../domain/events.ts'
import type { Work } from '../domain/work.ts'
import {
  type Accept as DeciderAccept,
  type Acting,
  type Leaf,
  leavesOf,
  type Matches,
  metAt,
  nextLeaves,
  waitsFor,
} from './deciders.ts'
import {
  actorOf,
  assignmentAt,
  atOrBefore,
  currentOf,
  directionAt,
  draftAt,
  finished,
  isAssignment,
  isOpen,
  isPerson,
  type Item,
  itemAt,
  itemsOf,
  labelOf,
  maxOf,
  officialAt,
  openAncestorOf,
  resultAt,
  reviewItems,
  roleAt,
  roleNameOf,
  roleOf,
  ruleAt,
  sameActor,
  standardAt,
  taskAt,
  taskOfTarget,
  tierOf,
  versionAt,
} from './view.ts'

// --- what a direction says -----------------------------------------------------------------------

// A version, or a draft's proposal: what one direction says to a task. number: null for a
// proposal that is no version yet.
export interface Content {
  readonly of: DirectionId
  readonly number: number | null
  readonly says: string
  readonly standards: ReadonlyArray<StandardEntry>
}
export const contentOf = (v: Version<Direction>): Content => ({
  of: v.of,
  number: v.number,
  says: v.says,
  standards: v.standards,
})
const contentAt = (w: Work, d: DirectionId, n: number): Content => contentOf(versionAt(w, d, n))
const contentNow = (w: Work, d: DirectionId): Content => contentOf(currentOf(w, d))

export const current = (w: Work, d: DirectionId): Version<Direction> => currentOf(w, d)

// A draft is official when a version has it as its revision.
export const madeBy = (w: Work, draft: RevisionId): Version<Direction> | undefined => {
  const d = w.directions.get(draftAt(w, draft).of)
  return d?._tag === 'Official' ? d.versions.find((v) => v.revision === draft) : undefined
}

// The directions that a task follows: official ones (a task names only those).
const directionIdsOf = (w: Work, task: TaskId): ReadonlyArray<DirectionId> =>
  taskAt(w, task).descriptionAi.directions.filter((d) => officialAt(w, d) !== undefined)
export const directionsOf = (w: Work, task: TaskId): ReadonlyArray<Direction> =>
  directionIdsOf(w, task).map((d) => directionAt(w, d))

// A standard applies where its "where" matches the context of the task; none means everywhere.
export const applicableIn = (w: Work, content: Content, task: TaskId): ReadonlyArray<Standard> => {
  const context = taskAt(w, task).descriptionAi.context
  return content.standards.map((e) => standardAt(w, e)).filter((s) => applies(s.where, context))
}
export const applicable = (w: Work, v: VersionId, task: TaskId): ReadonlyArray<Standard> => {
  const at = v.lastIndexOf('@')
  return applicableIn(w, contentAt(w, v.slice(0, at) as DirectionId, Number(v.slice(at + 1))), task)
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
// The rules of a task if the proposal `to` replaced the version `from`.
export const rulesUnder = (
  w: Work,
  task: TaskId,
  from: Content,
  to: Content,
): ReadonlyArray<RuleEntry> =>
  directionIdsOf(w, task).flatMap((d) =>
    applicableIn(w, d === from.of ? to : contentNow(w, d), task).flatMap((s) => s.rules),
  )

// A rule by its id in the official version of each direction now.
export const findRule = (w: Work, id: string): Rule | undefined => {
  for (const d of w.directions.values()) {
    if (d._tag !== 'Official') continue
    for (const e of contentNow(w, d.id).standards) {
      const rule = standardAt(w, e)
        .rules.map((r) => ruleAt(w, r))
        .find((r) => r.id === id)
      if (rule) return rule
    }
  }
  return undefined
}

export const sameChecker = (a: Rule['checkedBy'], b: Rule['checkedBy']): boolean =>
  a._tag === 'Decider' ? b._tag === 'Decider' : b._tag === 'Role' && a.role === b.role
// Two rules are the same when they have the same id, words, and checker.
export const sameRule = (a: Rule, b: Rule): boolean =>
  a.entry === b.entry ||
  (a.id === b.id && a.says === b.says && sameChecker(a.checkedBy, b.checkedBy))
// The order of the keys of a where says nothing.
export const sameWhere = (a: Where, b: Where): boolean => {
  if (a._tag === 'Everywhere' || b._tag === 'Everywhere') return a._tag === b._tag
  return (
    a.conditions.size === b.conditions.size &&
    [...a.conditions].every(([k, v]) => b.conditions.get(k) === v)
  )
}
// Two standards are the same when they say the same: the same id, words, where, and rules (a
// revise keeps a rule's entry when its id, its words, and its checker stay).
export const sameStandard = (x: Standard, y: Standard): boolean =>
  x.entry === y.entry ||
  (x.id === y.id &&
    x.says === y.says &&
    sameWhere(x.where, y.where) &&
    x.rules.length === y.rules.length &&
    x.rules.every((r) => y.rules.includes(r)))
// Two drafts' standards have the same words, rule by rule: each draft makes its own entries.
export const sameWords = (w: Work, x: Standard, y: Standard): boolean =>
  x.id === y.id &&
  x.says === y.says &&
  sameWhere(x.where, y.where) &&
  x.rules.length === y.rules.length &&
  x.rules.every((r) => y.rules.some((q) => sameRule(ruleAt(w, r), ruleAt(w, q))))
export const sameProposal = (w: Work, x: Content, y: Content): boolean =>
  x.says === y.says &&
  x.standards.length === y.standards.length &&
  x.standards.every((s) =>
    y.standards.some((t) => sameWords(w, standardAt(w, s), standardAt(w, t))),
  )

// Two versions say the same to a task when the spirit and the standards that apply are the same.
export const sameFor = (w: Work, v: Content, now: Content, task: TaskId): boolean => {
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
export const covers = (x: Permission, when: Time): boolean =>
  atOrBefore(x.when, when) &&
  atOrBefore(when, x.until) &&
  (x.revoked._tag === 'NotRevoked' || Date.parse(when) < Date.parse(x.revoked.at))

// The acts of an act's actor at a time: the standing acts of its role, and the permissions given
// to that role that cover that time. A person or a run outside any task has none.
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

// Nobody gives more than they may do: the giver owns each target, or has that act on it. A
// person has the acts of their own roles; a model has the acts of its assignment.
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

// --- tasks ---------------------------------------------------------------------------------------

// A task is in the tree of another when it is that task or serves it, at any depth.
export const within = (w: Work, task: TaskId, root: TaskId): boolean => {
  for (let t: TaskId | undefined = task; t !== undefined; ) {
    if (t === root) return true
    const serves: Task['serves'] | undefined = w.tasks.get(t)?.serves
    t = serves?._tag === 'Serves' ? serves.task : undefined
  }
  return false
}
// The tasks that serve a task (its parts), in their order.
export const partsOf = (w: Work, task: TaskId): ReadonlyArray<Task> =>
  [...w.tasks.values()].filter((t) => t.serves._tag === 'Serves' && t.serves.task === task)
// An open task outside the tree of a task that needs the task or one of its open parts.
export const neederOf = (w: Work, task: TaskId): Task | undefined =>
  [...w.tasks.values()].find(
    (t) =>
      isOpen(t) &&
      !within(w, t.id, task) &&
      t.needs.some((n) => isOpen(taskAt(w, n)) && within(w, n, task)),
  )
export const resultsOf = (w: Work, task: TaskId): ReadonlyArray<Result> =>
  [...w.results.values()].filter((r) => r.task === task)

// A Change act on a task covers the parts of that task too.
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

// --- reviews -------------------------------------------------------------------------------------

export const isAcceptItem = (r: Item): boolean => r.decision === 'Accept' && r.resolves === undefined
export const isRejectItem = (r: Item): boolean => r.decision === 'Reject'
export const hasEvidence = (evidence: ReadonlyArray<Evidence>): boolean =>
  evidence.some((e) => e.at !== '' && e.says !== '')

// The records of a target's reviews, each once, in their order (a resolve is of its
// escalation's result).
export const reviewsOf = (
  w: Work,
  target: ResultId | TaskId | RevisionId | EvaluationId,
): ReadonlyArray<Review> => [...new Set(itemsOf(w, target).map((i) => i.review))]
// page: isAccept(x): an Accept; a Resolve is never an accept of the work.
export const isAccept = (r: Review): boolean => r._tag === 'Accept'

// --- who decides a result -----------------------------------------------------------------------

const makerRole = (w: Work, result: ResultId): RoleName =>
  assignmentAt(w, resultAt(w, result).by).role
// Who decides the results of a maker: the workflow's decide entry for its role; none: any one
// role with an Approve act on it.
export const deciderOf = (w: Work, result: ResultId): Deciders | undefined =>
  w.workflow.decide.get(makerRole(w, result))
const sameRole =
  (w: Work): Matches =>
  (leaf, act) =>
    leaf._tag === 'Role' && roleNameOf(w, act.by) === leaf.role
const isLeafOf = (w: Work, by: By) => (leaf: Leaf) =>
  leaf._tag === 'Role' && leaf.role === roleNameOf(w, by)

export const coversMaker = (w: Work, by: By, r: ResultId, when: Time): boolean =>
  can(w, by, 'Review', makerRole(w, r), when) || can(w, by, 'Approve', makerRole(w, r), when)
export const decidesResults = (w: Work, by: By, r: ResultId, when: Time): boolean => {
  const who = deciderOf(w, r)
  return who ? leavesOf(who).some(isLeafOf(w, by)) : can(w, by, 'Approve', makerRole(w, r), when)
}
// A decider's accept says where it read the result; it counts with the acts of its time.
export const decides = (w: Work, a: Item, r: ResultId): boolean =>
  decidesResults(w, a.by, r, a.when) && hasEvidence(a.evidence)
// The at of the latest Reject of a task: a criticism asks its deciders to look again.
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
export const decisionMet = (w: Work, r: ResultId, accepts: ReadonlyArray<DeciderAccept>) => {
  const who = deciderOf(w, r)
  return who ? metAt(who, accepts, sameRole(w)) !== undefined : accepts.length > 0
}
// Whether the decision of a result waits for the accept of `by` now.
export const decidesNow = (w: Work, by: By, r: ResultId, when: Time): boolean => {
  const who = deciderOf(w, r)
  return who
    ? nextLeaves(who, decidingNow(w, r), sameRole(w)).some(isLeafOf(w, by))
    : decidesResults(w, by, r, when)
}
// The roles whose accept the decision of a result waits for now (with a decide entry).
export const decisionWaitsOn = (w: Work, r: ResultId): ReadonlyArray<Leaf> => {
  const who = deciderOf(w, r)
  return who ? nextLeaves(who, decidingNow(w, r), sameRole(w)) : []
}
// The same in words, for a refusal and a blocker: "lead and techlead".
export const decisionWaitsFor = (
  w: Work,
  r: ResultId,
  accepts: ReadonlyArray<DeciderAccept>,
): string => {
  const who = deciderOf(w, r)
  return who ? waitsFor(who, accepts, sameRole(w)) : 'a role that decides it'
}
// The words of decisionWaitsFor with the accepts that count now (P5's blocker line).
export const decisionWaitsText = (w: Work, r: ResultId): string =>
  decisionWaitsFor(w, r, decidingNow(w, r))
export const turnMatches = sameRole

// A recorded review counts with the acts that its reviewer had at its own time.
const rightChecker = (w: Work, rule: Rule, a: Item, r: ResultId): boolean =>
  rule.checkedBy._tag === 'Role'
    ? roleNameOf(w, a.by) === rule.checkedBy.role && coversMaker(w, a.by, r, a.when)
    : decidesResults(w, a.by, r, a.when)
// Evidence counts when it says where it looked, comes from the right checker, and belongs to
// the result that its review is of.
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

// --- attempts -----------------------------------------------------------------------------------

// The person criticises as the owner: a person in a role that reviews or decides the maker is a
// reviewer like any other.
export const isCriticism = (w: Work, r: Item): boolean =>
  isPerson(w, r.by) && !(r.of._tag === 'Result' && coversMaker(w, r.by, r.of.id, r.when))
// Only a fault uses an attempt: a Reject of a reviewer or a decider; a recheck, the person's
// criticism and a Resolve (it has no verdict) use none.
export const isFault = (w: Work, r: Item): boolean =>
  isRejectItem(r) && !r.redo && !isCriticism(w, r)
// A result made under versions that still say the same to its task.
export const underNow = (w: Work, result: Result): boolean =>
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
// The tries that count against a maker: a result under versions that still say the same,
// with a fault before its deciders decided it, or not decided yet.
export const usedBy = (w: Work, a: AssignmentId): number =>
  [...w.results.values()].filter(
    (r) =>
      r.by === a &&
      underNow(w, r) &&
      (itemsOf(w, r.id).some((v) => isFault(w, v) && !decidedBefore(w, r.id, v.at)) ||
        !decided(w, r.id)),
  ).length
export const isDo = (w: Work, role: string): boolean =>
  w.workflow.roles.get(role as RoleName)?.acts.some((a) => a._tag === 'Do') ?? false
const maxAttemptsOf = (a: Assignment): number | undefined =>
  a._tag === 'Maker' ? maxOf(a.maxAttempts) : undefined
export const openDo = (w: Work, id: AssignmentId): boolean => {
  const a = assignmentAt(w, id)
  const max = maxAttemptsOf(a)
  return isDo(w, a.role) && !finished(a) && (max === undefined || usedBy(w, id) < max)
}
// The rules that one review assignment checks: every rule of its task that names its role.
export const checksOf = (w: Work, id: AssignmentId): ReadonlyArray<Rule> => {
  const a = assignmentAt(w, id)
  return rulesOf(w, a.task).filter(
    (r) => r.checkedBy._tag === 'Role' && r.checkedBy.role === a.role,
  )
}
export const openAncestor = (w: Work, a: AssignmentId): Assignment | undefined => {
  const id = openAncestorOf(w, a)
  return id === undefined ? undefined : assignmentAt(w, id)
}

// --- answers of Rejects --------------------------------------------------------------------------

// A list of answers names a review item: by its id, or by the Reject that holds the point.
export const answersInclude = (ids: ReadonlyArray<string>, r: Item): boolean =>
  ids.includes(r.id) || (r.group !== undefined && ids.includes(r.group))
export const answeredByVersion = (w: Work, r: Item): boolean =>
  [...w.drafts.values()].some((d) => answersInclude(d.answers, r) && madeBy(w, d.id) !== undefined)
// Two results are the same work: the same change (patch, for a commit), else the same digest.
export const sameWork = (x: ReportedWork, y: ReportedWork): boolean =>
  x._tag === 'Commit' && y._tag === 'Commit' && x.patch !== '' && y.patch !== ''
    ? x.patch === y.patch
    : x.digest !== '' && x.digest === y.digest
// An official draft, a split, or a remake answers a Reject. A Reject that names a rule is also
// answered by a later, changed result of its task with evidence for that rule; a recheck by any
// later result of its task.
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
  const rule = ruleAt(w, breaks)
  return later.some(
    (x) =>
      changed(x) && evidenceFor(w, rule, x.id, itemsOf(w, x.id).filter(isAcceptItem)).length > 0,
  )
}
export const answered = (w: Work, review: ReviewId | PointId): boolean => {
  const r = itemAt(w, review)
  if (r !== undefined) return answeredItem(w, r)
  // A Reject by its id: every point of it.
  const points = reviewItems(w).filter((i) => i.group === review)
  return points.length > 0 && points.every((p) => answeredItem(w, p))
}

export const openQuestions = (w: Work, target: TaskId | ResultId): ReadonlyArray<Question> =>
  [...w.questions.values()].filter((q) => q.status._tag === 'Open' && q.stops === target)

// --- stops and evaluations -----------------------------------------------------------------------

// The person's Reject of a task, or the person's criticism of one of its results.
export const isPersonStop = (w: Work, r: Item): boolean =>
  isRejectItem(r) &&
  !r.redo &&
  (r.of._tag === 'Task' ? isPerson(w, r.by) : r.of._tag === 'Result' && isCriticism(w, r))

// The person's open Rejects of a task or its results; with tree, anywhere under the task.
export const personRejectItems = (w: Work, task: TaskId, tree: boolean): ReadonlyArray<Item> =>
  reviewItems(w).filter((r) => {
    if (!isRejectItem(r) || !isPerson(w, r.by) || answeredItem(w, r)) return false
    const of = taskOfTarget(w, r.of)
    if (of === undefined) return false
    return tree ? within(w, of, task) : of === task
  })
export const personRejects = (w: Work, task: TaskId, tree: boolean): ReadonlyArray<RejectPoint> =>
  personRejectItems(w, task, tree).flatMap((r) => {
    const point = r.group === undefined ? undefined : pointOf(w, r.id as PointId)
    return point ? [point] : []
  })

// The result whose fault made an exhaustion, and its maker.
export const exhaustionResult = (w: Work, x: Exhaustion): Result => {
  const fault = itemAt(w, x.fault)
  if (fault?.of._tag !== 'Result') throw new Error(`${x.id} names ${x.fault}, no fault of a result`)
  return resultAt(w, fault.of.id)
}
export const exhaustionTask = (w: Work, x: Exhaustion): TaskId => exhaustionResult(w, x).task

// A stop as the engine reads it: an exhaustion, or the first point of a person's Reject (one
// act, one stop).
export type StopRef =
  | { readonly _tag: 'Exhaustion'; readonly exhaustion: Exhaustion; readonly at: number }
  | { readonly _tag: 'Item'; readonly item: Item; readonly at: number }
const stopOfItem = (r: Item): StopRef => ({ _tag: 'Item', item: r, at: r.at })
// The key that names one stop: ex3, or the first point v4.1.
export const stopRefKey = (s: StopRef): string =>
  s._tag === 'Exhaustion' ? s.exhaustion.id : (s.item.first ?? s.item.id)
export const stopValue = (s: StopRef): Stop => {
  if (s._tag === 'Exhaustion') return { _tag: 'Exhaustion', id: s.exhaustion.id }
  return { _tag: 'PersonReject', id: s.item.group ?? (s.item.id as RejectId) }
}
// The stop that a stored Stop names.
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

export const stopRefsOf = (w: Work, task: TaskId): ReadonlyArray<StopRef> => {
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
// At the level of a task or a standard an evaluation counts when it is written; at the level of
// a direction or a principle, after the owner accepts it. The person's own counts when written.
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

// The words of a stop in a refusal.
export const stopText = (w: Work, s: StopRef): string =>
  s._tag === 'Exhaustion'
    ? `the last try of ${labelOf(w, exhaustionResult(w, s.exhaustion).by)}, which ended on a fault`
    : `the person's Reject "${s.item.reason ?? ''}"`

// After a maker's last try, the next try works only on inputs that differ from the ones that
// failed: a direction version that says something new, or a newer accepted result of a need.
const sameInputs = (w: Work, x: Exhaustion, when: Time): boolean => {
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
      .filter((r) => accepted(w, r.id, when))
      .at(-1)
    return now !== undefined && (usedThen === undefined || !sameWork(now.work, usedThen.work))
  })
  return sameVersions && !needChanged
}
// page: workStop(task): why no new maker starts on a task, in words; undefined: nothing.
export const workStop = (w: Work, task: TaskId, when: Time): string | undefined => {
  const waits = evaluationWaitsRef(w, task)
  if (waits) {
    return (
      `${task} waits for an evaluation of ${stopText(w, waits)}: what is wrong, why, and what to ` +
      `improve; ` +
      'the high role of its tree writes it, or the person'
    )
  }
  const last = [...w.exhaustions.values()].filter((x) => exhaustionTask(w, x) === task).at(-1)
  if (last && sameInputs(w, last, when)) {
    const maker = labelOf(w, exhaustionResult(w, last).by)
    return (
      `${task} has the inputs that failed in the last try of ${maker}; its evaluation asks for a ` +
      `change first: ` +
      'a direction version that says something new to it, a newer accepted result of a task that ' +
      'it needs, or a remake or a split'
    )
  }
  return undefined
}

// --- blockers ------------------------------------------------------------------------------------

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
export const recheck = (w: Work, r: ResultId, d: DirectionId, _when: Time): ReadonlyArray<Rule> =>
  recheckRules(w, r, d)

// A result of another task that has a newer attempt is old.
const isOld = (w: Work, used: ResultId): boolean =>
  resultsOf(w, resultAt(w, used).task).at(-1)?.id !== used

// An escalation waits until its answerer, or a role that decides the results, resolves it.
export const openEscalationItems = (w: Work, r: ResultId): ReadonlyArray<Item> =>
  itemsOf(w, r).filter(
    (e) => e.decision === 'Escalate' && !reviewItems(w).some((x) => x.resolves === e.id),
  )
export const openEscalations = (w: Work, r: ResultId): ReadonlyArray<Escalate> =>
  openEscalationItems(w, r).map((i) => i.review as Escalate)

// What still stops a result at a time, as items, in the old order. A result is accepted when
// nothing does.
export const blockerItems = (w: Work, r: ResultId, _when: Time): ReadonlyArray<Blocker> => {
  const result = resultAt(w, r)
  const task = taskAt(w, result.task)
  const reviews = itemsOf(w, r)
  const accepts = reviews.filter(isAcceptItem)
  const rules = rulesOf(w, task.id)
  const ruleEntries = rules.map((x) => x.entry)
  const unanswered = rejectsBefore(w, result).filter((x) => !answeredItem(w, x))
  const missing = (rule: Rule): ReadonlyArray<Blocker> => {
    const found = evidenceFor(w, rule, r, accepts)
    const rejects = unanswered.filter((x) => x.breaks === rule.entry).map((x) => x.id as PointId)
    if (found.length === 0) return [{ _tag: 'Evidence', ref: rule.entry, rejects }]
    if (found.every((e) => e.uses.some((u) => isOld(w, u)))) {
      return [{ _tag: 'OldEvidence', ref: rule.entry }]
    }
    return []
  }
  const who = deciderOf(w, r)
  const now = decidingNow(w, r)
  const decider: ReadonlyArray<Blocker> = decisionMet(w, r, now)
    ? []
    : decisionMet(
          w,
          r,
          accepts.filter((a) => decides(w, a, r)),
        )
      ? [{ _tag: 'DeciderAcceptedUnderOld' }]
      : who === undefined
        ? [{ _tag: 'DeciderAnyApprover' }]
        : [{ _tag: 'DeciderWaits', leaves: nextLeaves(who, now, sameRole(w)) as never }]
  const rejectRef = (x: Item) => x.id as PointId
  return [
    ...directionIdsOf(w, task.id)
      .filter((d) => recheckRules(w, r, d).length > 0)
      .map(
        (d): Blocker => ({
          _tag: 'OldVersion',
          ref: d,
          rules: recheckRules(w, r, d).map((x) => x.entry),
        }),
      ),
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
      .map(
        (x): Blocker =>
          x.redo
            ? { _tag: 'Recheck', ref: x.id as ReviewId }
            : { _tag: 'Reject', ref: rejectRef(x) },
      ),
    ...unanswered
      .filter(
        (x) =>
          x.breaks !== undefined &&
          ruleEntries.includes(x.breaks) &&
          evidenceFor(w, ruleAt(w, x.breaks), r, accepts).length > 0,
      )
      .map((x): Blocker => ({ _tag: 'Unchanged', ref: x.id as PointId })),
    ...unanswered
      .filter((x) => x.redo)
      .map((x): Blocker => ({ _tag: 'Recheck', ref: x.id as ReviewId })),
    ...unanswered
      .filter((x) => !x.redo && !(x.breaks !== undefined && ruleEntries.includes(x.breaks)))
      .map((x): Blocker => ({ _tag: 'Change', ref: rejectRef(x) })),
    ...openEscalationItems(w, r).map((x): Blocker => ({ _tag: 'Escalation', ref: x.id as EscalationId })),
    ...openQuestions(w, r).map((q): Blocker => ({ _tag: 'Question', ref: q.id })),
  ]
}
export const accepted = (w: Work, r: ResultId, when: Time): boolean =>
  blockerItems(w, r, when).length === 0

// The latest result is the work as it is now; an older accepted result does not count.
export const taskAccepted = (w: Work, task: TaskId, when: Time): boolean => {
  const t = taskAt(w, task)
  const latest = resultsOf(w, task).at(-1)
  return (
    openQuestions(w, task).length === 0 &&
    evaluationWaitsRef(w, task) === undefined &&
    !itemsOf(w, task).some((r) => isRejectItem(r) && !answeredItem(w, r)) &&
    latest !== undefined &&
    accepted(w, latest.id, when) &&
    t.needs.every((n) => taskAccepted(w, n, when))
  )
}

// --- drafts --------------------------------------------------------------------------------------

// Who accepts a draft: approvedBy, or the owner. The first version has only its owner: no task
// follows the direction yet, so no role of approvedBy can work on it.
export const decidersOfDraft = (w: Work, draft: RevisionId): Deciders => {
  const x = draftAt(w, draft)
  const d = directionAt(w, x.of)
  if (x._tag === 'New' || d.approvedBy._tag === 'Owner') return d.owner
  return d.approvedBy.deciders
}
// The owner's item also matches a high role with a Change act on the direction at the time of
// the act (a medium or a low role changes no direction; a program has no tier).
const standsInForOwner = (w: Work, by: By, direction: DirectionId, when: Time): boolean => {
  const tier = tierOf(roleOf(w, by))
  return (tier === undefined || tier === 'high') && can(w, by, 'Change', direction, when)
}
export const draftMatches =
  (w: Work, direction: DirectionId): Matches =>
  (leaf, act: Acting) =>
    leaf._tag === 'Role'
      ? roleNameOf(w, act.by) === leaf.role
      : actorOf(w, act.by).name === leaf.name || standsInForOwner(w, act.by, direction, act.when)
// The person, not a model: their accept of a draft counts with no evidence.
export const byPerson = (w: Work, by: By): boolean => !isAssignment(by) && isPerson(w, by)
export const draftAcceptItems = (w: Work, draft: RevisionId): ReadonlyArray<Item> =>
  itemsOf(w, draft).filter((r) => isAcceptItem(r) && (hasEvidence(r.evidence) || byPerson(w, r.by)))
export const draftAccepts = (w: Work, draft: RevisionId): ReadonlyArray<Review> =>
  draftAcceptItems(w, draft).map((r) => r.review)
// A Reject by an item of the deciders ends the draft: its reviser revises again.
export const vetoItem = (w: Work, draft: RevisionId): Item | undefined => {
  const matches = draftMatches(w, draftAt(w, draft).of)
  const leaves = leavesOf(decidersOfDraft(w, draft))
  return itemsOf(w, draft).find((r) => isRejectItem(r) && leaves.some((l) => matches(l, r)))
}
export const vetoOf = (w: Work, draft: RevisionId): Reject | undefined =>
  vetoItem(w, draft)?.review as Reject | undefined
// The roles or people whose accept a draft still waits for.
export const draftWaitsFor = (w: Work, draft: RevisionId): ReadonlyArray<Leaf> =>
  nextLeaves(
    decidersOfDraft(w, draft),
    draftAcceptItems(w, draft),
    draftMatches(w, draftAt(w, draft).of),
  )

// --- notes ---------------------------------------------------------------------------------------

// A lesson stays official while the current version still holds its text.
const lessonStatus = (w: Work, rule: VersionId, text: string): 'Official' | 'Replaced' => {
  const at = rule.lastIndexOf('@')
  const d = rule.slice(0, at) as DirectionId
  const now = currentOf(w, d)
  if (now.number === Number(rule.slice(at + 1))) return 'Official'
  const standards = now.standards.map((e) => standardAt(w, e))
  const texts = [
    now.says,
    ...standards.map((s) => s.says),
    ...standards.flatMap((s) => rulesOfStandard(w, s).map((r) => r.says)),
  ]
  return texts.includes(text) ? 'Official' : 'Replaced'
}
// page: Note.find(topic, { all }). Official lessons and seen notes; all: replaced lessons too.
export const findNotes = (
  w: Work,
  topic: string,
  all: boolean,
): ReadonlyArray<{ readonly note: Note; readonly status: 'Seen' | 'Official' | 'Replaced' }> => {
  const words = topic.toLowerCase()
  const notes: ReadonlyArray<Note> = [...w.questions.values(), ...w.notes.values()].sort(
    (a, b) => Date.parse(a.when) - Date.parse(b.when),
  )
  return notes
    .filter((n) => n.text.toLowerCase().includes(words))
    .map((note) => ({
      note,
      status: note._tag === 'Lesson' ? lessonStatus(w, note.rule, note.text) : ('Seen' as const),
    }))
    .filter((found) => all || found.status !== 'Replaced')
}

// --- checkpoints ---------------------------------------------------------------------------------

// page: Checkpoint.save: what is open on a task and on its open parts.
export const checkpointOf = (
  w: Work,
  task: TaskId,
  seenOutside: ReadonlyArray<Source>,
  next: string,
  when: Time,
): CheckpointPart => {
  const results = resultsOf(w, task)
  const latest = results.at(-1)
  const own: ReadonlyArray<string> = [task, ...results.map((r) => r.id)]
  const decided = (a: AssignmentId) =>
    latest !== undefined && itemsOf(w, latest.id).some((r) => r.by === a)
  const mine = [...w.assignments.values()].filter((a) => a.task === task)
  return {
    task,
    open: {
      blockers: latest ? blockerItems(w, latest.id, when) : [],
      // Only the points of Rejects: a recheck is asked again by the next result.
      rejects: reviewItems(w)
        .filter(
          (r) =>
            isRejectItem(r) &&
            r.group !== undefined &&
            own.includes(r.of.id) &&
            !answeredItem(w, r),
        )
        .map((r) => r.id as PointId),
      escalations: latest ? openEscalationItems(w, latest.id).map((r) => r.id as EscalationId) : [],
      unfinishedReviews: mine
        .filter((a) => actsOf(w, a.id, when).some((x) => x._tag === 'Review') && !decided(a.id))
        .map((a) => a.id),
      pendingApprovals: latest
        ? mine
            .filter((a) => decidesResults(w, a.id, latest.id, when) && !decided(a.id))
            .map((a) => a.id)
        : [],
      questions: own.flatMap((id) => openQuestions(w, id as TaskId).map((q) => q.id)),
    },
    parts: partsOf(w, task)
      .filter(isOpen)
      .map((t) => checkpointOf(w, t.id, seenOutside, next, when)),
    seenOutside,
    next,
    when,
  }
}

// page: Checkpoint.resume. The engine compares the revisions that each system gives, and lists
// the results to check again: accepted ones, and the latest one, made from a source that changed.
export const resume = (
  w: Work,
  checkpoint: string,
  _by: AssignmentId,
  when: Time,
  outsideNow: ReadonlyArray<Source>,
): { readonly changedOutside: ReadonlyArray<Source>; readonly recheck: ReadonlyArray<Result> } => {
  const k = w.checkpoints.get(checkpoint as CheckpointId)
  if (k === undefined) throw new Error(`the work has no checkpoint ${checkpoint}`)
  const revision = (s: Source) => (s._tag === 'Git' ? s.commit : s.revision)
  const changedOutside = outsideNow.filter(
    (now) =>
      !k.seenOutside.some((seen) => seen.name === now.name && revision(seen) === revision(now)),
  )
  const results = resultsOf(w, k.task)
  const latest = results.at(-1)
  return {
    changedOutside,
    recheck: results.filter(
      (r) =>
        (accepted(w, r.id, when) || r === latest) &&
        r.madeFrom.some(
          (m) => m._tag !== 'Result' && changedOutside.some((c) => c.name === m.name),
        ),
    ),
  }
}
