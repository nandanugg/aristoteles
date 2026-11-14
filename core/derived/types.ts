// The types of the derived catalog (plan/rebuild/BUILD.md 3.4, 3.5, section 6): the state of each
// record, the steps, the waiting items, and the values that the effects select. index.ts is the
// export surface; the functions live in catalog.ts, steps.ts, waiting.ts, can.ts, selectors.ts.
//
// R1 is in the signatures: a dependent takes the state of its dependency as a parameter (deps),
// so a test gives an ended dependency and checks the dependent, with no store. Only derive()
// wires the edges, in the order of the table of BUILD.md 3.4.
import type { Intent } from '../schema/actions.ts'
import type { Refusal } from '../schema/errors.ts'
import type {
  Answerer,
  AssignmentId,
  Attempt,
  Author,
  Blocker,
  DeciderLeaf,
  Decision,
  DirectionId,
  DropReason,
  EscalationId,
  EvaluationId,
  EvaluationState,
  EventRef,
  Failure,
  Human,
  NonBlank,
  NonEmpty,
  Permission,
  PermissionId,
  PermissionState,
  PointId,
  PositiveInt,
  ProblemActor,
  ProblemId,
  QuestionId,
  RejectId,
  ResultId,
  ReviewId,
  RevisionId,
  RoleName,
  RunId,
  RunState,
  SessionId,
  SourceState,
  Stop,
  SuggestionId,
  TaskDraftId,
  TaskDraftState,
  TaskId,
  TaskState,
  Time,
  VersionId,
} from '../schema/index.ts'
import type { Moment } from '../state/index.ts'
import type { RoleWordsState } from './role-words.ts'

// =================================================================================================
// The derived value: the state of every record, once
// =================================================================================================

export interface States {
  readonly permissions: ReadonlyMap<PermissionId, PermissionState>
  readonly directions: ReadonlyMap<DirectionId, DirectionState>
  readonly revisions: ReadonlyMap<RevisionId, RevisionState>
  readonly results: ReadonlyMap<ResultId, ResultState>
  readonly tasks: ReadonlyMap<TaskId, TaskState>
  readonly evaluations: ReadonlyMap<EvaluationId, EvaluationState>
  readonly assignments: ReadonlyMap<AssignmentId, AssignmentState>
  readonly questions: ReadonlyMap<QuestionId, QuestionState>
  readonly escalations: ReadonlyMap<EscalationId, EscalationState>
  readonly problems: ReadonlyMap<ProblemId, ProblemState>
  readonly runs: ReadonlyMap<RunId, RunState>
  readonly taskDrafts: ReadonlyMap<TaskDraftId, TaskDraftState>
  readonly forwards: ReadonlyMap<EventRef, ForwardState>
  readonly sends: ReadonlyMap<EventRef, SendState>
  readonly sources: ReadonlyArray<SourceSeen>
  // Each draft of new words of a role, by its event (ruling 2026-11-14).
  readonly roleWords: ReadonlyMap<EventRef, RoleWordsState>
}

// What every reader reads: the moment, and the state of each record at that moment.
export interface Derived {
  readonly moment: Moment
  readonly states: States
}

// Computes each state once, in the order of the edges (BUILD.md 3.4).
export type Derive = (m: Moment) => Derived

// =================================================================================================
// The catalog, in the order of derive()
// =================================================================================================

// --- 1. PermissionState (reused: model.ts) ------------------------------------------------------
export type PermissionStateOf = (permission: Permission, at: Time) => PermissionState

// --- 2. DirectionState (NEW): the edge version -> draft -----------------------------------------
// Drafted: no version yet (its first draft waits). Official: the version that is current now.
export type DirectionState =
  | { readonly _tag: 'Drafted' }
  | { readonly _tag: 'Official'; readonly current: VersionId }
export type DirectionStateOf = (m: Moment, direction: DirectionId) => DirectionState

// --- 3. RevisionState (NEW, replaces model.ts RevisionState): S2, S6, S7 ------------------------
// The order is fixed (S6): Official, then Outdated, then Conflicted, then Vetoed, then Waiting.
// Outdated before Vetoed: a draft on an old base is not revised again; a new draft is made on the
// current version.
export type OwnerAcceptWhy =
  | 'SaysChanged' // the draft changes what the direction says
  | 'AfterReject' // the draft answers a Reject of the owner
// A leaf that a draft waits for. OwnerAccept (S2): the owner accepts too, even when approvedBy
// names deciders; the page shows the draft to the owner, and no agent gets a review step for it.
export type DraftLeaf =
  | DeciderLeaf
  | { readonly _tag: 'OwnerAccept'; readonly owner: Human; readonly why: OwnerAcceptWhy }
