// The stored events, grouped by the record that they happen to (the owner's rulings, 2026-11-12):
//   - a creation goes under the record that it creates: { _tag: 'Task', create: Opened{...} };
//   - a move goes under the record that it moves, which it names once, by its id: { _tag:
//     'Task', id: 't3', move: Closed{...} }; the moves of a record are its <Record>Move union,
//     in the past tense, and each has its typed transition (domain/moves.ts);
//   - a record that is written once (a review, a result, a note...) is a creation only.
// What is stored is what the actor wrote (its written input): the fold makes the id (one counter,
// no stored id of a new record), the clock, when (the event's time), by (the author), under (the
// snapshot), and every record that follows from the act (the parts of a split, the new task of a
// remake, a version, a lesson, an exhaustion); it maps the words of a file to the records (a rule
// named by its key becomes its entry). Every key is present: null is "none given", and a value
// that only some acts have is its own member. A refusal never comes from the replay: every event
// was checked when it was written; the fold checks the kind of each stored reference that two
// kinds share a pattern for (an escalation, a resolve, a reject).
import { Schema } from 'effect'
import { Author } from './actor.ts'
import { Level, Reason } from './closed.ts'
import {
  CompanyCheckers,
  CompanyFolder,
  ConfigFile,
  ContextFile,
  DirectionFile,
  ExternalSource,
  PartFile,
  ReviseFile,
  RoleWords,
  Snapshot,
  type TaskFile,
  type TaskFileKey,
  type Workspace,
} from './files.ts'
import {
  AnswerId,
  AssignmentId,
  DirectionId,
  EscalationId,
  EvaluationId,
  EventRef,
  ExhaustionId,
  NonBlank,
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
} from './ids.ts'

const Text = Schema.String
const NonEmpty = Schema.NonEmptyArray

// Evidence and points as the CLI writes them: a rule by its key in the official version of that
// time (the fold finds its entry). null: the line or the point names no rule.
export const EvidenceData = Schema.Struct({ rule: Schema.NullOr(Text), where: Text, what: Text })
export type EvidenceData = typeof EvidenceData.Type
export const PointData = Schema.Struct({ text: NonBlank, breaks: Schema.NullOr(Text) })
export type PointData = typeof PointData.Type
// A point of a Reject of a task: a task has no rule to break.
export const TaskPointData = Schema.Struct({ text: NonBlank })
export type TaskPointData = typeof TaskPointData.Type

// What a report made: a file or one section of it (its digest and its size), or a commit (its
// tree as the digest, and its change as git patch-id names it, so that a rebase is the same work).
export const ReportedWork = Schema.Union([
  Schema.TaggedStruct('File', { digest: Text, size: Schema.Number }),
  Schema.TaggedStruct('Commit', { digest: Text, patch: Text }),
])
export type ReportedWork = typeof ReportedWork.Type

// page: Source. A source and its revision (the owner's ruling, 2026-11-12): a git source of a
// task's workspace at a commit (the CLI reads it from git, so it never expires), or an outside
// source at the revision that an agent read (work source). name: the source of a workspace,
// or the name of the outside source. When an outside source was seen is the time of the stored
// act that named it or checked it (derived.ts sourceStateOf), so no source keeps a time.
export const Git = Schema.TaggedStruct('Git', { name: Text, commit: Text })
export const Outside = Schema.TaggedStruct('Outside', { name: Text, revision: Text })
export const SourceSchema = Schema.Union([Git, Outside])
export const MadeFrom = Schema.Union([
  SourceSchema,
  Schema.TaggedStruct('Result', { result: ResultId }),
])

// A place of a task's workspace, as a task stores it: a repo has its base; verify: null, none.
export const WorkspaceData = Schema.Union([
  Schema.TaggedStruct('Files', { source: Text, path: Text, verify: Schema.NullOr(Text) }),
  Schema.TaggedStruct('Repo', {
    source: Text,
    path: Text,
    base: Text,
    verify: Schema.NullOr(Text),
  }),
])
export type WorkspaceData = typeof WorkspaceData.Type
// A task as it is opened (from its file, or a host's task draft). from: null, no starting point.
export const TaskData = Schema.Struct({
  name: Text,
  text: Text,
  directions: Schema.Array(DirectionId),
  context: ContextFile,
  needs: Schema.Array(TaskId),
  from: Schema.NullOr(ResultId),
  workspace: Schema.Array(WorkspaceData),
  references: Schema.Array(Text),
})
export type TaskData = typeof TaskData.Type
// A remake names a key of its file, or keeps the old task's value of it.
const keepOr = <S extends Schema.Top>(value: S) =>
  Schema.Union([Schema.TaggedStruct('Keep', {}), Schema.TaggedStruct('Set', { value })])
