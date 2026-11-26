import { Effect, Option, Result, Schema, Stream } from 'effect'
import { Projection, ReadPosition, StoredEvents, type Of, type Refusal } from '../../core/schema/project.ts'
import type { ProjectJournal } from '../../core/services/project.ts'
import { fold } from '../../core/state/project.ts'

const encodeProjection = Schema.encodeSync(Projection)
const encodeEvents = Schema.encodeSync(StoredEvents)

// The server binds the journal to the authenticated project before supplying it to these handlers.
export const projectSnapshot = (journal: ProjectJournal): Effect.Effect<Response, Refusal> =>
  Effect.flatMap(journal.eventsAfter(ReadPosition.make(0)), (events) => {
    const state = fold(events)
    return Result.isFailure(state) ? Effect.fail(state.failure) : Effect.succeed(Response.json(encodeProjection(state.success)))
  })

export const projectEvents = (
  journal: ProjectJournal, after: Of<typeof ReadPosition>,
): Effect.Effect<Response, Refusal> =>
  Effect.map(journal.eventsAfter(after), (events) => Response.json(encodeEvents(events)))

export const projectEventStream = (journal: ProjectJournal, after: Of<typeof ReadPosition>) =>
  Stream.paginate(after, (position) => Effect.flatMap(journal.eventsAfter(position), (events) => {
    const last = events.at(-1)
    if (last) return Effect.succeed([events, Option.some(ReadPosition.make(last.number))] as const)
    return Effect.as(Effect.sleep('100 millis'), [events, Option.some(position)] as const)
  }))
