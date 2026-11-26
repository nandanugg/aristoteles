import { Result, Schema } from 'effect'
import {
  AttemptNumber, ReadPosition, Rationale, RetryCount, StoredEvent, edge, projectLine, refuse, taskLine,
  type Project, type Projection, type Refusal, type Task, type TaskPhase,
} from '../schema/project.ts'

export const beforeProject: Projection = { _tag: 'BeforeProject' }
export const readPosition = (state: Projection): typeof ReadPosition.Type =>
  state._tag === 'BeforeProject' ? ReadPosition.make(0) : state.value.read

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the current phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('The event has the wrong actor for the addressed work.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The addressed record changed after it was read.')))

const applyProjectMove = (state: Projection, event: StoredEvent): Result.Result<Project, Refusal> => {
  const { input, line, actor, number, read } = event
  if (line._tag !== 'Project' || input._tag !== 'next' || actor._tag !== 'Human') return wrongActor()
  const { fact } = input
  switch (fact._tag) {
    case 'ProjectOpened': {
      if (edge(projectLine, state._tag, 'next', 'Open') !== 'Allowed' || state._tag !== 'BeforeProject') return wrongMove()
      if (read !== 0) return stale()
      const { owner, host, pipeline, staff } = fact
      if (actor.id !== owner.id) return wrongActor()
      if (host.id === pipeline.id || !staff.roles.some((role) => role.id === host.id)) {
        return Result.fail(refuse('InvalidInput', Rationale.make('The project needs distinct roles and an assigned host.')))
      }
      return Result.succeed({
        id: line.id, owner, host, pipeline, staff, tasks: new Map(),
        status: { _tag: 'Open' }, activation: { _tag: 'Onboarding' }, lastChange: number,
        read: ReadPosition.make(number),
      })
    }
    case 'ProjectEnded':
    case 'TaskSent': {
      if (state._tag !== 'Open' || state.value.id !== line.id) return wrongMove()
      const project = state.value
      if (actor.id !== project.owner.id) return wrongActor()
      if (project.lastChange > read) return stale()
      if (fact._tag === 'ProjectEnded') {
        if (edge(projectLine, state._tag, 'next', 'Ended') !== 'Allowed') return wrongMove()
        return Result.succeed({ ...project, status: { _tag: 'Ended', at: number }, lastChange: number })
      }
      if (edge(projectLine, state._tag, 'next', 'Open') !== 'Allowed') return wrongMove()
      const { draft } = fact
      if (project.tasks.has(draft.id)) return stale()
      const roles = [project.host, project.pipeline]
      const role = roles.find((item) => item.id === draft.role.id)
      const reviewer = roles.find((item) => item.id === draft.reviewer.id)
      if (!role || !reviewer) return wrongActor()
      const tasks = new Map(project.tasks)
      tasks.set(draft.id, {
        ...draft, role, reviewer, phase: { _tag: 'Sent', retryCount: RetryCount.make(0) },
        attempts: { _tag: 'First' }, lastChange: number,
      })
      return Result.succeed({ ...project, tasks })
    }
    default:
      return wrongMove()
  }
}

const moveTask = (project: Project, task: Task, event: StoredEvent): Result.Result<Task, Refusal> => {
  const { actor, input, move, number, read } = event
  if (task.lastChange > read) return stale()
  const before = task.phase
  const fact = input.fact
  const entered = (phase: TaskPhase, attempts = task.attempts): Result.Result<Task, Refusal> =>
    edge(taskLine, before._tag, move, phase._tag) === 'Allowed'
      ? Result.succeed({ ...task, phase, attempts, lastChange: number })
      : wrongMove()
  switch (fact._tag) {
    case 'Began': {
      if (before._tag !== 'Sent') return wrongMove()
      const { session, place } = fact
      if (actor._tag !== 'Staff' || actor.id !== session.staff.id || actor.id !== project.staff.id ||
          !project.staff.roles.some((role) => role.id === task.role.id)) return wrongActor()
      const next = task.attempts._tag === 'First' ? 1 : task.attempts.last + 1
      if (!Schema.is(AttemptNumber)(next)) return wrongMove()
      return entered({
        _tag: 'Working', attempt: { number: next, session, place, retryCount: before.retryCount },
      }, { _tag: 'PreviouslyWorked', last: next })
    }
    case 'Result': {
      if (before._tag !== 'Working') return wrongMove()
      const { attempt } = before
      if (actor._tag !== 'Staff' || actor.id !== attempt.session.staff.id) return wrongActor()
      if (fact.attempt !== attempt.number) return stale()
      return entered({
        _tag: 'ReadyToReview', result: { summary: fact.summary, files: fact.files, attempt },
      })
    }
    case 'CommandOutcomes':
      if (before._tag !== 'ReadyToReview') return wrongMove()
      if (actor._tag !== 'Staff' || actor.id !== before.result.attempt.session.staff.id) return wrongActor()
      return entered({ _tag: 'Reviewing', result: before.result })
    case 'ReviewFacts': {
      if (before._tag !== 'Reviewing') return wrongMove()
      if (actor._tag !== 'Staff' || actor.id !== project.staff.id ||
          !project.staff.roles.some((role) => role.id === task.reviewer.id)) return wrongActor()
      const attempt = before.result.attempt
      const retryCount = attempt.retryCount + 1
      if (!Schema.is(RetryCount)(retryCount)) return wrongMove()
      return entered({ _tag: 'Working', attempt: { ...attempt, retryCount } })
    }
    default:
      return wrongMove()
  }
}

export const applyEvent = (state: Projection, event: StoredEvent): Result.Result<Projection, Refusal> => {
  if (!Schema.is(StoredEvent)(event) || event.number !== readPosition(state) + 1) {
    return Result.fail(refuse('InvalidInput', Rationale.make('Apply stored events once and in journal order.')))
  }
  if (state._tag === 'Ended') {
    return Result.fail(refuse('ProjectEnded', Rationale.make('This project has ended.')))
  }
  const updated = event.line._tag === 'Project' ? applyProjectMove(state, event) : (() => {
    if (state._tag !== 'Open') return wrongMove()
    const task = state.value.tasks.get(event.line.id)
    if (!task) return wrongMove()
    return Result.map(moveTask(state.value, task, event), (changed) => {
      const tasks = new Map(state.value.tasks)
      tasks.set(changed.id, changed)
      return { ...state.value, tasks }
    })
  })()
  return Result.map(updated, (project) => ({
    _tag: project.status._tag, value: { ...project, read: ReadPosition.make(event.number) },
  }))
}

export const fold = (
  events: readonly StoredEvent[], before: Projection = beforeProject,
): Result.Result<Projection, Refusal> => {
  let state = before
  for (const event of events) {
    const moved = applyEvent(state, event)
    if (Result.isFailure(moved)) return moved
    state = moved.success
  }
  return Result.succeed(state)
}