export const RemakeData = Schema.Struct({
  name: Text,
  text: Text,
  references: Schema.Array(Text),
  from: Schema.NullOr(ResultId),
  directions: keepOr(Schema.Array(DirectionId)),
  context: keepOr(ContextFile),
  needs: keepOr(Schema.Array(TaskId)),
  workspace: keepOr(Schema.Array(WorkspaceData)),
})
export type RemakeData = typeof RemakeData.Type

// A task file as an event stores it: a remake keeps each key that its file does not name.
const workspaceDataOf = (w: Workspace): WorkspaceData =>
  w.base === undefined
    ? { _tag: 'Files', source: w.source, path: w.path, verify: w.verify ?? null }
    : { _tag: 'Repo', source: w.source, path: w.path, base: w.base, verify: w.verify ?? null }
export const taskDataOf = (file: TaskFile): TaskData => ({
  name: file.name,
  text: file.text,
  directions: file.directions,
  context: file.context,
  needs: file.needs,
  from: file.from ?? null,
  workspace: file.workspace.map(workspaceDataOf),
  references: file.references,
})
export const remakeDataOf = (file: TaskFile): RemakeData => {
  const set = <A>(key: TaskFileKey, value: A) =>
    file.named.includes(key) ? { _tag: 'Set' as const, value } : { _tag: 'Keep' as const }
  return {
    name: file.name,
    text: file.text,
    references: file.references,
    from: file.from ?? null,
    directions: set('directions', file.directions),
    context: set('context', file.context),
    needs: set('needs', file.needs),
    workspace: set('workspace', file.workspace.map(workspaceDataOf)),
  }
}

// The two forms of an event of a group: a creation, and a move of one record by its id.
const created = <G extends string, C extends Schema.Top>(group: G, create: C) =>
  Schema.TaggedStruct(group, { create })
const moved = <G extends string, I extends Schema.Top, M extends Schema.Top>(
  group: G,
  id: I,
  move: M,
) => Schema.TaggedStruct(group, { id, move })
const Failure = Schema.Literals(['ended', 'error', 'silent'])

// --- the workflow, roles, runs, terminals and sends ---------------------------------------------

