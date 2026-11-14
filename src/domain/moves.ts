// The moves of each record with a lifecycle (plan/types REVIEW-1 section 5): one function per
// move, from the state that it may leave to the state that it makes, so that a move back (an
// answered question opened again, a revoked permission revoked twice, a stopped terminal woken
// by the supervisor) does not compile. MOVES ties each stored move kind to its function, so a
// new kind fails the compile there until it has one; the fold (core/state) calls them, and no
// other code writes a state (architecture.test.ts). Pure: the caller finds the record by its id,
// and puts the new copy in the Work.
import type { Human } from './actor.ts'
import type { EventRef, ResultId, SessionId, TaskId, Time } from './ids.ts'
import type {
  Answerer,
  Assignment,
  By,
  Direction,
  Meta,
  NonBlank,
  NonEmpty,
  OfficialDirection,
  Permission,
  Question,
  Snapshot,
  Task,
  Text,
  Under,
  Version,
} from './model.ts'
import type {
  Activity,
  DropReason,
  Failure,
  HostRun,
  HostTerminal,
  Problem,
  ProblemActor,
  Run,
  Send,
  TaskDraft,
  TerminalState,
} from './ui-model.ts'
import type { EventGroup, MoveTag } from './events.ts'
import type { ConfigFile, RoleWords } from './files.ts'
import type { Forward } from './work.ts'

// A record whose field F is in the state T: Task & { end: Closed } is a closed task.
type In<R, F extends keyof R, T extends string> = R & {
  readonly [K in F]: Extract<R[F], { readonly _tag: T }>
}
// A record of a union with its state fields left out, member by member.
type Without<R, F extends PropertyKey> = R extends unknown ? Omit<R, F> : never

// --- the first state of each record ------------------------------------------------------------

// A new record starts in the first state of its lifecycle; these are the only writers of it.
export const openTask = (
  fields: Omit<Task, 'end' | 'untouched'>,
): In<Task, 'end', 'NotEnded'> & In<Task, 'untouched', 'NotBriefed'> => ({
  ...fields,
  end: { _tag: 'NotEnded' },
  untouched: { _tag: 'NotBriefed' },
})
export const giveAssignment = (fields: Without<Assignment, 'end'>): OpenAssignment =>
  ({ ...fields, end: { _tag: 'NotEnded' } }) as OpenAssignment
// A new token, never briefed.
export const newMeta = (secret: Text): In<Meta, 'claim', 'Free'> => ({
  secret,
  claim: { _tag: 'Free' },
  briefs: 0,
})
export const askQuestion = (fields: Omit<Question, 'status'>): OpenQuestion => ({
  ...fields,
  status: { _tag: 'Open' },
})
export const grantPermission = (
  fields: Omit<Permission, 'revoked'>,
): In<Permission, 'revoked', 'NotRevoked'> => ({ ...fields, revoked: { _tag: 'NotRevoked' } })
// A forwarded act that moves work on waits for the person's confirm.
export const waitForConfirm = (
  event: EventRef,
  inner: Extract<Forward, { readonly _tag: 'Confirmable' }>['inner'],
): WaitingForward => ({ event, _tag: 'Confirmable', inner, state: { _tag: 'Waiting' } })
export const startRun = (fields: Without<Run, 'end'>): In<Run, 'end', 'NotEnded'> =>
  ({ ...fields, end: { _tag: 'NotEnded' } }) as In<Run, 'end', 'NotEnded'>
export const draftTask = (
  fields: Omit<TaskDraft, 'opened'>,
): In<TaskDraft, 'opened', 'NotOpened'> => ({ ...fields, opened: { _tag: 'NotOpened' } })
export const recordProblem = (
  fields: Omit<Problem, 'fixed'>,
): In<Problem, 'fixed', 'NotFixed'> => ({ ...fields, fixed: { _tag: 'NotFixed' } })
export const sendText = (fields: Without<Send, 'state'>): PendingSend =>
  ({ ...fields, state: { _tag: 'Pending' } }) as PendingSend

// --- Task --------------------------------------------------------------------------------------

export type OpenTask = In<Task, 'end', 'NotEnded'>

// Task.Closed: the owner or a Change act closes an open task.
export const closeTask = (
  task: OpenTask,
  by: By,
  reason: NonBlank,
  when: Time,
): In<Task, 'end', 'Closed'> => ({ ...task, end: { _tag: 'Closed', by, reason, when } })

// Task.Remade: the old task is replaced by the new one (next); the new task is opened apart.
export const replaceTask = (
  task: OpenTask,
  next: TaskId,
  by: By,
  reason: NonBlank,
  when: Time,
): In<Task, 'end', 'Replaced'> => ({
  ...task,
  end: { _tag: 'Replaced', by, reason, next, when },
})

// Task.Described: the person writes the description for people.
export const describeTask = (task: Task, text: Text): Task => ({ ...task, descriptionHuman: text })

