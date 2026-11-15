// PROPOSAL for the owner (plan/types/BUILD.md, "UI types for the owner to approve"). The UI
// layer has no types on the design page and none in plan/ui; these are written in the page's
// style. Each type says what it means and which old code it replaces. The outside stays as
// today: the CLI words, the HTTP JSON (the view data below keeps the old keys and words), the
// SQL reader tables. The UI packages (P7 server and view, P8 pump, P9 watcher, P10 page) wait
// for the owner's approval of this file; the replay (P4) stores the records of part 1 now and
// follows any change of them later. Parts 1 to 3 have no optional field and tag every union
// with _tag (the owner's rulings, 2026-11-11 and 2026-11-12); part 4's optionals and its kind,
// act and type keys are the outside (the JSON that the page reads), kept as today.
import type {
  Adjustment,
  Destination,
  DropReason as DropReasonSchema,
  Enter,
  Line,
  StartPrompt,
  StartReason,
  SupervisorReason as SupervisorReasonSchema,
  TaskData,
} from './events.ts'
import type { Settings } from './files.ts'
import type { NonEmpty, Tier, Why } from './model.ts'
import type { Human } from './actor.ts'
import type {
  AgentId,
  AssignmentId,
  DirectionId,
  EscalationId,
  EvaluationId,
  EventRef,
  NonBlank,
  PositiveInt,
  ProblemId,
  QuestionId,
  ResultId,
  RevisionId,
  RoleName,
  RunId,
  SessionId,
  TaskDraftId,
  TaskId,
  Time,
} from './ids.ts'

type Text = string

// --- 1. The records of the UI, folded from the store ------------------------------------------

// A project of the UI is a talk with a host model (Nanda, 2026-11-11). A run is that session before
// it has an assignment: a host that talks with the person and drafts the top task. Its top task is
// derived: the task opened from a draft of the run (derived.ts topOfRun), and a remake keeps the
// run (the current task follows the remakes). The host is the AI CLI that the person triggers
// (Nanda, 2026-11-13): the page shows its own terminal, a pane of the person's tmux server.
export type Run = HostRun
interface RunBase {
  readonly id: RunId // h1
  readonly session: SessionId // the terminal of the host model
  readonly terminal: HostTerminal
  // The sessions of the hosts before this one: a continue moves the run to a new pane, and the
  // UI closes a window of an older host.
  readonly formerSessions: ReadonlyArray<SessionId>
  readonly startedAt: Time // was run.at
}
// Where the host runs: a window that the UI made on its own tmux server (stores before
// 2026-11-13), or a pane of the person's own tmux server, which the UI never starts, resizes,
// stops, or restarts.
export type HostTerminal =
  | { readonly _tag: 'Window' }
  | { readonly _tag: 'Pane'; readonly socket: Text; readonly pane: Text }
// was run.type host (work run start). Was two fields, done and closed, that could both be set; a
// done project stays done.
export type HostRun = RunBase & {
  readonly _tag: 'Host'
  readonly end:
    | { readonly _tag: 'NotEnded' } // the run goes on
    | { readonly _tag: 'Done'; readonly at: Time } // the person accepted the end (work run done)
    | { readonly _tag: 'Closed'; readonly at: Time } // the person closed it (work run close)
}
export type RunEnd = HostRun['end']

// What the sidebar shows and what reacts to it. Replaces runState's words talks, works, ends,
// done, closed (the view keeps those words until after parity).
export type RunState =
  | { readonly _tag: 'Talking' } // no top task yet: the host drafts it; the canvas shows its drafts
  | { readonly _tag: 'Working'; readonly top: TaskId } // the top task runs
  // The Sol accepted the top task: an end decision waits for the person (was 'ends')
  // since: the time of the last Accept of the top task's result (the hold for the host counts
  // from it).
  | { readonly _tag: 'AwaitingEndAccept'; readonly top: TaskId; readonly since: Time }
  | { readonly _tag: 'Done'; readonly at: Time } // the watcher closes the host terminal
  | { readonly _tag: 'Closed'; readonly at: Time }

