import { applyTaskMove, restartTask } from './task.ts'
import { applyActivationMove } from './project-activation.ts'
import { applyProposalMove } from './proposal.ts'
import { Result, Schema } from 'effect'
import {
  DirectionVersion, Role, Stage, ReadPosition, Rationale, RetryCount, activeWork, ActivationEvent, approvedProposals, roleOf, ProjectEvent, ProposalEvent, QuestionEvent, SessionEvent, StoredEvent, TaskEvent, answerFor, currentQuestion, edge, projectLine, questionLine, refuse, sessionLine, sessionMayStart, sameActor, staffOf, subagentCapacity,
  type LiveSession, type Project, type Projection, type Proposal, type Question, type StoredActor, type Refusal, type StaffSession,
} from '../schema/project.ts'

export const readPosition = (state: Projection): typeof ReadPosition.Type =>
  state?.read ?? ReadPosition.make(0)

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the current phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('The event has the wrong actor for the addressed work.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current live staff session.')))
const noChild = () => Result.fail(refuse('NoCapacity', Rationale.make('The staff has no free subagent slot.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The addressed record changed after it was read.')))

const applyProjectMove = (project: Projection, event: ProjectEvent): Result.Result<Project, Refusal> => {
  const { actor, number, read } = event
  if (event.from === null) {
    if (actor._tag !== 'Human') return wrongActor()
    if (project) return wrongMove()
    if (read !== 0) return stale()
    const { input } = event
    const { owner, host, pipeline, staff } = input
    const roles = new Map([host, pipeline, ...input.roles].map((role) => [role.key, role]))
    if (roles.size !== input.roles.length + 2 || !staff.roles.some((role) => role.key === host.key) ||
        new Set(staff.roles.map((role) => role.key)).size !== staff.roles.length ||
        staff.roles.some((role) => !roles.has(role.key))) {
      return Result.fail(refuse('InvalidInput', Rationale.make('The project needs distinct roles and an assigned host.')))
    }
    if (staff.subagents === 0) return Result.fail(refuse('StaffingMinimum', Rationale.make('The onboarding host needs a subagent.')))
    const canonicalStaff = { ...staff, roles: [roles.get(staff.roles[0].key)!, ...staff.roles.slice(1).map((role) => roles.get(role.key)!)] as const }
    return Result.succeed({
      owner, roles: { host, pipeline, work: new Map(input.roles.map((role) => [role.key, role])) }, staff: new Map([[staff.key, canonicalStaff]]),
      subscriptions: new Map([[staff.subscription.key, staff.subscription]]), openedAt: number,
      staffing: null, proposals: new Map(), sessions: new Map(), tasks: new Map(), questions: new Map(),
      status: { _tag: 'Open' }, activation: { _tag: 'Onboarding' }, lastChange: number,
      read: ReadPosition.make(number),
    })
  }
  if (project?.status._tag !== event.from) return wrongMove()
  if (actor._tag !== 'Human') return wrongActor()
  if (project.lastChange > read) return stale()
  if (edge(projectLine, event.from, event.move, 'Ended') !== 'Allowed' ||
      [...project.sessions.values()].some((session) => session._tag === 'Live' || session._tag === 'Starting')) return wrongMove()
  return Result.succeed({ ...project, status: { _tag: 'Ended', at: number }, lastChange: number })
}

const sameDirection = Schema.toEquivalence(DirectionVersion)
const sameRole = Schema.toEquivalence(Role)
const equalStage = Schema.toEquivalence(Stage)

const openTask = (project: Project, event: Extract<TaskEvent, { from: null }>): Result.Result<Project, Refusal> => {
  const { line, actor, number, read, input: draft } = event
  const activation = activeWork(project)
  if (!activation) return wrongMove()
  if (activation.work.at > read) return stale()
  if (actor._tag !== 'Staff' || actor.key !== activation.staff.key) return retired()
  if (project.tasks.has(line.key)) return stale()
  const role = roleOf(project, draft.stages[0].role.key)
  const reviewer = roleOf(project, draft.reviewer.key)
  if (!role || !reviewer) return wrongActor()
  if (role.responsibility.acceptedAt > read || reviewer.responsibility.acceptedAt > read ||
      !sameRole(reviewer, draft.reviewer)) return stale()
  const direction = draft.direction
  const proposals = [...project.proposals.values()]
  if (direction.acceptedAt > read || !proposals.some(({ phase }) =>
    phase._tag === 'Accepted' && phase.version.value._tag === 'Direction' &&
    sameDirection({ ...phase.version, value: phase.version.value }, direction)) ||
    proposals.some(({ phase, basis }) => phase._tag === 'Accepted' && phase.version.value._tag === 'Direction' &&
      basis._tag === 'Version' && basis.version.acceptedAt === direction.acceptedAt)) return stale()
  const source = direction.value.stages
  const offset = source.findIndex((_, index) => draft.stages.every((stage, delta) =>
    source[index + delta] !== undefined && equalStage(source[index + delta]!, stage)))
  const [first, ...rest] = offset < 0 ? [] : source.slice(offset, offset + draft.stages.length)
  if (!first || [first, ...rest].some((stage) => stage.role.key !== role.key))
    return Result.fail(refuse('InvalidInput', Rationale.make('Use a contiguous stage slice assigned to the role.')))
  const tasks = new Map(project.tasks)
  tasks.set(line.key, {
    key: line.key, name: draft.name, goal: draft.goal, reviewer, direction,
    stages: [{ ...first, role }, ...rest.map((stage) => ({ ...stage, role }))], facts: draft.facts,
    phase: { _tag: 'Sent', retryCount: RetryCount.make(0), feedback: { _tag: 'None' } }, lastAttempt: { _tag: 'None' }, lastChange: number,
  })
  return Result.succeed({ ...project, tasks })
}