// Assignment.BriefedFirst, on the task: how its files looked at its first brief, once.
export const firstBrief = (
  task: In<Task, 'untouched', 'NotBriefed'>,
  files: Readonly<Record<string, Snapshot>>,
  inPlace: Extract<Task['untouched'], { readonly _tag: 'AtFirstBrief' }>['inPlace'],
): In<Task, 'untouched', 'AtFirstBrief'> => ({
  ...task,
  untouched: { _tag: 'AtFirstBrief', files, inPlace },
})

// --- Assignment and its meta --------------------------------------------------------------------

export type OpenAssignment = Assignment & { readonly end: { readonly _tag: 'NotEnded' } }

// Assignment.Briefed (all three): the snapshot of the versions that the brief read.
export const briefAssignment = <A extends OpenAssignment>(
  a: A,
  under: Under,
): A => ({ ...a, under })

// Assignment.Finished: an open assignment ends; what waited for it goes up (the engine).
// A new maker of the task ends the open maker before it the same way (nothing tells the two
// apart). The result names its own end, so a finished one cannot finish again.
export const finishAssignment = (
  a: OpenAssignment,
  when: Time,
): In<Assignment, 'end', 'Finished'> => ({ ...a, end: { _tag: 'Finished', when } })

// Assignment.Briefed: the claim of the brief (a low checker's names its result).
export const claim = (meta: Meta, since: Time, result: ResultId | null): Meta => ({
  ...meta,
  briefs: meta.briefs + 1,
  claim: result === null ? { _tag: 'Held', since } : { _tag: 'Checking', since, result },
})

// Assignment.Freed (the CLI word: free), and the end of a unit: the claim is free.
export const freeClaim = (meta: Meta): In<Meta, 'claim', 'Free'> => ({
  ...meta,
  claim: { _tag: 'Free' },
})

// --- Question ----------------------------------------------------------------------------------

export type OpenQuestion = In<Question, 'status', 'Open'>

// Question.Answered: only an open question is answered, once (bug 2).
export const answerQuestion = (
  q: OpenQuestion,
  answer: NonBlank,
  by: Answerer,
  when: Time,
): In<Question, 'status', 'Answered'> => ({
  ...q,
  status: { _tag: 'Answered', answer, by, when },
})

// --- Permission ----------------------------------------------------------------------------------

// Permission.Revoked: once; the acts before it stay.
export const revokePermission = (
  x: In<Permission, 'revoked', 'NotRevoked'>,
  at: Time,
): In<Permission, 'revoked', 'Revoked'> => ({ ...x, revoked: { _tag: 'Revoked', at } })

// --- Forward (the CLI words: forward, confirm) ------------------------------------------------

export type WaitingForward = Extract<Forward, { readonly _tag: 'Confirmable' }> & {
  readonly state: { readonly _tag: 'Waiting' }
}

// Forward.Confirmed: the person confirms a forward that waits; it counts at that event.
export const confirmForward = (
  f: WaitingForward,
  event: EventRef,
): Extract<Forward, { readonly _tag: 'Confirmable' }> => ({
  ...f,
  state: { _tag: 'Confirmed', event },
})

// --- the workflow -----------------------------------------------------------------------------

// Workflow.RoleWordsChanged: only the words of roles change (description, intro, responsibilities,
// output), never their acts or tiers.
export const changeRoleWords = (
  config: ConfigFile,
  roles: Readonly<Record<string, RoleWords>>,
): ConfigFile => ({
  ...config,
  roles: Object.fromEntries(
    Object.entries(config.roles).map(([name, file]) => [name, { ...file, ...roles[name] }]),
  ),
})

// --- Direction ---------------------------------------------------------------------------------

// The accept that meets the deciders of a draft makes its version official: a new direction
// becomes official with it, an official one adds it as its current version.
export const makeOfficial = (d: Direction, version: Version<Direction>): OfficialDirection =>
  d._tag === 'NewDirection'
    ? { ...d, _tag: 'Official', versions: [version] }
    : { ...d, versions: [...d.versions, version] as NonEmpty<Version<Direction>> }

// --- the UI: runs, task drafts, problems, sends ----------------------------------------------

// Run.Done: a host run whose top task is accepted (the engine checks it) ends as done; a done
// project stays done.
export const runDone = (
  run: In<HostRun, 'end', 'NotEnded'>,
  at: Time,
): In<HostRun, 'end', 'Done'> => ({ ...run, end: { _tag: 'Done', at } })
// Run.HostMoved: the host of an open run continues in another pane. The old session becomes a
// former one, so that the UI closes its window.
export const moveHost = (
  run: In<Run, 'end', 'NotEnded'>,
  session: SessionId,
  terminal: HostTerminal,
): In<Run, 'end', 'NotEnded'> => ({
  ...run,
  session,
  terminal,
  formerSessions: [...run.formerSessions, run.session],
})
// Run.Closed: an open run is closed.
export const runClosed = (
  run: In<Run, 'end', 'NotEnded'>,
  at: Time,
): In<Run, 'end', 'Closed'> => ({ ...run, end: { _tag: 'Closed', at } })

// Task.OpenedFromDraft, on the draft: the person opens a draft once.
export const openTaskDraft = (
  draft: In<TaskDraft, 'opened', 'NotOpened'>,
  task: TaskId,
): In<TaskDraft, 'opened', 'Opened'> => ({ ...draft, opened: { _tag: 'Opened', task } })

