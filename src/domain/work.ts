// The state of a dir before a top: what the fold makes of its events. It is immutable: a step
// returns a new Work, and a refused act leaves the old one as it was. Every derived state is a
// function of (Work, time) in core/derived.
import type { Author } from './actor.ts'
import type { FitAnswer, Recorded } from './events.ts'
import type { ConfigFile } from './files.ts'
import type {
  Counters,
  DirectionId,
  ReviewId,
  RevisionId,
  RoleName,
  RuleEntry,
  StandardEntry,
  VersionId,
} from './ids.ts'
import type {
  Direction,
  NonEmpty,
  Review,
  Revision,
  Rule,
  Source,
  Standard,
  Text,
} from './model.ts'
import type { Send } from './ui-model.ts'

// An id that a step made, as the CLI prints it after "->" (state.created). A version made by
// an accept is named too: tsd-writing@2.
export type CreatedId = ReviewId | RevisionId | VersionId

// One stored event, and the ids that its step made (work log prints both).
export interface Logged {
  readonly recorded: Recorded
  readonly created: ReadonlyArray<CreatedId>
}

// A record of `work role fit`: the yes and why of each question.
export interface Fit {
  readonly hash: Text
  readonly by: Author
  readonly answers: NonEmpty<typeof FitAnswer.Type>
}

export interface Work {
  // From the config event.
  readonly config: ConfigFile
  readonly hashes: Readonly<Record<string, string>>
  readonly texts: Readonly<Record<string, string>>
  readonly fits: ReadonlyMap<RoleName, Fit>

  // The records of the directions, each list in the order that the fold made them.
  // Every direction, drafted (NewDirection) or official.
  readonly directions: ReadonlyMap<DirectionId, Direction>
  readonly drafts: ReadonlyMap<RevisionId, Revision<Direction>>
  readonly standards: ReadonlyMap<StandardEntry, Standard>
  readonly rules: ReadonlyMap<RuleEntry, Rule>
  // Every Review by its id: the owner's accept or reject of a draft.
  readonly reviews: ReadonlyMap<ReviewId, Review>
  // The revision of each outside source now, by its name.
  readonly sources: ReadonlyMap<string, Source>
  // The person's typed sends to a pane, in the order written.
  readonly sends: ReadonlyArray<Send>

  // Every stored event with the ids that its step made, in seq order (state.events).
  readonly events: ReadonlyArray<Logged>
  readonly counters: Counters
  // The engine's clock: the at of the last record made (model.ts, rule 3).
  readonly clock: number
}

// What one step gives: the new state, and the ids that it made in the old naming order.
export interface Stepped {
  readonly work: Work
  readonly created: ReadonlyArray<CreatedId>
}
