import { applyTaskMove, restartTask } from './task.ts'
import { applyActivationMove } from './project-activation.ts'
import { applyProposalMove } from './proposal.ts'
import { Result, Schema } from 'effect'
import {
  DirectionVersion, Role, Stage, ReadPosition, Rationale, RetryCount, activeWork, actorFor, approvedProposals, boundHostSession, liveSession, ProposalValue, roleOf, StoredEvent, answerFor, currentQuestion, edge, projectLine, questionLine, refuse, sessionLine, sessionMayStart, sameActor, staffByKey, staffOf, versionOf,
  type LiveSession, type Project, type ProjectEvent, type QuestionEvent, type SessionEvent, type TaskEvent, type Projection, type Question, type Refusal,
} from '../schema/project.ts'

export const readPosition = (state: Projection): typeof ReadPosition.Type =>
  state?.read ?? ReadPosition.make(0)

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the current phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('The event has the wrong actor for the addressed work.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current live staff session. Run work wait to see what is due.')))
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
      owner, roles: { host, pipeline, work: new Map(input.roles.map((role) => [role.key, role])) },
      subscriptions: new Map([[staff.subscription.key, staff.subscription]]), openedAt: number,
      staffing: { _tag: 'Staffing', staff: new Map([[staff.key, canonicalStaff]]), subscriptions: [staff.subscription] },
      proposals: new Map(), sessions: new Map(), tasks: new Map(), questions: new Map(),
      status: { _tag: 'Open' }, activation: { _tag: 'Onboarding' }, lastChange: number,
      read: ReadPosition.make(number),
    })
  }
  if (project?.status._tag !== event.from) return wrongMove()
  if (actor._tag !== 'Human') return wrongActor()
  if (project.lastChange > read) return stale()
  if (edge(projectLine, event.from, event.move, 'Ended') !== 'Allowed' ||
      [...project.sessions.values()].some((session) => session._tag !== 'Ended')) return wrongMove()
  return Result.succeed({ ...project, status: { _tag: 'Ended', at: number }, lastChange: number })
}

const sameApprovedProposals = Schema.toEquivalence(Schema.NonEmptyArray(versionOf(ProposalValue)))
const sameDirection = Schema.toEquivalence(DirectionVersion)
const sameRole = Schema.toEquivalence(Role)
const equalStage = Schema.toEquivalence(Stage)

const openTask = (project: Project, event: Extract<TaskEvent, { from: null }>): Result.Result<Project, Refusal> => {
  const { key, actor, number, read, input: draft } = event
  const activation = activeWork(project)
  if (!activation) return wrongMove()
  if (activation.work.at > read) return stale()
  if (actor._tag !== 'Session' || actor.key !== boundHostSession(project)?.key) return retired()
  if (project.tasks.has(key)) return stale()
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
  tasks.set(key, {
    key, name: draft.name, goal: draft.goal, reviewer, direction,
    stages: [{ ...first, role }, ...rest.map((stage) => ({ ...stage, role }))], facts: draft.facts, questions: new Map(),
    phase: { _tag: 'Sent', retryCount: RetryCount.make(0), feedback: { _tag: 'None' } }, lastAttempt: { _tag: 'None' }, lastChange: number,
  })
  return Result.succeed({ ...project, tasks })
}

// A session retirement changes each affected task in the same journal event.
const applySessionMove = (project: Project, event: SessionEvent): Result.Result<Project, Refusal> => {
  const { key, number, read, actor } = event
  if (actor._tag !== 'Human') return wrongActor()
  const sessions = new Map(project.sessions)
  if (event.from === null) {
    const { staff, staffing } = event.input
    if (read < staffing || sessions.has(key)) return stale()
    return Result.map(sessionMayStart(project, staff.key, staffing), (assigned) => {
      sessions.set(key, { _tag: 'Starting', key, staff: assigned, startedAt: number, lastChange: number })
      return { ...project, sessions }
    })
  }
  const previous = sessions.get(key)
  if (!previous) return retired()
  if (read < previous.lastChange) return stale()
  if (previous._tag !== event.from) return wrongMove()
  if (event.from === 'Starting') {
    if (previous._tag !== 'Starting') return wrongMove()
    const { key, staff, startedAt } = previous
    if (event.move === 'cancel') {
      sessions.set(key, { _tag: 'Ended', key, staff, startedAt, lastChange: number })
      return Result.succeed({ ...project, sessions })
    }
    const activation = project.activation
    const host = staffOf(project, project.roles.host)
    if (activation._tag === 'RollingBack' && host?.key === staff.key) return wrongMove()
    const live: LiveSession = { _tag: 'Live', key, staff, startedAt: number, lastChange: number, pane: event.input.pane }
    sessions.set(key, live)
    let next = activation
    if (activation._tag === 'Activating' && host?.key === staff.key) {
      const proposals = approvedProposals(project)
      if (!proposals || !sameApprovedProposals(proposals, activation.proposals)) return stale()
      next = { ...activation, _tag: 'Active', work: { _tag: 'NotStarted' } }
    }
    if (activation._tag === 'Active' && host?.key === staff.key && activation.work._tag !== 'NotStarted' &&
        startedAt < activation.work.at) return wrongMove()
    return Result.succeed({ ...project, sessions, activation: next,
      lastChange: next !== activation ? number : project.lastChange })
  }
  const { observed } = event.input
  if (edge(sessionLine, previous._tag, event.move, observed) !== 'Allowed' ||
      (previous._tag !== 'Live' && previous._tag !== 'Paused')) return wrongMove()
  if (observed !== 'Ended') {
    sessions.set(key, { ...previous, _tag: observed, lastChange: number })
    return Result.succeed({ ...project, sessions })
  }
  const { staff, startedAt } = previous
  sessions.set(key, { _tag: 'Ended', key, staff, startedAt, lastChange: number })
  const tasks = new Map(project.tasks)
  const proposals = new Map(project.proposals)
  for (const [key, task] of tasks) {
    const phase = task.phase
    if (phase._tag === 'Working' && phase.attempt.actor.key === previous.key) {
      const restarted = restartTask(task, phase, number)
      if (Result.isSuccess(restarted)) tasks.set(key, restarted.success)
    }
    if (phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.actor.key === previous.key) {
      tasks.set(key, { ...task, phase: { ...phase, assignment: { _tag: 'Waiting' } }, lastChange: number })
    }
  }
  for (const [key, proposal] of proposals) {
    const phase = proposal.phase
    if (phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.actor.key === previous.key)
      proposals.set(key, { ...proposal, phase: { _tag: 'Reviewing', assignment: { _tag: 'Waiting' } }, lastChange: number })
  }
  return Result.succeed({ ...project, sessions, tasks, proposals })
}