// work init (old config), and later changes of the words of roles (old config.text). A dir has
// one workflow: its move names no id.
export const WorkflowMove = Schema.Union([
  Schema.TaggedStruct('RoleWordsChanged', {
    roles: Schema.Record(Text, RoleWords),
    hashes: Schema.Record(Text, Text),
    texts: Schema.Record(Text, Text),
  }),
])
const Workflow = Schema.Union([
  created(
    'Workflow',
    Schema.TaggedStruct('Defined', {
      config: ConfigFile,
      hashes: Schema.Record(Text, Text),
      texts: Schema.Record(Text, Text),
    }),
  ),
  Schema.TaggedStruct('Workflow', { move: WorkflowMove }),
])
// The fit of a role (work role fit): the latest one counts. It holds the answer to each question
// of guides/fitness.yaml (its id): a yes with its why, as the CLI records a fit only then.
export const FitAnswer = Schema.Struct({
  id: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
  yes: Schema.Literal(true),
  why: NonBlank,
})
export const RoleMove = Schema.Union([
  Schema.TaggedStruct('Fitted', { hash: Text, answers: NonEmpty(FitAnswer) }),
])
const Role = moved('Role', RoleName, RoleMove)
// A run of the UI (work run start, done, close).
export const RunMove = Schema.Union([
  Schema.TaggedStruct('Done', {}),
  Schema.TaggedStruct('Closed', {}),
])
// A run starts as a host (it talks with the person and drafts the top task) or as the assess
// skill (it reads the dir and drafts directions); the CLI word: --kind=host|assess.
const Run = Schema.Union([
  created(
    'Run',
    Schema.Union([
      Schema.TaggedStruct('HostStarted', { session: SessionId }),
      Schema.TaggedStruct('AssessStarted', { session: SessionId }),
    ]),
  ),
  moved('Run', RunId, RunMove),
])
// A top task that a host drafts; the person opens it (a creation of the Task).
const TaskDraft = created(
  'TaskDraft',
  Schema.TaggedStruct('Drafted', { run: RunId, task: TaskData, role: RoleName }),
)
export const ProblemMove = Schema.Union([Schema.TaggedStruct('Fixed', {})])
const Problem = Schema.Union([
  created('Problem', Schema.TaggedStruct('Recorded', { stopped: TaskId, says: NonBlank })),
  moved('Problem', ProblemId, ProblemMove),
])
// The terminal of a session (work session, work event), by its id. Started: the UI gives the
// terminal to an agent, with a new token (the old one stops working; null: it keeps its token).
// A failure is always after three tries; a prompt shows its line; the other moves have no words.
export const TerminalMove = Schema.Union([
  Schema.TaggedStruct('Started', { for: AssignmentId, secret: Schema.NullOr(Text) }),
  Schema.TaggedStruct('Failed', { why: Failure, lastLines: Text }),
  Schema.TaggedStruct('Prompted', { line: Text }),
  Schema.TaggedStruct('Stopped', {}),
  Schema.TaggedStruct('Resumed', {}),
  Schema.TaggedStruct('Closed', {}),
])
const Terminal = moved('Terminal', SessionId, TerminalMove)
// Every text that goes into a terminal (ui-model.ts Send). A destination fixes its way in; a
// reason that names its terminal (a host's) has none, so that the two cannot disagree. The keys
// of a start prompt hold a token, so they are made when typed, never stored.
export const Destination = Schema.TaggedStruct('Terminal', {
  session: SessionId,
  via: Schema.TaggedStruct('Tmux', {}),
})
export const WakeCause = Schema.Union([
  Schema.TaggedStruct('ChildActed', { child: AssignmentId }),
  Schema.TaggedStruct('QuestionAnswered', { question: QuestionId }),
  Schema.TaggedStruct('EscalationReviewed', { review: EventRef, escalation: EscalationId }),
  Schema.TaggedStruct('NeedAccepted', { review: EventRef, needer: TaskId }),
  Schema.TaggedStruct('PersonDecided', { review: EventRef }),
  Schema.TaggedStruct('QuestionWaits', { question: QuestionId }),
])
const Typed = Schema.TaggedStruct('Typed', {})
// The first input of a new terminal: typed when it is quiet, or given to its launch command.
export const StartReason = Schema.TaggedStruct('Start', {
  to: Destination,
  via: Schema.Union([Typed, Schema.TaggedStruct('LaunchArgument', {})]),
})
// Every other reason of the supervisor: its keys are a line or Enter.
export const SupervisorReason = Schema.Union([
  Schema.TaggedStruct('Wake', {
    to: Destination,
    cause: Schema.Union([
      Schema.TaggedStruct('Acted', { by: NonEmpty(WakeCause) }),
      Schema.TaggedStruct('NextChanged', {}),
    ]),
  }),
  // To the host of the agent: its prompt, or its failure, as the stored terminal move.
  Schema.TaggedStruct('AgentAtPrompt', { prompt: EventRef }),
  Schema.TaggedStruct('AgentFailed', { failure: EventRef }),
  // To the host of the decision's tree: write its words.
  Schema.TaggedStruct('DecisionNeedsWords', {
    decision: Schema.Union([ProblemId, RevisionId, RunId]),
  }),
  // To the host of the problem's task: try it again.
  Schema.TaggedStruct('ProblemRetry', { problem: ProblemId }),
  // The host's prompt after the person opens its task draft: into the terminal of its run.
  Schema.TaggedStruct('DraftOpened', { draft: TaskDraftId }),
  // The retry input of a failed terminal, try 1 to 3: typed, or given to the resume command.
  Schema.TaggedStruct('Retry', {
    to: Destination,
    attempt: Schema.Literals([1, 2, 3]),
    via: Schema.Union([Typed, Schema.TaggedStruct('ResumeArgument', {})]),
  }),
])
// Why a send never reached its terminal (ui/watcher.js and ui/pump.js today).
export const DropReason = Schema.Union([
  Schema.TaggedStruct('TerminalNotLive', {}), // its pane is not running (closed, or exited)
  Schema.TaggedStruct('StoppedByPerson', {}), // no input goes into a stopped terminal
  Schema.TaggedStruct('BeforeRestart', {}), // sent before the supervisor started (not typed late)
  Schema.TaggedStruct('NotReadyInTime', {}), // not quiet within 90 s
  Schema.TaggedStruct('TypingFailed', {}), // the pump could not type it
  Schema.TaggedStruct('Merged', { into: EventRef }), // one wake took its cause along
])
export const SendMove = Schema.Union([
  Schema.TaggedStruct('Delivered', {}),
  Schema.TaggedStruct('Dropped', { why: DropReason }),
])
// What is typed: a line then Enter, Enter alone (the default answer of a prompt), or the tier's
// start words with the agent's token (made when typed: the store never keeps a token). Only a
// start sends the start words, and a start sends nothing else.
export const Line = Schema.TaggedStruct('Line', { text: NonBlank })
export const Enter = Schema.TaggedStruct('Enter', {})
export const StartPrompt = Schema.TaggedStruct('StartPrompt', {})
const Send = Schema.Union([
  created(
    'Send',
    Schema.Union([
      // work send: a host's input for the terminal of its child; the author is the sender.
      Schema.TaggedStruct('Sent', {
        from: Schema.TaggedStruct('Agent', { to: Destination }),
        keys: Schema.Union([Line, Enter]),
      }),
      Schema.TaggedStruct('Sent', {
        from: Schema.TaggedStruct('Supervisor', { reason: StartReason }),
        keys: StartPrompt,
      }),
      Schema.TaggedStruct('Sent', {
        from: Schema.TaggedStruct('Supervisor', { reason: SupervisorReason }),
        keys: Schema.Union([Line, Enter]),
      }),
    ]),
  ),
  // The Sent event names the send.
  moved('Send', EventRef, SendMove),
])
// The host's words about a decision for the person (work note words): the latest counts. Only a
// direction change has a hope.
const HostWords = created(
  'HostWords',
  Schema.Union([
    Schema.TaggedStruct('ProblemWords', { on: ProblemId, text: NonBlank }),
    Schema.TaggedStruct('DraftWords', {
      on: RevisionId,
      text: NonBlank,
      hope: Schema.NullOr(Text),
    }),
    Schema.TaggedStruct('EndWords', { on: RunId, text: NonBlank }),
  ]),
)