export type RevisionState =
  | { readonly _tag: 'Official'; readonly version: VersionId }
  | { readonly _tag: 'Outdated'; readonly current: VersionId }
  // S7: a rule id that another open draft of the direction, or the current version, also adds.
  | { readonly _tag: 'Conflicted'; readonly rule: string; readonly with: RevisionId | VersionId }
  | { readonly _tag: 'Vetoed'; readonly by: RejectId }
  | { readonly _tag: 'Waiting'; readonly waitsFor: NonEmpty<DraftLeaf> }
export type RevisionStateOf = (
  m: Moment,
  draft: RevisionId,
  deps: { readonly direction: DirectionState },
) => RevisionState

// --- 4. ResultState (NEW, replaces model.ts ResultState): S5, C6 --------------------------------
// One word for every reader (the card read its own: S5). Superseded: a later result of its task
// exists; "is it the latest" is read here once (escalations, forwards, rechecks).
export type ResultState =
  | { readonly _tag: 'Accepted' }
  | { readonly _tag: 'InReview' }
  | { readonly _tag: 'Rejected' }
  | { readonly _tag: 'Superseded'; readonly by: ResultId }
export type ResultStateOf = (m: Moment, result: ResultId) => ResultState

// --- 5. The blockers of a result (reused: model.ts Blocker) -------------------------------------
export type BlockersOf = (m: Moment, result: ResultId) => ReadonlyArray<Blocker>

// --- 6. TaskState (reused: model.ts) ------------------------------------------------------------
// The latest result of the task and its state; a task with no result has none.
export type LatestResult =
  | { readonly _tag: 'NoResult' }
  | { readonly _tag: 'Latest'; readonly result: ResultId; readonly state: ResultState }
// C4: a Reject of a part that was replaced does not count for its parent.
export type TaskStateOf = (
  m: Moment,
  task: TaskId,
  deps: { readonly latest: LatestResult; readonly needs: ReadonlyArray<TaskState> },
) => TaskState

// The two states of a task that are final (its stored end).
export type EndedTask = Extract<TaskState, { readonly _tag: 'Closed' | 'Replaced' }>
export const isEndedTask = (state: TaskState): state is EndedTask =>
  state._tag === 'Closed' || state._tag === 'Replaced'

// --- 7. EvaluationState (reused: model.ts) ------------------------------------------------------
export type EvaluationStateOf = (m: Moment, evaluation: EvaluationId) => EvaluationState

// --- 8. AssignmentState (NEW, absorbs MakerState): C1, S4, S9, B5, I2 ---------------------------
// Working: it may act; a maker has its attempt (S4: one count). OutOfTries: a maker whose last try
// ended on a fault; its task waits for an evaluation. BriefOver (ruling 10.9): its brief is longer
// than the limit of its tier (Outside.measure); it waits, holds no file turn, and the nearest high
// role above it shortens the directions of its task or splits the task. Settled: its task is
// accepted: no step, no file turn; it goes back to Working when a version change opens the task
// again. Ended: final.
export type Tries =
  | { readonly _tag: 'Reviews' } // a role that makes nothing has no attempts
  | { readonly _tag: 'Makes'; readonly attempt: Attempt }
export type AssignmentEndWhy =
  | { readonly _tag: 'Finished'; readonly when: Time } // a finish, or a new maker of its task
  | { readonly _tag: 'TaskEnded'; readonly task: TaskId; readonly state: EndedTask } // C1
  | { readonly _tag: 'ParentEnded'; readonly parent: AssignmentId } // a settled child
export type AssignmentState =
  | { readonly _tag: 'Working'; readonly tries: Tries }
  | { readonly _tag: 'OutOfTries'; readonly used: number; readonly max: PositiveInt }
  | { readonly _tag: 'BriefOver'; readonly size: number; readonly limit: number }
  | { readonly _tag: 'Settled'; readonly task: TaskId }
  | { readonly _tag: 'Ended'; readonly why: AssignmentEndWhy }
export type ParentState =
  | { readonly _tag: 'GivenByPerson' }
  | { readonly _tag: 'Parent'; readonly parent: AssignmentId; readonly state: AssignmentState }
export type AssignmentStateOf = (
  m: Moment,
  assignment: AssignmentId,
  deps: { readonly task: TaskState; readonly parent: ParentState },
) => AssignmentState