// An agent of a persistent role, for one project (ruling 9): it lives from the first assignment
// of its role in the run to the end of the run, in one terminal. Its assignments attach to it, as
// those of the top task attach to the host. The fold makes it at that first give (P3), before any
// session exists; the supervisor starts its terminal later. It keeps the tier of its role at its
// birth (ruling 13: work in progress keeps what it started with).
export interface PersistentAgent {
  readonly id: AgentId // p1
  readonly role: RoleName
  readonly run: RunId // its project
  readonly tier: Tier
  readonly terminal:
    | { readonly _tag: 'NotStarted' }
    | { readonly _tag: 'Started'; readonly session: SessionId; readonly at: Time }
  readonly at: Time // its first assignment
}
// Derived, never stored. OnAssignment: its open assignments (a split gives one role parts that
// run at once, P6). Between: it waits in work wait, and its silence is no fault. Ended: its run is
// Done or Closed, so its terminal closes.
export type AgentState =
  | { readonly _tag: 'OnAssignment'; readonly assignments: NonEmpty<AssignmentId> }
  | { readonly _tag: 'Between' }
  | { readonly _tag: 'Ended'; readonly at: Time }

// A top task that a host drafts; only the person opens it. 
export interface TaskDraft {
  readonly id: TaskDraftId // td1
  readonly run: RunId
  readonly task: TaskData // the task file that the host wrote
  readonly role: Text // the Sol role that does it
  readonly at: Time
  // The task that the person opened from it (Task.OpenedFromDraft).
  readonly opened:
    | { readonly _tag: 'NotOpened' }
    | { readonly _tag: 'Opened'; readonly task: TaskId }
}
// Waiting: the canvas shows it with an Open button. Opened. Dropped: another draft of its run
// was opened, or its run ended (was not modelled: the page showed Open under a closed run).
export type TaskDraftState =
  | { readonly _tag: 'Waiting' }
  | { readonly _tag: 'Opened'; readonly task: TaskId }
  | { readonly _tag: 'Dropped' }

// A system problem: a host records it on the task that it stops; it shows on the parent of that
// task (derived: the stopped task's parent, else the task), so that one cause shows once; a fix
// ends it. 
export interface Problem {
  readonly id: ProblemId // sp1
  readonly stopped: TaskId
  readonly says: NonBlank // what happened, and how to fix it
  // The host tells its own problem; for one that the supervisor or the person recorded, a try
  // resumes the host (ui/watcher.js tryProblem; it told them apart by the shape of by, bug 7).
  readonly recordedBy: ProblemActor
  readonly at: Time
  // The supervisor asks its host to try it again each retryMinutes: the last try is its last
  // Send with the reason ProblemRetry, which keeps through a restart. The supervisor fixes one
  // by itself too (ui/watcher.js 408).
  readonly fixed:
    | { readonly _tag: 'NotFixed' }
    | { readonly _tag: 'Fixed'; readonly by: ProblemActor; readonly at: Time }
}
// Who records or fixes a system problem: the host, the supervisor in the UI of this person, or
// the person.
export type ProblemActor =
  | { readonly _tag: 'Host'; readonly assignment: AssignmentId }
  | { readonly _tag: 'Supervisor'; readonly name: Text }
  | Human

// The host's words about a decision for the person (work note words), one member per kind of
// decision; only a direction change has a hope; the latest counts. 
export type HostWords = HostWordsBase &
  (
    | { readonly _tag: 'ProblemWords'; readonly on: ProblemId }
    | { readonly _tag: 'DraftWords'; readonly on: RevisionId; readonly hope: Text | null }
    | { readonly _tag: 'EndWords'; readonly on: RunId }
  )
interface HostWordsBase {
  readonly text: NonBlank // the problem, in the host's words (work guide decision-words)
  readonly by: AssignmentId
  readonly at: Time
}

// What the UI recorded about a terminal (work event), by its session: the terminal of a run (its
// host too) or of an agent. The kind is a free string: ended,
// error, silent, prompt, stopped, resumed, closed. A failure is always after three tries.
export interface TerminalEvent {
  readonly session: SessionId
  readonly report: TerminalReport
  readonly at: Time
}
export type Failure = 'ended' | 'error' | 'silent'
export type TerminalReport =
  | { readonly _tag: 'Failed'; readonly why: Failure; readonly lastLines: Text }
  | { readonly _tag: 'Prompted'; readonly line: Text } // the tool asks; its host answers it
  | { readonly _tag: 'Stopped' } // the person's Stop: no retry until the person's Resume
  | { readonly _tag: 'Resumed' } // the person's Resume
  | { readonly _tag: 'Closed' } // its work ended, so its terminal closed

