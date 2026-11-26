import { Result, Schema } from 'effect'
import {
  AttemptNumber, ReadPosition, Rationale, RetryCount, StoredEvent, edge, liveSession, projectLine, refuse, sessionLine, sessionMayStart, staffOf, subagentCapacity, taskLine, validateStaffing,
  type LiveSession, type Project, type Projection, type Refusal, type StaffSession, type Task, type TaskPhase,
} from '../schema/project.ts'

export const beforeProject: Projection = { _tag: 'BeforeProject' }
export const readPosition = (state: Projection): typeof ReadPosition.Type =>
  state._tag === 'BeforeProject' ? ReadPosition.make(0) : state.value.read

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the current phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('The event has the wrong actor for the addressed work.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current live staff session.')))
const noChild = () => Result.fail(refuse('NoCapacity', Rationale.make('The staff has no free subagent slot.')))
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
      const roles = new Map([host, pipeline, ...fact.roles].map((role) => [role.id, role]))
      if (actor.id !== owner.id) return wrongActor()
      if (roles.size !== fact.roles.length + 2 || !staff.roles.some((role) => role.id === host.id) ||
          new Set(staff.roles.map((role) => role.id)).size !== staff.roles.length ||
          staff.roles.some((role) => !roles.has(role.id))) {
        return Result.fail(refuse('InvalidInput', Rationale.make('The project needs distinct roles and an assigned host.')))
      }
      if (staff.subagents === 0) return Result.fail(refuse('StaffingMinimum', Rationale.make('The onboarding host needs a subagent.')))
      const canonicalStaff = { ...staff, roles: [roles.get(staff.roles[0].id)!, ...staff.roles.slice(1).map((role) => roles.get(role.id)!)] as const }
      return Result.succeed({
        id: line.id, owner, host, pipeline, roles, staff: new Map([[staff.id, canonicalStaff]]),
        subscriptions: new Map([[staff.subscription.id, staff.subscription]]), staffingAt: number,
        sessions: new Map(), tasks: new Map(),
        status: { _tag: 'Open' }, activation: { _tag: 'Onboarding' }, lastChange: number,
        read: ReadPosition.make(number),
      })
    }
    case 'SessionStarted':
    case 'StaffingAccepted':
    case 'ProjectEnded':
    case 'TaskSent': {
      if (state._tag !== 'Open' || state.value.id !== line.id) return wrongMove()
      const project = state.value
      if (actor.id !== project.owner.id) return wrongActor()
      if (fact._tag === 'SessionStarted') {
        const { id, staff, staffing, pane } = fact.session
        if (read < staffing || project.sessions.has(id)) return stale()
        return Result.map(sessionMayStart(project, staff, staffing, null), (assigned) => {
          const sessions = new Map(project.sessions)
          sessions.set(id, { _tag: 'Live', id, staff: assigned, pane, startedAt: number })
          return { ...project, sessions }
        })
      }
      if (fact._tag === 'StaffingAccepted') {
        if (project.staffingAt > read) return stale()
        return Result.map(validateStaffing(project, fact.plan), (plan) => ({
          ...project, staff: new Map(plan.staff.map((staff) => [staff.id, staff])),
          subscriptions: new Map(plan.subscriptions.map((item) => [item.id, item])), staffingAt: number,
        }))
      }
      if (project.lastChange > read) return stale()
      if (fact._tag === 'ProjectEnded') {
        if (edge(projectLine, state._tag, 'next', 'Ended') !== 'Allowed' ||
            [...project.sessions.values()].some((session) => session._tag === 'Live')) return wrongMove()
        return Result.succeed({ ...project, status: { _tag: 'Ended', at: number }, lastChange: number })
      }
      if (edge(projectLine, state._tag, 'next', 'Open') !== 'Allowed') return wrongMove()
      const { draft } = fact
      if (project.tasks.has(draft.id)) return stale()
      const role = project.roles.get(draft.role.id)
      const reviewer = project.roles.get(draft.reviewer.id)
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
      if (fact.staffing !== project.staffingAt || read < fact.staffing) return stale()
      if (before._tag !== 'Sent') return wrongMove()
      const session = liveSession(project, fact.session.id)
      const staff = staffOf(project, task.role)
      if (!session) return retired()
      if (!staff || actor._tag !== 'Staff' || actor.id !== session.staff.id || actor.id !== staff.id) return wrongActor()
      if (fact.place === 'Child' && subagentCapacity(project, staff).freeSubagents === 0) return noChild()
      const next = task.attempts._tag === 'First' ? 1 : task.attempts.last + 1
      if (!Schema.is(AttemptNumber)(next)) return wrongMove()
      return entered({
        _tag: 'Working', attempt: { number: next, session, place: fact.place, retryCount: before.retryCount },
      }, { _tag: 'PreviouslyWorked', last: next })
    }
    case 'Result': {
      if (before._tag !== 'Working') return wrongMove()
      const { attempt } = before
      if (actor._tag !== 'Staff' || actor.id !== attempt.session.staff.id) return wrongActor()
      if (!liveSession(project, attempt.session.id)) return retired()
      if (fact.attempt !== attempt.number) return stale()
      return entered({
        _tag: 'ReadyToReview', result: { summary: fact.summary, files: fact.files, attempt },
      })
    }
    case 'CommandOutcomes':
      if (before._tag !== 'ReadyToReview') return wrongMove()
      if (actor._tag !== 'Staff' || actor.id !== before.result.attempt.session.staff.id) return wrongActor()
      return entered({
        _tag: 'Reviewing', result: before.result, enteredAt: number, review: { _tag: 'Waiting' },
      })
    case 'Reviewing': {
      if (fact.staffing !== project.staffingAt || read < fact.staffing) return stale()
      if (before._tag !== 'Reviewing' || before.review._tag !== 'Waiting') return wrongMove()
      const staff = staffOf(project, task.reviewer)
      const session = liveSession(project, fact.session.id)
      if (!session) return retired()
      if (!staff || actor._tag !== 'Staff' || actor.id !== staff.id || actor.id !== session.staff.id) return wrongActor()
      if (subagentCapacity(project, staff).freeSubagents === 0) return noChild()
      return entered({ ...before, review: { _tag: 'By', session } })
    }
    case 'ReviewFacts': {
      if (before._tag !== 'Reviewing') return wrongMove()
      if (before.review._tag !== 'By') return wrongMove()
      const reviewer = staffOf(project, task.reviewer)
      if (actor._tag !== 'Staff' || actor.id !== reviewer?.id || actor.id !== before.review.session.staff.id) return wrongActor()
      if (!liveSession(project, before.review.session.id)) return retired()
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
    default:
      return wrongMove()
  }
}

