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
  Destination,
  DropReason as DropReasonSchema,
  Enter,
  Line,
  StartPrompt,
  StartReason,
  SupervisorReason as SupervisorReasonSchema,
  TaskData,
  WakeCause as WakeCauseSchema,
} from './events.ts'
import type { Settings } from './files.ts'
import type { Why } from './model.ts'
import type { Human } from './actor.ts'
import type {
  AssignmentId,
  EventRef,
  NonBlank,
  ProblemId,
  RevisionId,
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
  | { readonly _tag: 'AwaitingEndAccept'; readonly top: TaskId }
  | { readonly _tag: 'Done'; readonly at: Time } // the watcher closes the host terminal
  | { readonly _tag: 'Closed'; readonly at: Time }

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
export type Sender = SentPair['from']
export type Keys = SentPair['keys']
// Every reason of the supervisor but a start: a wake, a word to a host about a child, a decision
// or a problem, the host's prompt after an open, a retry input.
export type SupervisorReason = typeof SupervisorReasonSchema.Type
export type WakeCause = typeof WakeCauseSchema.Type
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

// The terminal that a session stands for: a run (its host too), or an agent.
export interface Supervised {
  readonly session: SessionId
  readonly for: RunId | AssignmentId
  readonly state: TerminalState
}

// --- 3. The decisions that reach the person ----------------------------------------------------

// A decision: one of three that reach the person (README: "only three kinds of decision need
// you"; the JSON names the kind in "kind"). Replaces view.js itemsOf's objects.
export type Decision = DecisionBase &
  (
    | { readonly _tag: 'System'; readonly stopped: TaskId } // a system problem (id: sp..)
    // a direction change: a draft that waits for the person (id: d..). why: the draft's reason
    // and words, which the page shows with the change (nothing when none was given; new, the
    // owner's ruling 2026-11-12: the JSON of the decision has the key why).
    | {
        readonly _tag: 'Direction'
        readonly direction: Text
        readonly change: DraftChange
        readonly hope: Text | null
        readonly why: Why
      }
    | { readonly _tag: 'End' } // the end of a project: the Sol accepted its top task (id: h..)
  )
interface DecisionBase {
  readonly id: Text
  readonly task: TaskId | null // the task where it shows; null: every top task of the dir
  readonly text: Text // the fixed sentence of its kind
  readonly words: Text | null // the host's words, when written
  readonly at: Time
  // It shows when its host wrote its words, when no host holds its tree, or when the host wrote
  // nothing for hostWaitMinutes; a problem that the person's UI recorded shows at once.
  readonly shown:
    | { readonly _tag: 'Shown' }
    | { readonly _tag: 'HeldForHost'; readonly until: Time }
}
// What a draft changes, as a code review: one diff of the whole text of the direction.
export interface DraftChange {
  readonly direction: Text // the name of the direction
  readonly lines: ReadonlyArray<Text> // ' ' kept, '-' gone, '+' new
}

// --- 4. The view data that the page reads (GET /api/...) -----------------------------------------
// Replaces the plain objects of view.js; the keys and the word values stay as today (parity).

// The live state of a terminal on a card with a session (was added by server.js live()). Its
// keys are optional because the JSON has them only on such a card (parity note 9).
interface Live {
  readonly live?: boolean // its pane runs
  readonly ended?: boolean // its pane exited and stays for a resume
}

// GET /api/dir: the sidebar.
export interface DirView {
  readonly name: Text // the folder name
  readonly path: Text
  readonly theme: 'light' | 'dark'
  readonly sound: boolean
  readonly settings: Settings
  readonly hasConfig: boolean // aristoteles.yaml exists
  readonly rolesDraft: boolean // aristoteles.draft.yaml waits for the person's accept
  readonly initialized: boolean // the dir has a store
  readonly startPrompt: Text // the person pastes it into their AI CLI in the dir: that session is the host
  readonly projects: ReadonlyArray<ProjectSummary> // the newest first
}

// A project: a run, or a top task that no run holds (opened at a terminal).
export interface ProjectSummary {
  readonly id: Text // h.. or t..
  readonly kind: 'host' | 'task'
  readonly at: Time | ''
  readonly session: SessionId | null
  readonly state: 'talks' | 'works' | 'ends' | 'done' | 'closed' // RunState in the old words
  readonly title: Text
  readonly top: TaskId | null // the current top task, after remakes
  readonly badge: boolean // an item shows on a task of its tree
}

// GET /api/project/<id>: the canvas in layout A.
export interface ProjectView extends ProjectSummary {
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
  readonly attempt: { readonly now: number; readonly max: number | null } | null
  readonly owner: Owner | null // the terminal that owns the task
  readonly badge: boolean
  readonly parent: TaskId | null
}
// The terminal that owns a task: its open Sol or Terra; a Luna runs inside its parent's.
export interface Owner extends Live {
  readonly a: AssignmentId
  readonly role: Text
  readonly tier: 'sol' | 'terra' | 'luna' | 'program'
  readonly session: SessionId | null
  readonly inside: AssignmentId | null
  // Only the terminal of live work can be resumed; the JSON has the key only then (outside).
  readonly resumable?: boolean
}
export interface WorkCard extends Live {
  readonly a: AssignmentId
  readonly role: Text
  readonly tier: 'sol' | 'terra' | 'luna' | 'program'
  readonly attempt: { readonly now: number; readonly max: number | null }
  readonly session: SessionId | null
  readonly inside: AssignmentId | null
  readonly result: Text | null
  readonly output: Text | null
  readonly state: 'works' | 'in review' | 'accepted' | 'rejected' | 'finished'
  readonly files: number
  readonly reviews: ReadonlyArray<ReviewCard> // the reviews that run now
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
export interface TerminalRef extends Live {
  readonly session: SessionId
  readonly a: Text // the run or the assignment
}

// GET /api/task/<t>: the panel of a task.
export interface TaskPanel {
  readonly id: TaskId
  readonly name: Text
  readonly text: Text
  readonly words: Text
  readonly top: boolean
  readonly decisions: ReadonlyArray<Decision> // the shown decisions on this task
  readonly terminal: TerminalRef | null
  readonly directions: ReadonlyArray<DirectionView> | null // only on the top task
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
export type PageMessage =
  | { readonly type: 'term.open' | 'term.close'; readonly session: SessionId }
  | { readonly type: 'term.input'; readonly session: SessionId; readonly data: Text }
  | {
      readonly type: 'term.resize'
      readonly session: SessionId
      readonly cols: number
      readonly rows: number
    }

// The person's acts on the page (POST /api/act); the answer is { out } or { error } (an error
// has no "refused: " prefix).
export type PageAct =
  | { readonly act: 'accept-roles' }
  | { readonly act: 'open'; readonly draft: TaskDraftId }
  | { readonly act: 'close'; readonly run: RunId; readonly reason?: Text }
  | { readonly act: 'stop'; readonly session: SessionId }
  | { readonly act: 'resume'; readonly session: SessionId; readonly tier: 'sol' | 'terra' }
  | { readonly act: 'fixed'; readonly problem: ProblemId }
  | { readonly act: 'accept-draft'; readonly draft: RevisionId; readonly comment?: Text }
  | { readonly act: 'reject-draft'; readonly draft: RevisionId; readonly reason: Text }
  | { readonly act: 'end'; readonly run: RunId }
  | { readonly act: 'reject-task'; readonly task: TaskId; readonly reason: Text }
  | { readonly act: 'settings'; readonly settings: Settings }
