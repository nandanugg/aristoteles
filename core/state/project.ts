import { applyTaskMove, restartTask } from './task.ts'
import { applyProjectPhase } from './project-activation.ts'
import { applyProposalMove } from './proposal.ts'
import { Result, Schema } from 'effect'
import {
  DirectionVersion, Role, Stage, ReadPosition, Rationale, RetryCount, activeWork, actorFor, approvedProposals, boundHostSession, liveSession, ProposalValue, roleOf, StoredEvent, answerFor, currentQuestion, edge, questionLine, refuse, sessionLine, sessionMayStart, sameActor, staffByKey, staffOf, versionOf,
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
    const { owner, host, pipeline, staff, subscription } = input
    const roles = new Map([host, pipeline, ...input.roles].map((role) => [role.key, role]))
    if (roles.size !== input.roles.length + 2 || !staff.roles.some((role) => role.key === host.key) ||
        new Set(staff.roles.map((role) => role.key)).size !== staff.roles.length ||
        staff.roles.some((role) => !roles.has(role.key))) {
      return Result.fail(refuse('InvalidInput', Rationale.make('The project needs distinct roles and an assigned host.')))
    }
    if (staff.subscription.key !== subscription.key)
      return Result.fail(refuse('InvalidInput', Rationale.make('Use the listed subscription for the initial staff.')))
    if (staff.subagents === 0) return Result.fail(refuse('StaffingMinimum', Rationale.make('The onboarding host needs a subagent.')))
    return Result.succeed({
      owner, roles: { host, pipeline, work: new Map(input.roles.map((role) => [role.key, role])) },
      openedIn: number,
      staffing: { _tag: 'Staffing', staff: new Map([[staff.key, staff]]), subscriptions: new Map([[subscription.key, subscription]]) },
      proposals: new Map(), sessions: new Map(), tasks: new Map(), questions: new Map(),
      phase: { _tag: 'Onboarding' }, changedIn: number,
      read: ReadPosition.make(number),
    })
  }
  return project ? applyProjectPhase(project, event) : wrongMove()
}

const sameApprovedProposals = Schema.toEquivalence(Schema.NonEmptyArray(versionOf(ProposalValue)))
const sameDirection = Schema.toEquivalence(DirectionVersion)
const sameRole = Schema.toEquivalence(Role)
const equalStage = Schema.toEquivalence(Stage)

const openTask = (project: Project, event: Extract<TaskEvent, { from: null }>): Result.Result<Project, Refusal> => {
  const { key, actor, number, read, input: draft } = event
  const activation = activeWork(project)
  if (!activation) return wrongMove()
  if (activation.work.startedIn > read) return stale()
  if (actor._tag !== 'Session' || actor.key !== boundHostSession(project)?.key) return retired()
  if (project.tasks.has(key)) return stale()
  const role = roleOf(project, draft.stages[0].role.key)
  const reviewer = roleOf(project, draft.reviewer.key)
  if (!role || !reviewer) return wrongActor()
  if (role.responsibility.acceptedIn > read || reviewer.responsibility.acceptedIn > read ||
      !sameRole(reviewer, draft.reviewer)) return stale()
  const direction = draft.direction
  const proposals = [...project.proposals.values()]
  if (direction.acceptedIn > read || !proposals.some(({ phase }) =>
    phase._tag === 'Accepted' && phase.version.value._tag === 'Direction' &&
    sameDirection({ ...phase.version, value: phase.version.value }, direction)) ||
    proposals.some(({ phase, basis }) => phase._tag === 'Accepted' && phase.version.value._tag === 'Direction' &&
      basis._tag === 'Version' && basis.version.acceptedIn === direction.acceptedIn)) return stale()
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
    retryCount: RetryCount.make(0), phase: { _tag: 'Sent', feedback: { _tag: 'None' } }, lastAttempt: { _tag: 'None' }, changedIn: number,
  })
  return Result.succeed({ ...project, tasks })
}

