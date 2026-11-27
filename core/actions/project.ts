import { Context, DateTime, Effect, Result, Schema } from 'effect'
import {
  EventNumber, ReadPosition, Rationale, hostSession, RetryLimit as RetryLimitValue, staffedIn, submissionParty, proposalLine, taskLine, StoredEvent, Submission, liveSession, boundHostSession, pendingFix, refuse, reviewOutcome,
  type Project, type ProposalKey, type TaskKey, type LiveSession, type Of, type Projection, type Refusal, type StoredActor, type Party,
} from '../schema/project.ts'
import type { Committed, Journal, Write } from '../services/project.ts'
import { reviewTask } from '../state/task-review.ts'
import { applyEvent, fold, readPosition } from '../state/project.ts'

export type AuthenticatedActor =
  | { readonly _tag: 'Human'; readonly actor: Extract<StoredActor, { _tag: 'Human' }> }
  | { readonly _tag: 'Staff'; readonly session: LiveSession }
  | { readonly _tag: 'Host'; readonly session: LiveSession }
  | { readonly _tag: 'Review'; readonly session: LiveSession; readonly queuedIn: Of<typeof EventNumber> } & (
      | { readonly line: 'Task'; readonly key: Of<typeof TaskKey> }
      | { readonly line: 'Proposal'; readonly key: Of<typeof ProposalKey> }
    )
export class Authority extends Context.Service<Authority, {
  readonly actor: Effect.Effect<AuthenticatedActor, Refusal>
}>()('project/Authority') {}

export const CloseRaised = Context.Reference<(
  request: Extract<Submission, { line: 'Task'; move: 'takeAsIs' | 'drop' }>,
  actor: StoredActor, commit: Effect.Effect<Committed, Refusal>,
) => Effect.Effect<Committed, Refusal>>('project/CloseRaised', { defaultValue: () => (_request, _actor, commit) => commit })

type Moves = {
  [Event in StoredEvent as `${Event['line']}:${Event['from']}:${Event['move']}`]:
    Omit<Event, 'number' | 'read' | 'actor' | 'at'>
}
type MoveInput = Moves[keyof Moves]
type BuildMove = (state: Projection, events: readonly StoredEvent[]) => Result.Result<MoveInput, Refusal>

// These moves share an append transaction. Each one is folded on its own line.
const followingMoves = (event: StoredEvent, project: Project, before: Projection): readonly MoveInput[] => {
  if (event.line === 'Session') {
    const input = { session: event.key }
    if (event.from === 'Starting' && event.move === 'next' && project.phase._tag === 'Activating' &&
        hostSession(project)?.key === event.key)
      return [{ line: 'Project', from: 'Activating', move: 'next', input }]
    if ((event.from !== 'Live' && event.from !== 'Paused') || event.input.observed !== 'Ended') return []
    const moves: MoveInput[] = []
    for (const { key, phase } of project.tasks.values()) {
      if (phase._tag === 'Working' && phase.attempt.actor.key === event.key)
        moves.push({ line: 'Task', key, from: 'Working', move: 'restart', input })
      if (phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.actor.key === event.key)
        moves.push({ line: 'Task', key, from: 'Reviewing', move: 'release', input })
    }
    for (const { key, phase } of project.proposals.values()) {
      if (phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.actor.key === event.key)
        moves.push({ line: 'Proposal', key, from: 'Reviewing', move: 'release', input: { _tag: 'SessionEnded', ...input } })
    }
    return moves
  }
  if (event.line === 'Task' && (event.move === 'split' || event.move === 'joinParts' ||
      event.move === 'redistribute' || (event.from === 'Split' && event.move === 'dropStage'))) {
    const phase = project.tasks.get(event.key)?.phase
    if (phase?._tag !== 'Split') return []
    return phase.partition.parts.filter(({ task }) => !project.tasks.has(task)).map(({ task }) => ({
      line: 'Task', key: task, from: null, move: 'open', input: { _tag: 'Child', parent: event.key },
    }))
  }
  if (event.line === 'Task' && event.from === 'Raised') {
    const prior = before?.tasks.get(event.key)?.phase
    const current = project.tasks.get(event.key)?.phase
    if (prior?._tag !== 'Raised' || !before) return []
    const changedCause = event.move === 'assess' && prior.fix._tag === 'Assessed' && current?._tag === 'Raised' &&
      prior.fix.assessment.missed !== event.input.missed
    if (event.move !== 'drop' && event.move !== 'takeAsIs' && !changedCause) return []
    const proposal = pendingFix(before, event.key)
    const from = proposal?.phase._tag
    if (!proposal || (from !== 'Drafting' && from !== 'Reviewing' && from !== 'WaitingForOwner')) return []
    return [{ line: 'Proposal', key: proposal.key, move: 'remove', from, input: { _tag: 'Fix', task: event.key } }]
  }
  if (event.line !== 'Proposal') return []
  if (event.move !== 'accept') return []
  const proposal = project.proposals.get(event.key)
  if (proposal?.phase._tag !== 'Accepted') return []
  const moves: MoveInput[] = []
  const from = project.phase._tag
  if (from !== 'Ended' && proposal.phase.version.value._tag !== 'Direction')
    moves.push({ line: 'Project', move: 'apply', input: { proposal: event.key }, from })
  if (proposal.subject._tag === 'Fix')
    moves.push({ line: 'Task', key: proposal.subject.task, from: 'Raised', move: 'applyFix', input: { proposal: event.key } })
  return moves
}