// Every text that goes into a terminal, as one record (the owner's rulings, 2026-11-12): a
// host's input for its child (work send), and what the supervisor writes: a
// wake, a word to a host about a child, a decision or a problem, the first input, the host's
// prompt after an open, a retry input. Was three things: the send act, the watcher's tells and
// inputs (never stored; the wake's time was the session's woke), and the outbox message. A Send
// is stored, so a restart keeps it and its state. Each axis is a closed union read through a
// total map, so a new member is one line and the compiler lists each reader. A reason that names
// a host's terminal holds no destination: it is derived, and cannot disagree. A Send to an agent
// with no terminal is never recorded (the CLI refuses it, and a tell skips it). The person
// typing into a terminal on the page is raw input, not a Send.
export type Send = SentPair & {
  readonly id: EventRef // its Sent event (e12)
  readonly state: SendState
  readonly at: Time // when it was sent (and pending from)
}
// Who sends, and what is typed: the pairs of the stored Sent (events.ts), so only a start sends
// the start words with the token, and a start sends nothing else. The agent's sender keeps its
// assignment, which the stored event has as its author. The reasons, the destination, the
// causes of a wake and the keys are the Schemas of events.ts, each written once.
export type SentPair =
  | {
      readonly from: {
        readonly _tag: 'Agent'
        readonly assignment: AssignmentId
        readonly to: typeof Destination.Type
      }
      readonly keys: typeof Line.Type | typeof Enter.Type
    }
  | {
      readonly from: { readonly _tag: 'Supervisor'; readonly reason: typeof StartReason.Type }
      readonly keys: typeof StartPrompt.Type
    }
  | {
      readonly from: { readonly _tag: 'Supervisor'; readonly reason: SupervisorReason }
      readonly keys: typeof Line.Type | typeof Enter.Type
    }
// Every reason of the supervisor but a start: a wake, a word to a host about a child, a
// problem, the host's prompt after an open, a retry input.
export type SupervisorReason = typeof SupervisorReasonSchema.Type
export type SendState =
  | { readonly _tag: 'Pending' }
  | { readonly _tag: 'Delivered'; readonly at: Time }
  | { readonly _tag: 'Dropped'; readonly at: Time; readonly why: DropReason }
// Why a send never reached its terminal (events.ts DropReason).
export type DropReason = typeof DropReasonSchema.Type

// The terminal of a real agent (a Sol or a Terra), so that the UI can resume it. A host shares the
// session of its run.
export interface AgentSession {
  readonly assignment: AssignmentId
  readonly session: SessionId
  readonly at: Time
}

// --- 2. The supervisor of the terminals (the watcher) ------------------------------------------

// One state per terminal, by its session. The stored moves (a failure after three tries, the
// person's Stop, the close at the end of work) are the outer state; what the pump sees every few
// seconds is the activity of a live terminal, and nothing stores it. Replaces the watcher's
// closure maps stopped, ended, retry, the failures sent up, told, woke and idleNext, which a
// restart forgot (bugs 4, 5, 14, 15; told and woke are Sends). A new act of the agent brings a
// failed terminal back with no person; only Stopped needs the person (moves.ts: no automatic
// move takes it).
export type TerminalState =
  | { readonly _tag: 'Live'; readonly activity: Activity }
  | { readonly _tag: 'Failed'; readonly why: Failure; readonly at: Time }
  | { readonly _tag: 'Stopped'; readonly at: Time } // the person's Stop
  | { readonly _tag: 'Closed'; readonly at: Time } // its work ended, so it closed once
export type Activity =
  // Launched; the first input waits until the tool is quiet.
  | { readonly _tag: 'Starting'; readonly since: Time }
  // It wrote output within the window (8 s): a wake waits.
  | { readonly _tag: 'Busy'; readonly lastOutput: Time }
  // It is quiet, and this is its last next step (words/next stepKey: no words, no times), so a
  // change of the words of work next wakes nobody (bug 13).
  | { readonly _tag: 'Quiet'; readonly stepKey: Text }
  // The tool asks; its host heard of it.
  | { readonly _tag: 'AtPrompt'; readonly line: Text }
  // It ended, showed error words, or was silent; tried again 1 to 3 times.
  | {
      readonly _tag: 'Retrying'
      readonly why: Failure
      readonly tries: 1 | 2 | 3
      readonly lastTry: Time
    }