// Problem.Fixed: a fix ends an open problem; the record keeps who fixed it.
export const fixProblem = (
  p: In<Problem, 'fixed', 'NotFixed'>,
  by: ProblemActor,
  at: Time,
): In<Problem, 'fixed', 'Fixed'> => ({ ...p, fixed: { _tag: 'Fixed', by, at } })

export type PendingSend = In<Send, 'state', 'Pending'>

// Send.Delivered: the text reached its terminal.
export const deliverSend = (s: PendingSend, at: Time): In<Send, 'state', 'Delivered'> => ({
  ...s,
  state: { _tag: 'Delivered', at },
})

// Send.Dropped: the text never reached its terminal, for a reason that the UI knows.
export const dropSend = (
  s: PendingSend,
  at: Time,
  why: DropReason,
): In<Send, 'state', 'Dropped'> => ({ ...s, state: { _tag: 'Dropped', at, why } })

// --- the supervisor of the terminals (ui-model.ts TerminalState) --------------------------------

export type Live = Extract<TerminalState, { readonly _tag: 'Live' }>
export type Stopped = Extract<TerminalState, { readonly _tag: 'Stopped' }>
export type Failed = Extract<TerminalState, { readonly _tag: 'Failed' }>

// What the pump sees of a live terminal (not stored): its activity changes.
export const tick = (_t: Live, activity: Activity): Live => ({ _tag: 'Live', activity })

// Terminal.Started: the UI gives a new terminal to an agent; it starts, and its first input waits
// until the tool is quiet.
export const startTerminal = (at: Time): Live => ({
  _tag: 'Live',
  activity: { _tag: 'Starting', since: at },
})

// Terminal.Prompted: the tool of a live terminal asks; its host heard of it.
export const promptTerminal = (_t: Live, line: Text): Live => ({
  _tag: 'Live',
  activity: { _tag: 'AtPrompt', line },
})

// Terminal.Failed: a live terminal failed three times; the failure went up.
export const failTerminal = (
  _t: Live,
  why: Failure,
  at: Time,
): Failed => ({ _tag: 'Failed', why, at })

// A new act of its agent brings a failed terminal back, with no person.
export const recoverTerminal = (_t: Failed, at: Time): Live => ({
  _tag: 'Live',
  activity: { _tag: 'Busy', lastOutput: at },
})

// Terminal.Stopped: the person's Stop, from any state.
export const stopTerminal = (_t: TerminalState, at: Time): Stopped => ({ _tag: 'Stopped', at })

// Terminal.Resumed: only the person resumes a stopped terminal, or a failed one (the failure
// is cleared); it starts again. No automatic move takes a Stopped one: the rule is this type.
export const resumeTerminal = (_t: Stopped | Failed, _by: Human, at: Time): Live => ({
  _tag: 'Live',
  activity: { _tag: 'Starting', since: at },
})

// Terminal.Closed: its work ended, so it closes once (a stopped one stays the person's).
export const closeTerminal = (
  _t: Exclude<TerminalState, Stopped>,
  at: Time,
): Extract<TerminalState, { readonly _tag: 'Closed' }> => ({ _tag: 'Closed', at })

// --- every stored move, and its function -------------------------------------------------------

type MoveKind = { [G in EventGroup]: `${G}.${MoveTag<G> & string}` }[EventGroup]

// One entry per stored move kind (events.ts <Record>Move). null: the move changes no state of
// its record.
export const MOVES = {
  'Workflow.RoleWordsChanged': changeRoleWords,
  // The latest fit of a role replaces the one before (Work.fits); a fit has no state.
  'Role.Fitted': null,
  // A draft of new words and its reject change no record: their state follows from the log
  // (core/derived, ruling 2026-11-14).
  'Role.WordsDrafted': null,
  'Role.WordsRejected': null,
  'Run.HostMoved': moveHost,
  'Run.Done': runDone,
  'Run.Closed': runClosed,
  'Problem.Fixed': fixProblem,
  'Terminal.Started': startTerminal,
  'Terminal.Failed': failTerminal,
  'Terminal.Prompted': promptTerminal,
  'Terminal.Stopped': stopTerminal,
  'Terminal.Resumed': resumeTerminal,
  'Terminal.Closed': closeTerminal,
  'Send.Delivered': deliverSend,
  'Send.Dropped': dropSend,
  'Task.Remade': replaceTask,
  // The split task keeps its state; the fold makes its parts and the change.
  'Task.Split': null,
  'Task.Closed': closeTask,
  'Task.Described': describeTask,
  'Assignment.Briefed': briefAssignment,
  'Assignment.BriefedToCheck': briefAssignment,
  'Assignment.BriefedFirst': firstBrief,
  'Assignment.Freed': freeClaim,
  'Assignment.Finished': finishAssignment,
  'Question.Answered': answerQuestion,
  'Permission.Revoked': revokePermission,
  // The source keeps its revision; when it was seen is the time of the move in the log.
  'Source.Checked': null,
  'Forward.Confirmed': confirmForward,
} as const satisfies { readonly [K in MoveKind]: ((...args: never) => unknown) | null }
