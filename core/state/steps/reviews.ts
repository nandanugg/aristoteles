// The step of a review: one record (a Reject holds its points) at the engine's clock. An accept
// that meets the deciders of a draft makes its version; a fault on the last try of a maker makes
// an exhaustion; a low reviewer's unit ends.
import {
  type Answerer,
  type Assignment,
  type By,
  type EscalationId,
  type Evidence,
  type EvidenceData,
  type NonEmpty,
  type Point,
  type PointId,
  type RejectId,
  type ResultId,
  type Review,
  type ReviewWritten,
  type Stepped,
  type TaskId,
  type Time,
  type Work,
} from '../../schema/index.ts'
import { type Act, type Build, built, put } from '../act.ts'
import {
  decidersOfDraft,
  draftAcceptItems,
  draftMatches,
  exhaustionResult,
  isFault,
  maxTriesOf,
  metAt,
  stopRefOrThrow,
  stopRefTask,
  usedBy,
} from '../decisions.ts'
import { itemsOfReview } from '../items.ts'
import {
  answererBy,
  assignmentAt,
  assignmentBy,
  draftAt,
  isAssignment,
  openAncestorOf,
  personOf,
  resultAt,
  taskAt,
  underNowOf,
} from '../records.ts'
import { findRule, underNow } from '../versions.ts'
import { endUnit } from './assignments.ts'
import { makeVersion } from './directions.ts'

type Target = { readonly _tag: string; readonly id: string }
type Base = {
  readonly under: Assignment['under']
  readonly when: Time
}

// The target of a review as a result, task, draft or evaluation id; a resolve's is its
// escalation's result.
const targetOf = (w: Work, d: ReviewWritten): Target | undefined => {
  switch (d._tag) {
    case 'Accept':
    case 'Reject':
      return d.of
    case 'Recheck':
    case 'Escalate':
      return { _tag: 'Result', id: d.of }
    case 'Resolve': {
      const escalated = w.reviews.get(d.escalation)
      return escalated?._tag === 'Escalate' ? { _tag: 'Result', id: escalated.of } : undefined
    }
  }
}
// The task of a review's target (the person's review reads the versions of its task now).
const reviewTask = (w: Work, of: Target): TaskId | undefined => {
  if (of._tag === 'Task') return of.id as TaskId
  if (of._tag === 'Result') return resultAt(w, of.id as ResultId).task
  if (of._tag === 'Evaluation') {
    const e = w.evaluations.get(of.id as never)
    return e === undefined ? undefined : stopRefTask(w, stopRefOrThrow(w, e.answers))
  }
  return undefined
}
// The evidence of a review: a rule by its id in the official version now.
const evidenceOf = (w: Work, list: ReadonlyArray<EvidenceData>): ReadonlyArray<Evidence> =>
  list.map((e) => {
    const rule = e.rule === null ? undefined : findRule(w, e.rule)
    return { says: e.what, meets: rule?.entry ?? null, at: e.where, uses: [] }
  })
const evidenceData = (d: ReviewWritten): ReadonlyArray<EvidenceData> =>
  d._tag === 'Accept' ? d.of.evidence : d._tag === 'Resolve' ? d.evidence : []

const acceptOf = (
  w: Work,
  by: By,
  d: Extract<ReviewWritten, { readonly _tag: 'Accept' }>,
  evidence: ReadonlyArray<Evidence>,
  base: Base & { readonly id: Review['id']; readonly at: number },
): Review => {
  const reviewer = answererBy(w, by)
  const nonEmpty = evidence as NonEmpty<Evidence>
  switch (d.of._tag) {
    case 'Result':
      return {
        ...base,
        _tag: 'Accept',
        reason: d.reason,
        by: reviewer,
        of: { _tag: 'Result', id: d.of.id, evidence: nonEmpty },
      }
    case 'Evaluation':
      return {
        ...base,
        _tag: 'Accept',
        reason: d.reason,
        by: personOf(w, by),
        of: { _tag: 'Evaluation', id: d.of.id, evidence: nonEmpty },
      }
    case 'Revision':
      return typeof reviewer === 'string'
        ? {
            ...base,
            _tag: 'Accept',
            reason: d.reason,
            by: reviewer,
            of: { _tag: 'Revision', id: d.of.id, evidence: nonEmpty },
          }
        : {
            ...base,
            _tag: 'Accept',
            reason: d.reason,
            by: reviewer,
            of: { _tag: 'Revision', id: d.of.id, evidence },
          }
  }
}
const rejectOf = (
  w: Work,
  by: By,
  d: Extract<ReviewWritten, { readonly _tag: 'Reject' }>,
  base: Base & { readonly id: RejectId; readonly at: number },
): Review => {
  const reviewer = answererBy(w, by)
  const of = d.of
  switch (of._tag) {
    case 'Result': {
      const points = of.points.map((p): Point => {
        const rule = p.breaks === null ? undefined : findRule(w, p.breaks)
        return {
          text: p.text,
          breaks: rule ? { _tag: 'Rule', rule: rule.entry } : { _tag: 'NoRule' },
        }
      }) as unknown as NonEmpty<Point>
      return { ...base, _tag: 'Reject', by: reviewer, of: { _tag: 'Result', id: of.id, points } }
    }
    case 'Task':
      return {
        ...base,
        _tag: 'Reject',
        by: reviewer,
        of: { _tag: 'Task', id: of.id, points: of.points },
      }
    case 'Revision':
      return {
        ...base,
        _tag: 'Reject',
        by: reviewer,
        of: { _tag: 'Revision', id: of.id, reason: of.reason },
      }
    case 'Evaluation':
      return {
        ...base,
        _tag: 'Reject',
        by: personOf(w, by),
        of: { _tag: 'Evaluation', id: of.id, reason: of.reason },
      }
  }
}