// --- tasks, assignments, results -----------------------------------------------------------

// review: the Reject (or one point) that a remake or a split answers; null: none. A remake and a
// split are moves of the task: the fold makes the new task and the parts.
const Answered = Schema.NullOr(Schema.Union([RejectId, PointId]))
export const TaskMove = Schema.Union([
  Schema.TaggedStruct('Remade', { file: RemakeData, reason: NonBlank, review: Answered }),
  Schema.TaggedStruct('Split', { parts: NonEmpty(PartFile), review: Answered }),
  Schema.TaggedStruct('Closed', { reason: NonBlank }),
  // The person writes the description of a task for people (work task describe).
  Schema.TaggedStruct('Described', { text: NonBlank }),
])
const Task = Schema.Union([
  created(
    'Task',
    Schema.Union([
      Schema.TaggedStruct('Opened', { task: TaskData }),
      // The person opens the top task that a host drafted.
      Schema.TaggedStruct('OpenedFromDraft', { draft: TaskDraftId }),
    ]),
  ),
  moved('Task', TaskId, TaskMove),
])
// A brief is plain, a low checker's (it names the result that it reviews), or the first brief of
// a maker's task (how its files looked, and for a maker that writes in place, their text).
export const AssignmentMove = Schema.Union([
  Schema.TaggedStruct('Briefed', {}),
  Schema.TaggedStruct('BriefedToCheck', { result: ResultId }),
  Schema.TaggedStruct('BriefedFirst', {
    untouched: Schema.Record(Text, Snapshot),
    before: Schema.Union([
      Schema.TaggedStruct('NotInPlace', {}),
      Schema.TaggedStruct('InPlace', { texts: Schema.Record(Text, Text) }),
    ]),
  }),
  // A parent frees the claim of a child (the CLI word: free).
  Schema.TaggedStruct('Freed', {}),
  Schema.TaggedStruct('Finished', {}),
])
// An assignment is given as a maker (its role has a Do act; maxAttempts null: the role's limit)
// or as a reviewer, which has no attempts (PLAN bug 3). Who gave it is its author: an agent
// gives a child; the person, or the CLI for a program, gives an assignment with no parent.
const Assignment = Schema.Union([
  created(
    'Assignment',
    Schema.Union([
      Schema.TaggedStruct('GivenMaker', {
        task: TaskId,
        role: RoleName,
        secret: Text,
        maxAttempts: Schema.NullOr(PositiveInt),
      }),
      Schema.TaggedStruct('GivenReviewer', { task: TaskId, role: RoleName, secret: Text }),
    ]),
  ),
  moved('Assignment', AssignmentId, AssignmentMove),
])
// A report: one attempt of its author. after: an in-place maker's files as the report left
// them; null: not an in-place maker.
const Result = created(
  'Result',
  Schema.TaggedStruct('Result', {
    output: Text,
    madeFrom: Schema.Array(MadeFrom),
    work: ReportedWork,
    files: Schema.Array(Text),
    after: Schema.NullOr(Schema.Record(Text, Text)),
  }),
)

// --- reviews, questions, notes, evaluations --------------------------------------------------

