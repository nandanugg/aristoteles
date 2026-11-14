// The input of every act (plan/rebuild/BUILD.md D7, 3.6). Each member has:
//   target  the ids that the act acts on: canAct (core/derived) checks only these;
//   content what only the actor writes or chooses: the action checks it (a Write or Pick choice).
// Intent is an input with no content, made by a mapped type, so there is no second list of acts.
// The CLI and the page decode their input into one ActionInput; the action reads the files that
// a content names (FilePath) through the Files service. Where a content type says "P5 decides",
// the actions package fixes the decoded form (an additive change).
import type { Level } from '../../src/domain/closed.ts'
import type {
  EvidenceData,
  ForwardedAct,
  Line,
  Enter,
  Stop,
  StartReason,
  SupervisorReason,
  DropReason,
  TerminalMove,
} from '../../src/domain/events.ts'
import type { CompanyCheckers, CompanyFolder, ExternalSource, Settings } from '../../src/domain/files.ts'
import type {
  AnswerId,
  AssignmentId,
  DirectionId,
  EscalationId,
  EvaluationId,
  EventRef,
  PermissionId,
  PointId,
  PositiveInt,
  ProblemId,
  QuestionId,
  RejectId,
  ResultId,
  RevisionId,
  RoleName,
  RunId,
  SessionId,
  TaskDraftId,
  TaskId,
  Time,
} from '../../src/domain/ids.ts'
import type { GrantedAct, NonEmpty } from '../../src/domain/model.ts'

// A path that the actor names; the action reads the file.
export type FilePath = string
// Free words of the actor. The action refuses blank words with a Write choice.
export type Words = string
// The random part of a new token (Tokens service); the event keeps only its sha256, and the
// adapter prints the token from the created id and this part.
export type RawSecret = string
// A pane of the person's own tmux server ($TMUX, $TMUX_PANE).
export interface PaneInput {
  readonly session: SessionId
  readonly socket: string
  readonly pane: string
}
// What a suggestion is about, by the key that the person or agent typed (events.ts Suggestion).
export type SuggestAbout =
  | { readonly _tag: 'NewDirection' }
  | { readonly _tag: 'Direction'; readonly direction: DirectionId }
  | { readonly _tag: 'Standard'; readonly key: string }
  | { readonly _tag: 'Rule'; readonly key: string }
// The target of an accept and of a reject.
export type AcceptOf =
  | { readonly _tag: 'Result'; readonly id: ResultId }
  | { readonly _tag: 'Revision'; readonly id: RevisionId }
  | { readonly _tag: 'Evaluation'; readonly id: EvaluationId }
export type RejectOf = AcceptOf | { readonly _tag: 'Task'; readonly id: TaskId }
// Why a draft changes its direction, as typed (P5 decides): --why, one of the five reasons, and
// --why-words. The action makes the stored Why: a reason that is no reason is a Pick refusal, and
// blank words are none given (N5).
export interface WhyInput {
  readonly reason: string | null
  readonly words: Words | null
}
// One --point of a reject, with the rule that it breaks (--breaks), as typed.
export interface PointInput {
  readonly text: Words
  readonly breaks: Words | null
}

type None = { readonly [K in never]: never }
type In<K extends string, T, C> = {
  readonly _tag: K
  readonly target: T
  readonly content: C
}

