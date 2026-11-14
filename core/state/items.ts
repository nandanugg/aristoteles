// The reviews as the old engine kept them, one item per point of a Reject (v4.1, v4.2), with the
// at that its own decide had, and a resolve read as an accept of its escalation's result. The
// fold reads these to name an exhaustion (its fault and its at) and to count a decision.
import {
  type Answerer,
  type By,
  type EscalationId,
  type EvaluationId,
  type Evidence,
  type PointId,
  pointsOf,
  type RejectId,
  type ResultId,
  type Review,
  type ReviewId,
  type RevisionId,
  type RuleEntry,
  type TaskId,
  type Time,
  type Under,
  type Work,
} from '../schema/index.ts'
import { resultAt } from './records.ts'

// What a review is about: a result, a task, a draft or an evaluation.
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
  readonly answerBy: Answerer | undefined
  readonly under: Under
  readonly when: Time
  readonly at: number
  // The Reject of a point, and the first point of that Reject (one act, one stop).
  readonly group: RejectId | undefined
  readonly first: PointId | undefined
}

export const itemsOfReview = (w: Work, v: Review): ReadonlyArray<Item> => {
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
      if (result === undefined) {
        throw new Error(`${v.id} resolves ${v.escalation}, which is no escalation`)
      }
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
// The task of a review's target: a result's task, or the task itself; none for a draft.
export const taskOfTarget = (w: Work, of: Target): TaskId | undefined =>
  of._tag === 'Task' ? of.id : of._tag === 'Result' ? resultAt(w, of.id).task : undefined

export const isAcceptItem = (r: Item): boolean =>
  r.decision === 'Accept' && r.resolves === undefined
export const isRejectItem = (r: Item): boolean => r.decision === 'Reject'
export const hasEvidence = (evidence: ReadonlyArray<Evidence>): boolean =>
  evidence.some((e) => e.at !== '' && e.says !== '')