// The targets of an accept and of a reject, each with its own fields (model.ts Review).
const AcceptOfResult = Schema.TaggedStruct('Result', {
  id: ResultId,
  evidence: NonEmpty(EvidenceData),
})
// The person's accept of a draft needs no evidence.
const AcceptOfRevision = Schema.TaggedStruct('Revision', {
  id: RevisionId,
  evidence: Schema.Array(EvidenceData),
})
const AcceptOfEvaluation = Schema.TaggedStruct('Evaluation', {
  id: EvaluationId,
  evidence: NonEmpty(EvidenceData),
})
const RejectOfResult = Schema.TaggedStruct('Result', { id: ResultId, points: NonEmpty(PointData) })
const RejectOfTask = Schema.TaggedStruct('Task', { id: TaskId, points: NonEmpty(TaskPointData) })
const RejectOfRevision = Schema.TaggedStruct('Revision', { id: RevisionId, reason: NonBlank })
const RejectOfEvaluation = Schema.TaggedStruct('Evaluation', {
  id: EvaluationId,
  reason: NonBlank,
})
const reason = Schema.NullOr(Text) // a comment; only words read it
const accept = <S extends Schema.Top>(of: S) => Schema.TaggedStruct('Accept', { of, reason })
const reject = <S extends Schema.Top>(of: S) => Schema.TaggedStruct('Reject', { of })
// A Resolve ends one escalation (the CLI word: resolve) with an agreement or a direction in
// words; it has no verdict on the result.
const Resolve = Schema.TaggedStruct('Resolve', {
  escalation: EscalationId,
  resolution: NonBlank,
  evidence: Schema.Array(EvidenceData),
})
export const ReviewWritten = Schema.Union([
  accept(Schema.Union([AcceptOfResult, AcceptOfRevision, AcceptOfEvaluation])),
  reject(Schema.Union([RejectOfResult, RejectOfTask, RejectOfRevision, RejectOfEvaluation])),
  // work recheck: a Reject that any later result answers.
  Schema.TaggedStruct('Recheck', { of: ResultId, reason: NonBlank }),
  // The CLI word: escalate --result. Its answerer is derived from the author: the nearest open
  // assignment above, else the owner, at each time.
  Schema.TaggedStruct('Escalate', { of: ResultId, reason: NonBlank }),
  Resolve,
])
export type ReviewWritten = typeof ReviewWritten.Type
const Review = created('Review', ReviewWritten)
// Who an agent's question goes to, first: Above, the nearest open assignment above, else the
// owner, and in a project of the UI the host in the owner's place (work ask); Owner, the owner
// (--to=owner). Its answerer is derived: it moves up as the one it went to finishes.
const Asked = Schema.TaggedStruct('Asked', {
  text: NonBlank,
  to: Schema.Union([Schema.TaggedStruct('Above', {}), Schema.TaggedStruct('Owner', {})]),
})
// The person's question to an agent: only forwarded (the old person.ask, only in a forward).
const AskedOfAgent = Schema.TaggedStruct('Asked', {
  text: NonBlank,
  to: Schema.TaggedStruct('Agent', { assignment: AssignmentId }),
})
export const QuestionMove = Schema.Union([Schema.TaggedStruct('Answered', { text: NonBlank })])
const Question = Schema.Union([
  created(
    'Question',
    Schema.Union([
      Asked,
      // The CLI word: escalate with no result. A maker sends its blocked task up: it stops the
      // maker's task, goes to the nearest open assignment above, else the owner (never the
      // host), and ends the maker's unit.
      Schema.TaggedStruct('Escalated', { text: NonBlank }),
    ]),
  ),
  moved('Question', QuestionId, QuestionMove),
])
// A message and a finding are about a task (the person's comment is a message).
const Message = Schema.TaggedStruct('Message', { about: TaskId, text: NonBlank })
const Note = created(
  'Note',
  Schema.Union([Message, Schema.TaggedStruct('Finding', { about: TaskId, text: NonBlank })]),
)
// What stops a task until an evaluation answers it, by its kind: the last try of a maker, or a
// Reject of the person (as a whole, or one point of it).
export const Stop = Schema.Union([
  Schema.TaggedStruct('Exhaustion', { id: ExhaustionId }),
  Schema.TaggedStruct('PersonReject', { id: Schema.Union([RejectId, PointId]) }),
])
const Evaluation = created(
  'Evaluation',
  Schema.TaggedStruct('Evaluation', {
    stop: Stop,
    wrong: NonBlank,
    why: NonBlank,
    improve: NonEmpty(NonBlank),
    level: Level,
  }),
)
// A suggestion about a direction, a standard or a rule by its key, or about nothing (a new
// direction); the fold finds the entry of the key in the official versions of that time.
const Suggestion = created(
  'Suggestion',
  Schema.TaggedStruct('Suggestion', {
    about: Schema.Union([
      Schema.TaggedStruct('NewDirection', {}),
      Schema.TaggedStruct('Direction', { direction: DirectionId }),
      Schema.TaggedStruct('Standard', { key: Text }),
      Schema.TaggedStruct('Rule', { key: Text }),
    ]),
    says: NonBlank,
  }),
)

// --- drafts of directions, permissions, sources, checkpoints, forwards ---------------------------

