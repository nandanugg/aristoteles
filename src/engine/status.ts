// The derived states, computed once here; the words module turns them into text, and the CLI
// and the page read the state (nobody reads a sentence back, bug 10).
import type {
  AssignmentId,
  EvaluationId,
  PointId,
  RejectId,
  ResultId,
  RevisionId,
  TaskId,
  Time,
} from '../domain/ids.ts'
import { type PositiveInt, versionId } from '../domain/ids.ts'
import type {
  Attempt,
  EvaluationState,
  MakerState,
  NonEmpty,
  Permission,
  PermissionState,
  ResultState,
  RevisionState,
  TaskState,
} from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { leavesOf } from './deciders.ts'
import {
  answeredItem,
  blockerItems,
  decidersOfDraft,
  draftWaitsFor,
  evaluationDecision,
  evaluationCounts,
  evaluationWaits,
  isRejectItem,
  madeBy,
  resultsOf,
  taskAccepted,
  usedBy,
  vetoItem,
} from './queries.ts'
import { assignmentAt, currentOf, draftAt, finished, itemsOf, maxOf, taskAt } from './view.ts'

// The old engine's names for these three; they live with the reads that they need.
export { accepted, blockerItems, taskAccepted } from './queries.ts'

// page: Task.state(task, when). A task with a Reject of its own that no change answered is
// Returned, or, while that waits for an evaluation, WaitsForEvaluation (the old word of both is
// Returned); a task that waits for the evaluation of a last try only is still in review.
export const taskState = (w: Work, task: TaskId, when: Time): TaskState => {
  const t = taskAt(w, task)
  if (t.end._tag === 'Closed') return { _tag: 'Closed' }
  if (t.end._tag === 'Replaced') return { _tag: 'Replaced', next: t.end.next }
  const reject = itemsOf(w, task).find((r) => isRejectItem(r) && !answeredItem(w, r))
  if (reject !== undefined) {
    const stop = evaluationWaits(w, task)
    if (stop !== undefined) return { _tag: 'WaitsForEvaluation', stop }
    return { _tag: 'Returned', reject: reject.id as PointId }
  }
  if (taskAccepted(w, task, when)) return { _tag: 'Accepted' }
  if (resultsOf(w, task).length > 0) return { _tag: 'InReview' }
  return { _tag: 'Open' }
}

export const resultState = (w: Work, result: ResultId, when: Time): ResultState => {
  const items = blockerItems(w, result, when)
  if (items.length === 0) return { _tag: 'Accepted' }
  return items.some((i) => i._tag === 'Reject') ? { _tag: 'Rejected' } : { _tag: 'InReview' }
}

// engine used(a): the tries that count against a maker (only a fault uses one).
export const used = (w: Work, a: AssignmentId): number => usedBy(w, a)

export const makerState = (w: Work, a: AssignmentId): MakerState => {
  const x = assignmentAt(w, a)
  if (finished(x)) return { _tag: 'Finished' }
  const n = usedBy(w, a)
  const max = x._tag === 'Maker' ? x.maxAttempts : ({ _tag: 'Unlimited' } as const)
  if (max._tag === 'AtMost' && n >= max.max) return { _tag: 'OutOfTries', used: n, max: max.max }
  return { _tag: 'Working', used: n, max }
}

// One attempt count for the brief, next and the page: the try it is on, never above its limit.
export const attemptOf = (w: Work, a: AssignmentId): Attempt => {
  const x = assignmentAt(w, a)
  const max = x._tag === 'Maker' ? x.maxAttempts : ({ _tag: 'Unlimited' } as const)
  return { number: Math.min(usedBy(w, a) + 1, maxOf(max) ?? Infinity), max }
}

export const revisionState = (w: Work, draft: RevisionId): RevisionState => {
  const made = madeBy(w, draft)
  if (made !== undefined) return { _tag: 'Official', version: versionId(made.of, made.number) }
  const veto = vetoItem(w, draft)
  if (veto !== undefined) return { _tag: 'Vetoed', by: veto.review.id as RejectId }
  const x = draftAt(w, draft)
  const now = w.directions.get(x.of)?._tag === 'Official' ? currentOf(w, x.of) : undefined
  const base = x._tag === 'Change' ? x.base : undefined
  if (now !== undefined && base !== versionId(now.of, now.number)) {
    return { _tag: 'Outdated', current: versionId(now.of, now.number) }
  }
  // A draft that every decider accepted and that is not official waits for its deciders again.
  const waits = draftWaitsFor(w, draft)
  const leaves = waits.length > 0 ? waits : leavesOf(decidersOfDraft(w, draft))
  return { _tag: 'Waiting', waitsFor: leaves as NonEmpty<(typeof leaves)[number]> }
}

// engine covers(permission, when) as a state.
export const permissionState = (x: Permission, when: Time): PermissionState => {
  const t = Date.parse(when)
  if (x.revoked._tag === 'Revoked' && t >= Date.parse(x.revoked.at)) return { _tag: 'Revoked' }
  if (t < Date.parse(x.when)) return { _tag: 'NotYet' }
  if (t > Date.parse(x.until)) return { _tag: 'Ended' }
  return { _tag: 'Covers' }
}

export const evaluationState = (w: Work, e: EvaluationId): EvaluationState => {
  const x = w.evaluations.get(e)
  if (x === undefined) throw new Error(`the work has no evaluation ${e}`)
  const decision = evaluationDecision(w, x)
  if (decision?._tag === 'Reject') return { _tag: 'Rejected', by: decision.id as RejectId }
  return evaluationCounts(w, x) ? { _tag: 'Counts' } : { _tag: 'WaitsForOwner' }
}

// A limit of attempts as a number, for the words.
export const attemptsMax = (w: Work, a: AssignmentId): PositiveInt | undefined => {
  const x = assignmentAt(w, a)
  return x._tag === 'Maker' && x.maxAttempts._tag === 'AtMost' ? x.maxAttempts.max : undefined
}
