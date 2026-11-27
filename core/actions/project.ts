import { Context, DateTime, Effect, Result, Schema } from 'effect'
import {
  ReadPosition, Rationale, RetryLimit as RetryLimitValue, staffingAt, submissionParty, taskLine, StoredEvent, Submission, liveSession, boundHostSession, refuse, reviewOutcome,
  type EventNumber, type ProposalKey, type TaskKey, type LiveSession, type Of, type Projection, type Refusal, type StoredActor, type Party,
} from '../schema/project.ts'
import type { Committed, Journal, Write } from '../services/project.ts'
import { reviewTask } from '../state/task-review.ts'
import { applyEvent, fold, readPosition } from '../state/project.ts'

export type AuthenticatedActor =
  | { readonly _tag: 'Human'; readonly actor: Extract<StoredActor, { _tag: 'Human' }> }
  | { readonly _tag: 'Staff'; readonly session: LiveSession }
  | { readonly _tag: 'Host'; readonly session: LiveSession }
  | { readonly _tag: 'Review'; readonly session: LiveSession; readonly review: Of<typeof EventNumber> } & (
      | { readonly line: 'Task'; readonly key: Of<typeof TaskKey> }
      | { readonly line: 'Proposal'; readonly key: Of<typeof ProposalKey> }
    )
export class Authority extends Context.Service<Authority, {
  readonly actor: Effect.Effect<AuthenticatedActor, Refusal>
}>()('project/Authority') {}

type Moves = {
  [Event in StoredEvent as `${Event['line']}:${Event['from']}:${Event['move']}`]:
    Omit<Event, 'number' | 'read' | 'actor' | 'at'>
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
      const entry: StoredEvent = { ...move, number, actor, read, at }
      if (!Schema.is(StoredEvent)(entry)) {
        return Result.fail(refuse('WrongMove', Rationale.make('The stored input must match the move on its line.')))
      }
      return Result.map(applyEvent(state, entry), (updated) => ({ event: entry, state: updated }))
    })
  })
  return yield* journal.transact(edit)
})

const wrongActor = () => refuse('WrongActor', Rationale.make('Use the input for your authenticated actor.'))
export const RetryLimit = Context.Reference<Of<typeof RetryLimitValue>>('project/RetryLimit', {
  defaultValue: () => RetryLimitValue.make(1),
})
const retired = () => refuse('RetiredSession', Rationale.make('Report from the attempt’s live session.'))
const readSubmission = Schema.decodeUnknownEffect(Submission, { onExcessProperty: 'error' })

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
  project: Projection, request: Submission, authenticated: AuthenticatedActor, limit: Of<typeof RetryLimitValue>,
): Result.Result<MoveInput, Refusal> => {
  const moved = (input: MoveInput) => Result.succeed(input)
  if (request.line === 'Project') {
    if (request.move === 'open') return moved({ ...request, from: null })
    return moved({ ...request, from: 'Open' })
  }
  if (!project) return Result.fail(refuse('WrongMove', Rationale.make('Open the project first.')))
  const current = authenticated._tag === 'Staff' || authenticated._tag === 'Review'
    ? liveSession(project, authenticated.session.key) : null
  if ((authenticated._tag === 'Staff' || authenticated._tag === 'Review') &&
      current?.staff.key !== authenticated.session.staff.key) return Result.fail(retired())
  if (request.line === 'Task') {
    if (request.move === 'open') {
      const activation = project.activation
      if (authenticated._tag !== 'Host' || activation._tag !== 'Active' ||
          authenticated.session.key !== boundHostSession(project)?.key || authenticated.session.staff.key !== activation.staff.key)
        return Result.fail(retired())
      return moved({ ...request, from: null })
    }
    if (!current) return Result.fail(retired())
    const { line, key } = request
    const task = project.tasks.get(key)
    if (request.move === 'review') {
      if (!task || task.phase._tag !== 'Reviewing' || authenticated._tag !== 'Review' ||
          authenticated.line !== line || authenticated.key !== key ||
          task.phase.assignment._tag !== 'Assigned' || task.phase.assignment.by.key !== current.staff.key ||
          task.phase.assignment.review !== authenticated.review) return Result.fail(retired())
      const { facts } = request.input
      const report = { session: current.key, review: authenticated.review, facts, limit }
      const from = 'Reviewing' as const
      return Result.flatMap(reviewTask(task, task.phase, facts, limit), (phase) => {
        switch (phase._tag) {
          case 'Raised': return moved({ line, key, from, move: 'raise', input: { ...report, reason: phase.reason } })
          case 'Working': return moved({ line, key, from, move: 'back', input: report })
          case 'Done': return moved({ line, key, from, move: 'next', input: report })
        }
      })
    }
    if (task?.phase._tag === 'Working' && task.phase.attempt.session.key !== current.key) return Result.fail(retired())
    if (request.move === 'raise')
      return moved({ line, key, from: 'Working', move: 'raise', input: { ...request.input, session: current.key } })
    const { input } = request
    if (Schema.is(taskLine.Working.moves.next.submission.input)(input))
      return moved({ line, key, from: 'Working', move: 'next', input: { ...input, session: current.key } })
    return moved({ line, key, from: 'Sent', move: 'next', input: { session: current, staffing: staffingAt(project), where: 'Session' } })
  }
  if (request.line === 'Activation') {
    if (request.move === 'next') return moved({ ...request, from: 'Onboarding' })
    return moved({ ...request, from: 'Active' })
  }
  if (request.line === 'Question') {
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
      const { line, key, input: { facts } } = request
      const phase = project.proposals.get(key)?.phase
      if (!current || authenticated._tag !== 'Review' || phase?._tag !== 'Reviewing' ||
          authenticated.line !== line || authenticated.key !== key ||
          phase.assignment._tag !== 'Assigned' || phase.assignment.by.key !== current.staff.key ||
          phase.assignment.review !== authenticated.review) return Result.fail(retired())
      const input = { session: current, review: authenticated.review, facts }
      return reviewOutcome(facts) === 'Holds'
        ? moved({ line, key, from: 'Reviewing', move: 'next', input })
        : moved({ line, key, from: 'Reviewing', move: 'sendBack', input })
    }
  }
}
export const submit = (journal: Journal, input: unknown): Effect.Effect<Committed, Refusal, Authority> =>
  Effect.gen(function* () {
    const request = yield* Effect.mapError(readSubmission(input), () =>
      refuse('InvalidInput', Rationale.make('The submission does not match the checked input.')))
    const authority = yield* (yield* Authority).actor
    const party = submissionParty(request)
    // The bound host's pane also serves the work roles assigned to its staff.
    const authenticated: AuthenticatedActor = authority._tag === 'Host' && party !== 'Host'
      ? { _tag: 'Staff', session: authority.session } : authority
    if (!maySubmit(authenticated, party)) return yield* Effect.fail(wrongActor())
    const limit = yield* RetryLimit
    const actor: StoredActor = authenticated._tag === 'Human' ? authenticated.actor
      : { _tag: 'Staff', key: authenticated.session.staff.key }
    return yield* commitProjectMove(journal, actor, request.read, (project) => moveFor(project, request, authenticated, limit))
  })

// The provider and other engine ports record the input of a specific line move.
export const recordObserved = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, move: MoveInput,
): Effect.Effect<Committed, Refusal> => commitProjectMove(journal, actor, read, () => Result.succeed(move))