// A fault on the last try of its maker (under versions that still say the same): an exhaustion
// of that maker's result, once. (derived: AssignmentState OutOfTries owns this stop, S9.)
const exhaust = (b: Build, review: Review): void => {
  const w = b.work
  // The items of this one review (the items of every review of each new Work made the fold
  // quadratic in the reviews).
  const faults = [...w.reviews.values()].includes(review) ? itemsOfReview(w, review) : []
  const first = faults.find((i) => isFault(w, i))
  if (first === undefined || first.of._tag !== 'Result') return
  const result = resultAt(w, first.of.id)
  if (!underNow(w, result)) return
  const max = maxTriesOf(w, result.by)
  if (max === undefined || usedBy(w, result.by) < max) return
  if ([...w.exhaustions.values()].some((x) => exhaustionResult(w, x).id === result.id)) return
  const x = b.name('exhaustion')
  const exhaustion = { id: x, fault: first.id as PointId, when: first.when, at: first.at }
  b.work = { ...b.work, exhaustions: put(b.work.exhaustions, x, exhaustion) }
}

export const review = (work: Work, d: ReviewWritten, act: Act): Stepped =>
  built(work, (b) => {
    const w = work
    const by = act.by
    const of = targetOf(w, d)
    const task = of === undefined ? undefined : reviewTask(w, of)
    const under = isAssignment(by)
      ? assignmentAt(w, by).under
      : task === undefined || of?._tag === 'Revision'
        ? new Map()
        : underNowOf(w, taskAt(w, task))
    const base = { under, when: act.when }
    const evidence = evidenceOf(w, evidenceData(d))
    let made: Review
    switch (d._tag) {
      case 'Escalate': {
        const a = assignmentBy(by)
        const id = b.name('review')
        // (derived: the answerer now owns who answers; the record keeps the first one.)
        const answerBy: Answerer = openAncestorOf(w, a) ?? taskAt(w, resultAt(w, d.of).task).owner
        made = {
          ...base,
          _tag: 'Escalate',
          id: id as EscalationId,
          by: a,
          of: d.of,
          reason: d.reason,
          answerBy,
          at: b.tick(),
        }
        break
      }
      case 'Recheck': {
        const id = b.name('review')
        made = {
          ...base,
          _tag: 'Recheck',
          id,
          by: assignmentBy(by),
          of: d.of,
          reason: d.reason,
          at: b.tick(),
        }
        break
      }
      case 'Resolve': {
        const id = b.name('review')
        made = {
          ...base,
          _tag: 'Resolve',
          id,
          by: answererBy(w, by),
          escalation: d.escalation,
          resolution: d.resolution,
          evidence,
          at: b.tick(),
        }
        break
      }
      case 'Accept': {
        const id = b.name('review')
        made = acceptOf(w, by, d, evidence, { ...base, id, at: b.tick() })
        break
      }
      case 'Reject': {
        const id = b.name('review') as RejectId
        const points = d.of._tag === 'Result' || d.of._tag === 'Task' ? d.of.points.length : 1
        made = rejectOf(w, by, d, { ...base, id, at: b.tick(points) })
        break
      }
    }
    b.work = { ...b.work, reviews: put(b.work.reviews, made.id, made) }
    // An accept that meets the deciders of a draft makes the next version.
    // (derived: RevisionState Official is this rule; the fold must make the version record.)
    if (made._tag === 'Accept' && made.of._tag === 'Revision') {
      const draft = made.of.id
      const after = b.work
      const who = decidersOfDraft(after, draft)
      const matches = draftMatches(after, draftAt(after, draft).of)
      if (metAt(who, draftAcceptItems(after, draft), matches) !== undefined) {
        makeVersion(b, draft, act.when)
      }
    }
    exhaust(b, made)
    if (made._tag !== 'Escalate' && isAssignment(by)) endUnit(b, by)
    if (made._tag === 'Escalate') endUnit(b, made.by)
  })