// The terminal that a session stands for: a run (its host too), an assignment, or a persistent
// agent.
export interface Supervised {
  readonly session: SessionId
  readonly for: RunId | AssignmentId | AgentId
  readonly state: TerminalState
}

// --- 3. The decisions that reach the person ----------------------------------------------------

// A decision that the page shows: one of the kinds that reach the person (the JSON names the kind
// in "kind"), each with the id of its own record. One that waits for its host's words is held on
// the server and never reaches the page.
export type Decision = DecisionBase &
  (
    | { readonly _tag: 'System'; readonly id: ProblemId; readonly stopped: TaskId }
    // a direction change: a draft that waits for the person. why: the draft's reason and words,
    // which the page shows with the change (nothing when none was given). hope: the host's.
    | {
        readonly _tag: 'Direction'
        readonly id: RevisionId
        readonly direction: Text
        readonly change: DraftChange
        readonly hope: Text | null
        readonly why: Why
      }
    // the end of a project: the Sol accepted its top task, which a reject reopens
    | { readonly _tag: 'End'; readonly id: RunId; readonly top: TaskId }
    // a relayed act: an agent relayed the person's words as an act that counts only when the
    // person confirms it (Nanda, 2026-11-13). quote: the person's words.
    | { readonly _tag: 'Confirm'; readonly id: EventRef; readonly quote: Text }
    // new words of a role that a high agent or a host drafted, for the person's accept or reject
    // (ruling 2026-11-14). lines: '-' a word of now, '+' its drafted word.
    | {
        readonly _tag: 'RoleWords'
        readonly id: EventRef
        readonly role: Text
        readonly lines: ReadonlyArray<Text>
      }
    // a drafted adjustment of a role or a direction (ruling 14)
    | { readonly _tag: 'Adjustment'; readonly id: EventRef; readonly adjustment: Adjustment }
    // a question to the person: text is the question; the person picks an option or writes the
    // answer, and it counts at once. asker: who asked, as "writer (a3)".
    | {
        readonly _tag: 'Question'
        readonly id: QuestionId
        readonly asker: Text
        readonly options: ReadonlyArray<Text>
      }
    // an evaluation that counts after the owner's accept (P1, 2026-11-15)
    | {
        readonly _tag: 'Evaluation'
        readonly id: EvaluationId
        readonly level: Text
        readonly wrong: Text
        readonly why: Text
        readonly improve: ReadonlyArray<Text>
      }
    // any other item that waits for the person (P1, 2026-11-15): title names its kind, text says
    // what waits, and its acts are the ones that move it, each with its own ids.
    | { readonly _tag: 'Step'; readonly id: Text; readonly title: Text }
  )
// An act of a decision: each one is an intent of the item's step that passed canAct, so the page
// offers no act that is refused (P1). Accept, Reject, Confirm, Answer and FixProblem act on the
// decision's own record; AtTerminal is an act that needs a file, with its command.
export type DecisionAct =
  | { readonly _tag: 'Accept' }
  | { readonly _tag: 'Reject' }
  | { readonly _tag: 'Confirm' }
  | { readonly _tag: 'Answer' }
  | { readonly _tag: 'FixProblem' }
  | { readonly _tag: 'Resolve'; readonly escalation: EscalationId }
  | { readonly _tag: 'Give'; readonly task: TaskId; readonly role: RoleName }
  | { readonly _tag: 'Suggest'; readonly about: SuggestionTarget; readonly name: Text }
  | { readonly _tag: 'AtTerminal'; readonly line: Text }
interface DecisionBase {
  readonly task: TaskId | null // the task where it shows; null: every top task of the dir
  readonly text: Text // the fixed sentence of its kind
  readonly words: Text | null // the host's words, when written
  readonly at: Time
  readonly acts: ReadonlyArray<DecisionAct> // none: it waits for others, as waits says
  readonly waits: Text | null // what it waits for, when the person cannot move it now
}
// What a draft changes, as a code review: one diff of the whole text of the direction.
export interface DraftChange {
  readonly direction: Text // the title over it: the name of the direction, or what it compares
  readonly lines: ReadonlyArray<Text> // ' ' kept, '-' gone, '+' new
}