const applyQuestionMove = (project: Project, event: QuestionEvent): Result.Result<Project, Refusal> => {
  const { owner, key, number, read } = event
  const actor = actorFor(project, event.actor)
  if (!actor) return retired()
  const move = (questions: Project['questions']) => {
    const existing = questions.get(key)
    const store = (question: Question) => Result.succeed(new Map(questions).set(key, question))
    if (event.from === null) {
      if (existing) return stale()
      const { to: recipient, text, form } = event.input
      if (recipient._tag === 'Staff' && !staffByKey(project, recipient.key)) return wrongActor()
      return store({ key, from: event.actor, to: recipient, text, form, state: { _tag: 'Open' }, lastChange: number })
    }
    if (!existing) return wrongMove()
    if (!sameActor(existing.to, actor)) return wrongActor()
    if (existing.lastChange > read) return stale()
    if (edge(questionLine, existing.state._tag, event.move, 'Answered') !== 'Allowed') return wrongMove()
    const { answer } = event.input
    if (!answerFor(existing.form, answer))
      return Result.fail(refuse('InvalidInput', Rationale.make('The answer does not match this question’s form.')))
    return store({ ...existing, state: { _tag: 'Answered', by: event.actor, answer }, lastChange: number })
  }
  switch (owner._tag) {
    case 'Project':
      return Result.map(move(project.questions), (questions) => ({ ...project, questions }))
    case 'Task': {
      const task = project.tasks.get(owner.key)
      if (!task) return wrongMove()
      if (event.from === null && task.lastChange > read) return stale()
      return Result.map(move(task.questions), (questions) => ({
        ...project, tasks: new Map(project.tasks).set(owner.key, { ...task, questions }),
      }))
    }
    case 'Proposal': {
      const proposal = project.proposals.get(owner.key)
      if (!proposal || proposal.value._tag !== 'Staffing') return wrongMove()
      if (event.from === null) {
        if (actor._tag !== 'Staff' || actor.key !== staffOf(project, project.roles.host)?.key || event.input.to._tag !== 'Human')
          return wrongActor()
        if (proposal.phase._tag !== 'Drafting' || proposal.lastChange > read ||
            [...proposal.questions.values()].some((question) => currentQuestion(proposal, question))) return stale()
      } else {
        const existing = proposal.questions.get(key)
        if (existing && !currentQuestion(proposal, existing)) return stale()
      }
      return Result.map(move(proposal.questions), (questions) => ({
        ...project, proposals: new Map(project.proposals).set(owner.key, { ...proposal, questions }),
      }))
    }
  }
}

export const applyEvent = (state: Projection, event: StoredEvent): Result.Result<Project, Refusal> => {
  if (!Schema.is(StoredEvent)(event) || event.number !== readPosition(state) + 1) {
    return Result.fail(refuse('InvalidInput', Rationale.make('Apply stored events once and in journal order.')))
  }
  if (state?.status._tag === 'Ended') {
    return Result.fail(refuse('ProjectEnded', Rationale.make('This project has ended.')))
  }
  if (event.actor._tag === 'Session') {
    const session = state && liveSession(state, event.actor.key)
    if (!session) return retired()
    if (session.lastChange > event.read)
      return Result.fail(refuse('Stale', Rationale.make('The session changed. Run work wait before trying again.')))
  }
  const updated = event.line === 'Project' ? applyProjectMove(state, event) : ((): Result.Result<Project, Refusal> => {
    if (!state) return wrongMove()
    if (event.line === 'Activation') return applyActivationMove(state, event)
    if (event.line === 'Session') return applySessionMove(state, event)
    if (event.line === 'Proposal') return applyProposalMove(state, event)
    if (event.line === 'Question') return applyQuestionMove(state, event)
    if (event.from === null) return openTask(state, event)
    const task = state.tasks.get(event.key)
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
