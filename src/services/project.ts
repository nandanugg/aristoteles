import type { Effect, Result } from 'effect'
import type { StoredEvent } from '../domain/project/events.ts'
import type { CommandOutcome } from '../domain/project/task.ts'
import type { Project } from '../domain/project/records.ts'
import type { EventNumber, Of, ProjectId, ReadPosition, Refusal, RuleId, TaskId } from '../domain/project/values.ts'

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

export interface CommandReceipt {
  readonly project: Of<typeof ProjectId>
  readonly task: Of<typeof TaskId>
  readonly result: Of<typeof EventNumber>
  readonly rule: Of<typeof RuleId>
}

export type CommandCapture =
  | { readonly _tag: 'Unstarted' }
  | { readonly _tag: 'Unconfirmed' }
  | { readonly _tag: 'Captured'; readonly outcome: CommandOutcome }
