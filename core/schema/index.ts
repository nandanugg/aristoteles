// The door of the new tree to the owner's domain (plan/rebuild/BUILD.md, D3). Only this file and
// core/services/index.ts import from src/. Each name is re-exported by name, so the new tree can
// reach only what is here:
//   - the stored states that core/derived replaces are NOT here (work.ts ForwardState,
//     ui-model.ts SendState): core/derived has the new ones (BUILD.md D6, section 6);
//   - the helpers of src/domain/derived.ts that work out a state again (topOfRun, problemTaskOf)
//     are NOT here: core/derived owns those states.
// A package that needs another domain name adds it here by name (an additive change).

// --- ids, actors, closed words, errors ---------------------------------------------------------
export * from '../../src/domain/ids.ts'
export * from '../../src/domain/actor.ts'
export * from '../../src/domain/closed.ts'
export * from '../../src/domain/errors.ts'

// --- the stored events (Schemas: the store's contract, R2) -------------------------------------
export {
  ConfirmableAct,
  CountedAct,
  create,
  dataOf,
  decodeRecorded,
  Destination,
  DropReason as DropReasonSchema,
  encodeEvent,
  Enter,
  Event,
  EvidenceData,
  FitAnswer,
  ForwardedAct,
  GrantedAct as GrantedActSchema,
  kindOf,
  Line,
  memberOf,
  move,
  PointData,
  Recorded,
  ReportedWork,
  remakeDataOf,
  ReviewWritten,
  SourceSchema,
  StartPrompt,
  StartReason,
  Stop as StopSchema,
  SupervisorReason as SupervisorReasonSchema,
  TaskData,
  taskDataOf,
  TaskPointData,
  TerminalMove,
  Why as WhySchema,
  WRITTEN_BY,
  writtenBy,
} from '../../src/domain/events.ts'
export type {
  Draft,
  EventGroup,
  EventOf,
  GroupOf,
  Kind,
  RecordedOf,
  Total,
} from '../../src/domain/events.ts'

// --- the files that people write ----------------------------------------------------------------
export {
  checkerProblem,
  CompanyCheckers,
  CompanyFolder,
  ConfigFile,
  CONTEXT_KEYS,
  ContextKey,
  DirectionFile,
  ExternalSource,
  PartFile,
  ReviseFile,
  RoleFile,
  Settings,
  Snapshot,
  TaskFile,
  TerminalTier,
} from '../../src/domain/files.ts'

// --- the records of the work (model.ts), without the replaced states ---------------------------
export type {
  Accept,
  Act,
  Answerer,
  Assignment,
  AssignmentEnd,
  Attempt,
  Blocker,
  Breaks,
  By,
  Change,
  Checkpoint,
  CheckpointPart,
  ConditionKey,
  Context,
  DeciderLeaf,
  Deciders,
  Direction,
  DirectionContent,
  Escalate,
  Evaluation,
  EvaluationState,
  Evidence,
  Exhaustion,
  FactKey,
  Limit,
  Limits,
  Maker,
  MadeFrom,
  Meta,
  NonEmpty,
  Note,
  OfficialDirection,
  Permission,
  PermissionState,
  Point,
  Question,
  QuestionStatus,
  Recheck,
  Reject,
  Resolve,
  Result,
  Review,
  Reviewer,
  Revision,
  RevisionOrigin,
  Reviser,
  Role,
  Rule,
  Section,
  Source,
  SourceState,
  Standard,
  Stop,
  Suggestion,
  SuggestionAbout,
  Task,
  TaskEnd,
  TaskPoint,
  TaskState,
  Text,
  Under,
  Version,
  Where,
  Why,
  Workflow,
  Workspace,
} from '../../src/domain/model.ts'

// --- the folded state (work.ts), without the stored ForwardState --------------------------------
export type { CreatedId, Fit, Forward, Logged, Stepped, Work } from '../../src/domain/work.ts'

// --- the UI records (ui-model.ts), without the stored SendState ---------------------------------
export type {
  Activity,
  AgentSession,
  Decision,
  DraftChange,
  DropReason,
  Failure,
  HostRun,
  HostTerminal,
  HostWords,
  PageAct,
  PageMessage,
  Problem,
  ProblemActor,
  Run,
  RunEnd,
  RunState,
  Send,
  SentPair,
  ServerMessage,
  Supervised,
  SupervisorReason,
  TaskDraft,
  TaskDraftState,
  TerminalEvent,
  TerminalReport,
  TerminalState,
} from '../../src/domain/ui-model.ts'
// The view data of the page (ui-model.ts part 4): adapters/web/contract.ts checks its Schemas
// against these.
export type {
  CanvasRow,
  DiffView,
  DirectionView,
  DirView,
  Owner,
  ProjectSummary,
  ProjectView,
  ResultView,
  ReviewCard,
  TaskCard,
  TaskDraftView,
  TaskPanel,
  TerminalRef,
  WorkCard,
} from '../../src/domain/ui-model.ts'

// --- pure helpers of the domain: ids, text, context, lookup -------------------------------------
export {
  afterOf,
  currentVersion,
  decisionOf,
  isRejectRef,
  officialDirections,
  officialOf,
  playedBy,
  pointOf,
  pointsOf,
  replacesOf,
  revisionOf,
  roleFileOf,
  sameAnswerer,
  targetOf,
  versionIdOf,
} from '../../src/domain/derived.ts'
export type { RejectPoint } from '../../src/domain/derived.ts'
export * from '../../src/domain/context.ts'
export * from '../../src/domain/lookup.ts'
// The moves of the records: only core/state (the fold) uses them (BUILD.md 3.3).
export * as Moves from '../../src/domain/moves.ts'