// page: Revision.why (the owner's ruling, 2026-11-12): none given, or one of the five reasons
// (the CLI word --why) with the reviser's words or none (--why-words).
export const Why = Schema.Union([
  Schema.TaggedStruct('NoneGiven', {}),
  Schema.TaggedStruct('Given', { reason: Reason, words: Schema.NullOr(NonBlank) }),
])
// A draft (a Revision) of a direction: the whole of a new one (the CLI word: direction new), a
// change of its current version (direction revise), or a commit of a company direction (the
// daily refresh). Its state (waiting, vetoed, official) follows from the reviews.
const Revision = created(
  'Revision',
  Schema.Union([
    Schema.TaggedStruct('Drafted', {
      direction: DirectionFile,
      answers: Schema.Array(AnswerId),
      why: Why,
    }),
    Schema.TaggedStruct('Revised', {
      direction: DirectionId,
      edit: ReviseFile,
      answers: Schema.Array(AnswerId),
      why: Why,
    }),
    Schema.TaggedStruct('Imported', {
      direction: DirectionId,
      source: ExternalSource,
      folder: CompanyFolder,
      owner: Text,
      checkers: CompanyCheckers,
    }),
  ]),
)
// The act that a permission gives (every act but Do; the CLI word: grant --act).
export const GrantedAct = Schema.Union([
  Schema.TaggedStruct('Review', { resultsOf: Schema.Array(RoleName) }),
  Schema.TaggedStruct('Approve', { resultsOf: Schema.Array(RoleName) }),
  Schema.TaggedStruct('Change', { changesOf: Schema.Array(Schema.Union([DirectionId, TaskId])) }),
])
export const PermissionMove = Schema.Union([Schema.TaggedStruct('Revoked', {})])
const Permission = Schema.Union([
  created(
    'Permission',
    Schema.TaggedStruct('Granted', { act: GrantedAct, to: RoleName, until: Time }),
  ),
  moved('Permission', PermissionId, PermissionMove),
])
// An agent reads an outside source (work source): a new revision is a Moved; the same revision
// again is a Checked of the source by its name, which only renews when it was seen.
export const SourceMove = Schema.Union([Schema.TaggedStruct('Checked', {})])
const Source = Schema.Union([
  created('Source', Schema.TaggedStruct('Moved', { source: Outside })),
  moved('Source', Text, SourceMove),
])
const Checkpoint = created(
  'Checkpoint',
  Schema.TaggedStruct('Checkpoint', { task: TaskId, next: NonBlank }),
)

// What the top agent may forward for the person, as the act: two lists, one member per act. An
// act that stops work or informs counts at once (a reject, a question, a comment); an act that
// moves work on waits for the person's confirm (an accept, a resolve, an answer).
export const CountedAct = Schema.Union([
  created('Review', reject(Schema.Union([RejectOfResult, RejectOfTask, RejectOfRevision]))),
  created('Question', AskedOfAgent),
  created('Note', Message),
])
export type CountedAct = typeof CountedAct.Type
export const ConfirmableAct = Schema.Union([
  created('Review', accept(Schema.Union([AcceptOfResult, AcceptOfRevision]))),
  created('Review', Resolve),
  moved('Question', QuestionId, QuestionMove),
])
export type ConfirmableAct = typeof ConfirmableAct.Type
export const ForwardedAct = Schema.Union([...CountedAct.members, ...ConfirmableAct.members])
export type ForwardedAct = typeof ForwardedAct.Type
export const ForwardMove = Schema.Union([Schema.TaggedStruct('Confirmed', {})])
// The person's act, by the top agent with the person's exact words (the CLI words: forward and
// confirm, which names the forward by its event). The person is a person of aristoteles.yaml.
const Forward = Schema.Union([
  created(
    'Forward',
    Schema.TaggedStruct('Forwarded', {
      person: Text,
      quote: NonBlank,
      channel: Schema.Literals(['chat', 'github']),
      inner: ForwardedAct,
    }),
  ),
  moved('Forward', EventRef, ForwardMove),
])

// --- every event --------------------------------------------------------------------------------

export const Event = Schema.Union([
  ...Workflow.members,
  Role,
  ...Run.members,
  TaskDraft,
  ...Problem.members,
  Terminal,
  ...Send.members,
  HostWords,
  ...Task.members,
  ...Assignment.members,
  Result,
  Review,
  ...Question.members,
  Note,
  Evaluation,
  Suggestion,
  Revision,
  ...Permission.members,
  ...Source.members,
  Checkpoint,
  ...Forward.members,
])
export type Event = typeof Event.Type
// The record that an event happens to.
export type EventGroup = Event['_tag']
export type GroupOf<G extends EventGroup> = Extract<Event, { readonly _tag: G }>
// The data of an event: its creation, or its move.
type DataOf<E> = E extends { readonly create: infer D }
  ? D
  : E extends { readonly move: infer D }
    ? D
    : never