// --- 9. Attempt (reused: model.ts): S4 ----------------------------------------------------------
// The try that a maker is on: used + 1, never above its limit.
export type AttemptOf = (m: Moment, maker: AssignmentId) => Attempt

// --- 10. Who answers now (the domain Answerer) --------------------------------------------------
// The first one that a question or an escalation went to while its state is not Ended, else the
// nearest assignment above it that is not Ended, else the owner of its task (C1: a question never
// waits for an agent of an ended task).
export type AnswererNow = (
  m: Moment,
  first: Answerer,
  assignments: ReadonlyMap<AssignmentId, AssignmentState>,
) => Answerer

// --- 11. QuestionState (NEW): C2 ----------------------------------------------------------------
export type QuestionState =
  | { readonly _tag: 'Open'; readonly answerer: Answerer }
  | {
      readonly _tag: 'Answered'
      readonly answer: NonBlank
      readonly by: Answerer
      readonly when: Time
    }
  | { readonly _tag: 'Irrelevant'; readonly task: TaskId } // the task that it stops ended
export type QuestionStateOf = (
  m: Moment,
  question: QuestionId,
  deps: { readonly stops: TaskState; readonly answerer: Answerer },
) => QuestionState

// --- 12. EscalationState (NEW) ------------------------------------------------------------------
export type EscalationIrrelevant =
  | { readonly _tag: 'ResultSuperseded'; readonly by: ResultId }
  | { readonly _tag: 'TaskEnded'; readonly task: TaskId }
export type EscalationState =
  | { readonly _tag: 'Open'; readonly answerer: Answerer }
  | { readonly _tag: 'Resolved'; readonly by: ReviewId }
  | { readonly _tag: 'Irrelevant'; readonly why: EscalationIrrelevant }
export type EscalationStateOf = (
  m: Moment,
  escalation: EscalationId,
  deps: { readonly result: ResultState; readonly task: TaskState; readonly answerer: Answerer },
) => EscalationState

// --- 13. Placement (NEW): d15, C3, S11 ----------------------------------------------------------
// Where a decision shows: on an open task (after following Replaced.next), or for the whole dir.
export type Placement =
  | { readonly _tag: 'OnTask'; readonly task: TaskId }
  | { readonly _tag: 'DirWide' }
export type PlacementOf = (
  m: Moment,
  from: TaskId,
  deps: { readonly tasks: ReadonlyMap<TaskId, TaskState> },
) => Placement

// --- 14. ProblemState (NEW): C3, S12 ------------------------------------------------------------
// Recovered: the supervisor or the person recorded it, and a later act of an agent of the stopped
// task's tree is in the store (the work goes on). Irrelevant: the stopped task ended. No effect
// writes Problem.Fixed because a pane is alive (S12).
export type ProblemState =
  | { readonly _tag: 'Open' }
  | { readonly _tag: 'Fixed'; readonly by: ProblemActor; readonly at: Time }
  | { readonly _tag: 'Recovered'; readonly by: EventRef }
  | { readonly _tag: 'Irrelevant'; readonly task: TaskId }
export type ProblemStateOf = (
  m: Moment,
  problem: ProblemId,
  deps: { readonly stopped: TaskState },
) => ProblemState

// --- 15. RunState (reused: ui-model.ts): S1 -----------------------------------------------------
// Closed when its current top task ended. The watcher reads this, never run.end.
export type RunTop =
  | { readonly _tag: 'NoTopTask' }
  | { readonly _tag: 'TopTask'; readonly task: TaskId; readonly state: TaskState }
export type RunStateOf = (m: Moment, run: RunId, deps: { readonly top: RunTop }) => RunState

// --- 16. TaskDraftState (reused: ui-model.ts): S3 -----------------------------------------------
export type TaskDraftStateOf = (
  m: Moment,
  draft: TaskDraftId,
  deps: { readonly run: RunState },
) => TaskDraftState

// --- 17. ForwardState (NEW, a derived type beside the stored work.ts ForwardState): C6 ----------
export type ForwardIrrelevant =
  | { readonly _tag: 'QuestionAnswered'; readonly question: QuestionId }
  | { readonly _tag: 'QuestionIrrelevant'; readonly question: QuestionId }
  | { readonly _tag: 'DraftDecided'; readonly draft: RevisionId }
  | { readonly _tag: 'PersonAccepted'; readonly draft: RevisionId } // the person's leaf is gone
  | { readonly _tag: 'ResultNotCurrent'; readonly result: ResultId } // superseded, or task ended
  | { readonly _tag: 'ResultAccepted'; readonly result: ResultId }
  | { readonly _tag: 'EscalationClosed'; readonly escalation: EscalationId }
