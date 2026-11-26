import { applyActivationMove } from './project-activation.ts'
import { applyProposalMove } from './proposal.ts'
import { Result, Schema } from 'effect'
import {
  AttemptNumber, ReadPosition, Rationale, RetryCount, ActivationEvent, ProjectEvent, ProposalEvent, QuestionEvent, SessionEvent, StoredEvent, TaskEvent, answerFor, currentQuestion, edge, liveSession, projectLine, questionLine, refuse, sessionLine, sessionMayStart, staffOf, subagentCapacity, taskLine,
  type LiveSession, type Project, type Projection, type Question, type StoredActor, type Refusal, type StaffSession, type Task, type TaskPhase,
} from '../schema/project.ts'

export const readPosition = (state: Projection): typeof ReadPosition.Type =>
  state?.read ?? ReadPosition.make(0)

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the current phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('The event has the wrong actor for the addressed work.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current live staff session.')))
const noChild = () => Result.fail(refuse('NoCapacity', Rationale.make('The staff has no free subagent slot.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The addressed record changed after it was read.')))

const applyProjectMove = (project: Projection, event: ProjectEvent): Result.Result<Project, Refusal> => {
  const { line, actor, number, read } = event
  if (actor._tag !== 'Human') return wrongActor()
  if (event.from === null) {
    if (project) return wrongMove()
    if (read !== 0) return stale()
    const { input } = event
    const { owner, host, pipeline, staff } = input
    const roles = new Map([host, pipeline, ...input.roles].map((role) => [role.id, role]))
    if (actor.id !== owner.id) return wrongActor()
    if (roles.size !== input.roles.length + 2 || !staff.roles.some((role) => role.id === host.id) ||
        new Set(staff.roles.map((role) => role.id)).size !== staff.roles.length ||
        staff.roles.some((role) => !roles.has(role.id))) {
      return Result.fail(refuse('InvalidInput', Rationale.make('The project needs distinct roles and an assigned host.')))
    }
    if (staff.subagents === 0) return Result.fail(refuse('StaffingMinimum', Rationale.make('The onboarding host needs a subagent.')))
    const canonicalStaff = { ...staff, roles: [roles.get(staff.roles[0].id)!, ...staff.roles.slice(1).map((role) => roles.get(role.id)!)] as const }
    return Result.succeed({
      id: line.id, owner, host, pipeline, roles, staff: new Map([[staff.id, canonicalStaff]]),
      subscriptions: new Map([[staff.subscription.id, staff.subscription]]), staffingAt: number,
      staffing: null, proposals: new Map(), sessions: new Map(), tasks: new Map(), questions: new Map(),
      status: { _tag: 'Open' }, activation: { _tag: 'Onboarding' }, lastChange: number,
      read: ReadPosition.make(number),
    })
  }
  if (project?.status._tag !== event.from || project.id !== line.id) return wrongMove()
  if (actor.id !== project.owner.id) return wrongActor()
  if (event.move === 'end') {
    if (project.lastChange > read) return stale()
    if (edge(projectLine, event.from, event.move, 'Ended') !== 'Allowed' ||
        [...project.sessions.values()].some((session) => session._tag === 'Live')) return wrongMove()
    return Result.succeed({ ...project, status: { _tag: 'Ended', at: number }, lastChange: number })
  }
  if (edge(projectLine, event.from, event.move, 'Open') !== 'Allowed') return wrongMove()
  if (project.lastChange > read) return stale()
  if (event.input._tag === 'StartWork') {
    if (project.activation._tag !== 'Active' || project.activation.work !== null) return wrongMove()
    return Result.succeed({ ...project, activation: { ...project.activation, work: number }, lastChange: number })
  }
  const { draft } = event.input
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

const moveTask = (project: Project, task: Task, event: TaskEvent): Result.Result<Task, Refusal> => {
  const { actor, move, number, read } = event
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
      if (!staff || actor._tag !== 'Staff' || actor.id !== session.staff.id || actor.id !== staff.id) return wrongActor()
      if (place === 'Child' && subagentCapacity(project, staff).freeSubagents === 0) return noChild()
      const next = task.attempts._tag === 'First' ? 1 : task.attempts.last + 1
      if (!Schema.is(AttemptNumber)(next)) return wrongMove()
      return entered({
        _tag: 'Working', attempt: { number: next, session, place, retryCount: before.retryCount },
      }, { _tag: 'PreviouslyWorked', last: next })
    }
    case 'Working': {
      if (before._tag !== event.from) return wrongMove()
      const { attempt } = before
      if (actor._tag !== 'Staff' || actor.id !== attempt.session.staff.id) return wrongActor()
      if (!liveSession(project, attempt.session.id)) return retired()
      if (event.input.attempt !== attempt.number) return stale()
      return entered({
        _tag: 'ReadyToReview', result: { summary: event.input.summary, files: event.input.files, attempt },
      })
    }
    case 'ReadyToReview':
      if (before._tag !== event.from) return wrongMove()
      if (actor._tag !== 'Staff' || actor.id !== before.result.attempt.session.staff.id) return wrongActor()
      return entered({ _tag: 'Reviewing', result: before.result, by: null, review: null })
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

// A session retirement changes each affected task in the same journal event.
const applySessionMove = (project: Project, event: SessionEvent): Result.Result<Project, Refusal> => {
  const { line, number, read, actor } = event
  if (actor._tag !== 'Human' || actor.id !== project.owner.id) return wrongActor()
  const sessions = new Map(project.sessions)
  if (event.from === null) {
    const { staff, staffing, pane } = event.input
    if (read < staffing || sessions.has(line.id)) return stale()
    return Result.map(sessionMayStart(project, staff, staffing, null), (assigned) => {
      sessions.set(line.id, { _tag: 'Live', id: line.id, staff: assigned, pane, startedAt: number })
      return { ...project, sessions }
    })
  }
  const previous = sessions.get(line.id)
  if (!previous) return retired()
  if (read < previous.startedAt) return stale()
  if (previous._tag !== event.from) return wrongMove()
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
      if (phase._tag === 'Reviewing' && phase.by?.id === previous.staff.id) {
        tasks.set(id, { ...task, phase: { ...phase, by: null, review: null }, lastChange: number })
      }
    }
    const proposals = new Map(project.proposals)
    if (!continued) {
      for (const [id, proposal] of proposals) {
        const phase = proposal.phase
        if (phase._tag === 'Reviewing' && phase.by?.id === previous.staff.id)
          proposals.set(id, { ...proposal, phase: { _tag: 'Reviewing', by: null, review: null }, lastChange: number })
      }
    }
    return { ...project, sessions, tasks, proposals }
  }
  if (event.from === 'Paused') {
    const { id, staffing, pane } = event.input
    if (edge(sessionLine, previous._tag, 'next', 'Live') !== 'Allowed' || sessions.has(id)) return wrongMove()
    if (read < staffing) return stale()
    return Result.flatMap(sessionMayStart(project, previous.staff.id, staffing, previous), (staff) => {
      const continued: LiveSession = { _tag: 'Live', id, staff, pane, startedAt: number }
      const resumedChildren = [...tasks.values()].filter(({ phase }) => phase._tag === 'Working' &&
        phase.attempt.place === 'Child' && phase.attempt.session.id === previous.id).length
      if (resumedChildren > subagentCapacity(project, staff).freeSubagents) return noChild()
      sessions.set(continued.id, continued)
      return Result.succeed(move(previous, continued))
    })
  }
  const { observed } = event.input
  if (edge(sessionLine, previous._tag, 'next', observed) !== 'Allowed') return wrongMove()
  const { id, staff, startedAt } = previous
  return Result.succeed(move({ _tag: observed, id, staff, startedAt }, null))
}

