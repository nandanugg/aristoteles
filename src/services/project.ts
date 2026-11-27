import type { Effect, Result } from 'effect'
import type { StoredEvent } from '../domain/project/events.ts'
import type { CommandOutcome } from '../domain/project/task.ts'
import type { Project } from '../domain/project/records.ts'
import type { EventNumber, Of, ReadPosition, Refusal, OptionIndex } from '../domain/project/values.ts'

export interface Committed {
  readonly event: StoredEvent
  readonly following: readonly StoredEvent[]
  readonly state: Project
}

export type Write = (
  events: readonly StoredEvent[],
  number: Of<typeof EventNumber>,
) => Result.Result<Committed, Refusal>

export interface Journal {
  readonly directory: URL
  readonly database: URL
  readonly eventsAfter: (after: Of<typeof ReadPosition>) => Effect.Effect<readonly StoredEvent[], Refusal>
  readonly transact: (edit: Write) => Effect.Effect<Committed, Refusal>
}

export interface CommandRecord {
  readonly directory: URL
  readonly database: URL
  readonly reportedIn: Of<typeof EventNumber>
  readonly slot: Of<typeof OptionIndex>
  readonly rule: CommandOutcome['rule']
}

export type CommandCapture =
  | { readonly _tag: 'NotStarted' }
  | { readonly _tag: 'Running' }
  | { readonly _tag: 'Captured'; readonly outcome: CommandOutcome }