export type ForwardState =
  | { readonly _tag: 'Counted' } // a reject, a question, a comment: it counted at once
  | { readonly _tag: 'Waiting' }
  | { readonly _tag: 'Confirmed'; readonly event: EventRef }
  | { readonly _tag: 'Irrelevant'; readonly why: ForwardIrrelevant }
// The state of what the inner act acts on.
export type ForwardTarget =
  | { readonly _tag: 'Counted' }
  | { readonly _tag: 'Question'; readonly question: QuestionId; readonly state: QuestionState }
  | { readonly _tag: 'Revision'; readonly draft: RevisionId; readonly state: RevisionState }
  | {
      readonly _tag: 'Result'
      readonly result: ResultId
      readonly state: ResultState
      readonly task: TaskState
    }
  | {
      readonly _tag: 'Escalation'
      readonly escalation: EscalationId
      readonly state: EscalationState
    }
export type ForwardStateOf = (
  m: Moment,
  forward: EventRef,
  deps: { readonly target: ForwardTarget },
) => ForwardState

// --- 18. HostOfTree (NEW): S11 ------------------------------------------------------------------
// The host of a placement: the open Sol in the session of the run that holds the tree.
export type HostOfTree =
  | {
      readonly _tag: 'Host'
      readonly run: RunId
      readonly session: SessionId
      readonly assignment: AssignmentId
    }
  | { readonly _tag: 'NoHost' }
export type HostOf = (
  m: Moment,
  placement: Placement,
  deps: {
    readonly runs: ReadonlyMap<RunId, RunState>
    readonly assignments: ReadonlyMap<AssignmentId, AssignmentState>
  },
) => HostOfTree

// --- 19. SendState (NEW, a derived type beside the stored ui-model.ts SendState): C5 ------------
// An irrelevant send is never typed. No event marks it (R2: the drop reasons stay as they are).
export type SendIrrelevant =
  | { readonly _tag: 'OwnerEnded'; readonly assignment: AssignmentId }
  | { readonly _tag: 'RunEnded'; readonly run: RunId }
  | { readonly _tag: 'DecisionGone'; readonly decision: ProblemId | RevisionId | RunId }
  | { readonly _tag: 'ProblemNotOpen'; readonly problem: ProblemId }
  | { readonly _tag: 'DraftNotOpened'; readonly draft: TaskDraftId }
export type SendState =
  | { readonly _tag: 'Pending' }
  | { readonly _tag: 'Delivered'; readonly at: Time }
  | { readonly _tag: 'Dropped'; readonly at: Time; readonly why: DropReason }
  | { readonly _tag: 'Irrelevant'; readonly why: SendIrrelevant }
// The owner of the send's terminal, and what the send is about, each with its state.
export type SessionOwner =
  | { readonly _tag: 'Agent'; readonly assignment: AssignmentId; readonly state: AssignmentState }
  | { readonly _tag: 'Host'; readonly run: RunId; readonly state: RunState }
  | { readonly _tag: 'NoOwner' }
export type SendAbout =
  | { readonly _tag: 'Nothing' }
  | { readonly _tag: 'Problem'; readonly problem: ProblemId; readonly state: ProblemState }
  | { readonly _tag: 'Revision'; readonly draft: RevisionId; readonly state: RevisionState }
  | { readonly _tag: 'Run'; readonly run: RunId; readonly state: RunState }
  | { readonly _tag: 'TaskDraft'; readonly draft: TaskDraftId; readonly state: TaskDraftState }
export interface SendTarget {
  readonly owner: SessionOwner
  readonly about: SendAbout
}
export type SendStateOf = (
  m: Moment,
  send: EventRef,
  deps: { readonly target: SendTarget },
) => SendState

// --- 20. SourceState (reused: model.ts) ---------------------------------------------------------
// Each outside source that an agent read, with its revision now and its state at the moment
// (outside.settings.outsideSourceHours). A git source never expires: it is not listed.
export interface SourceSeen {
  readonly name: string
  readonly revision: string
  readonly state: SourceState
}
export type SourceStatesOf = (m: Moment) => ReadonlyArray<SourceSeen>

// =================================================================================================
// The steps (nextFor) and the waiting items (waitingFor)
// =================================================================================================

// Why a Working maker makes no result now, for a reason that can change back. Ruling 10.2: an
// idle maker gives up its turn of a file at once, so the next maker writes it.
export type Idle =
  | { readonly _tag: 'WaitsForEvaluation'; readonly task: TaskId }
  | { readonly _tag: 'NeedsTask'; readonly task: TaskId; readonly need: TaskId }