const actorFor = (project: Project, actor: StoredActor): Question['from'] | undefined =>
  actor._tag === 'Human' ? (project.owner.id === actor.id ? project.owner : undefined) : project.staff.get(actor.id)

const applyQuestionMove = (project: Project, event: QuestionEvent): Result.Result<Project, Refusal> => {
  const { line, number, read } = event
  const actor = actorFor(project, event.actor)
  if (!actor) return wrongActor()
  if (actor._tag === 'Staff') {
    const live = [...project.sessions.values()].find((session) => session._tag === 'Live' && session.staff.id === actor.id)
    if (!live) return retired()
    if (read < live.startedAt) return stale()
  }
  const questions = new Map(project.questions)
  if (event.from === null) {
    if (questions.has(line.id)) return stale()
    const { to: recipient, text, form, about } = event.input
    const to = actorFor(project, recipient)
    if (!to) return wrongActor()
    let subject: Question['about']
    switch (about._tag) {
      case 'Project': subject = about; break
      case 'Task': {
        const task = project.tasks.get(about.task)
        if (!task) return wrongMove()
        if (task.lastChange > read) return stale()
        subject = { _tag: 'Task', task }
        break
      }
      case 'Staffing': {
        if (actor._tag !== 'Staff' || actor.id !== staffOf(project, project.host)?.id || to._tag !== 'Human')
          return wrongActor()
        const { proposal } = about
        if (proposal.basis > read || [...questions.values()].some((question) => question.about._tag === 'Staffing' &&
            question.about.proposal.id === proposal.id && question.about.proposal.basis >= proposal.basis)) return stale()
        subject = about
        break
      }
    }
    const question: Question = { id: line.id, from: actor, to, text, form, about: subject, state: { _tag: 'Open' }, lastChange: number }
    if (!currentQuestion(project, question)) return stale()
    questions.set(line.id, question)
    return Result.succeed({ ...project, questions })
  }
  const question = questions.get(line.id)
  if (!question) return wrongMove()
  if (question.to._tag !== actor._tag || question.to.id !== actor.id) return wrongActor()
  if (question.lastChange > read || !currentQuestion(project, question)) return stale()
  if (edge(questionLine, question.state._tag, event.move, 'Answered') !== 'Allowed') return wrongMove()
  const { answer } = event.input
  if (!answerFor(question.form, answer))
    return Result.fail(refuse('InvalidInput', Rationale.make('The answer does not match this question’s form.')))
  questions.set(line.id, { ...question, state: { _tag: 'Answered', by: actor, answer }, lastChange: number })
  return Result.succeed({ ...project, questions })
}