// A session retirement changes each affected task in the same journal event.
const applySessionMove = (project: Project, event: StoredEvent): Result.Result<Project, Refusal> => {
  const { line, input, number, read, actor } = event
  if (line._tag !== 'Session' || input._tag !== 'next') return wrongMove()
  if (actor._tag !== 'Human' || actor.id !== project.owner.id) return wrongActor()
  const previous = project.sessions.get(line.id)
  if (!previous) return retired()
  if (read < previous.startedAt) return stale()
  const { fact } = input
  const sessions = new Map(project.sessions)
  const tasks = new Map(project.tasks)
  const move = (session: StaffSession, continued: LiveSession | null) => {
    sessions.set(session.id, session)
    for (const [id, task] of tasks) {
      const phase = task.phase
      if (phase._tag === 'Working' && phase.attempt.session.id === previous.id) {
        if (continued) {
          tasks.set(id, { ...task, phase: { ...phase, attempt: { ...phase.attempt, session: continued } }, lastChange: number })
        } else if (session._tag === 'Ended' && edge(taskLine, phase._tag, 'restart', 'Sent') === 'Allowed') {
          tasks.set(id, { ...task, phase: { _tag: 'Sent', retryCount: phase.attempt.retryCount }, lastChange: number })
        }
      }
      if (phase._tag === 'Reviewing' && phase.review._tag === 'By' && phase.review.session.id === previous.id) {
        tasks.set(id, { ...task, phase: { ...phase, review: { _tag: 'Waiting' } }, lastChange: number })
      }
    }
    return { ...project, sessions, tasks }
  }
  if (fact._tag === 'Resumed') {
    if (edge(sessionLine, previous._tag, 'next', 'Live') !== 'Allowed' || sessions.has(fact.id)) return wrongMove()
    if (read < fact.staffing) return stale()
    return Result.flatMap(sessionMayStart(project, previous.staff.id, fact.staffing, previous), (staff) => {
      const continued: LiveSession = { _tag: 'Live', id: fact.id, staff, pane: fact.pane, startedAt: number }
      const resumedChildren = [...tasks.values()].filter(({ phase }) => phase._tag === 'Working' &&
        phase.attempt.place === 'Child' && phase.attempt.session.id === previous.id).length
      if (resumedChildren > subagentCapacity(project, staff).freeSubagents) return noChild()
      sessions.set(continued.id, continued)
      return Result.succeed(move(previous, continued))
    })
  }
  if (fact._tag !== 'Paused' && fact._tag !== 'Ended') return wrongMove()
  if (edge(sessionLine, previous._tag, 'next', fact._tag) !== 'Allowed') return wrongMove()
  const { id, staff, startedAt } = previous
  return Result.succeed(move({ _tag: fact._tag, id, staff, startedAt }, null))
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
    if (event.line._tag === 'Session') return applySessionMove(state.value, event)
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
