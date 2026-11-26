import { Result, Schema } from 'effect'
import {
  AttemptNumber, RetryCount, Rationale, edge, liveSession, refuse, staffOf, subagentCapacity, taskLine, taskRules, activeWork,
  type EventNumber, type Of, type Project, type Refusal, type Task, type TaskEvent, type TaskPhase,
} from '../schema/project.ts'

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the current task phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('The actor does not serve the assigned task role.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current live task session.')))
const noChild = () => Result.fail(refuse('NoCapacity', Rationale.make('The staff has no free subagent slot.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The task changed after it was read.')))

export const restartTask = (task: Task, phase: Extract<TaskPhase, { _tag: 'Working' }>, number: Of<typeof EventNumber>): Result.Result<Task, Refusal> =>
  edge(taskLine, phase._tag, 'restart', 'Sent') === 'Allowed'
    ? Result.succeed({ ...task, phase: { _tag: 'Sent', retryCount: phase.attempt.retryCount }, lastChange: number })
    : wrongMove()

export const applyTaskMove = (project: Project, task: Task, event: TaskEvent): Result.Result<Task, Refusal> => {
  const { actor, move, number, read } = event
  if (!activeWork(project)) return wrongMove()
  if (task.lastChange > read) return stale()
  const before = task.phase
  const entered = (phase: TaskPhase, attempts = task.attempts): Result.Result<Task, Refusal> =>
    edge(taskLine, before._tag, move, phase._tag) === 'Allowed'
      ? Result.succeed({ ...task, phase, attempts, lastChange: number })
      : wrongMove()
  switch (event.from) {
    case 'Sent': {
      if (before._tag !== event.from) return wrongMove()
      const { session: claimed, place, staffing } = event.input
      if (staffing !== project.staffingAt || read < staffing) return stale()
      const session = liveSession(project, claimed.id)
      const staff = staffOf(project, task.role)
      if (!session) return retired()
      if (read < session.startedAt) return stale()
      if (!staff || actor._tag !== 'Staff' || actor.id !== session.staff.id || actor.id !== staff.id) return wrongActor()
      if (place === 'Child' && subagentCapacity(project, staff).freeSubagents === 0) return noChild()
      const next = task.attempts._tag === 'First' ? 1 : task.attempts.last + 1
      if (!Schema.is(AttemptNumber)(next)) return wrongMove()
      return entered({ _tag: 'Working', attempt: { number: next, session, place, retryCount: before.retryCount } },
        { _tag: 'PreviouslyWorked', last: next })
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
      return entered({ _tag: 'Reviewing', result: before.result, outcomes, by: null, review: null })
    }
    case 'Reviewing': {
      if (before._tag !== event.from) return wrongMove()
      const reviewer = staffOf(project, task.reviewer)
      if (event.move === 'next') {
        const { staffing } = event.input
        if (staffing !== project.staffingAt || read < staffing) return stale()
        if (before.by !== null) return wrongMove()
        const session = liveSession(project, event.input.session.id)
        if (!session) return retired()
        if (!reviewer || actor._tag !== 'Staff' || actor.id !== reviewer.id || actor.id !== session.staff.id) return wrongActor()
        if (subagentCapacity(project, reviewer).freeSubagents === 0) return noChild()
        return entered({ ...before, by: session.staff, review: number })
      }
      if (!before.by) return wrongMove()
      if (actor._tag !== 'Staff' || actor.id !== reviewer?.id || actor.id !== before.by.id) return wrongActor()
      if (![...project.sessions.values()].some((session) => session._tag === 'Live' && session.staff.id === before.by?.id)) return retired()
      const attempt = before.result.attempt
      const working = liveSession(project, attempt.session.id)
      if (!working) return retired()
      if (attempt.place === 'Child' && working.staff.id !== reviewer.id) {
        const assigned = project.staff.get(working.staff.id)
        if (!assigned || subagentCapacity(project, assigned).freeSubagents === 0) return noChild()
      }
      const retryCount = attempt.retryCount + 1
      if (!Schema.is(RetryCount)(retryCount)) return wrongMove()
      return entered({ _tag: 'Working', attempt: { ...attempt, retryCount } })
    }
  }
}