export const applyEvent = (state: Projection, event: StoredEvent): Result.Result<Project, Refusal> => {
  if (!Schema.is(StoredEvent)(event) || event.number !== readPosition(state) + 1) {
    return Result.fail(refuse('InvalidInput', Rationale.make('Apply stored events once and in journal order.')))
  }
  if (state?.status._tag === 'Ended') {
    return Result.fail(refuse('ProjectEnded', Rationale.make('This project has ended.')))
  }
  const updated = Schema.is(ProjectEvent)(event) ? applyProjectMove(state, event) : (() => {
    if (!state) return wrongMove()
    if (Schema.is(ActivationEvent)(event)) return applyActivationMove(state, event)
    if (Schema.is(SessionEvent)(event)) return applySessionMove(state, event)
    if (Schema.is(ProposalEvent)(event)) return applyProposalMove(state, event)
    if (Schema.is(QuestionEvent)(event)) return applyQuestionMove(state, event)
    if (!Schema.is(TaskEvent)(event)) return wrongMove()
    const task = state.tasks.get(event.line.id)
    if (!task) return wrongMove()
    return Result.map(moveTask(state, task, event), (changed) => {
      const tasks = new Map(state.tasks)
      tasks.set(changed.id, changed)
      return { ...state, tasks }
    })
  })()
  return Result.map(updated, (project) => ({ ...project, read: ReadPosition.make(event.number) }))
}

export const fold = (
  events: readonly StoredEvent[], before: Projection = null,
): Result.Result<Projection, Refusal> => {
  let state = before
  for (const event of events) {
    const moved = applyEvent(state, event)
    if (Result.isFailure(moved)) return moved
    state = moved.success
  }
  return Result.succeed(state)
}
