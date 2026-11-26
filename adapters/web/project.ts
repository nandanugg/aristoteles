import { Effect, Option, Result, Schema, Stream } from 'effect'
import { ownerProposals } from './view.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import { Authority, submit } from '../../core/actions/project.ts'
import { Projection, Proposal, ReadPosition, Refusal, Rationale, StoredEvents, refuse, type Of } from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { fold } from '../../core/state/project.ts'

const encodeProjection = Schema.encodeSync(Projection)
const encodeEvents = Schema.encodeSync(StoredEvents)

// The server binds the journal to the authenticated project before supplying it to these handlers.
export const projectSnapshot = (journal: Journal): Effect.Effect<Response, Refusal> =>
  Effect.flatMap(journal.eventsAfter(ReadPosition.make(0)), (events) => {
    const state = fold(events)
    return Result.isFailure(state) ? Effect.fail(state.failure) : Effect.succeed(Response.json(encodeProjection(state.success)))
  })

export const projectEvents = (
  journal: Journal, after: Of<typeof ReadPosition>,
): Effect.Effect<Response, Refusal> =>
  Effect.map(journal.eventsAfter(after), (events) => Response.json(encodeEvents(events)))

export const projectEventStream = (journal: Journal, after: Of<typeof ReadPosition>) =>
  Stream.paginate(after, (position) => Effect.flatMap(journal.eventsAfter(position), (events) => {
    const last = events.at(-1)
    if (last) return Effect.succeed([events, Option.some(ReadPosition.make(last.number))] as const)
    return Effect.as(Effect.sleep('100 millis'), [events, Option.some(position)] as const)
  }))

// The server supplies the journal and authenticates the actor before responding to the page.
export const projectSubmission = (
  journal: Journal, request: Request, review?: Effect.Effect<unknown, Refusal>,
): Effect.Effect<Response, never, Authority> => {
  const input = Effect.tryPromise({
    try: async (): Promise<unknown> => request.json(),
    catch: () => refuse('InvalidInput', Rationale.make('Send a checked project submission.')),
  })
  return Effect.matchEffect(Effect.flatMap(input, (body) => submit(journal, body)), {
    onSuccess: ({ event }) => Effect.gen(function* () {
      if (review && event.line._tag === 'Proposal' && event.from !== null)
        yield* Effect.forkDetach(Effect.result(review))
      return Response.json(encodeEvents([event]))
    }),
    onFailure: (failure) => Effect.succeed(Response.json(Schema.encodeSync(Refusal)(failure), {
      status: failure.code === 'WrongActor' || failure.code === 'RetiredSession' ? 403
        : failure.code === 'Stale' || failure.code === 'WrongMove' ? 409 : 400,
    })),
  })
}

const encodeProposals = Schema.encodeSync(Schema.Array(Proposal))
export const projectOnboarding = (journal: Journal): Effect.Effect<Response, Refusal, Authority> =>
  Effect.gen(function* () {
    const actor = yield* (yield* Authority).actor
    const project = yield* readOpenProject(journal)
    if (actor._tag !== 'Human' || actor.actor.id !== project.owner.id)
      return yield* Effect.fail(refuse('WrongActor', Rationale.make('Read proposals from the owner’s page.')))
    return Response.json(encodeProposals(ownerProposals(project)))
  })
