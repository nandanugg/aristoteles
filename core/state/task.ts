import { Result, Schema } from 'effect'
import { reviewMove, reviewTask } from './task-review.ts'
import {
  AttemptNumber, Rationale, edge, liveSession, refuse, staffOf, subagentCapacity, taskLine, taskRules, activeWork, staffingAt, taskRole, taskReviewStaff,
  type EventNumber, type Of, type Project, type Refusal, type Task, type TaskEvent, type TaskPhase,
} from '../schema/project.ts'

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the current task phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('The actor does not serve the assigned task role.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current live task session.')))
const noChild = () => Result.fail(refuse('NoCapacity', Rationale.make('The staff has no free subagent slot.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The task changed after it was read.')))

export const restartTask = (task: Task, phase: Extract<TaskPhase, { _tag: 'Working' }>, number: Of<typeof EventNumber>): Result.Result<Task, Refusal> =>
  edge(taskLine, phase._tag, 'restart', 'Sent') === 'Allowed'
    ? Result.succeed({ ...task, phase: { _tag: 'Sent', retryCount: phase.attempt.retryCount, feedback: phase.attempt.feedback }, lastChange: number })
    : wrongMove()

export const applyTaskMove = (project: Project, task: Task, event: Exclude<TaskEvent, { from: null }>): Result.Result<Task, Refusal> => {
  const { actor, move, number, read } = event
  if (!activeWork(project)) return wrongMove()
  if (task.lastChange > read) return stale()
  const before = task.phase
  const entered = (phase: TaskPhase, lastAttempt = task.lastAttempt): Result.Result<Task, Refusal> =>
    edge(taskLine, before._tag, move, phase._tag) === 'Allowed'
      ? Result.succeed({ ...task, phase, lastAttempt, lastChange: number })
      : wrongMove()
  switch (event.from) {
    case 'Sent': {
      if (before._tag !== event.from) return wrongMove()
      const { session: claimed, where, staffing } = event.input
      if (staffing !== staffingAt(project) || read < staffing) return stale()
      const session = liveSession(project, claimed.id)
      const staff = staffOf(project, taskRole(task))
      if (!session) return retired()
      if (read < session.startedAt) return stale()
      if (!staff || actor._tag !== 'Staff' || actor.id !== session.staff.id || actor.id !== staff.id) return wrongActor()
      if (where === 'Subagent' && subagentCapacity(project, staff).freeSubagents === 0) return noChild()
      const next = task.lastAttempt._tag === 'None' ? 1 : task.lastAttempt.number + 1
      if (!Schema.is(AttemptNumber)(next)) return wrongMove()
      return entered({ _tag: 'Working', attempt: { number: next, session, where, retryCount: before.retryCount, feedback: before.feedback } },
        { _tag: 'Attempted', number: next })
    }
    case 'Working': {
      if (before._tag !== event.from) return wrongMove()
      const { attempt } = before
      if (event.move === 'restart') {
        if (actor._tag !== 'Human' || actor.id !== project.owner.id) return wrongActor()
        if (attempt.session.id !== event.input.session || project.sessions.get(event.input.session)?._tag !== 'Ended') return wrongMove()
        return restartTask(task, before, number)
      }
      if (actor._tag !== 'Staff' || actor.id !== attempt.session.staff.id) return wrongActor()
      if (event.input.session !== attempt.session.id || !liveSession(project, attempt.session.id)) return retired()
      if (event.input.attempt !== attempt.number) return stale()
      if (event.move === 'raise') return entered({ _tag: 'Raised', reason: event.input.reason, evidence: event.input.evidence })
      return entered({
        _tag: 'ReadyToReview', result: { summary: event.input.summary, files: event.input.files, attempt, at: number },
      })
    }
    case 'ReadyToReview': {
      if (before._tag !== event.from) return wrongMove()
      if (actor._tag !== 'Human' || actor.id !== project.owner.id) return wrongActor()
      const applicable = taskRules(task).filter(({ verification }) => verification._tag === 'Command')
      const { outcomes } = event.input
      if (applicable.length !== outcomes.length || applicable.some((rule, index) =>
        JSON.stringify(rule) !== JSON.stringify(outcomes[index]?.rule)))
        return Result.fail(refuse('InvalidEvidence', Rationale.make('Record one outcome for each pinned command rule in order.')))
      return entered({ _tag: 'Reviewing', result: before.result, outcomes, assignment: { _tag: 'Waiting' } })
    }
    case 'Reviewing': {
      if (before._tag !== event.from) return wrongMove()
      if (event.move === 'assign') {
        const { staffing } = event.input
        if (staffing !== staffingAt(project) || read < staffing) return stale()
        if (before.assignment._tag !== 'Waiting') return wrongMove()
        const session = liveSession(project, event.input.session.id)
        if (!session || read < session.startedAt) return retired()
        const reviewer = taskReviewStaff(project, task)
        if (!reviewer || actor._tag !== 'Staff' || actor.id !== reviewer.id || actor.id !== session.staff.id) return wrongActor()
        if (subagentCapacity(project, reviewer).freeSubagents === 0) return noChild()
        return entered({ ...before, assignment: { _tag: 'Assigned', by: session.staff, review: task.lastChange } })
      }
      const { assignment } = before
      const { session: id, review, facts, limit } = event.input
      if (assignment._tag !== 'Assigned' || review !== assignment.review) return retired()
      const session = liveSession(project, id)
      if (!session || read < session.startedAt || session.staff.id !== assignment.by.id) return retired()
      if (actor._tag !== 'Staff' || actor.id !== assignment.by.id) return wrongActor()
      return Result.flatMap(reviewTask(task, before, facts, limit), (phase) => {
        if (reviewMove(phase) !== event.move || (event.move === 'raise' && (phase._tag !== 'Raised' || phase.reason !== event.input.reason)))
          return wrongMove()
        if (phase._tag === 'Working') {
          const { attempt } = phase
          const working = liveSession(project, attempt.session.id)
          if (!working) return retired()
          if (attempt.where === 'Subagent' && working.staff.id !== assignment.by.id &&
              subagentCapacity(project, working.staff).freeSubagents === 0) return noChild()
        }
        return entered(phase)
      })
    }
  }
}