// A session retirement changes each affected task in the same journal event.
const applySessionMove = (project: Project, event: SessionEvent): Result.Result<Project, Refusal> => {
  const { line, number, read, actor } = event
  if (actor._tag !== 'Human') return wrongActor()
  const sessions = new Map(project.sessions)
  if (event.from === null) {
    const { staff, staffing, previous } = event.input
    if (read < staffing || sessions.has(line.key)) return stale()
    const paused = previous._tag === 'Session' ? sessions.get(previous.key) : null
    if (previous._tag === 'Session' && paused?._tag !== 'Paused') return retired()
    return Result.map(sessionMayStart(project, staff.key, staffing, paused ?? null), (assigned) => {
      sessions.set(line.key, { _tag: 'Starting', key: line.key, staff: assigned, startedAt: number, previous: paused?._tag === 'Paused' ? paused : { _tag: 'None' } })
      return { ...project, sessions }
    })
  }
  const previous = sessions.get(line.key)
  if (!previous) return retired()
  if (read < previous.startedAt) return stale()
  if (previous._tag !== event.from) return wrongMove()
  if (event.from === 'Starting') {
    if (previous._tag !== 'Starting') return wrongMove()
    const { key, staff, startedAt } = previous
    if (event.move === 'cancel') {
      sessions.set(key, { _tag: 'Ended', key, staff, startedAt })
      return Result.succeed({ ...project, sessions })
    }
    const activation = project.activation
    if (activation._tag === 'RollingBack' && activation.staff.key === staff.key) return wrongMove()
    const live: LiveSession = { _tag: 'Live', key, staff, startedAt: number, pane: event.input.pane }
    sessions.set(key, live)
    let next = activation
    if (activation._tag === 'Activating' && activation.staff.key === staff.key) {
      const proposals = approvedProposals(project)
      if (!proposals || JSON.stringify(proposals) !== JSON.stringify(activation.proposals)) return stale()
      next = { ...activation, _tag: 'Active', work: { _tag: 'NotStarted' } }
    }
    if (activation._tag === 'Active' && activation.staff.key === staff.key && activation.work._tag !== 'NotStarted' &&
        startedAt < activation.work.at) return wrongMove()
    const tasks = new Map(project.tasks)
    const paused = previous.previous
    if (paused._tag === 'Paused') {
      const continuing = [...tasks.values()].filter(({ phase }) => phase._tag === 'Working' &&
        phase.attempt.session.key === paused.key)
      const children = continuing.filter(({ phase }) => phase._tag === 'Working' && phase.attempt.where === 'Subagent')
      if (children.length > subagentCapacity(project, staff).freeSubagents) return noChild()
      for (const task of continuing) {
        const phase = task.phase
        if (phase._tag === 'Working')
          tasks.set(task.key, { ...task, phase: { ...phase, attempt: { ...phase.attempt, session: live } }, lastChange: number })
      }
    }
    return Result.succeed({ ...project, sessions, tasks, activation: next,
      lastChange: next !== activation ? number : project.lastChange })
  }
  const tasks = new Map(project.tasks)
  const move = (session: StaffSession) => {
    sessions.set(session.key, session)
    for (const [key, task] of tasks) {
      const phase = task.phase
      if (session._tag === 'Ended' && phase._tag === 'Working' && phase.attempt.session.key === previous.key) {
        const restarted = restartTask(task, phase, number)
        if (Result.isSuccess(restarted)) tasks.set(key, restarted.success)
      }
      if (phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.by.key === previous.staff.key) {
        tasks.set(key, { ...task, phase: { ...phase, assignment: { _tag: 'Waiting' } }, lastChange: number })
      }
    }
    const proposals = new Map(project.proposals)
    for (const [key, proposal] of proposals) {
      const phase = proposal.phase
      if (phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.by.key === previous.staff.key)
        proposals.set(key, { ...proposal, phase: { _tag: 'Reviewing', assignment: { _tag: 'Waiting' } }, lastChange: number })
    }
    return { ...project, sessions, tasks, proposals }
  }
  const observed = event.from === 'Paused' ? 'Ended' : event.input.observed
  if (edge(sessionLine, previous._tag, 'next', observed) !== 'Allowed') return wrongMove()
  const { key, staff, startedAt } = previous
  return Result.succeed(move({ _tag: observed, key, staff, startedAt }))
}

