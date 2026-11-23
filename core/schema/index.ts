// The door of the new tree to the owner's domain (plan/rebuild/BUILD.md, D3). Only this file and
// core/services/index.ts import from src/. Each name is re-exported by name, so the new tree can
// reach only what is here:
//   - the stored states that core/derived replaces are NOT here (ui-model.ts SendState):
//     core/derived has the new ones (BUILD.md D6, section 6);
//   - the helpers that work out a state again are NOT here: core/derived owns those states.
// A package that needs another domain name adds it here by name (an additive change).

// --- ids, actors, closed words, errors ---------------------------------------------------------
export * from '../../src/domain/ids.ts'
export * from '../../src/domain/actor.ts'
export * from '../../src/domain/closed.ts'
export * from '../../src/domain/errors.ts'

// --- the acts of the work model (their stored form; the types are core/state/c16/types.ts) ---
export {
  ItemRec as ItemRecSchema,
} from '../../src/domain/work-acts.ts'
export {
  WorkActed,
  WorkForwarded,
  WorkForwardDropped,
  WorkHostPane,
  WorkOpened,
} from '../../src/domain/events.ts'

// --- the acts of the c16 contract (their stored form; the types are core/state/c16/types.ts) ---
export {
  ActEnvelope as ActEnvelopeSchema,
  Actor as ActorSchema,
  actorOf,
  AnswerBody as AnswerBodySchema,
  Ask as AskSchema,
  Body as BodySchema,
  keyOf,
  QuestionBody as QuestionBodySchema,
  QuestionForm as QuestionFormSchema,
  Refusal as RefusalSchema,
  LoopReviewMode,
} from '../../src/domain/c16-acts.ts'
export type { ActorCase, RefusalNameCase } from '../../src/domain/c16-acts.ts'

// --- the stored events (Schemas: the store's contract, R2) -------------------------------------
export {
  create,
  dataOf,
  decodeRecorded,
  Destination,
  DropReason as DropReasonSchema,
  encodeEvent,
  Enter,
  Event,
  FitAnswer,
  kindOf,
  Line,
  memberOf,
  move,
  OnboardedDirection,
  Recorded,
  ReviewWritten,
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
  Example,
  RuleEvidence,
  Examples,
  casesOfRules,
  casesProblem,
  rulesUsedBy,
  ExternalSource,
  firstSentence,
  Flow,
  FlowStep,
  isMarked,
  type MarkedStep,
  PersistenceFile,
  ReviseFile,
  RoleFile,
  Settings,
  Snapshot,
  isSpot,
  RuleRef,
  Sample,
  Spot,
  spotsOf,
  StandardFile,
  usesProblem,
} from '../../src/domain/files.ts'

// --- the records of the work (model.ts) --------------------------------------------------------
export type {
  Accept,
  By,
  ConditionKey,
  Context,
  Direction,
  DirectionContent,
  FactKey,
  Limit,
  NonEmpty,
  OfficialDirection,
  Reject,
  Review,
  Revision,
  RevisionOrigin,
  Reviser,
  Rule,
  Section,
  Source,
  Standard,
  Text,
  Version,
  Where,
  Why,
} from '../../src/domain/model.ts'

// --- the folded state (work.ts) -----------------------------------------------------------------
export type { CreatedId, Fit, Logged, Stepped, Work } from '../../src/domain/work.ts'

// --- the UI records (ui-model.ts), without the stored SendState ---------------------------------
export type {
  DraftChange,
  DropReason,
  PageMessage,
  Send,
  ServerMessage,
} from '../../src/domain/ui-model.ts'
// The view data of the page (ui-model.ts part 4): adapters/web/contract.ts checks its Schemas
// against these.
export type {
  DirectionCard,
  DirectionView,
  DirView,
  ExampleView,
  FlowStepView,
  OnboardingView,
  QuestionView,
  RoleCard,
  SpotView,
} from '../../src/domain/ui-model.ts'

// --- pure helpers of the domain: ids, text, context, lookup -------------------------------------
export {
  currentVersion,
  decisionOf,
  officialDirections,
  officialOf,
  revisionOf,
  versionIdOf,
} from '../../src/domain/derived.ts'
// The files of onboarding (before the store) and their derived states.
export {
  AiQuestion,
  Discovery,
  QuestionTarget,
  deviationCases,
  OnboardingChoice,
  AnsweredQuestion,
  answersIn,
  draftIn,
  onlyLead,
  OnboardingAct,
  OnboardingDirection,
  OnboardingRoleState,
  RoleReview,
  resetWords,
} from '../../src/domain/onboarding.ts'
export type { OnboardingDirectionState, OnboardingRole } from '../../src/domain/onboarding.ts'
export * from '../../src/domain/context.ts'
export * from '../../src/domain/lookup.ts'
// The moves of the records: only core/state (the fold) uses them (BUILD.md 3.3).
export * as Moves from '../../src/domain/moves.ts'

export { type AdmissionPolicy, type ChildRelease, type ChildReservation, type RecheckBrief, RecheckFinding, type RecheckUse, RuntimeEvent, type SerialAssignment, Turn, WorkerDelivery, WorkerPlacement } from '../../src/domain/worker-runtime.ts'