// --- 4. The view data that the page reads (GET /api/...) -----------------------------------------
// Replaces the plain objects of view.js; the keys and the word values stay as today (parity).

// A terminal as the page shows it: the pump's reading, else what the store says of it.
export type TerminalSeen =
  | { readonly _tag: 'Unknown'; readonly session: SessionId } // no reading of it yet
  | { readonly _tag: 'Live'; readonly session: SessionId } // its pane runs
  | { readonly _tag: 'Ended'; readonly session: SessionId } // its pane exited; it stays for a resume
  | { readonly _tag: 'Closed'; readonly session: SessionId } // stopped, or closed when work ended
// The terminal of a card: none (a program, or no agent yet), or one that the page sees.
export type CardTerminal = { readonly _tag: 'None' } | TerminalSeen

// GET /api/dir: the sidebar.
export interface DirView {
  readonly name: Text // the folder name
  readonly path: Text
  readonly theme: 'light' | 'dark'
  readonly sound: boolean
  readonly settings: Settings
  readonly hasConfig: boolean // aristoteles.yaml exists
  // Onboarding files are in the dir (.work/assess/ or aristoteles.draft.yaml): with no store, the
  // page shows the directions page and the agents page (rulings 2, 3, 11).
  readonly onboarding: boolean
  readonly initialized: boolean // the dir has a store
  readonly startPrompt: Text // the person pastes it into their AI CLI in the dir: that session is the host
  readonly projects: ReadonlyArray<ProjectSummary> // the newest first
  // The decisions that no open task shows (P1, F3): of no task, or of a task that ended.
  readonly inbox: ReadonlyArray<Decision>
}

// A project: a run with its session, or a top task that no run holds (opened at a terminal).
// state: RunState in the old words; top: the current top task, after remakes (a run that talks
// has none yet).
export type ProjectSummary = SummaryHead &
  (
    | {
        readonly kind: 'host'
        readonly id: RunId
        readonly session: SessionId
        readonly state: 'talks' | 'works' | 'ends' | 'done' | 'closed'
        readonly top: TaskId | null
      }
    | {
        readonly kind: 'task'
        readonly id: TaskId
        readonly state: 'works' | 'done' | 'closed'
        readonly top: TaskId
      }
  )
interface SummaryHead {
  readonly at: Time | ''
  readonly title: Text
  readonly badge: boolean // an item shows on a task of its tree
}

// GET /api/project/<id>: the canvas in layout A.
export type ProjectView = ProjectSummary & ProjectRows
interface ProjectRows {
  readonly rows: ReadonlyArray<CanvasRow> // the task tree going down; only what runs now
  readonly drafts: ReadonlyArray<TaskDraftView> // a talking run's drafts of the top task
  readonly terminal: TerminalRef | null // a run's own terminal
}
export interface CanvasRow {
  readonly depth: number
  readonly task: TaskCard
  readonly work: ReadonlyArray<WorkCard> // one card per maker that runs now
}
export interface TaskCard {
  readonly id: TaskId
  readonly name: Text
  readonly words: Text // the status line, with no attempt
  readonly attempt: { readonly now: number; readonly max: PositiveInt | null } | null
  readonly owner: Owner | null // the terminal that owns the task
  readonly badge: boolean
  readonly parent: TaskId | null
}
// The terminal that owns a task (ruling 7): its open assignment of the host or of a persistent
// agent; a subagent runs inside the terminal above it. Two tasks of one persistent agent show its
// one terminal (ruling 9).
export interface Owner {
  readonly a: AssignmentId
  readonly role: Text
  readonly tier: 'sol' | 'terra' | 'luna' | 'program'
  readonly agent: AgentId | null // the persistent agent whose terminal it is
  readonly terminal: CardTerminal
  readonly inside: AssignmentId | null
  // Only the terminal of live work can be resumed: a lead whose agent or assignment goes on.
  readonly resumable: boolean
}
export interface WorkCard {
  readonly a: AssignmentId
  readonly role: Text
  readonly tier: 'sol' | 'terra' | 'luna' | 'program'
  readonly attempt: { readonly now: number; readonly max: PositiveInt | null }
  readonly terminal: CardTerminal
  readonly inside: AssignmentId | null
  // The canvas shows only work that runs now: in work, or its result in review with the reviews
  // that run now.
  readonly now:
    | { readonly state: 'works' }
    | {
        readonly state: 'in review'
        readonly result: ResultId
        readonly output: Text
        readonly files: number
        readonly reviews: ReadonlyArray<ReviewCard>
      }
}
export interface ReviewCard {
  readonly id: Text | null // null: a checker that has not reviewed yet, or a decider that waits
  readonly by: Text
  readonly role: Text | null
  readonly tier: 'sol' | 'terra' | 'luna' | 'program' | 'person' | null
  readonly decides: boolean
  readonly decision: 'accept' | 'reject' | 'escalate' | 'reviews' | 'waits'
  readonly line: Text
}
export interface TaskDraftView {
  readonly id: TaskDraftId
  readonly name: Text
  readonly text: Text
  readonly role: Text
  readonly at: Time
}
export interface TerminalRef {
  readonly a: Text // the run, the persistent agent, or the assignment
  readonly terminal: TerminalSeen
}

