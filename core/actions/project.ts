import { Context, DateTime, Effect, Result, Schema } from 'effect'
import {
  ReadPosition, Rationale, RetryLimit, staffingAt, submissionParty, StoredEvent, Submission, liveSession, refuse, reviewOutcome,
  type EventNumber, type ProposalAddress, type TaskAddress, type LiveSession, type Of, type Projection, type Refusal, type SessionId, type Staff, type StoredActor, type Party,
} from '../schema/project.ts'
import type { Committed, Journal, Write } from '../services/project.ts'
import { reviewTask } from '../state/task-review.ts'
import { applyEvent, fold, readPosition } from '../state/project.ts'

export type AuthenticatedActor =
  | { readonly _tag: 'Human'; readonly actor: Extract<StoredActor, { _tag: 'Human' }> }
  | { readonly _tag: 'Staff'; readonly session: LiveSession }
  | { readonly _tag: 'Host'; readonly id: Of<typeof SessionId>; readonly staff: Staff }
  | { readonly _tag: 'Review'; readonly line: Of<typeof TaskAddress | typeof ProposalAddress>; readonly session: LiveSession; readonly review: Of<typeof EventNumber> }
export class Authority extends Context.Service<Authority, {
  readonly actor: Effect.Effect<AuthenticatedActor, Refusal>
}>()('project/Authority') {}

type Moves = {
  [Event in StoredEvent as `${Event['line']['_tag']}:${Event['from']}:${Event['move']}`]:
    Pick<Event, 'line' | 'from' | 'move' | 'input'>
}
type MoveInput = Moves[keyof Moves]
type BuildMove = (state: Projection, events: readonly StoredEvent[]) => Result.Result<MoveInput, Refusal>

export const commitProjectMove = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, build: BuildMove,
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const at = yield* DateTime.now
  const edit: Write = (events, number) => Result.flatMap(fold(events), (state) => {
    if (read > readPosition(state)) return Result.fail(refuse('Stale', Rationale.make('That read is ahead of the journal.')))
    return Result.flatMap(build(state, events), (move) => {
      const { line, from, move: name, input } = move
      const entry = { line, from, move: name, input, number, actor, read, at }
      if (!Schema.is(StoredEvent)(entry)) {
        return Result.fail(refuse('WrongMove', Rationale.make('The stored input must match the move on its line.')))
      }
      return Result.map(applyEvent(state, entry), (updated) => ({ event: entry, state: updated }))
    })
  })
  return yield* journal.transact(edit)
})

const wrongActor = () => refuse('WrongActor', Rationale.make('Use the input for your authenticated actor.'))
export const ReviewLimit = Context.Reference<Of<typeof RetryLimit>>('project/ReviewLimit', {
  defaultValue: () => RetryLimit.make(1),
})
const retired = () => refuse('RetiredSession', Rationale.make('Report from the attempt’s live session.'))
const readSubmission = Schema.decodeUnknownEffect(Submission, { onExcessProperty: 'error' })

type Address = Submission['line']['_tag']
const onLine = <L extends Address>(request: Submission, line: L):
  request is Extract<Submission, { line: { _tag: L } }> => request.line._tag === line

const maySubmit = (actor: AuthenticatedActor, party: Party | undefined) => {
  switch (party) {
    case 'Owner': return actor._tag === 'Human'
    case 'Host': return actor._tag === 'Host'
    case 'Reviewer': return actor._tag === 'Review'
    case 'Assignee': return actor._tag === 'Staff'
    case 'Actor':
    case 'Recipient':
    case 'Proposer': return actor._tag === 'Human' || actor._tag === 'Staff'
    default: return false
  }
}

