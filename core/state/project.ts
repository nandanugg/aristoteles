import { acceptedDirection, childDraft, directionSlice, validatePartition } from './task-tree.ts'
import { applyTaskMove } from './task.ts'
import { applyProjectPhase } from './project-activation.ts'
import { applyProposalMove } from './proposal.ts'
import { Result, Schema } from 'effect'
import { hostRole,
  ReadPosition, Rationale, RetryCount, activeWork, actorFor, boundHostSession, liveSession, roleOf, taskLine, taskMembership, StoredEvent, answerFor, currentQuestion, edge, questionLine, refuse, sessionLine, sessionMayStart, sameActor, staffByKey, staffOf,
  type LiveSession, type Project, type ProjectEvent, type QuestionEvent, type SessionEvent, type Task, type TaskEvent, type TaskPhase, type Projection, type Question, type Refusal,
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
    const { owner, roles, staff, subscription } = input
    if (!staff.roles.some((key) => roles.get(key)?._tag === 'Host') ||
        new Set(staff.roles).size !== staff.roles.length ||
        staff.roles.some((role) => !roles.has(role))) {
      return Result.fail(refuse('InvalidInput', Rationale.make('The project needs distinct roles and an assigned host.')))
    }
    if (staff.subscription.key !== subscription.key)
      return Result.fail(refuse('InvalidInput', Rationale.make('Use the listed subscription for the initial staff.')))
    if (staff.subagents === 0) return Result.fail(refuse('StaffingMinimum', Rationale.make('The onboarding host needs a subagent.')))
    return Result.succeed({
      owner, roles,
      openedIn: number,
      staffing: { _tag: 'Staffing', staff: new Map([[staff.key, staff]]), subscriptions: new Map([[subscription.key, subscription]]) },
      proposals: new Map(), sessions: new Map(), tasks: new Map(), questions: new Map(),
      phase: { _tag: 'Onboarding' }, changedIn: number,
      read: ReadPosition.make(number),
    })
  }
  return project ? applyProjectPhase(project, event) : wrongMove()
}