export const commitProjectMove = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, build: BuildMove,
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const at = yield* DateTime.now
  const edit: Write = (events, number) => Result.flatMap(fold(events), (state) => {
    if (read > readPosition(state)) return Result.fail(refuse('Stale', Rationale.make('That read is ahead of the journal.')))
    return Result.flatMap(build(state, events), (move) => {
      const entry: StoredEvent = { ...move, number, actor, read, at }
      if (!Schema.is(StoredEvent)(entry)) {
        return Result.fail(refuse('WrongMove', Rationale.make('The stored input must match the move on its line.')))
      }
      return Result.flatMap(applyEvent(state, entry), (primary) => {
        let current = primary
        const following: StoredEvent[] = []
        for (const move of followingMoves(entry, primary, state)) {
          const next = current.read + 1
          if (!Schema.is(EventNumber)(next))
            return Result.fail(refuse('Unavailable', Rationale.make('The project journal has no event numbers left.')))
          const event: StoredEvent = { ...move, number: next, actor: { _tag: 'Human' }, read: current.read, at }
          const updated = applyEvent(current, event)
          if (Result.isFailure(updated)) return Result.fail(updated.failure)
          following.push(event)
          current = updated.success
        }
        return Result.succeed({ event: entry, following, state: current })
      })
    })
  })
  return yield* journal.transact(edit)
})

const wrongActor = () => refuse('WrongActor', Rationale.make('Use the input for your authenticated actor.'))
export const RetryLimit = Context.Reference<Of<typeof RetryLimitValue>>('project/RetryLimit', {
  defaultValue: () => RetryLimitValue.make(1),
})
const retired = () => refuse('RetiredSession', Rationale.make('Use the current live session. Run work wait to see what is due.'))
const readSubmission = Schema.decodeUnknownEffect(Submission, { onExcessProperty: 'error' })

const maySubmit = (actor: AuthenticatedActor, party: Party | undefined) => {
  switch (party) {
    case 'Sender': return actor._tag === 'Human' || actor._tag === 'Staff'
    case 'Owner': return actor._tag === 'Human'
    case 'Host': return actor._tag === 'Host'
    case 'Reviewer': return actor._tag === 'Review'
    case 'Pipeline':
    case 'Assignee': return actor._tag === 'Staff'
    case 'Anyone':
    case 'Recipient':
    case 'Proposer': return actor._tag === 'Human' || actor._tag === 'Staff'
    default: return false
  }
}