// GET /api/task/<t>: the panel of a task.
export interface TaskPanel {
  readonly id: TaskId
  readonly name: Text
  readonly text: Text
  readonly words: Text
  // A top task shows its directions; null: a part of another task.
  readonly top: { readonly directions: ReadonlyArray<DirectionView> } | null
  readonly decisions: ReadonlyArray<Decision> // the shown decisions on this task
  readonly terminal: TerminalRef | null
  readonly results: ReadonlyArray<ResultView>
  // line: the act as work log prints it.
  readonly timeline: ReadonlyArray<{ readonly at: Time; readonly who: Text; readonly line: Text }>
  readonly files: ReadonlyArray<{
    readonly file: Text
    readonly added: number
    readonly removed: number
  }>
}
export interface ResultView {
  readonly id: Text
  readonly by: Text
  readonly output: Text
  readonly at: Time
  // One per Review of the result: each point of a Reject (v4.1), a recheck as a Reject.
  readonly reviews: ReadonlyArray<{
    readonly id: Text
    readonly by: Text
    readonly decision: 'Accept' | 'Reject' | 'Escalate' | 'Resolve'
    readonly reason: Text | null
    readonly breaks: Text | null
    readonly at: Time
    readonly evidence: ReadonlyArray<{
      readonly rule: Text | null
      readonly where: Text | null
      readonly says: Text
    }>
  }>
}
export interface DirectionView {
  readonly id: Text
  readonly name: Text
  readonly owner: Text
  readonly version: Text // tsd-writing@2
  readonly summary: Text // the page shows it before the words (Nanda, 2026-11-15)
  readonly flow: ReadonlyArray<FlowStepView> // a sequence diagram under the summary; none: no diagram
  readonly says: Text
  readonly standards: ReadonlyArray<{
    readonly id: Text
    readonly says: Text
    readonly rules: ReadonlyArray<{
      readonly id: Text
      readonly says: Text
      readonly checkedBy: Text | null
    }>
  }>
  // The versions made during the project, and the drafts that wait.
  readonly changed: ReadonlyArray<{ readonly id: Text; readonly at: Time }>
  readonly drafts: ReadonlyArray<{ readonly id: Text; readonly by: Text; readonly at: Time }>
}
// GET /api/diff/<t>?file=: the diff of one file of a task.
export interface DiffView {
  readonly file: Text | null
  readonly diff: Text
}

// The websocket: "changed" when the store has a new act, and the bytes of the terminals. The
// optional keys of the messages and of the acts below are the wire format (outside), as today.
export type ServerMessage =
  | { readonly type: 'changed' }
  | {
      readonly type: 'term.data'
      readonly session: SessionId
      readonly data: Text
      readonly reset?: boolean
    } // base64
  | { readonly type: 'term.error'; readonly session: SessionId; readonly error: Text }
  // The size of a terminal as tmux has it, before its first bytes and after each resize: the page
  // never sizes a terminal itself (ruling 2026-11-14).
  | {
      readonly type: 'term.size'
      readonly session: SessionId
      readonly cols: PositiveInt
      readonly rows: PositiveInt
    }