const openTask = (project: Project, event: Extract<TaskEvent, { from: null }>): Result.Result<Project, Refusal> => {
  const { key, actor, number, read } = event
  const activation = activeWork(project)
  if (!activation) return wrongMove()
  if (activation.work.startedIn > read || project.tasks.has(key)) return stale()
  const save = (
    draft: Pick<Task, 'name' | 'goal' | 'role' | 'direction' | 'stages' | 'attachments' | 'facts' | 'reviewer'>,
    parent: Task['parent'], phase: TaskPhase,
  ): Result.Result<Project, Refusal> => {
    const role = roleOf(project, draft.role)
    const reviewer = roleOf(project, draft.reviewer)
    if (!role || !reviewer) return wrongActor()
    if (role.responsibility.acceptedIn > read || reviewer.responsibility.acceptedIn > read) return stale()
    if (edge(taskLine, 'null', event.move, phase._tag) !== 'Allowed') return wrongMove()
    const task: Task = {
      ...draft, key, parent, phase, responsibility: role.responsibility, reviewerResponsibility: reviewer.responsibility,
      omitted: [], questions: new Map(), retryCount: RetryCount.make(0), automaticRetry: 'Available',
      lastAttempt: { _tag: 'None' }, changedIn: number,
    }
    const checked = phase._tag === 'Split'
      ? validatePartition(project, task, phase.partition, read, 'split')
      : Result.succeed(undefined)
    return Result.map(checked, () => ({ ...project, tasks: new Map(project.tasks).set(key, task) }))
  }
  const sent = { _tag: 'Sent', feedback: { _tag: 'None' } } as const
  if (event.move === 'open' && event.input._tag === 'Child') {
    if (actor._tag !== 'Human') return wrongActor()
    const parent = project.tasks.get(event.input.parent)
    if (parent?.phase._tag !== 'Split' || parent.changedIn > read || taskMembership(project, parent) !== 'Current') return wrongMove()
    const part = parent.phase.partition.parts.find(({ task }) => task === key)
    const draft = part && childDraft(parent, part)
    return draft ? save(draft, event.input, sent) : wrongMove()
  }
  if (event.move === 'split') {
    if (actor._tag !== 'Human') return wrongActor()
    const { draft, partition } = event.input
    if (!acceptedDirection(project, draft.direction, read) ||
        draft.attachments.some(({ at, direction, stage }) =>
          at > draft.stages.length || stage > direction.value.stages.length || !acceptedDirection(project, direction, read))) return stale()
    const stages = directionSlice(draft.direction, draft.stages)
    if (!stages) return wrongMove()
    return save({ ...draft, stages }, { _tag: 'Root' }, { _tag: 'Split', partition })
  }
  if (event.input._tag !== 'Root' || actor._tag !== 'Session' || actor.key !== boundHostSession(project)?.key) return retired()
  const { _tag, ...draft } = event.input
  if (!acceptedDirection(project, draft.direction, read)) return stale()
  const stages = directionSlice(draft.direction, draft.stages)
  const role = stages?.[0].role
  if (!stages || !role || stages.some((stage) => stage.role !== role))
    return Result.fail(refuse('InvalidInput', Rationale.make('Use a contiguous stage slice assigned to the role.')))
  return save({ ...draft, stages, role, attachments: [] }, { _tag: 'Root' }, sent)
}

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
    const host = staffOf(project, hostRole(project).key)
    if (activation._tag === 'RollingBack' && host?.key === staff.key) return wrongMove()
    const live: LiveSession = { _tag: 'Live', key, staff, startedIn: number, changedIn: number, pane: event.input.pane }
    sessions.set(key, live)
    if (activation._tag === 'Active' && host?.key === staff.key && activation.work._tag !== 'NotStarted' &&
        startedIn < activation.work.startedIn) return wrongMove()
    return Result.succeed({ ...project, sessions })
  }
  const { observed } = event.input
  if (edge(sessionLine, previous._tag, event.move, observed) !== 'Allowed' ||
      (previous._tag !== 'Live' && previous._tag !== 'Paused')) return wrongMove()
  const { staff, startedIn } = previous
  sessions.set(key, observed === 'Ended' ? { _tag: 'Ended', key, staff, startedIn, changedIn: number }
    : { ...previous, _tag: observed, changedIn: number })
  return Result.succeed({ ...project, sessions })
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
      const { to: recipient, text, expects } = event.input
      if (recipient._tag === 'Staff' && !staffByKey(project, recipient.key)) return wrongActor()
      const question = { key, from: event.actor, to: recipient, text, state: { _tag: 'Open' }, changedIn: number } as const
      switch (expects._tag) {
        case 'ShortAnswer': return store({ ...question, expects })
        case 'Markdown': return store({ ...question, expects })
        case 'OneChoice': return store({ ...question, expects })
        case 'ManyChoices': return store({ ...question, expects })
        case 'Matrix': return store({ ...question, expects })
      }
    }
    if (!existing) return wrongMove()
    if (!sameActor(existing.to, actor)) return wrongActor()
    if (existing.changedIn > read) return stale()
    if (edge(questionLine, existing.state._tag, event.move, 'Answered') !== 'Allowed') return wrongMove()
    const { answer } = event.input
    const { expects } = existing
    if (!answerFor(expects, answer))
      return Result.fail(refuse('InvalidInput', Rationale.make('The answer does not match what the question expects.')))
    const question = { ...existing, changedIn: number }
    const state = { _tag: 'Answered', by: event.actor } as const
    switch (expects._tag) {
      case 'ShortAnswer':
        if (answer._tag === 'ShortAnswer') return store({ ...question, expects, state: { ...state, answer: { text: answer.text } } })
        break
      case 'Markdown':
        if (answer._tag === 'Markdown') return store({ ...question, expects, state: { ...state, answer: { text: answer.text } } })
        break
      case 'OneChoice':
        if (answer._tag === 'OneChoice') return store({ ...question, expects, state: { ...state, answer: { picked: answer.picked } } })
        break
      case 'ManyChoices':
        if (answer._tag === 'ManyChoices') return store({ ...question, expects, state: { ...state, answer: { picked: answer.picked } } })
        break
      case 'Matrix':
        if (answer._tag === 'Matrix') return store({ ...question, expects, state: { ...state, answer: { cells: answer.cells } } })
        break
    }
    return Result.fail(refuse('InvalidInput', Rationale.make('The answer kind does not match.')))
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
        if (actor._tag !== 'Staff' || actor.key !== staffOf(project, hostRole(project).key)?.key || event.input.to._tag !== 'Human')
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