const moveFor = (
  project: Projection, request: Submission, authenticated: AuthenticatedActor, limit: Of<typeof RetryLimit>,
): Result.Result<MoveInput, Refusal> => {
  const moved = (input: MoveInput) => Result.succeed(input)
  if (onLine(request, 'Project')) {
    if (request.move === 'open') return moved({ ...request, from: null })
    return moved({ ...request, from: 'Open' })
  }
  if (!project) return Result.fail(refuse('WrongMove', Rationale.make('Open the project first.')))
  const current = authenticated._tag === 'Staff' || authenticated._tag === 'Review'
    ? liveSession(project, authenticated.session.id) : null
  if ((authenticated._tag === 'Staff' || authenticated._tag === 'Review') &&
      current?.staff.id !== authenticated.session.staff.id) return Result.fail(retired())
  if (onLine(request, 'Task')) {
    if (request.move === 'open') {
      const activation = project.activation
      if (authenticated._tag !== 'Host' || activation._tag !== 'Active' ||
          authenticated.id !== activation.binding.id || authenticated.staff.id !== activation.staff.id)
        return Result.fail(retired())
      return moved({ ...request, from: null })
    }
    if (!current) return Result.fail(retired())
    const { line } = request
    const task = project.tasks.get(line.id)
    if (request.move === 'review') {
      if (!task || task.phase._tag !== 'Reviewing' || authenticated._tag !== 'Review' ||
          authenticated.line._tag !== line._tag || authenticated.line.id !== line.id ||
          task.phase.assignment._tag !== 'Assigned' || task.phase.assignment.by.id !== current.staff.id ||
          task.phase.assignment.review !== authenticated.review) return Result.fail(retired())
      const { facts } = request.input
      const report = { session: current.id, review: authenticated.review, facts, limit }
      const from = 'Reviewing' as const
      return Result.flatMap(reviewTask(task, task.phase, facts, limit), (phase) => {
        switch (phase._tag) {
          case 'Raised': return moved({ line, from, move: 'raise', input: { ...report, reason: phase.reason } })
          case 'Working': return moved({ line, from, move: 'back', input: report })
          case 'Done': return moved({ line, from, move: 'next', input: report })
        }
      })
    }
    if (task?.phase._tag === 'Working' && task.phase.attempt.session.id !== current.id) return Result.fail(retired())
    if (request.move === 'raise')
      return moved({ line, from: 'Working', move: 'raise', input: { ...request.input, session: current.id } })
    const { input } = request
    if ('attempt' in input)
      return moved({ line, from: 'Working', move: 'next', input: { ...input, session: current.id } })
    return moved({ line, from: 'Sent', move: 'next', input: { session: current, staffing: staffingAt(project), where: 'Session' } })
  }
  if (onLine(request, 'Activation')) {
    if (request.move === 'next') return moved({ ...request, from: 'Onboarding' })
    return moved({ ...request, from: 'Active' })
  }
  if (onLine(request, 'Question')) {
    if (request.move === 'open') return moved({ ...request, from: null })
    return moved({ ...request, from: 'Open' })
  }
  switch (request.move) {
    case 'open': return moved({ ...request, from: null })
    case 'submit': return moved({ ...request, from: 'Drafting' })
    case 'accept':
    case 'remove':
    case 'sendBack': return moved({ ...request, from: 'WaitingForOwner' })
    case 'review': {
      const { line, input: { facts } } = request
      const phase = project.proposals.get(line.id)?.phase
      if (!current || authenticated._tag !== 'Review' || phase?._tag !== 'Reviewing' ||
          authenticated.line._tag !== line._tag || authenticated.line.id !== line.id ||
          phase.assignment._tag !== 'Assigned' || phase.assignment.by.id !== current.staff.id ||
          phase.assignment.review !== authenticated.review) return Result.fail(retired())
      const input = { session: current, review: authenticated.review, facts }
      return reviewOutcome(facts) === 'Holds'
        ? moved({ line, from: 'Reviewing', move: 'next', input })
        : moved({ line, from: 'Reviewing', move: 'sendBack', input })
    }
  }
}
export const submit = (journal: Journal, input: unknown): Effect.Effect<Committed, Refusal, Authority> =>
  Effect.gen(function* () {
    const request = yield* Effect.mapError(readSubmission(input), () =>
      refuse('InvalidInput', Rationale.make('The submission does not match the checked input.')))
    const authenticated = yield* (yield* Authority).actor
    if (!maySubmit(authenticated, submissionParty(request))) return yield* Effect.fail(wrongActor())
    if ((request.line._tag === 'Project' || request.line._tag === 'Activation') && request.line.id !== journal.id)
      return yield* Effect.fail(refuse('InvalidInput', Rationale.make('The move addresses a different project.')))
    const limit = yield* ReviewLimit
    const actor: StoredActor = authenticated._tag === 'Human' ? authenticated.actor
      : { _tag: 'Staff', id: (authenticated._tag === 'Host' ? authenticated.staff : authenticated.session.staff).id }
    return yield* commitProjectMove(journal, actor, request.read, (project) => moveFor(project, request, authenticated, limit))
  })

// The provider and other engine ports record the input of a specific line move.
export const recordObserved = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, move: MoveInput,
): Effect.Effect<Committed, Refusal> => commitProjectMove(journal, actor, read, () => Result.succeed(move))