export type PageMessage =
  | { readonly type: 'term.open' | 'term.close'; readonly session: SessionId }
  | { readonly type: 'term.input'; readonly session: SessionId; readonly data: Text }
  | {
      readonly type: 'term.resize'
      readonly session: SessionId
      readonly cols: PositiveInt
      readonly rows: PositiveInt
    }

// The person's acts on the page (POST /api/act); the answer is { out } or { error } (an error
// has no "refused: " prefix).
export type PageAct =
  | { readonly act: 'open'; readonly draft: TaskDraftId }
  | { readonly act: 'close'; readonly run: RunId; readonly reason?: Text }
  | { readonly act: 'stop'; readonly session: SessionId }
  | {
      readonly act: 'resume'
      readonly session: SessionId
      readonly tier: 'sol' | 'terra' | 'luna'
    }
  | { readonly act: 'fixed'; readonly problem: ProblemId }
  | { readonly act: 'accept-draft'; readonly draft: RevisionId; readonly comment?: Text }
  | { readonly act: 'reject-draft'; readonly draft: RevisionId; readonly reason: NonBlank }
  | { readonly act: 'confirm'; readonly forward: EventRef }
  // the person answers a question: the words of an option, or their own
  | { readonly act: 'answer'; readonly question: QuestionId; readonly text: Text }
  | { readonly act: 'end'; readonly run: RunId }
  | { readonly act: 'reject-task'; readonly task: TaskId; readonly reason: NonBlank }
  | { readonly act: 'settings'; readonly settings: Settings }
  // the person decides new words of a role (ruling 2026-11-14)
  | { readonly act: 'accept-words'; readonly draft: EventRef }
  | { readonly act: 'reject-words'; readonly draft: EventRef; readonly reason: NonBlank }
  // the person decides a drafted adjustment (ruling 14)
  | { readonly act: 'accept-adjustment'; readonly draft: EventRef }
  | { readonly act: 'reject-adjustment'; readonly draft: EventRef; readonly reason: NonBlank }
  // the text box of the gear stores a suggestion: about a direction, a new one, or the roles (P7)
  | { readonly act: 'suggest'; readonly about: SuggestionTarget; readonly says: NonBlank }
  // the acts of the person's other items (P1): an assign, a resolve, an evaluation's decision
  | { readonly act: 'assign'; readonly task: TaskId; readonly role: RoleName }
  | { readonly act: 'resolve'; readonly escalation: EscalationId; readonly text: Text }
  | { readonly act: 'accept-evaluation'; readonly evaluation: EvaluationId; readonly text: Text }
  | { readonly act: 'reject-evaluation'; readonly evaluation: EvaluationId; readonly reason: NonBlank }
export type SuggestionTarget =
  | { readonly _tag: 'NewDirection' }
  | { readonly _tag: 'Direction'; readonly direction: DirectionId }
  | { readonly _tag: 'Roles' }

// GET /api/onboarding: the directions page and the agents page (rulings 2, 3, 11), and the two
// entries of the gear after the store (ruling 13). One view serves both times (PLAN.md section 5):
// before the store it reads the onboarding files; after it, the store and the adjustments that
// wait for the person.
export interface OnboardingView {
  readonly stage: 'files' | 'store'
  readonly directions: ReadonlyArray<DirectionCard>
  readonly roles: ReadonlyArray<RoleCard> // the roles that the project has come first
  readonly adjustments: ReadonlyArray<Decision> // after the store; none before it
  readonly start: StartView
}
// Whether the store can start (O1, core/actions startStateOf): open, waiting for an accept, or
// blocked, with what blocks it and who fixes it. started: the store exists.
export type StartView =
  | { readonly state: 'open' | 'waiting' | 'started' }
  | { readonly state: 'blocked'; readonly says: Text; readonly fix: Text }
