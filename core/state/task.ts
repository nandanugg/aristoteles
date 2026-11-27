import { Result, Schema } from 'effect'
import { matchSender, validatePartition } from './task-tree.ts'
import { applyRaisedMove } from './raised.ts'
import { reviewMove, reviewTask } from './task-review.ts'
import {
  AttemptNumber, Rationale, RetryCount, edge, liveSession, refuse, staffByKey, staffOf, subagentCapacity, taskAdmission, taskMembership, taskLine, taskRules, activeWork, staffedIn, taskRole, taskReviewStaff,
  type Project, type Refusal, type Task, type TaskEvent, type TaskPhase,
} from '../schema/project.ts'

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the current task phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('The actor does not serve the assigned task role.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current live task session.')))
const noChild = () => Result.fail(refuse('NoCapacity', Rationale.make('The staff has no free subagent slot.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The task changed after it was read. Run work wait before trying again.')))

export const applyTaskMove = (project: Project, task: Task, event: Exclude<TaskEvent, { from: null }>): Result.Result<Task, Refusal> => {
  const { actor, move, number, read } = event
  if (!activeWork(project) || taskMembership(project, task) !== 'Current') return wrongMove()
  if (task.changedIn > read) return stale()
  const before = task.phase
  const session = actor._tag === 'Session' ? liveSession(project, actor.key) : undefined
  const entered = (
    phase: TaskPhase, fields: Partial<Pick<Task, 'lastAttempt' | 'direction' | 'automaticRetry' | 'retryCount' | 'goal' | 'omitted'>> = {},
  ): Result.Result<Task, Refusal> =>
    edge(taskLine, before._tag, move, phase._tag) === 'Allowed'
      ? Result.succeed({ ...task, ...fields, phase, changedIn: number })
      : wrongMove()
  if (before._tag !== event.from) return wrongMove()
  if (event.move === 'split' || event.from === 'Split') {
    if (!matchSender(project, task, actor)) return wrongActor()
    if (before._tag === 'Raised' && before.reason !== 'TooBig' && before.reason !== 'WrongTask') return wrongMove()
    if (event.move === 'dropStage') {
      const { stage, partition } = event.input
      if (stage > task.stages.length || task.omitted.includes(stage) || before._tag !== 'Split') return wrongMove()
      const previous = before.partition.parts.find(({ range }) => range.first <= stage && stage <= range.last)
      if (!previous || partition.parts.some(({ task }) => task === previous.task)) return wrongMove()
      const omitted = [...task.omitted, stage]
      return Result.flatMap(validatePartition(project, { ...task, omitted }, partition, read, event.move),
        (checked) => entered({ _tag: 'Split', partition: checked }, { omitted }))
    }
    const partition = event.move === 'split' ? event.input.partition : event.input
    return Result.flatMap(validatePartition(project, task, partition, read, event.move), (checked) =>
      entered({ _tag: 'Split', partition: checked }))
  }
  switch (event.from) {
    case 'Raised': {
      if (event.move === 'back') {
        if (!matchSender(project, task, actor)) return wrongActor()
        if (before._tag !== 'Raised' || (before.reason !== 'TooBig' && before.reason !== 'WrongTask')) return wrongMove()
        return entered({ _tag: 'Sent', feedback: { _tag: 'None' } }, { goal: event.input.goal })
      }
      return applyRaisedMove(project, task, event, entered)
    }
    case 'Sent': {
      if (before._tag !== event.from) return wrongMove()
      const staff = staffOf(project, taskRole(task))
      if (!session || actor._tag !== 'Session') return retired()
      if (read < session.startedIn) return stale()
      if (!staff || staff.key !== session.staff.key) return wrongActor()
      if (event.move === 'raise') return entered({
        _tag: 'Raised', reason: 'TooBig', origin: { _tag: 'Brief', why: event.input.why },
        evidence: [], retained: { _tag: 'NoResult' }, fix: { _tag: 'Unassessed' },
      })
      const { where, staffedIn: basis } = event.input
      if (basis !== staffedIn(project) || read < basis) return stale()
      const admission = taskAdmission(project, task, read)
      if (admission !== 'Allowed') return Result.fail(refuse('WrongMove', Rationale.make(
        admission === 'NeedsSplit' ? 'The sender must split this brief into work for its roles.'
          : admission === 'Parallel' ? 'Parallel work requires a prepared worktree.'
          : 'Wait for the preceding part to finish and read the current partition.',
      )))
      if (where === 'Subagent' && subagentCapacity(project, staff).freeSubagents === 0) return noChild()
      const next = task.lastAttempt._tag === 'None' ? 1 : task.lastAttempt.number + 1
      if (!Schema.is(AttemptNumber)(next)) return wrongMove()
      return entered({ _tag: 'Working', attempt: { number: next, actor, where, feedback: before.feedback } },
        { lastAttempt: { _tag: 'Attempted', number: next } })
    }
    case 'Working': {
      if (before._tag !== event.from) return wrongMove()
      const { attempt } = before
      if (event.move === 'restart') {
        if (actor._tag !== 'Human') return wrongActor()
        const ended = project.sessions.get(event.input.session)
        if (attempt.actor.key !== event.input.session || ended?._tag !== 'Ended') return wrongMove()
        if (ended.changedIn > read) return stale()
        return entered({ _tag: 'Sent', feedback: attempt.feedback })
      }
      if (actor._tag !== 'Session') return wrongActor()
      if (session?.key !== attempt.actor.key) return retired()
      if (event.input.attempt !== attempt.number) return stale()
      if (event.move === 'dropStage') {
        const { stage } = event.input
        if (stage > task.stages.length || task.omitted.includes(stage) || task.stages.length - task.omitted.length <= 1)
          return wrongMove()
        return entered(before, { omitted: [...task.omitted, stage] })
      }
      if (event.move === 'raise') return entered({ _tag: 'Raised', reason: event.input.reason, evidence: event.input.evidence, origin: { _tag: 'Work' },
        retained: { _tag: 'NoResult' }, fix: { _tag: 'Unassessed' },
      })
      return entered({
        _tag: 'ReadyToReview', result: { summary: event.input.summary, files: event.input.files, attempt, reportedIn: number },
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
      if (event.move === 'release') {
        const { assignment } = before
        if (actor._tag !== 'Human') return wrongActor()
        const ended = project.sessions.get(event.input.session)
        if (assignment._tag !== 'Assigned' || assignment.actor.key !== event.input.session || ended?._tag !== 'Ended')
          return wrongMove()
        if (ended.changedIn > read) return stale()
        return entered({ ...before, assignment: { _tag: 'Waiting' } })
      }
      if (event.move === 'assign') {
        const { staffedIn: basis } = event.input
        if (basis !== staffedIn(project) || read < basis) return stale()
        if (before.assignment._tag !== 'Waiting') return wrongMove()
        if (!session || actor._tag !== 'Session' || read < session.startedIn) return retired()
        const reviewer = taskReviewStaff(project, task)
        if (!reviewer || reviewer.key !== session.staff.key) return wrongActor()
        if (subagentCapacity(project, reviewer).freeSubagents === 0) return noChild()
        return entered({ ...before, assignment: { _tag: 'Assigned', actor, queuedIn: task.changedIn } })
      }
      const { assignment } = before
      const { queuedIn, facts, limit } = event.input
      if (assignment._tag !== 'Assigned' || queuedIn !== assignment.queuedIn) return retired()
      if (!session || read < session.startedIn || session.key !== assignment.actor.key) return retired()
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
          return Result.map(entered(phase), (task) => ({ ...task, retryCount: RetryCount.make(task.retryCount + 1) }))
        }
        return entered(phase)
      })
    }
  }
}