export type ActionInput =
  // --- the workflow and its config ------------------------------------------------------------
  | In<'DefineWorkflow', None, None> // work init: reads aristoteles.yaml of the dir
  | In<'ApplyConfig', None, None> // work config apply, page accept-roles
  | In<'RestoreConfig', None, None> // work config restore: files only, no event
  | In<'FitRole', { readonly role: RoleName }, { readonly answers: FilePath }>
  // work role draft: the file holds new words of the role, which wait for the person
  | In<'DraftRoleWords', { readonly role: RoleName }, { readonly file: FilePath }>
  // work role accept|reject, page accept-words|reject-words: the person decides a draft of role
  // words by its event; an accept writes the words into aristoteles.yaml and stores them
  | In<'AcceptRoleWords', { readonly draft: EventRef }, None>
  | In<'RejectRoleWords', { readonly draft: EventRef }, { readonly reason: Words }>
  | In<'SaveSettings', None, { readonly settings: Settings }> // page settings: files only
  // --- runs, task drafts, problems, terminals, sends (the UI) ----------------------------------
  | In<'JoinRun', None, { readonly pane: PaneInput }> // work run start
  | In<'ContinueRun', { readonly run: RunId }, { readonly pane: PaneInput; readonly quote: Words }>
  | In<'EndRun', { readonly run: RunId }, None> // work run done, page end
  | In<'CloseRun', { readonly run: RunId }, None> // work run close, page close (after CloseTask)
  // The file holds the task and the role of its Sol (role: <name>), as work task draft reads it.
  | In<'DraftTask', { readonly run: RunId }, { readonly file: FilePath }>
  | In<'RecordProblem', { readonly task: TaskId }, { readonly says: Words }>
  | In<'FixProblem', { readonly problem: ProblemId }, None>
  | In<'WriteHostWords', { readonly on: ProblemId | RevisionId | RunId }, { readonly text: Words; readonly hope: Words | null }>
  | In<'StartSession', { readonly assignment: AssignmentId }, { readonly session: SessionId; readonly secret: RawSecret | null }>
  // work event, and the watcher: a failure after three tries, a prompt, a close.
  | In<'ReportTerminal', { readonly session: SessionId }, { readonly move: Extract<typeof TerminalMove.Type, { readonly _tag: 'Failed' | 'Prompted' | 'Closed' }> }>
  | In<'StopTerminal', { readonly session: SessionId }, None> // page stop
  | In<'ResumeTerminal', { readonly session: SessionId }, { readonly tier: 'sol' | 'terra' }> // page resume
  | In<'Send', { readonly session: SessionId }, { readonly keys: typeof Line.Type | typeof Enter.Type }> // work send
  | In<'SupervisorSend', { readonly reason: typeof StartReason.Type | typeof SupervisorReason.Type }, { readonly keys: typeof Line.Type | typeof Enter.Type | { readonly _tag: 'StartPrompt' } }>
  | In<'SendDelivered', { readonly send: EventRef }, None>
  | In<'SendDropped', { readonly send: EventRef }, { readonly why: typeof DropReason.Type }>
  // --- tasks ------------------------------------------------------------------------------------
  | In<'OpenTask', None, { readonly file: FilePath }>
  | In<'OpenTaskFromDraft', { readonly draft: TaskDraftId }, None>
  | In<'SplitTask', { readonly task: TaskId; readonly answers: RejectId | PointId | null }, { readonly file: FilePath }>
  | In<'RemakeTask', { readonly task: TaskId; readonly answers: RejectId | PointId | null }, { readonly file: FilePath; readonly reason: Words }>
  | In<'CloseTask', { readonly task: TaskId }, { readonly reason: Words }>
  | In<'DescribeTask', { readonly task: TaskId }, { readonly text: Words }>
  // --- assignments --------------------------------------------------------------------------------
  | In<'Give', { readonly task: TaskId; readonly role: RoleName }, { readonly maxAttempts: PositiveInt | null; readonly secret: RawSecret }>
  | In<'Free', { readonly assignment: AssignmentId }, None>
  | In<'Finish', { readonly assignment: AssignmentId }, None>
  | In<'Brief', { readonly assignment: AssignmentId }, None>
  // --- work, reviews, questions, notes ----------------------------------------------------------
  // madeFrom: the words of --made-from (P5 decides the decoded form; N4 reads git itself).
  | In<'Report', { readonly assignment: AssignmentId }, { readonly output: Words; readonly madeFrom: ReadonlyArray<Words> }>
  | In<'Accept', { readonly of: AcceptOf }, { readonly evidence: ReadonlyArray<typeof EvidenceData.Type>; readonly reason: Words | null }>
  // points for a result or a task; reason for a draft or an evaluation (P5 decides the split).
  | In<'Reject', { readonly of: RejectOf }, { readonly points: ReadonlyArray<PointInput>; readonly reason: Words | null }>
  | In<'Recheck', { readonly result: ResultId }, { readonly reason: Words }>
  | In<'EscalateResult', { readonly result: ResultId }, { readonly reason: Words }>
  | In<'EscalateTask', { readonly task: TaskId }, { readonly reason: Words }> // a maker sends its task up
  | In<'Resolve', { readonly escalation: EscalationId }, { readonly resolution: Words; readonly evidence: ReadonlyArray<typeof EvidenceData.Type> }>
  | In<'Ask', { readonly to: 'Above' | 'Owner' }, { readonly text: Words }>
  | In<'Answer', { readonly question: QuestionId }, { readonly text: Words }>
  | In<'Note', { readonly task: TaskId }, { readonly kind: 'Message' | 'Finding'; readonly text: Words }>
  | In<'Evaluate', { readonly stop: typeof Stop.Type }, { readonly wrong: Words; readonly why: Words; readonly improve: NonEmpty<Words>; readonly level: Level }>
  | In<'Checkpoint', { readonly task: TaskId }, { readonly next: Words }>
  | In<'ReadSource', { readonly name: string }, { readonly revision: string }>
  // --- directions, suggestions, permissions -----------------------------------------------------
  | In<'DraftDirection', None, { readonly file: FilePath; readonly answers: ReadonlyArray<AnswerId>; readonly why: WhyInput }>
  | In<'ReviseDirection', { readonly direction: DirectionId }, { readonly file: FilePath; readonly answers: ReadonlyArray<AnswerId>; readonly why: WhyInput }>
  | In<'ImportCompany', { readonly direction: DirectionId }, { readonly source: typeof ExternalSource.Type; readonly folder: typeof CompanyFolder.Type; readonly owner: string; readonly checkers: typeof CompanyCheckers.Type }>
  | In<'Suggest', { readonly about: SuggestAbout }, { readonly says: Words }>
  | In<'Grant', { readonly act: GrantedAct; readonly to: RoleName }, { readonly until: Time }>
  | In<'Revoke', { readonly permission: PermissionId }, None>
  // --- forwards -----------------------------------------------------------------------------------
  // The inner act is the target: canAct checks the act that the person would do.
  | In<'Forward', { readonly act: ForwardedAct }, { readonly person: string; readonly quote: Words; readonly channel: 'chat' | 'github' }>
  | In<'Confirm', { readonly forward: EventRef }, None>

export type ActionTag = ActionInput['_tag']
export type InputOf<K extends ActionTag> = Extract<ActionInput, { readonly _tag: K }>

// An act with no content: what canAct checks, and what a step of nextFor offers.
export type Intent = {
  readonly [K in ActionTag]: { readonly _tag: K; readonly target: InputOf<K>['target'] }
}[ActionTag]

export const intentOf = (input: ActionInput): Intent =>
  ({ _tag: input._tag, target: input.target }) as Intent