// The kinds of waiting item; SURFACES has one entry for each.
export type WaitingKind =
  | 'Question'
  | 'Escalation'
  | 'Forward'
  | 'DraftForPerson'
  | 'DraftForRole'
  | 'DraftVetoed'
  | 'RoleWords'
  | 'RoleWordsRejected'
  | 'ChangePoint'
  | 'Stop'
  | 'EvaluationForOwner'
  | 'Suggestion'
  | 'DecideResult'
  | 'IdleAssignment'
  | 'IdleTask'
  | 'OutsideNeed'
  | 'Problem'
  | 'RunEnd'
  | 'BriefOver'

// One kind of step with the ids that it names (the old NextStep of `work next`, minus the
// bookkeeping steps of D14: FinishChildOfClosedTask, FinishInClosedTask, FinishChild, and of
// ruling 10.2: FinishIdleChild, since the file turn passes by itself). A field
// that is not an id only picks words; stepKey leaves it out. PersonDecides is the step of a
// person's waiting item.
export type StepWhat =
  | {
      readonly _tag: 'ReadSource'
      readonly source: string
      readonly revision: string
      readonly seenAt: Time
      readonly hours: number
    }
  | { readonly _tag: 'Answer'; readonly question: QuestionId }
  | { readonly _tag: 'Resolve'; readonly escalation: EscalationId; readonly result: ResultId }
  | {
      readonly _tag: 'RecheckStaleSource'
      readonly result: ResultId
      readonly source: string
      readonly was: string
      readonly now: string
    }
  | {
      readonly _tag: 'RecheckOldNeed'
      readonly result: ResultId
      readonly need: TaskId
      readonly newer: ResultId
    }
  | { readonly _tag: 'ReviewDraft'; readonly draft: RevisionId }
  | { readonly _tag: 'ReviseRejectedDraft'; readonly draft: RevisionId; readonly reject: RejectId }
  | {
      readonly _tag: 'AnswerSuggestion'
      readonly suggestion: SuggestionId
      readonly direction: DirectionId
    }
  | {
      readonly _tag: 'PutOnBase'
      readonly task: TaskId
      readonly result: ResultId
      readonly repo: string
      readonly base: string
      readonly commit: string
    }
  | { readonly _tag: 'FinishAcceptedTask'; readonly task: TaskId }
  | {
      readonly _tag: 'EvaluationWaitsForOwner'
      readonly evaluation: EvaluationId
      readonly task: TaskId
    }
  | { readonly _tag: 'Evaluate'; readonly task: TaskId; readonly stop: Stop }
  | {
      readonly _tag: 'WaitsForEvaluationBy'
      readonly task: TaskId
      readonly stop: Stop
      readonly evaluator: AssignmentId
    }
  | { readonly _tag: 'WaitsForEvaluationNoHigh'; readonly task: TaskId; readonly stop: Stop }
  | {
      readonly _tag: 'WaitsForParts'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
    }
  | {
      readonly _tag: 'DraftOfEvaluationWaits'
      readonly task: TaskId
      readonly draft: RevisionId
      readonly evaluation: EvaluationId | null
    }
  | {
      readonly _tag: 'WaitsForChangeOfEvaluation'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
    }
  | {
      readonly _tag: 'RemakeAsEvaluated'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
      readonly oneUnit: boolean
    }
  | {
      readonly _tag: 'EscalateForRemake'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
      readonly oneUnit: boolean
    }
  | {
      readonly _tag: 'ReviseAsEvaluated'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
      readonly directions: ReadonlyArray<DirectionId>
    }
  // B1: the intent of this step names the point in its answers.
  | {
      readonly _tag: 'ReviseForReturnedTask'
      readonly point: PointId
      readonly task: TaskId
      readonly directions: ReadonlyArray<DirectionId>
    }
  | { readonly _tag: 'EscalateForReturnedTask'; readonly point: PointId; readonly task: TaskId }
  | { readonly _tag: 'WaitsForOutsideNeed'; readonly task: TaskId; readonly need: TaskId }
  | { readonly _tag: 'RunsAfter'; readonly task: TaskId; readonly need: TaskId }
  | { readonly _tag: 'MediumRuns'; readonly lead: AssignmentId; readonly task: TaskId }
  | {
      readonly _tag: 'RunSectionWithMedium'
      readonly task: TaskId
      readonly roles: NonEmpty<RoleName>
    }
  | { readonly _tag: 'SplitFirst'; readonly task: TaskId }
  | { readonly _tag: 'RunWithMedium'; readonly task: TaskId; readonly roles: NonEmpty<RoleName> }
  | {
      readonly _tag: 'ChangeWaitsForDraft'
      readonly point: PointId
      readonly drafts: NonEmpty<RevisionId>
      readonly first: boolean
    }
  | {
      readonly _tag: 'ReviseForPoint'
      readonly point: PointId
      readonly directions: ReadonlyArray<DirectionId>
      readonly first: boolean
    }
  | {
      readonly _tag: 'EscalateForPoint'
      readonly point: PointId
      readonly result: ResultId
      readonly first: boolean
    }
  | {
      readonly _tag: 'MakerWaitsForFile'
      readonly maker: AssignmentId
      readonly file: string
      readonly before: AssignmentId
    }
  | { readonly _tag: 'MakerWorking'; readonly maker: AssignmentId; readonly task: TaskId }
  | {
      readonly _tag: 'GiveMakerCommand'
      readonly maker: AssignmentId
      readonly task: TaskId
      readonly redo: boolean
      readonly ownChild: boolean
    }
  | { readonly _tag: 'AssignMaker'; readonly task: TaskId; readonly roles: NonEmpty<RoleName> }
  | { readonly _tag: 'NoMakerRole'; readonly task: TaskId }
  | { readonly _tag: 'CheckAgainUnderNewVersion'; readonly result: ResultId }
  | {
      readonly _tag: 'ProgramChecksNextReport'
      readonly role: RoleName
      readonly task: TaskId
      readonly result: ResultId
    }
  | { readonly _tag: 'CheckYourself'; readonly result: ResultId }
  | { readonly _tag: 'CheckerWorking'; readonly checker: AssignmentId; readonly result: ResultId }
  | {
      readonly _tag: 'GiveCheckerCommand'
      readonly checker: AssignmentId
      readonly result: ResultId
      readonly task: TaskId
    }
  | { readonly _tag: 'CheckerOfHigherTier'; readonly result: ResultId; readonly role: RoleName }
  | {
      readonly _tag: 'AssignChecker'
      readonly result: ResultId
      readonly role: RoleName
      readonly task: TaskId
    }
  | { readonly _tag: 'Decide'; readonly result: ResultId; readonly again: boolean }
  | { readonly _tag: 'WaitsForDecider'; readonly result: ResultId; readonly decider: AssignmentId }
  | {
      readonly _tag: 'AssignDecider'
      readonly result: ResultId
      readonly role: RoleName
      readonly task: TaskId
    }
  | {
      readonly _tag: 'DeciderByPerson'
      readonly result: ResultId
      readonly leaf: DeciderLeaf
      readonly task: TaskId
    }
  | { readonly _tag: 'PersonDecides'; readonly kind: WaitingKind; readonly id: string }
  // Ruling 10.9: a brief over its limit. The agent and its parent wait; the nearest high role
  // above it shortens the directions of its task, or splits the task.
  | {
      readonly _tag: 'BriefOverWaits'
      readonly assignment: AssignmentId
      readonly task: TaskId
      readonly size: number
      readonly limit: number
    }
  // Ruling 10.10: the host writes the words of a draft that waits for the person. A draft from no
  // project (DirWide) goes to every active host; the first words end it for the others.
  | {
      readonly _tag: 'ExplainDraft'
      readonly draft: RevisionId
      readonly direction: DirectionId
      readonly dirWide: boolean
    }
  // The notices of ruling 10.1 (notices.ts): what the watcher typed into a terminal before, as
  // steps of the actor it was for, so that its work wait returns. A child's AI CLI asks (a
  // permission dialog): its host answers with work send.
  | {
      readonly _tag: 'AnswerPrompt'
      readonly agent: AssignmentId
      readonly task: TaskId
      readonly session: SessionId
      readonly line: string
      readonly prompt: EventRef
    }
  // The terminal of a child failed its 3 tries: its host records a system problem.
  | {
      readonly _tag: 'RecordFailure'
      readonly agent: AssignmentId
      readonly task: TaskId
      readonly why: Failure
      readonly lastLines: string
      readonly failure: EventRef
    }
  // The end of a project waits for the host's words (S11, B8: only while the page holds it).
  | { readonly _tag: 'WriteEndWords'; readonly run: RunId }
  // An open problem that the host recorded: it tests it again. asked: the newest ask of the
  // person to try it now (a ProblemRetry send of the page's Fixed), so a new ask changes the key.
  | { readonly _tag: 'TestProblem'; readonly problem: ProblemId; readonly asked: EventRef | null }
  // A question of the actor waits for its answer, or got it after the actor's last act.
  | { readonly _tag: 'WaitsForAnswer'; readonly question: QuestionId }
  | { readonly _tag: 'Answered'; readonly question: QuestionId }
  // An escalation of the actor was resolved after its last act: it decides the result now.
  | { readonly _tag: 'Resolved'; readonly escalation: EscalationId; readonly result: ResultId }
  | {
      readonly _tag: 'ShortenOrSplit'
      readonly assignment: AssignmentId
      readonly task: TaskId
      readonly size: number
      readonly limit: number
      readonly directions: ReadonlyArray<DirectionId>
    }