// One direction of the list, and the right column when it is open. Its state says what it has:
// a draft (or a version) holds all its words at once, and only a question has open questions.
// loading, question, ready, accepted: a file of onboarding; current: official in the store.
export type DirectionCard = CardHead &
  (
    // the host drafts it: the first draft, or again because its file was in an older shape
    | { readonly state: 'loading'; readonly why: 'drafting' | 'reset' }
    // the host drafts it again after the person's answers
    | {
        readonly state: 'loading'
        readonly why: 'answered'
        readonly draft: DirectionWords
        readonly answered: NonEmpty<AnsweredView>
      }
    // the host drafts it again from the person's words (a Revise)
    | {
        readonly state: 'loading'
        readonly why: 'revise'
        readonly words: Text
        readonly draft: DirectionWords
        readonly answered: ReadonlyArray<AnsweredView>
      }
    | {
        readonly state: 'question'
        readonly draft: DirectionWords
        readonly open: NonEmpty<QuestionView>
      }
    | { readonly state: 'ready' | 'accepted' | 'current'; readonly draft: DirectionWords }
  )
interface CardHead {
  readonly id: Text
  readonly name: Text // before its first draft: the person's principle, or the company folder
  readonly origin: Text // where it comes from, in one line
  readonly principle: Text | null // the words of the person who added it (ruling 5)
  readonly example: Text | null
}
// The words of a draft or of a version, all present together. The summary shows before the words;
// diff: the words against the last draft, or the version against the one before it (Nanda,
// 2026-11-15): with none before, every line comes.
export interface DirectionWords {
  readonly summary: Text
  readonly flow: ReadonlyArray<FlowStepView> // none: no diagram
  readonly says: Text
  readonly standards: DirectionView['standards'] // each rule names the role that checks it
  readonly diff: DraftChange
}
// One step of the flow of a direction (Nanda, 2026-11-15): an actor acts on another actor or on a
// file (from equal to to: an act on its own). place: where the project defines the step, with the
// line when it has one; null: it names none. uses: the ids that apply at a step that the direction
// governs (the page marks it), and examples: what shows it followed and broken; both none: an
// unmarked step.
export interface FlowStepView {
  readonly from: Text
  readonly to: Text
  readonly says: Text
  readonly place: { readonly file: Text; readonly line: PositiveInt | null } | null
  readonly uses: ReadonlyArray<Text>
  readonly examples: ReadonlyArray<ExampleView>
}
// An example (ruling 4; Nanda, 2026-11-15): an output of a marked step that follows or breaks
// the direction (fit), with the input of a step that checks or decides. It sits in the step that
// it shows. A stale spot asks for other examples.
export interface ExampleView {
  readonly fit: 'Follows' | 'Breaks'
  readonly input: SampleView | null
  readonly output: SampleView
}
// A real place of the project, or the host's own words when the project has none.
export type SampleView = SpotView | { readonly written: Text }
// One real place of an example. current: its excerpt is in its file now. around: the real code, so the
// person sees the place (Nanda, 2026-11-15): 3 lines above and 3 below the lines of the excerpt
// (or its line, when the excerpt is gone), the lines of the excerpt marked; none when the file
// does not read.
export interface SpotView {
  readonly file: Text
  readonly line: PositiveInt
  readonly excerpt: Text
  readonly current: boolean
  readonly around: ReadonlyArray<CaseLine>
}
export interface CaseLine {
  readonly line: number
  readonly text: Text
  readonly mark: boolean
}
// A question of the AI about a draft (ruling 5): an example, and the options A and B.
export interface QuestionView {
  readonly says: Text
  readonly example: ExampleView
  readonly options: readonly [Text, Text]
}
export interface AnsweredView extends QuestionView {
  readonly answer: 'A' | 'B'
}
// One card of the agents page (ruling 11); its window shows the rest.
export interface RoleCard {
  readonly role: Text
  readonly icon: Text // a name of ROLE_ICONS (adapters/web/vendor/role-icons.js draws it)
  readonly tier: 'sol' | 'terra' | 'luna' | 'program'
  // tiers.<t>.model of the settings, or the class of the tier (Opus, Sonnet, Haiku); null: a
  // program
  readonly model: Text | null
  readonly launch: Text | null // tiers.<t>.launch of the settings, read only
  readonly summary: Text // the line of the card; after the store, its description
  readonly description: Text
  // null: a program
  readonly persistence: { readonly persistent: boolean; readonly why: Text } | null
  // false: a program, the role of the top task (the only persistent high role, ruling 15), or a
  // role of the store (the gear changes it by an adjustment)
  readonly toggle: boolean
  readonly found: Text | null // where the project has the role
  readonly state: 'waiting' | 'accepted' | 'current' // current: a role of the store
  readonly request: Text | null // the words of a Revise that wait for the host
}