export type CreateOf<G extends EventGroup> = Extract<GroupOf<G>, { readonly create: unknown }>
export type MoveOf<G extends EventGroup> = Extract<GroupOf<G>, { readonly move: unknown }>
export type MoveTag<G extends EventGroup> = DataOf<MoveOf<G>> extends { readonly _tag: infer T }
  ? T
  : never
// Every kind of event, as its group and its member: 'Task.Opened', 'Review.Accept'.
export type Kind = {
  [G in EventGroup]: DataOf<GroupOf<G>> extends { readonly _tag: infer T extends string }
    ? `${G}.${T}`
    : never
}[EventGroup]
// A table with one entry per kind: a new kind fails the compile of each table until it has one.
export type Total<V> = { readonly [K in Kind]: V }
// The event of one kind: its creation, or its move with the id of the record that it moves.
type CreateData<G extends EventGroup> = DataOf<CreateOf<G>>
type MoveData<G extends EventGroup> = DataOf<MoveOf<G>>
// One event per member of the data, so that a pair of the data (a sender and its keys) stays one.
type Created<G extends EventGroup, M> =
  Extract<CreateData<G>, { readonly _tag: M }> extends infer D
    ? D extends unknown
      ? { readonly _tag: G; readonly create: D }
      : never
    : never
// A move keeps the form of its group: with the id of the record, or none (the one workflow).
type Moved<G extends EventGroup, M> = [Extract<MoveData<G>, { readonly _tag: M }>] extends [never]
  ? never
  : Omit<MoveOf<G>, 'move'> & { readonly move: Extract<MoveData<G>, { readonly _tag: M }> }
export type EventOf<K extends Kind> = K extends `${infer G extends EventGroup}.${infer M}`
  ? Created<G, M> | Moved<G, M>
  : never

// A forwarded act is an event of its own kind too (the person's question to an agent is a
// Question.Asked that only a forward holds).
export const dataOf = (event: Event | ForwardedAct): { readonly _tag: string } =>
  'create' in event ? event.create : event.move
export const memberOf = (event: Event | ForwardedAct): string => dataOf(event)._tag
export const kindOf = (event: Event | ForwardedAct): Kind =>
  `${event._tag}.${memberOf(event)}` as Kind

// Builders: create('Task', { _tag: 'Opened', ... }), move('Task', id, { _tag: 'Closed', ... }).
export const create = <G extends EventGroup>(
  group: G,
  data: DataOf<CreateOf<G>>,
): GroupOf<G> => ({ _tag: group, create: data }) as unknown as GroupOf<G>
export const move = <G extends EventGroup>(
  group: G,
  id: MoveOf<G> extends { readonly id: infer I } ? I : never,
  data: DataOf<MoveOf<G>>,
): GroupOf<G> => ({ _tag: group, id, move: data }) as unknown as GroupOf<G>

// --- who writes each kind -----------------------------------------------------------------------