// D8: a Do step holds the intents that the actor may run, one per option; each passes canAct.
export type NextStep =
  | { readonly _tag: 'Do'; readonly what: StepWhat; readonly intents: NonEmpty<Intent> }
  | { readonly _tag: 'Wait'; readonly what: StepWhat }

// Who a waiting item waits for.
export type WaitsFor =
  | { readonly _tag: 'Person'; readonly name: string }
  | { readonly _tag: 'Assignment'; readonly assignment: AssignmentId }
  | { readonly _tag: 'Role'; readonly role: RoleName }
// When the page shows a decision: at once, or after the host wrote its words or a wait.
export type Hold = Decision['shown']

interface WaitingBase {
  readonly for: WaitsFor
  readonly placement: Placement
  readonly at: Time
  readonly step: NextStep
}
// D9: the one list behind `work waiting` and the page decisions.
export type WaitingItem = WaitingBase &
  (
    | { readonly _tag: 'Question'; readonly question: QuestionId }
    | { readonly _tag: 'Escalation'; readonly escalation: EscalationId; readonly result: ResultId }
    | { readonly _tag: 'Forward'; readonly forward: EventRef; readonly hold: Hold } // page: Confirm
    | {
        readonly _tag: 'DraftForPerson' // page: Direction (S2)
        readonly draft: RevisionId
        readonly leaf: DraftLeaf
        readonly hold: Hold
      }
    | {
        readonly _tag: 'DraftForRole'
        readonly draft: RevisionId
        readonly role: RoleName
        readonly reviewer:
          | { readonly _tag: 'Reviewer'; readonly assignment: AssignmentId }
          | { readonly _tag: 'NoReviewer' }
      }
    | { readonly _tag: 'DraftVetoed'; readonly draft: RevisionId; readonly reject: RejectId }
    // New words of a role (ruling 2026-11-14): a draft for the person (page: RoleWords), and a
    // rejected draft that waits for a newer one.
    | {
        readonly _tag: 'RoleWords'
        readonly draft: EventRef
        readonly role: RoleName
        readonly hold: Hold
      }
    | { readonly _tag: 'RoleWordsRejected'; readonly draft: EventRef; readonly role: RoleName }
    | { readonly _tag: 'ChangePoint'; readonly task: TaskId; readonly point: PointId }
    | { readonly _tag: 'Stop'; readonly task: TaskId; readonly stop: Stop }
    | { readonly _tag: 'EvaluationForOwner'; readonly evaluation: EvaluationId }
    | {
        readonly _tag: 'Suggestion'
        readonly suggestion: SuggestionId
        readonly about:
          | { readonly _tag: 'Direction'; readonly direction: DirectionId }
          | { readonly _tag: 'NewDirection' }
      }
    | { readonly _tag: 'DecideResult'; readonly result: ResultId; readonly leaf: DeciderLeaf }
    // A maker that waits for a file that another maker holds (one maker per file at a time).
    | {
        readonly _tag: 'IdleAssignment'
        readonly assignment: AssignmentId
        readonly before: AssignmentId
        readonly file: string
      }
    // Additive (P1): an open task that no open assignment works on; the old row had no kind.
    | { readonly _tag: 'IdleTask'; readonly task: TaskId }
    | { readonly _tag: 'OutsideNeed'; readonly task: TaskId; readonly need: TaskId }
    | { readonly _tag: 'Problem'; readonly problem: ProblemId; readonly hold: Hold } // page: System
    | {
        readonly _tag: 'RunEnd' // page: End
        readonly run: RunId
        readonly top: TaskId
        readonly hold: Hold
      }
    // Ruling 10.9: a brief over its limit with no high role above it: the task's owner splits it.
    | { readonly _tag: 'BriefOver'; readonly assignment: AssignmentId; readonly task: TaskId }
  )