const actorFor = (project: Project, actor: StoredActor): Question['from'] | undefined =>
  actor._tag === 'Human' ? project.owner : project.staff.get(actor.key)

const applyQuestionMove = (project: Project, event: QuestionEvent): Result.Result<Project, Refusal> => {
  const { line, number, read } = event
  const actor = actorFor(project, event.actor)
  if (!actor) return wrongActor()
  if (actor._tag === 'Staff') {
    const live = [...project.sessions.values()].find((session) => session._tag === 'Live' && session.staff.key === actor.key)
    if (!live) return retired()
    if (read < live.startedAt) return stale()
  }
  const owned = [...project.proposals.values()].find((proposal) => proposal.questions.some(({ key }) => key === line.key))
  const existing = owned?.questions.find(({ key }) => key === line.key) ?? project.questions.get(line.key)
  const store = (question: Question, proposal?: Proposal) => proposal
    ? Result.succeed({ ...project, proposals: new Map(project.proposals).set(proposal.key, {
      ...proposal, questions: [...proposal.questions.filter(({ key }) => key !== question.key), question],
    }) })
    : Result.succeed({ ...project, questions: new Map(project.questions).set(question.key, question) })
  if (event.from === null) {
    if (existing) return stale()
    const { to: recipient, text, form, about } = event.input
    const to = actorFor(project, recipient)
    if (!to) return wrongActor()
    const ask = (subject: Question['about'], proposal?: Proposal) => store({
      key: line.key, from: actor, to, text, form, about: subject, state: { _tag: 'Open' }, lastChange: number,
    }, proposal)
    switch (about._tag) {
      case 'Project': return ask(about)
      case 'Task': {
        const task = project.tasks.get(about.task)
        if (!task) return wrongMove()
        if (task.lastChange > read) return stale()
        return ask({ _tag: 'Task', task })
      }
      case 'Staffing': {
        if (actor._tag !== 'Staff' || actor.key !== staffOf(project, project.roles.host)?.key || to._tag !== 'Human')
          return wrongActor()
        const proposal = project.proposals.get(about.proposal.key)
        if (!proposal || proposal.value._tag !== 'Staffing' || proposal.phase._tag !== 'Drafting' ||
            proposal.lastChange > read || proposal.questions.some((question) => currentQuestion(proposal, question))) return stale()
        return ask({ _tag: 'Staffing' }, proposal)
      }
    }
  }
  if (!existing) return wrongMove()
  if (!sameActor(existing.to, actor)) return wrongActor()
  if (existing.lastChange > read || (owned && !currentQuestion(owned, existing))) return stale()
  if (edge(questionLine, existing.state._tag, event.move, 'Answered') !== 'Allowed') return wrongMove()
  const { answer } = event.input
  if (!answerFor(existing.form, answer))
    return Result.fail(refuse('InvalidInput', Rationale.make('The answer does not match this question’s form.')))
  return store({ ...existing, state: { _tag: 'Answered', by: actor, answer }, lastChange: number }, owned)
}

export const applyEvent = (state: Projection, event: StoredEvent): Result.Result<Project, Refusal> => {
  if (!Schema.is(StoredEvent)(event) || event.number !== readPosition(state) + 1) {
    return Result.fail(refuse('InvalidInput', Rationale.make('Apply stored events once and in journal order.')))
  }
  if (state?.status._tag === 'Ended') {
    return Result.fail(refuse('ProjectEnded', Rationale.make('This project has ended.')))
  }
  const updated = Schema.is(ProjectEvent)(event) ? applyProjectMove(state, event) : ((): Result.Result<Project, Refusal> => {
    if (!state) return wrongMove()
    if (Schema.is(ActivationEvent)(event)) return applyActivationMove(state, event)
    if (Schema.is(SessionEvent)(event)) return applySessionMove(state, event)
    if (Schema.is(ProposalEvent)(event)) return applyProposalMove(state, event)
    if (Schema.is(QuestionEvent)(event)) return applyQuestionMove(state, event)
    if (!Schema.is(TaskEvent)(event)) return wrongMove()
    if (event.from === null) return openTask(state, event)
    const task = state.tasks.get(event.line.key)
    if (!task) return wrongMove()
    return Result.map(applyTaskMove(state, task, event), (changed) => {
      const tasks = new Map(state.tasks)
      tasks.set(changed.key, changed)
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
