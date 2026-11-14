// Checkpoint.Checkpoint: the record keeps what was open on a task and its open parts at that
// time (blockers, open points, escalations, reviews and approvals not made, questions). That
// snapshot is a status computed when the checkpoint was saved, and the old Work stores it, so
// the fold computes it here with the old rules. In core/derived these are blockersOf (Blocker[])
// and the states of tasks, results and questions; the record could keep only its facts once the
// owner reshapes it (R4).
import {
  type AssignmentId,
  type Blocker,
  type CheckpointPart,
  type DirectionId,
  type EscalationId,
  type EventOf,
  type PointId,
  type ReportedWork,
  type Result,
  type ResultId,
  type ReviewId,
  type Rule,
  type Source,
  type Stepped,
  type TaskId,
  type Time,
  type Work,
} from '../schema/index.ts'
import { type Act, built, put } from './act.ts'
import {
  actsOf,
  coversMaker,
  deciderOf,
  decidesResults,
  decides,
  decidingNow,
  decisionMet,
  isCriticism,
  nextLeaves,
  sameRole,
} from './decisions.ts'
import {
  isAcceptItem,
  isRejectItem,
  type Item,
  itemsOf,
  reviewItems,
  taskOfTarget,
} from './items.ts'
import {
  isOpen,
  isPerson,
  openQuestions,
  partsOf,
  resultAt,
  resultsOf,
  roleNameOf,
  ruleAt,
  sameActor,
  standardAt,
  taskAt,
} from './records.ts'
import {
  applicableIn,
  contentAt,
  contentNow,
  directionIdsOf,
  madeBy,
  ruleNowFor,
  rulesOf,
  rulesOfStandard,
  sameStandard,
} from './versions.ts'

// --- answers of Rejects --------------------------------------------------------------------------

// A list of answers names a review item: by its id, or by the Reject that holds the point.
const answersInclude = (ids: ReadonlyArray<string>, r: Item): boolean =>
  ids.includes(r.id) || (r.group !== undefined && ids.includes(r.group))
const answeredByVersion = (w: Work, r: Item): boolean =>
  [...w.drafts.values()].some((d) => answersInclude(d.answers, r) && madeBy(w, d.id) !== undefined)
// Two results are the same work: the same change (patch, for a commit), else the same digest.
const sameWork = (x: ReportedWork, y: ReportedWork): boolean =>
  x._tag === 'Commit' && y._tag === 'Commit' && x.patch !== '' && y.patch !== ''
    ? x.patch === y.patch
    : x.digest !== '' && x.digest === y.digest

// A recorded review counts with the acts that its reviewer had at its own time.
const rightChecker = (w: Work, rule: Rule, a: Item, r: ResultId): boolean =>
  rule.checkedBy._tag === 'Role'
    ? roleNameOf(w, a.by) === rule.checkedBy.role && coversMaker(w, a.by, r, a.when)
    : decidesResults(w, a.by, r, a.when)
// Evidence counts when it says where it looked, comes from the right checker, and belongs to the
// result that its review is of.
const evidenceFor = (w: Work, rule: Rule, r: ResultId, accepts: ReadonlyArray<Item>) =>
  accepts
    .filter((a) => rightChecker(w, rule, a, r))
    .flatMap((a) => a.evidence)
    .filter((e) => e.meets === rule.entry && e.at !== '')

// An official draft, a split, or a remake answers a Reject. A Reject that names a rule is also
// answered by a later, changed result of its task with evidence for that rule, or for the rule
// that stands for it now; a recheck by any later result of its task.
const answeredItem = (w: Work, r: Item): boolean => {
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
// The person's Reject of a task, or the person's criticism of one of its results.
const isPersonStop = (w: Work, r: Item): boolean =>
  isRejectItem(r) &&
  !r.redo &&
  (r.of._tag === 'Task' ? isPerson(w, r.by) : r.of._tag === 'Result' && isCriticism(w, r))

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
const recheckRules = (w: Work, r: ResultId, d: DirectionId): ReadonlyArray<Rule> => {
  const result = resultAt(w, r)
  const now = contentNow(w, d)
  const then = result.under.get(d)
  if (then === undefined || then === now.number) return []
  const accepts = itemsOf(w, r).filter(isAcceptItem)
  const before = applicableIn(w, contentAt(w, d, then), result.task)
  const fresh = applicableIn(w, now, result.task).filter(
    (s) => !before.some((t) => sameStandard(s, t)),
  )
  const inForce = (s: (typeof fresh)[number]) =>
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
// A result of another task that has a newer attempt is old.
const isOld = (w: Work, used: ResultId): boolean =>
  resultsOf(w, resultAt(w, used).task).at(-1)?.id !== used
// An escalation waits until its answerer, or a role that decides the results, resolves it.
const openEscalationItems = (w: Work, r: ResultId): ReadonlyArray<Item> =>
  itemsOf(w, r).filter(
    (e) => e.decision === 'Escalate' && !reviewItems(w).some((x) => x.resolves === e.id),
  )

// What still stops a result, as items, in the old order.
const blockerItems = (w: Work, r: ResultId): ReadonlyArray<Blocker> => {
  const result = resultAt(w, r)
  const task = taskAt(w, result.task)
  const reviews = itemsOf(w, r)
  const accepts = reviews.filter(isAcceptItem)
  const rules = rulesOf(w, task.id)
  const unanswered = rejectsBefore(w, result).filter((x) => !answeredItem(w, x))
  // The rule of the task now that a point's rule stands for; undefined: it needs a direction
  // change.
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
      .map((x): Blocker => ({ _tag: 'Change', ref: rejectRef(x) })),
    ...openEscalationItems(w, r).map(
      (x): Blocker => ({ _tag: 'Escalation', ref: x.id as EscalationId }),
    ),
    ...openQuestions(w, r).map((q): Blocker => ({ _tag: 'Question', ref: q.id })),
  ]
}

// --- the checkpoint ------------------------------------------------------------------------------

// What is open on a task and on its open parts (page: Checkpoint.save).
const checkpointOf = (
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
      blockers: latest ? blockerItems(w, latest.id) : [],
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
      escalations: latest
        ? openEscalationItems(w, latest.id).map((r) => r.id as EscalationId)
        : [],
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

export const checkpointStep = (
  work: Work,
  e: EventOf<'Checkpoint.Checkpoint'>,
  act: Act,
): Stepped =>
  built(work, (b) => {
    const w = b.work
    const id = b.name('checkpoint')
    const part = checkpointOf(w, e.create.task, [...w.sources.values()], e.create.next, act.when)
    b.work = { ...b.work, checkpoints: put(b.work.checkpoints, id, { ...part, id }) }
  })