// A session retirement changes each affected task in the same journal event.
const applySessionMove = (project: Project, event: SessionEvent): Result.Result<Project, Refusal> => {
  const { key, number, read, actor } = event
  if (actor._tag !== 'Human') return wrongActor()
  const sessions = new Map(project.sessions)
  if (event.from === null) {
    const { staff, staffedIn } = event.input
    if (read < staffedIn || sessions.has(key)) return stale()
    return Result.map(sessionMayStart(project, staff.key, staffedIn), (assigned) => {
      sessions.set(key, { _tag: 'Starting', key, staff: assigned, startedIn: number, changedIn: number })
      return { ...project, sessions }
    })
  }
  const previous = sessions.get(key)
  if (!previous) return retired()
  if (read < previous.changedIn) return stale()
  if (previous._tag !== event.from) return wrongMove()
  if (event.from === 'Starting') {
    if (previous._tag !== 'Starting') return wrongMove()
    const { key, staff, startedIn } = previous
    if (event.move === 'cancel') {
      sessions.set(key, { _tag: 'Ended', key, staff, startedIn, changedIn: number })
      return Result.succeed({ ...project, sessions })
    }
    const activation = project.phase
    const host = staffOf(project, project.roles.host)
    if (activation._tag === 'RollingBack' && host?.key === staff.key) return wrongMove()
    const live: LiveSession = { _tag: 'Live', key, staff, startedIn: number, changedIn: number, pane: event.input.pane }
    sessions.set(key, live)
    let next = activation
    if (activation._tag === 'Activating' && host?.key === staff.key) {
      const proposals = approvedProposals(project)
      if (!proposals || !sameApprovedProposals(proposals, activation.proposals)) return stale()
      next = { ...activation, _tag: 'Active', work: { _tag: 'NotStarted' } }
    }
    if (activation._tag === 'Active' && host?.key === staff.key && activation.work._tag !== 'NotStarted' &&
        startedIn < activation.work.startedIn) return wrongMove()
    return Result.succeed({ ...project, sessions, phase: next,
      changedIn: next !== activation ? number : project.changedIn })
  }
  const { observed } = event.input
  if (edge(sessionLine, previous._tag, event.move, observed) !== 'Allowed' ||
      (previous._tag !== 'Live' && previous._tag !== 'Paused')) return wrongMove()
  if (observed !== 'Ended') {
    sessions.set(key, { ...previous, _tag: observed, changedIn: number })
    return Result.succeed({ ...project, sessions })
  }
  const { staff, startedIn } = previous
  sessions.set(key, { _tag: 'Ended', key, staff, startedIn, changedIn: number })
  const tasks = new Map(project.tasks)
  const proposals = new Map(project.proposals)
  for (const [key, task] of tasks) {
    const phase = task.phase
    if (phase._tag === 'Working' && phase.attempt.actor.key === previous.key) {
      const restarted = restartTask(task, phase, number)
      if (Result.isSuccess(restarted)) tasks.set(key, restarted.success)
    }
    if (phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.actor.key === previous.key) {
      tasks.set(key, { ...task, phase: { ...phase, assignment: { _tag: 'Waiting' } }, changedIn: number })
    }
  }
  for (const [key, proposal] of proposals) {
    const phase = proposal.phase
    if (phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.actor.key === previous.key)
      proposals.set(key, { ...proposal, phase: { _tag: 'Reviewing', assignment: { _tag: 'Waiting' } }, changedIn: number })
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
      return store({ key, from: event.actor, to: recipient, text, form, state: { _tag: 'Open' }, changedIn: number })
    }
    if (!existing) return wrongMove()
    if (!sameActor(existing.to, actor)) return wrongActor()
    if (existing.changedIn > read) return stale()
    if (edge(questionLine, existing.state._tag, event.move, 'Answered') !== 'Allowed') return wrongMove()
    const { answer } = event.input
    if (!answerFor(existing.form, answer))
      return Result.fail(refuse('InvalidInput', Rationale.make('The answer does not match this question’s form.')))
    return store({ ...existing, state: { _tag: 'Answered', by: event.actor, answer }, changedIn: number })
  }
  switch (owner._tag) {
    case 'Project':
      return Result.map(move(project.questions), (questions) => ({ ...project, questions }))
    case 'Task': {
      const task = project.tasks.get(owner.key)
      if (!task) return wrongMove()
      if (event.from === null && task.changedIn > read) return stale()
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
        if (proposal.phase._tag !== 'Drafting' || proposal.changedIn > read ||
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
  if (state?.phase._tag === 'Ended') {
    return Result.fail(refuse('ProjectEnded', Rationale.make('This project has ended.')))
  }
  if (event.actor._tag === 'Session') {
    const session = state && liveSession(state, event.actor.key)
    if (!session) return retired()
    if (session.changedIn > event.read)
      return Result.fail(refuse('Stale', Rationale.make('The session changed. Run work wait before trying again.')))
  }
  const updated = event.line === 'Project' ? applyProjectMove(state, event) : ((): Result.Result<Project, Refusal> => {
    if (!state) return wrongMove()
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