// Which renderer shows each kind. cli: `work waiting` (ruling 10.6: one list, so the system
// problems and the ends too). page: the kind of decision of the page (ui-model Decision), or None.
export interface Surface {
  readonly cli: boolean
  readonly page: Decision['_tag'] | 'None'
}
export const SURFACES = {
  Question: { cli: true, page: 'None' },
  Escalation: { cli: true, page: 'None' },
  Forward: { cli: true, page: 'Confirm' },
  DraftForPerson: { cli: true, page: 'Direction' },
  DraftForRole: { cli: true, page: 'None' },
  DraftVetoed: { cli: true, page: 'None' },
  RoleWords: { cli: true, page: 'RoleWords' },
  RoleWordsRejected: { cli: true, page: 'None' },
  ChangePoint: { cli: true, page: 'None' },
  Stop: { cli: true, page: 'None' },
  EvaluationForOwner: { cli: true, page: 'None' },
  Suggestion: { cli: true, page: 'None' },
  DecideResult: { cli: true, page: 'None' },
  IdleAssignment: { cli: true, page: 'None' },
  IdleTask: { cli: true, page: 'None' },
  OutsideNeed: { cli: true, page: 'None' },
  Problem: { cli: true, page: 'System' },
  RunEnd: { cli: true, page: 'End' },
  BriefOver: { cli: true, page: 'None' },
} as const satisfies { readonly [K in WaitingItem['_tag']]: Surface } & {
  readonly [K in WaitingKind]: Surface
}

