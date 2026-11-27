import { Result, Schema } from 'effect'
import { reviewMove, reviewTask } from './task-review.ts'
import {
  AttemptNumber, Rationale, edge, liveSession, refuse, staffByKey, staffOf, subagentCapacity, taskLine, taskRules, activeWork, staffingAt, taskRole, taskReviewStaff,
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
  const session = actor._tag === 'Session' ? liveSession(project, actor.key) : undefined
  const entered = (phase: TaskPhase, lastAttempt = task.lastAttempt): Result.Result<Task, Refusal> =>
    edge(taskLine, before._tag, move, phase._tag) === 'Allowed'
      ? Result.succeed({ ...task, phase, lastAttempt, lastChange: number })
      : wrongMove()
  switch (event.from) {
    case 'Sent': {
      if (before._tag !== event.from) return wrongMove()
      const { where, staffing } = event.input
      if (staffing !== staffingAt(project) || read < staffing) return stale()
      const staff = staffOf(project, taskRole(task))
      if (!session || actor._tag !== 'Session') return retired()
      if (read < session.startedAt) return stale()
      if (!staff || staff.key !== session.staff.key) return wrongActor()
      if (where === 'Subagent' && subagentCapacity(project, staff).freeSubagents === 0) return noChild()
      const next = task.lastAttempt._tag === 'None' ? 1 : task.lastAttempt.number + 1
      if (!Schema.is(AttemptNumber)(next)) return wrongMove()
      return entered({ _tag: 'Working', attempt: { number: next, actor, where, retryCount: before.retryCount, feedback: before.feedback } },
        { _tag: 'Attempted', number: next })
    }
    case 'Working': {
      if (before._tag !== event.from) return wrongMove()
      const { attempt } = before
      if (event.move === 'restart') {
        if (actor._tag !== 'Human') return wrongActor()
        if (attempt.actor.key !== event.input.session || project.sessions.get(event.input.session)?._tag !== 'Ended') return wrongMove()
        return restartTask(task, before, number)
      }
      if (actor._tag !== 'Session') return wrongActor()
      if (session?.key !== attempt.actor.key) return retired()
      if (event.input.attempt !== attempt.number) return stale()
      if (event.move === 'raise') return entered({ _tag: 'Raised', reason: event.input.reason, evidence: event.input.evidence })
      return entered({
        _tag: 'ReadyToReview', result: { summary: event.input.summary, files: event.input.files, attempt, at: number },
      })
    }
    case 'ReadyToReview': {
      if (before._tag !== event.from) return wrongMove()
      if (actor._tag !== 'Human') return wrongActor()
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
        if (!session || actor._tag !== 'Session' || read < session.startedAt) return retired()
        const reviewer = taskReviewStaff(project, task)
        if (!reviewer || reviewer.key !== session.staff.key) return wrongActor()
        if (subagentCapacity(project, reviewer).freeSubagents === 0) return noChild()
        return entered({ ...before, assignment: { _tag: 'Assigned', actor, review: task.lastChange } })
      }
      const { assignment } = before
      const { review, facts, limit } = event.input
      if (assignment._tag !== 'Assigned' || review !== assignment.review) return retired()
      if (!session || read < session.startedAt || session.key !== assignment.actor.key) return retired()
      return Result.flatMap(reviewTask(task, before, facts, limit), (phase) => {
        if (reviewMove(phase) !== event.move || (event.move === 'raise' && (phase._tag !== 'Raised' || phase.reason !== event.input.reason)))
          return wrongMove()
        if (phase._tag === 'Working') {
          const { attempt } = phase
          const working = liveSession(project, attempt.actor.key)
          const staff = working && staffByKey(project, working.staff.key)
          if (!staff) return retired()
          if (attempt.where === 'Subagent' && staff.key !== session.staff.key &&
              subagentCapacity(project, staff).freeSubagents === 0) return noChild()
        }
        return entered(phase)
      })
    }
  }
}
