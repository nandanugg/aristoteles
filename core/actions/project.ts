import { Context, DateTime, Effect, Result, Schema } from 'effect'
import {
  ReadPosition, Rationale, StoredEvent, Submission, liveSession, refuse,
  type LiveSession, type Of, type Projection, type Refusal, type StoredActor,
} from '../schema/project.ts'
import type { Committed, Journal, Write } from '../services/project.ts'
import { applyEvent, fold, readPosition } from '../state/project.ts'

export type AuthenticatedActor =
  | { readonly _tag: 'Human'; readonly actor: Extract<StoredActor, { _tag: 'Human' }> }
  | { readonly _tag: 'Staff'; readonly session: LiveSession }
export class Authority extends Context.Service<Authority, {
  readonly actor: Effect.Effect<AuthenticatedActor, Refusal>
}>()('project/Authority') {}

type Moves = {
  [Event in StoredEvent as `${Event['line']['_tag']}:${Event['from']}:${Event['move']}`]:
    Pick<Event, 'line' | 'from' | 'move' | 'input'>
}
type MoveInput = Moves[keyof Moves]
type BuildMove = (state: Projection) => Result.Result<MoveInput, Refusal>

const commit = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, build: BuildMove,
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const at = yield* DateTime.now
  const edit: Write = (events, number) => Result.flatMap(fold(events), (state) => {
    if (read > readPosition(state)) return Result.fail(refuse('Stale', Rationale.make('That read is ahead of the journal.')))
    return Result.flatMap(build(state), (move) => {
      const entry = { number, actor, read, at, ...move }
      if (!Schema.is(StoredEvent)(entry)) {
        return Result.fail(refuse('WrongMove', Rationale.make('The stored input must match the move on its line.')))
      }
      return Result.map(applyEvent(state, entry), (updated) => ({ event: entry, state: updated }))
    })
  })
  return yield* journal.transact(edit)
})

const wrongActor = () => refuse('WrongActor', Rationale.make('Use the input for your authenticated actor.'))
const retired = () => refuse('RetiredSession', Rationale.make('Report from the attempt’s live session.'))
const readSubmission = Schema.decodeUnknownEffect(Submission, { onExcessProperty: 'error' })

export const submit = (journal: Journal, input: unknown): Effect.Effect<Committed, Refusal, Authority> =>
  Effect.gen(function* () {
    const request = yield* Effect.mapError(readSubmission(input), () =>
      refuse('InvalidInput', Rationale.make('The submission does not match the checked input.')))
    const authority = yield* Authority
    const authenticated = yield* authority.actor
    if (request._tag === 'HumanChoice') {
      if (authenticated._tag !== 'Human') return yield* Effect.fail(wrongActor())
      const { choice } = request
      const address = choice._tag === 'NewProject' ? choice.project : choice.line
      if (address.id !== journal.id) {
        return yield* Effect.fail(refuse('InvalidInput', Rationale.make('The choice addresses a different project.')))
      }
      return yield* commit(journal, authenticated.actor, request.read, () => {
        if (choice._tag === 'EndProject')
          return Result.succeed({ line: choice.line, from: 'Open', move: 'end', input: {} })
        const { project, owner, host, pipeline, staff, roles } = choice
        return Result.succeed({ line: project, from: null, move: 'next', input: { owner, host, pipeline, staff, roles } })
      })
    }
    if (authenticated._tag !== 'Staff') return yield* Effect.fail(wrongActor())
    const { report, line } = request.report
    const { session } = authenticated
    const actor: StoredActor = { _tag: 'Staff', id: session.staff.id }
    return yield* commit(journal, actor, request.read, (project) => {
      if (project?.status._tag !== 'Open') return Result.fail(retired())
      const current = liveSession(project, session.id)
      if (!current || current.staff.id !== session.staff.id) return Result.fail(retired())
      if (report === null) return Result.succeed({
        line, from: 'Sent', move: 'next', input: { session: current, staffing: project.staffingAt, place: 'Main' },
      })
      const task = project.tasks.get(line.id)
      if (task?.phase._tag === 'Working' && task.phase.attempt.session.id !== session.id) return Result.fail(retired())
      return Result.succeed({ line, from: 'Working', move: 'next', input: report })
    })
  })

// The provider and other engine ports record the input of a specific line move.
export const recordObserved = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, move: MoveInput,
): Effect.Effect<Committed, Refusal> => commit(journal, actor, read, () => Result.succeed(move))