// The kinds that each author writes (the CLI's writers, and the who and channel of each old act):
// one table, so that a refresh accepts no result and a model run records no problem. The store
// keeps no other pair.
export const WRITTEN_BY = {
  // An agent by its token; GUARD (src/cli/guard.ts) has one row for each.
  Agent: [
    'Role.Fitted',
    'Problem.Recorded',
    'Problem.Fixed',
    'Send.Sent',
    'HostWords.ProblemWords',
    'HostWords.DraftWords',
    'HostWords.EndWords',
    'Task.Remade',
    'Task.Split',
    'Task.Closed',
    'Assignment.GivenMaker',
    'Assignment.GivenReviewer',
    'Assignment.Briefed',
    'Assignment.BriefedToCheck',
    'Assignment.BriefedFirst',
    'Assignment.Freed',
    'Assignment.Finished',
    'Result.Result',
    'Review.Accept',
    'Review.Reject',
    'Review.Recheck',
    'Review.Escalate',
    'Review.Resolve',
    'Question.Asked',
    'Question.Escalated',
    'Question.Answered',
    'Note.Message',
    'Note.Finding',
    'Evaluation.Evaluation',
    'Suggestion.Suggestion',
    'Revision.Drafted',
    'Revision.Revised',
    'Permission.Granted',
    'Permission.Revoked',
    'Source.Moved',
    'Source.Checked',
    'Checkpoint.Checkpoint',
    'Forward.Forwarded',
  ],
  // A check program's review.
  Program: ['Review.Accept', 'Review.Reject'],
  // The person at a terminal or on the page.
  Person: [
    'Workflow.Defined',
    'Workflow.RoleWordsChanged',
    'Role.Fitted',
    'Run.HostStarted',
    'Run.AssessStarted',
    'Run.Done',
    'Run.Closed',
    'Problem.Recorded',
    'Problem.Fixed',
    'Terminal.Stopped',
    'Terminal.Resumed',
    'Task.Opened',
    'Task.OpenedFromDraft',
    'Task.Remade',
    'Task.Split',
    'Task.Closed',
    'Task.Described',
    'Assignment.GivenMaker',
    'Assignment.GivenReviewer',
    'Assignment.Freed',
    'Assignment.Finished',
    'Review.Accept',
    'Review.Reject',
    'Review.Resolve',
    'Question.Answered',
    'Evaluation.Evaluation',
    'Suggestion.Suggestion',
    'Permission.Granted',
    'Permission.Revoked',
    'Forward.Confirmed',
  ],
  // A host run before it has an assignment: its task draft.
  Host: ['TaskDraft.Drafted'],
  // A model run outside any task: its draft of a new direction.
  ModelRun: ['Revision.Drafted'],
  // The CLI's own assign and finish of a program.
  System: ['Assignment.GivenReviewer', 'Assignment.Finished'],
  // The supervisor of the terminals: its sessions, what it sees, its sends and their fate, and
  // the problems that it records and fixes.
  Supervisor: [
    'Terminal.Started',
    'Terminal.Failed',
    'Terminal.Prompted',
    'Terminal.Closed',
    'Send.Sent',
    'Send.Delivered',
    'Send.Dropped',
    'Problem.Recorded',
    'Problem.Fixed',
  ],
  // The daily refresh of the company directions.
  Refresh: ['Revision.Imported'],
} as const satisfies { readonly [A in Author['_tag']]: ReadonlyArray<Kind> }
export type AuthorTag = Author['_tag']
export type WrittenBy = { readonly [A in AuthorTag]: (typeof WRITTEN_BY)[A][number] }
export type AgentKind = WrittenBy['Agent']

// The events of an author: the kinds of its row, and a send only from itself as the sender.
type EventBy<A extends AuthorTag> =
  EventOf<WrittenBy[A]> extends infer E
    ? E extends { readonly create: { readonly _tag: 'Sent'; readonly from: infer F } }
      ? F extends { readonly _tag: A }
        ? E
        : never
      : E
    : never
export interface RecordedBy<A extends AuthorTag> {
  readonly seq: number
  readonly at: Time
  readonly author: Extract<Author, { readonly _tag: A }>
  readonly event: EventBy<A>
}
// The authors that write a kind, and one event of that kind with its author (a fold step).
type AuthorsOf<K extends Kind> = { [A in AuthorTag]: K extends WrittenBy[A] ? A : never }[AuthorTag]
export type RecordedOf<K extends Kind> = {
  readonly seq: number
  readonly at: Time
  readonly author: Extract<Author, { readonly _tag: AuthorsOf<K> }>
  readonly event: EventOf<K>
}

// The kinds that only an agent's own assignment moves: a brief.
const SELF_MOVES: ReadonlyArray<string> = ['Briefed', 'BriefedToCheck', 'BriefedFirst']

// The pair is one that the table holds: its kind is in the author's row, a send comes from its
// author, and a brief moves the author's own assignment.
export const writtenBy = (author: Author, event: Event): boolean => {
  const kinds: ReadonlyArray<Kind> = WRITTEN_BY[author._tag]
  if (!kinds.includes(kindOf(event))) return false
  if (event._tag === 'Send' && 'create' in event) return event.create.from._tag === author._tag
  if (event._tag === 'Assignment' && 'move' in event && SELF_MOVES.includes(event.move._tag)) {
    return author._tag === 'Agent' && author.assignment === event.id
  }
  return true
}

// One event as the store keeps it: its seq in the dir, its time, and who wrote it; the store
// refuses a pair of an author and an event that the table does not hold.
export type Recorded = { [A in AuthorTag]: RecordedBy<A> }[AuthorTag]
export const Recorded = Schema.Struct({
  seq: Schema.Number,
  at: Time,
  author: Author,
  event: Event,
}).pipe(
  Schema.refine((r): r is Recorded => writtenBy(r.author, r.event), {
    message: 'an author that does not write this kind of event',
  }),
)

// An event before the store gives it a seq.
export interface Draft {
  readonly at: Time
  readonly author: Author
  readonly event: Event
}

// Every row decodes strictly: a key that the schema does not know is a damaged row.
export const decodeRecorded = Schema.decodeUnknownSync(Recorded, { onExcessProperty: 'error' })
export const encodeEvent = Schema.encodeSync(Event)
export const encodeAuthor = Schema.encodeSync(Author)
