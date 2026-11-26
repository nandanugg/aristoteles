import type { Effect, Result } from 'effect'
import type { StoredEvent } from '../domain/project/events.ts'
import type { Project } from '../domain/project/records.ts'
import type { EventNumber, Of, ProjectId, ReadPosition, Refusal } from '../domain/project/values.ts'

export interface Committed {
  readonly event: StoredEvent
  readonly state: Project
}

export type Write = (
  events: readonly StoredEvent[],
  number: Of<typeof EventNumber>,
) => Result.Result<Committed, Refusal>

export interface Journal {
  readonly id: Of<typeof ProjectId>
  readonly eventsAfter: (after: Of<typeof ReadPosition>) => Effect.Effect<readonly StoredEvent[], Refusal>
  readonly transact: (edit: Write) => Effect.Effect<Committed, Refusal>
}