// =================================================================================================
// The three cross-cutting functions
// =================================================================================================

// work waiting with no --for asks for Everyone; with --for, and the page (B7: git user.name),
// for one person.
export type WaitingWho =
  | { readonly _tag: 'Everyone' }
  | { readonly _tag: 'Person'; readonly name: string }
export type WaitingFor = (d: Derived, who: WaitingWho) => ReadonlyArray<WaitingItem>

// The steps of `work next` for an agent (the old order, expired sources first); for a person, the
// steps of the person's waiting items. Every intent of every Do step passes canAct (BUILD.md 4.2).
export type NextFor = (d: Derived, actor: Author) => ReadonlyArray<NextStep>

// The one check behind every refusal of state. It reads only Derived and never checks content.
export type CanAct =
  | { readonly _tag: 'May' }
  | { readonly _tag: 'MayNot'; readonly refusal: Refusal }
export type CanActOf = (d: Derived, actor: Author, intent: Intent) => CanAct

// The tags and ids of the steps, with no words and no times: a change of words wakes nobody
// (bug 13).
export type StepKey = (steps: ReadonlyArray<NextStep>) => string

// =================================================================================================
// The selectors of the effects (BUILD.md 3.7)
// =================================================================================================

// Each run whose RunState is Talking, Working or AwaitingEndAccept and whose terminal is a pane
// of the person (S1); former: the sessions of its older hosts.
export interface HostPane {
  readonly run: RunId
  readonly session: SessionId
  readonly socket: string
  readonly pane: string
  readonly former: ReadonlyArray<SessionId>
}
export type HostPanesOf = (d: Derived) => ReadonlyArray<HostPane>

// Each Sol or Terra assignment in a live run that is Working, with no terminal yet, or with a
// session that never briefed and is not Stopped (C1: never an Ended one).
export interface ToStart {
  readonly assignment: AssignmentId
  readonly session:
    | { readonly _tag: 'New' }
    | { readonly _tag: 'Again'; readonly session: SessionId }
}
export type TerminalsToStart = (d: Derived) => ReadonlyArray<ToStart>

// Each session whose owner is Ended, or whose run is Done or Closed, not closed once (C1, S1).
export interface ToClose {
  readonly session: SessionId
  readonly owner:
    | { readonly _tag: 'Agent'; readonly assignment: AssignmentId }
    | { readonly _tag: 'Run'; readonly run: RunId }
}
export type TerminalsToClose = (d: Derived) => ReadonlyArray<ToClose>

// The live terminals whose failures the supervisor retries: owners that are Working, Settled or
// OutOfTries, in runs that are not Done or Closed (C1, S1).
export interface ToWatch {
  readonly session: SessionId
  readonly owner:
    | { readonly _tag: 'Agent'; readonly assignment: AssignmentId }
    | { readonly _tag: 'Run'; readonly run: RunId }
}
export type TerminalsToWatch = (d: Derived) => ReadonlyArray<ToWatch>

// Each send whose SendState is Pending, with the session that it goes to (C5).
export interface PendingSend {
  readonly send: EventRef
  readonly to: SessionId
}
export type SendsPending = (d: Derived) => ReadonlyArray<PendingSend>