const moveFor = (
  project: Projection, request: Submission, authenticated: AuthenticatedActor, limit: Of<typeof RetryLimitValue>,
): Result.Result<MoveInput, Refusal> => {
  const moved = (input: MoveInput) => Result.succeed(input)
  if (request.line === 'Project') {
    if (request.move === 'open') return moved({ ...request, from: null })
    if (request.move === 'next') return moved({ ...request, from: 'Onboarding' })
    return moved({ ...request, from: 'Active' })
  }
  if (!project) return Result.fail(refuse('WrongMove', Rationale.make('Open the project first.')))
  const current = authenticated._tag === 'Staff' || authenticated._tag === 'Review'
    ? liveSession(project, authenticated.session.key) : null
  if ((authenticated._tag === 'Staff' || authenticated._tag === 'Review') &&
      current?.staff.key !== authenticated.session.staff.key) return Result.fail(retired())
  if (request.line === 'Task') {
    if (request.move === 'open') {
      const activation = project.phase
      if (authenticated._tag !== 'Host' || activation._tag !== 'Active' ||
          authenticated.session.key !== boundHostSession(project)?.key)
        return Result.fail(retired())
      return moved({ ...request, from: null, input: { ...request.input, _tag: 'Root' } })
    }
    if (request.move === 'split') {
      const input = request.input
      if (input._tag === 'New') return moved({ ...request, from: null, input })
      const from = project.tasks.get(request.key)?.phase._tag
      if (from === 'Sent' || from === 'Raised' || from === 'Split')
        return moved({ ...request, from, input })
      return Result.fail(refuse('WrongMove', Rationale.make('Split a new, sent, raised, or already split task.')))
    }
    if (request.move === 'joinParts' || request.move === 'redistribute') return moved({ ...request, from: 'Split' })
    if (request.move === 'dropStage') {
      const input = request.input
      return input._tag === 'Split' ? moved({ ...request, input, from: 'Split' }) : moved({ ...request, input, from: 'Working' })
    }
    if (request.move === 'tooBig') return moved({ ...request, from: 'Sent', move: 'raise' })
    if (request.move === 'back') return moved({ ...request, from: 'Raised' })
    if (request.move === 'assess' || request.move === 'tryAgain' || request.move === 'takeAsIs' || request.move === 'drop')
      return moved({ ...request, from: 'Raised' })
    if (!current) return Result.fail(retired())
    const { line, key } = request
    const task = project.tasks.get(key)
    if (request.move === 'review') {
      if (!task || task.phase._tag !== 'Reviewing' || authenticated._tag !== 'Review' ||
          authenticated.line !== line || authenticated.key !== key ||
          task.phase.assignment._tag !== 'Assigned' || task.phase.assignment.actor.key !== current.key ||
          task.phase.assignment.queuedIn !== authenticated.queuedIn) return Result.fail(retired())
      const { facts } = request.input
      const report = { queuedIn: authenticated.queuedIn, facts, limit }
      const from = 'Reviewing' as const
      return Result.flatMap(reviewTask(task, task.phase, facts, limit), (phase) => {
        switch (phase._tag) {
          case 'Raised': return moved({ line, key, from, move: 'raise', input: { ...report, reason: phase.reason } })
          case 'Working': return moved({ line, key, from, move: 'back', input: report })
          case 'Done': return moved({ line, key, from, move: 'next', input: report })
        }
      })
    }
    if (task?.phase._tag === 'Working' && task.phase.attempt.actor.key !== current.key) return Result.fail(retired())
    if (request.move === 'raise')
      return moved({ line, key, from: 'Working', move: 'raise', input: request.input })
    const { input } = request
    if (Schema.is(taskLine.Working.moves.next.submission.input)(input))
      return moved({ line, key, from: 'Working', move: 'next', input })
    return moved({ line, key, from: 'Sent', move: 'next', input: { staffedIn: staffedIn(project), where: 'Session' } })
  }
  if (request.line === 'Question') {
    if (request.move === 'open') return moved({ ...request, from: null })
    return moved({ ...request, from: 'Open' })
  }
  switch (request.move) {
    case 'open': return moved({ ...request, from: null })
    case 'submit': return Schema.is(proposalLine.null.moves.submit.input)(request.input)
      ? moved({ ...request, input: request.input, from: null })
      : moved({ ...request, input: request.input, from: 'Drafting' })
    case 'remove': return moved({ ...request, from: 'WaitingForOwner', input: { _tag: 'Onboarding' } })
    case 'accept':
    case 'sendBack': return moved({ ...request, from: 'WaitingForOwner' })
    case 'review': {
      const { line, key, input: { facts } } = request
      const phase = project.proposals.get(key)?.phase
      if (!current || authenticated._tag !== 'Review' || phase?._tag !== 'Reviewing' ||
          authenticated.line !== line || authenticated.key !== key ||
          phase.assignment._tag !== 'Assigned' || phase.assignment.actor.key !== current.key ||
          phase.assignment.queuedIn !== authenticated.queuedIn) return Result.fail(retired())
      const input = { queuedIn: authenticated.queuedIn, facts }
      return reviewOutcome(facts) === 'Holds'
        ? moved({ line, key, from: 'Reviewing', move: 'next', input })
        : moved({ line, key, from: 'Reviewing', move: 'sendBack', input })
    }
  }
}
export const submit = (journal: Journal, input: unknown): Effect.Effect<Committed, Refusal, Authority> =>
  Effect.flatMap(
    Effect.mapError(readSubmission(input), () =>
      refuse('InvalidInput', Rationale.make('The submission does not match the checked input.'))),
    (request) => submitChecked(journal, request),
  )

export const submitChecked = (journal: Journal, request: Submission): Effect.Effect<Committed, Refusal, Authority> =>
  Effect.gen(function* () {
    const authority = yield* (yield* Authority).actor
    const party = request.line === 'Task' && request.move === 'dropStage' && request.input._tag === 'Split'
      ? taskLine.Split.owes : submissionParty(request)
    // The bound host's pane also serves the work roles assigned to its staff.
    const authenticated: AuthenticatedActor = authority._tag === 'Host' && party !== 'Host'
      ? { _tag: 'Staff', session: authority.session } : authority
    if (!maySubmit(authenticated, party)) return yield* Effect.fail(wrongActor())
    const limit = yield* RetryLimit
    const actor: StoredActor = authenticated._tag === 'Human' ? authenticated.actor
      : { _tag: 'Session', key: authenticated.session.key }
    const commit = commitProjectMove(journal, actor, request.read, (project) => moveFor(project, request, authenticated, limit))
    if (request.line === 'Task' && (request.move === 'takeAsIs' || request.move === 'drop'))
      return yield* (yield* CloseRaised)(request, actor, commit)
    return yield* commit
  })

// The provider and other engine ports record the input of a specific line move.
export const recordObserved = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, move: MoveInput,
): Effect.Effect<Committed, Refusal> => commitProjectMove(journal, actor, read, () => Result.succeed(move))
