// The state of a dir: what the replay folds from its events. Its names are
// those of the engine's reads. It is immutable: a step returns a new Work, and a refused act
// leaves the old one as it was. Every derived state is a function of (Work, time) in src/engine.
import type { Effect } from 'effect'
import type { Author } from './actor.ts'
import type { ConfirmableAct, CountedAct, FitAnswer, Recorded } from './events.ts'
import type { ConfigFile } from './files.ts'
import type {
  AssignmentId,
  CheckpointId,
  Counters,
  DirectionId,
  EvaluationId,
  EventRef,
  ExhaustionId,
  NoteId,
  PermissionId,
  ProblemId,
  QuestionId,
  ResultId,
  ReviewId,
  RevisionId,
  RoleName,
  RuleEntry,
  RunId,
  StandardEntry,
  SuggestionId,
  TaskDraftId,
  TaskId,
  Time,
  VersionId,
} from './ids.ts'
import type {
  Assignment,
  Change,
  Checkpoint,
  Direction,
  Evaluation,
  Exhaustion,
  Meta,
  NonEmpty,
  Note,
  Permission,
  Question,
  Result,
  Review,
  Revision,
  Rule,
  Source,
  Standard,
  Suggestion,
  Task,
  Text,
  Workflow,
} from './model.ts'
import type {
  AgentSession,
  HostWords,
  Problem,
  Run,
  Send,
  TaskDraft,
  TerminalEvent,
} from './ui-model.ts'

// An id that a step made, as the CLI prints it after "->" (state.created). A version made by
// an accept is named too: tsd-writing@2.
export type CreatedId =
  | TaskId
  | AssignmentId
  | ResultId
  | ReviewId
  | PermissionId
  | CheckpointId
  | QuestionId
  | NoteId
  | SuggestionId
  | RevisionId
  | ExhaustionId
  | EvaluationId
  | RunId
  | TaskDraftId
  | ProblemId
  | VersionId

// One stored event, and the ids that its step made (work log prints both).
export interface Logged {
  readonly recorded: Recorded
  readonly created: ReadonlyArray<CreatedId>
}

// A person's act that the top agent forwarded with the person's exact words (work forward).
// Who, where from and the words are the Forwarded event's (event); this record keeps what
// follows from it. An act that only stops work or informs counts at once; an act that moves
// work on waits until the person confirms it at a terminal (work confirm). What each step
// made, and its time, are the log's (Work.events).
export type Forward = { readonly event: EventRef } & (
  | { readonly _tag: 'Counted'; readonly inner: CountedAct }
  | { readonly _tag: 'Confirmable'; readonly inner: ConfirmableAct; readonly state: ForwardState }
)
export type ForwardState =
  | { readonly _tag: 'Waiting' }
  // The person confirmed it (work confirm e12): it counted at that event.
  | { readonly _tag: 'Confirmed'; readonly event: EventRef }

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
  readonly workflow: Workflow
  readonly fits: ReadonlyMap<RoleName, Fit>

  // The engine's records (engine.read): each list in the order the engine made them.
  // Every direction, drafted (NewDirection) or official.
  readonly directions: ReadonlyMap<DirectionId, Direction>
  readonly drafts: ReadonlyMap<RevisionId, Revision<Direction>>
  readonly standards: ReadonlyMap<StandardEntry, Standard>
  readonly rules: ReadonlyMap<RuleEntry, Rule>
  readonly suggestions: ReadonlyMap<SuggestionId, Suggestion>
  readonly tasks: ReadonlyMap<TaskId, Task>
  readonly changes: ReadonlyArray<Change>
  readonly assignments: ReadonlyMap<AssignmentId, Assignment>
  readonly results: ReadonlyMap<ResultId, Result>
  // Every Review by its id; a Reject holds its points (v4.1, v4.2).
  readonly reviews: ReadonlyMap<ReviewId, Review>
  // A question by its id, and every other note by its own (one map each, so that neither holds
  // the other's kind).
  readonly questions: ReadonlyMap<QuestionId, Question>
  readonly notes: ReadonlyMap<NoteId, Exclude<Note, Question>>
  readonly exhaustions: ReadonlyMap<ExhaustionId, Exhaustion>
  readonly evaluations: ReadonlyMap<EvaluationId, Evaluation>
  readonly permissions: ReadonlyMap<PermissionId, Permission>
  readonly checkpoints: ReadonlyMap<CheckpointId, Checkpoint>

  // What only the CLI uses.
  readonly meta: ReadonlyMap<AssignmentId, Meta>
  // Every forward by its Forwarded event; the old pending are those that wait.
  readonly forwards: ReadonlyMap<EventRef, Forward>
  // The revision of each outside source now, by its name.
  readonly sources: ReadonlyMap<string, Source>
  // The files of each result, and the text of each file of a result at its report.
  readonly resultFiles: ReadonlyMap<ResultId, ReadonlyArray<string>>
  readonly after: ReadonlyMap<ResultId, Readonly<Record<string, string>>>

  // The UI (the types are in ui-model.ts).
  readonly runs: ReadonlyMap<RunId, Run>
  readonly sessions: ReadonlyMap<AssignmentId, AgentSession>
  readonly taskDrafts: ReadonlyMap<TaskDraftId, TaskDraft>
  readonly problems: ReadonlyMap<ProblemId, Problem>
  readonly terminalEvents: ReadonlyArray<TerminalEvent>
  readonly sends: ReadonlyArray<Send>
  readonly hostWords: ReadonlyMap<ProblemId | RevisionId | RunId, HostWords>

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

// What a check needs besides the state (the time, the cwd, what changed, the measure;
// given to the check). A replay needs none of it: the store is trusted.
export interface CheckContext {
  // The time of the check (the clock of the command, read once).
  readonly now: Time
  readonly cwd: string
  // The work of a result changed after its report (its digest now differs); it reads files.
  readonly changed: (result: Result) => Effect.Effect<boolean>
  // The length of an assignment's brief as the CLI prints it (Workflow.measure of the page; the
  // engine does not import the words module).
  readonly measure: (work: Work, assignment: Assignment) => number
}
