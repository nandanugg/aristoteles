import type { Effect, Result } from 'effect'
import type { StoredEvent } from '../domain/project/events.ts'
import type { Projection } from '../domain/project/records.ts'
import type { EventNumber, Of, ProjectId, ReadPosition, Refusal } from '../domain/project/values.ts'

export interface Committed {
  readonly event: StoredEvent
  readonly state: Projection
}

export type ProjectEdit = (
  events: readonly StoredEvent[],
  number: Of<typeof EventNumber>,
) => Result.Result<Committed, Refusal>

export interface ProjectJournal {
  readonly id: Of<typeof ProjectId>
  readonly eventsAfter: (after: Of<typeof ReadPosition>) => Effect.Effect<readonly StoredEvent[], Refusal>
  readonly transact: (edit: ProjectEdit) => Effect.Effect<Committed, Refusal>
}
