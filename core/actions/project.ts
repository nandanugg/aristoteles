import { Context, DateTime, Effect, Result, Schema } from 'effect'
import {
  ReadPosition, Rationale, StoredEvent, Submission, refuse,
  type LiveSession, type Of, type Projection, type Refusal, type StoredActor, type TaskAddress,
  type TaskDraft,
} from '../schema/project.ts'
import type { Committed, ProjectEdit, ProjectJournal } from '../services/project.ts'
import { applyEvent, fold, readPosition } from '../state/project.ts'

type AuthenticatedActor =
  | { readonly _tag: 'Human'; readonly actor: Extract<StoredActor, { _tag: 'Human' }> }
  | { readonly _tag: 'Staff'; readonly session: Of<typeof LiveSession> }
export class Authority extends Context.Service<Authority, {
  readonly actor: Effect.Effect<AuthenticatedActor, Refusal>
}>()('project/Authority') {}

type EventInput = Pick<StoredEvent, 'line' | 'move' | 'input'>
type BuildMove = (state: Projection) => Result.Result<EventInput, Refusal>
const fromResult = <A>(result: Result.Result<A, Refusal>): Effect.Effect<A, Refusal> =>
  Result.isFailure(result) ? Effect.fail(result.failure) : Effect.succeed(result.success)

const commit = (
  journal: ProjectJournal, actor: StoredActor, read: Of<typeof ReadPosition>, build: BuildMove,
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const at = yield* DateTime.now
  const edit: ProjectEdit = (events, number) => Result.flatMap(fold(events), (state) => {
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

const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('Use the input for your authenticated actor.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Report from the attempt’s live session.')))
const readSubmission = Schema.decodeUnknownEffect(Submission, { onExcessProperty: 'error' })

export const submit = (journal: ProjectJournal, input: unknown): Effect.Effect<Committed, Refusal, Authority> =>
  Effect.gen(function* () {
    const request = yield* Effect.mapError(readSubmission(input), () =>
      refuse('InvalidInput', Rationale.make('The submission does not match the checked input.')))
    const authority = yield* Authority
    const authenticated = yield* authority.actor
    if (request._tag === 'HumanChoice') {
      if (authenticated._tag !== 'Human') return yield* fromResult(wrongActor())
      const { choice } = request
      const project = choice._tag === 'NewProject' ? choice.project : choice.line
      if (project.id !== journal.id) {
        return yield* Effect.fail(refuse('InvalidInput', Rationale.make('The choice addresses a different project.')))
      }
      return yield* commit(journal, authenticated.actor, request.read, () => {
        if (choice._tag === 'EndProject') return Result.succeed({
          line: choice.line, move: 'next', input: { _tag: 'next', fact: { _tag: 'ProjectEnded' } },
        })
        const { project, owner, host, pipeline, staff } = choice
        return Result.succeed({
          line: project, move: 'next', input: { _tag: 'next', fact: { _tag: 'ProjectOpened', owner, host, pipeline, staff } },
        })
      })
    }
    if (authenticated._tag !== 'Staff') return yield* fromResult(wrongActor())
    const { report, line } = request.report
    const session = authenticated.session
    const actor: StoredActor = { _tag: 'Staff', id: session.staff.id }
    return yield* commit(journal, actor, request.read, (state) => {
      if (report._tag === 'Result') {
        const task = state._tag === 'Open' ? state.value.tasks.get(line.id) : undefined
        if (task?.phase._tag === 'Working' && task.phase.attempt.session.id !== session.id) return retired()
      } else if (report.session.id !== session.id || report.session.staff.id !== session.staff.id) {
        return retired()
      }
      const fact = report._tag === 'Began' ? { ...report, session } : report
      return Result.succeed({ line, move: 'next', input: { _tag: 'next', fact } })
    })
  })

// These facts enter through engine ports. The submission codec only accepts reports and owner choices.
type Observed =
  | { readonly _tag: 'TaskSent'; readonly draft: Of<typeof TaskDraft> }
  | { readonly _tag: 'CommandOutcomes'; readonly line: Of<typeof TaskAddress>; readonly outcomes: readonly [] }
  | { readonly _tag: 'ReviewFacts'; readonly line: Of<typeof TaskAddress>; readonly why: Of<typeof Rationale> }

export const recordObserved = (
  journal: ProjectJournal, actor: StoredActor, read: Of<typeof ReadPosition>, observation: Observed,
): Effect.Effect<Committed, Refusal> => commit(journal, actor, read, () => {
  switch (observation._tag) {
    case 'TaskSent':
      return Result.succeed({
        line: { _tag: 'Project', id: journal.id }, move: 'next', input: { _tag: 'next', fact: observation },
      })
    case 'CommandOutcomes':
      return Result.succeed({
        line: observation.line, move: 'next',
        input: { _tag: 'next', fact: { _tag: 'CommandOutcomes', outcomes: observation.outcomes } },
      })
    case 'ReviewFacts':
      return Result.succeed({
        line: observation.line, move: 'back',
        input: { _tag: 'back', fact: { _tag: 'ReviewFacts', why: observation.why } },
      })
  }
})
