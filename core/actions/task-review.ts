import { Effect, Result } from 'effect'
import { mayAssignTaskReview } from '../derived/project/review.ts'
import { Rationale, ReadPosition, refuse, staffingAt, type LiveSession, type Of, type Project, type Refusal, type TaskAddress, type ReviewFacts } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { Authority, commitProjectMove, submit } from './project.ts'

export const checkTaskReview = (
  journal: Journal, project: Project, line: Of<typeof TaskAddress>, session: LiveSession,
) => Effect.flatMap(journal.eventsAfter(ReadPosition.make(0)), (events) => {
  const task = project.tasks.get(line.id)
  if (!task) return Effect.fail(refuse('WrongMove', Rationale.make('That task is unavailable.')))
  const allowed = mayAssignTaskReview(project, events.filter((event) => event.number <= project.read), task, session)
  return allowed === 'Allowed' ? Effect.succeed(task.lastChange)
    : Effect.fail(refuse(allowed, Rationale.make('Use the staff and slot due to review this task.')))
})

export const assignTaskReview = (
  journal: Journal, project: Project, line: Of<typeof TaskAddress>, session: LiveSession,
): Effect.Effect<Committed, Refusal> => commitProjectMove(journal, session.staff, project.read, (current, events) => {
  const task = current?.tasks.get(line.id)
  if (!current || !task) return Result.fail(refuse('WrongMove', Rationale.make('That task is unavailable.')))
  if (task.lastChange > project.read || staffingAt(project) !== staffingAt(current))
    return Result.fail(refuse('Stale', Rationale.make('The task or staffing changed before the review opened.')))
  const allowed = mayAssignTaskReview(current, events, task, session)
  return allowed === 'Allowed'
    ? Result.succeed({ line, from: 'Reviewing', move: 'assign', input: { session, staffing: staffingAt(current) } })
    : Result.fail(refuse(allowed, Rationale.make('Use the staff and slot due to review this task.')))
})

export const reportTaskReview = (
  journal: Journal, line: Of<typeof TaskAddress>, read: Of<typeof ReadPosition>, facts: ReviewFacts,
): Effect.Effect<Committed, Refusal, Authority> => submit(journal, { read, line, move: 'review', input: { facts } })
