// B6: one escalation of a change point serves every assignment. An escalation names its points
// (work escalate --point); after its resolve, the role that directs drafts the change.
import type { Assignment, EscalationId, PointId, TaskId } from '../schema/index.ts'
import { directionIdsOf, holdsA, within } from './reads.ts'
import type { Derived } from './types.ts'

export interface PointEscalations {
  readonly open: EscalationId | undefined
  readonly resolved: EscalationId | undefined
}
// The open and the resolved escalation that name the point, by any assignment.
export const escalationsOfPoint = (d: Derived, point: PointId): PointEscalations => {
  const named = [...d.moment.work.reviews.values()].flatMap((v) =>
    v._tag === 'Escalate' && v.points.includes(point) ? [v.id] : [],
  )
  const inState = (tag: string) =>
    named.find((e) => d.states.escalations.get(e)?._tag === tag)
  return { open: inState('Open'), resolved: inState('Resolved') }
}
// The open assignment that drafts a change of the task's local directions: it holds Direct and
// its tree holds the task. None: the task's owner changes it (work waiting).
export const directorOf = (d: Derived, task: TaskId): Assignment | undefined => {
  const w = d.moment.work
  const local = directionIdsOf(w, task).some((x) => w.directions.get(x)?.source._tag === 'Local')
  if (!local) return undefined
  return [...w.assignments.values()].find((x) => {
    const state = d.states.assignments.get(x.id)?._tag
    return (
      state !== 'Ended' &&
      state !== 'BriefOver' &&
      holdsA(w, x, 'Direct') &&
      within(w, task, x.task)
    )
  })
}
