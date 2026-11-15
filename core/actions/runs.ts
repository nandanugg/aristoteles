// The actions of the UI's records: runs, task drafts, problems, the host's words, terminals and
// sends.
import { Effect } from 'effect'
import type { Derived } from '../derived/index.ts'
import { currentOf, holds, runOfTree, taskAt } from '../derived/reads.ts'
import type { Refusal } from '../schema/errors.ts'
import {
  create,
  isNonBlank,
  type Event,
  move,
  RoleName,
  type Run,
  type SessionId,
  taskDataOf,
  type Work,
  whereRecord,
} from '../schema/index.ts'
import { readTask, sha } from '../services/index.ts'
import {
  allowed,
  asWrite,
  blank,
  COMMON,
  configUnchanged,
  current,
  no,
  readText,
  type RefusalsOf,
} from './support.ts'
import { checkCaseTwins, checkRealNames, followNeeds } from './tasks.ts'
import type { InputOf } from '../schema/actions.ts'
import type { Action } from './types.ts'

export const REFUSALS = {
  JoinRun: {
    sessionInUse: (session: string) =>
      no(`the session ${session} is in use`, 'Pick', 'start the host with a new session'),
    paneHosts: (run: string) =>
      no(
        `this pane is the host of ${run} already; continue it, or close it`,
        'Pick',
        `continue ${run} in this pane, or close ${run} first`,
      ),
  },
  ContinueRun: {
    noQuote: (run: string) =>
      no(
        'a continue keeps the words of the person: --quote="..."',
        'Write',
        `write the person's words that continue ${run}`,
      ),
    sessionInUse: (session: string) =>
      no(`the session ${session} is in use`, 'Pick', 'continue with a new session'),
    paneHosts: (run: string) =>
      no(`this pane is the host of ${run} already`, 'Pick', `continue ${run} here, or close it`),
  },
  EndRun: {},
  CloseRun: {},
  DraftTask: {
    noRole: (file: string) =>
      no(
        `${file} names no role: add role: <the role that splits the task>`,
        'Write',
        `add role: <the role that splits it> to ${file}`,
      ),
    unknownRole: (role: string) =>
      no(`the draft names the role "${role}", which does not exist`, 'Pick', 'name a role that splits'),
    notSplitter: (role: string) =>
      no(
        `the draft names ${role}, which has no split act; a top task goes to a role that splits`,
        'Pick',
        'name a role of the workflow that splits',
      ),
    closedNeed: (need: string) =>
      no(`${need} is closed; a task does not need a closed task`, 'Pick', 'need an open task'),
    // The host plays the role that splits the top task, and the host is a terminal (ruling 15).
    disposable: (role: string) =>
      no(
        `a top task goes to a persistent role: ${role} is disposable, so it runs only as a ` +
          'subagent of a terminal',
        'Pick',
        'name a persistent role that splits',
      ),
  },
  RecordProblem: {
    noWords: () =>
      no(
        'a system problem needs its words: what happened, and how to fix it',
        'Write',
        'write what happened, and how to fix it',
      ),
  },
  FixProblem: {},
  WriteHostWords: {
    noWords: (on: string) =>
      no(`the words of ${on} need a text`, 'Write', `write the words of ${on}`),
    noHope: (on: string) =>
      no(
        `the words of ${on} need --hope="<what you hope by this change>": the UI shows the diff ` +
          'of the draft between them (work guide decision-words)',
        'Write',
        `write what you hope by ${on}`,
      ),
    hopeOfOfficial: (on: string) =>
      no(
        `${on} is already official; its words take no --hope`,
        'Write',
        `write the words of ${on} with no hope`,
      ),
  },
  StartSession: {
    badId: (session: string) =>
      no(
        `"${session}": a session id is letters, digits, dot, dash`,
        'Pick',
        'name the session with letters, digits, dot, dash',
      ),
    sessionInUse: (session: string) =>
      no(`the session ${session} is in use`, 'Pick', 'start the terminal with a new session'),
  },
  StartAgent: {
    badId: (session: string) =>
      no(
        `"${session}": a session id is letters, digits, dot, dash`,
        'Pick',
        'name the session with letters, digits, dot, dash',
      ),
    sessionInUse: (session: string) =>
      no(`the session ${session} is in use`, 'Pick', 'start the terminal with a new session'),
  },
  ReportTerminal: {
    noTerminal: (session: string) =>
      no(`${session} names no terminal`, 'Pick', 'name the session of a run or an agent'),
  },
  StopTerminal: {
    noTerminal: (session: string) =>
      no(`${session} names no terminal`, 'Pick', 'name the session of a run or an agent'),
  },
  ResumeTerminal: {
    noTerminal: (session: string) =>
      no(`${session} names no terminal`, 'Pick', 'name the session of a run or an agent'),
  },
  Send: {
    noTerminal: (session: string) =>
      no(
        `${session} names no terminal of an agent`,
        'Pick',
        'send to a child that runs in its own terminal',
      ),
  },
  SupervisorSend: {},
  SendDelivered: {
    noSend: (send: string) => no(`${send} is no send`, 'Pick', 'name a send that waits'),
  },
  SendDropped: {
    noSend: (send: string) => no(`${send} is no send`, 'Pick', 'name a send that waits'),
  },
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS

const fail = <A = never>(r: Refusal): Effect.Effect<A, Refusal> => Effect.fail(r)

// --- the reads of runs and terminals ------------------------------------------------------------

// A session id names one terminal for good: a run's, a former host's, or an agent's.
const sessionUsed = (w: Work, session: string): boolean =>
  [...w.runs.values()].some(
    (r) => r.session === session || r.formerSessions.some((s) => s === session),
  ) || [...w.sessions.values()].some((s) => s.session === session)
// The live run whose host runs in this pane of the person's tmux server (S1: its RunState).
const paneHost = (d: Derived, socket: string, pane: string): Run | undefined =>
  [...d.moment.work.runs.values()].find((r) => {
    const state = d.states.runs.get(r.id)?._tag
    return (
      state !== 'Done' &&
      state !== 'Closed' &&
      r.terminal._tag === 'Pane' &&
      r.terminal.socket === socket &&
      r.terminal.pane === pane
    )
  })
// The terminal of a session: a run's (its host), a persistent agent's (ruling 9: also before its
// first assignment), or an assignment's.
const terminalOf = (w: Work, session: SessionId): boolean =>
  [...w.runs.values()].some((r) => r.session === session) ||
  [...w.agents.values()].some(
    (x) => x.terminal._tag === 'Started' && x.terminal.session === session,
  ) ||
  [...w.sessions.values()].some((s) => s.session === session)

// The directions that a task may name, with their current standards in the file's shape.
export const taskDirections = (w: Work) =>
  [...w.directions.values()]
    .flatMap((x) => (x._tag === 'Official' ? [x.id] : []))
    .map((id) => ({
      id,
      standards: currentOf(w, id)
        .standards.flatMap((e) => w.standards.get(e) ?? [])
        .map((s) => ({ where: whereRecord(s.where) })),
    }))

// --- runs ----------------------------------------------------------------------------------------

const JoinRun: Action<'JoinRun'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { session, socket, pane } = input.content.pane
    if (sessionUsed(d.moment.work, session)) return yield* fail(R.JoinRun.sessionInUse(session))
    const other = paneHost(d, socket, pane)
    if (other) return yield* fail(R.JoinRun.paneHosts(other.id))
    return [create('Run', { _tag: 'HostJoined', session, socket, pane })]
  })

const ContinueRun: Action<'ContinueRun'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { run } = input.target
    const { session, socket, pane } = input.content.pane
    const words = input.content.quote
    if (blank(words)) return yield* fail(R.ContinueRun.noQuote(run))
    if (sessionUsed(d.moment.work, session)) {
      return yield* fail(R.ContinueRun.sessionInUse(session))
    }
    // The same pane may continue its own run: the person started the AI CLI again there.
    const other = paneHost(d, socket, pane)
    if (other && other.id !== run) return yield* fail(R.ContinueRun.paneHosts(other.id))
    return [move('Run', run, { _tag: 'HostMoved', session, socket, pane, words })]
  })

const EndRun: Action<'EndRun'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    return [move('Run', input.target.run, { _tag: 'Done' })]
  })

// A page Close is CloseTask of the top task, then this (D11).
const CloseRun: Action<'CloseRun'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    return [move('Run', input.target.run, { _tag: 'Closed' })]
  })

// A host drafts the top task of its project in its file, with the role that splits it.
const DraftTask: Action<'DraftTask'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const w = d.moment.work
    const cwd = d.moment.outside.cwd
    const { file } = input.content
    const text = yield* readText(cwd, file)
    const raw = yield* Effect.try({
      try: () => Bun.YAML.parse(text) as Record<string, unknown> | null,
      catch: (e) => COMMON.badFile(e instanceof Error ? e.message : String(e), file),
    })
    const { role, ...rest } = raw ?? {}
    const read = yield* readTask(file, Bun.YAML.stringify(rest), taskDirections(w)).pipe(
      Effect.mapError(asWrite(file)),
    )
    if (typeof role !== 'string') return yield* fail(R.DraftTask.noRole(file))
    yield* checkRealNames(cwd, read.workspace)
    yield* checkCaseTwins(d, read.workspace)
    const named = w.workflow.roles.get(RoleName.make(role))
    if (named === undefined) return yield* fail(R.DraftTask.unknownRole(role))
    if (!holds(named, 'Split')) return yield* fail(R.DraftTask.notSplitter(role))
    if (named._tag === 'Model' && named.persistence._tag === 'Disposable') {
      return yield* fail(R.DraftTask.disposable(role))
    }
    const task = yield* followNeeds(d, taskDataOf(read), R.DraftTask.closedNeed)
    const drafted = { _tag: 'Drafted' as const, run: input.target.run, task, role: named.role }
    return [create('TaskDraft', drafted)]
  })

// --- problems and the host's words ---------------------------------------------------------------

const RecordProblem: Action<'RecordProblem'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const says = input.content.says
    if (blank(says)) return yield* fail(R.RecordProblem.noWords())
    return [
      create('Problem', { _tag: 'Recorded', stopped: input.target.task, says: says as never }),
    ]
  })

const FixProblem: Action<'FixProblem'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    return [move('Problem', input.target.problem, { _tag: 'Fixed' })]
  })

// One member per kind of decision; a hope only on the words of an open draft.
type WordsInput = InputOf<'WriteHostWords'>
const onDraft = (i: WordsInput): i is Extract<WordsInput, { content: { hope: unknown } }> =>
  i.target.on._tag === 'Draft'
const WriteHostWords: Action<'WriteHostWords'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { text } = input.content
    if (blank(text)) return yield* fail(R.WriteHostWords.noWords(input.target.on.id))
    const words = text as never
    if (!onDraft(input)) {
      const { on } = input.target
      return on._tag === 'Problem'
        ? [create('HostWords', { _tag: 'ProblemWords', on: on.id, text: words })]
        : [create('HostWords', { _tag: 'EndWords', on: on.id, text: words })]
    }
    const { on } = input.target
    const { hope } = input.content
    const official = d.states.revisions.get(on.id)?._tag === 'Official'
    const draft = { _tag: 'DraftWords' as const, on: on.id, text: words }
    if (official) {
      if (hope !== null) return yield* fail(R.WriteHostWords.hopeOfOfficial(on.id))
      return [create('HostWords', { ...draft, hope: null })]
    }
    if (hope === null || !isNonBlank(hope)) return yield* fail(R.WriteHostWords.noHope(on.id))
    return [create('HostWords', { ...draft, hope })]
  })

// --- terminals -----------------------------------------------------------------------------------

const SESSION_WORDS = /^[A-Za-z0-9._-]+$/

// The supervisor starts the terminal of an agent; a new token makes the old one stop working.
const StartSession: Action<'StartSession'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const w = d.moment.work
    const { assignment } = input.target
    const { session, secret } = input.content
    if (!SESSION_WORDS.test(session)) return yield* fail(R.StartSession.badId(session))
    // An Ended owner holds no session (C1): the host of a remade top task hands it on.
    const other = [...w.sessions.values()].some(
      (s) =>
        s.assignment !== assignment &&
        s.session === session &&
        d.states.assignments.get(s.assignment)?._tag !== 'Ended',
    )
    // The session of a run belongs to the host on its top task.
    const a = w.assignments.get(assignment)
    if (a === undefined) return yield* Effect.die('canAct names the assignment')
    const task = taskAt(w, a.task)
    const ofRun = (r: Run) => task.serves._tag === 'TopTask' && runOfTree(w, task.id)?.id === r.id
    const taken = [...w.runs.values()].some((r) => r.session === session && !ofRun(r))
    // One terminal holds many assignments (ruling 9): those of a persistent agent share its
    // started session, and those of the host share the session of its run.
    const runs = a.runs
    const terminal = runs._tag === 'Agent' ? w.agents.get(runs.agent)?.terminal : undefined
    const ofAgent = terminal?._tag === 'Started' && terminal.session === session
    const ofHost = runs._tag === 'Host' && w.runs.get(runs.run)?.session === session
    if (!ofAgent && !ofHost && (other || taken)) {
      return yield* fail(R.StartSession.sessionInUse(session))
    }
    const started = {
      _tag: 'Started' as const,
      for: assignment,
      secret: secret ? sha(secret) : null,
    }
    return [move('Terminal', session, started)]
  })

// The supervisor starts the one terminal of a persistent agent, in a new session (P3).
const StartAgent: Action<'StartAgent'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const w = d.moment.work
    const { session } = input.content
    if (!SESSION_WORDS.test(session)) return yield* fail(R.StartAgent.badId(session))
    const used =
      [...w.runs.values()].some((r) => r.session === session) ||
      [...w.sessions.values()].some(
        (s) => s.session === session && d.states.assignments.get(s.assignment)?._tag !== 'Ended',
      ) ||
      [...w.agents.values()].some(
        (x) => x.terminal._tag === 'Started' && x.terminal.session === session,
      )
    if (used) return yield* fail(R.StartAgent.sessionInUse(session))
    return [move('Agent', input.target.agent, { _tag: 'Started', session })]
  })

const ReportTerminal: Action<'ReportTerminal'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { session } = input.target
    if (!terminalOf(d.moment.work, session))
      return yield* fail(R.ReportTerminal.noTerminal(session))
    return [move('Terminal', session, input.content.move)]
  })

const StopTerminal: Action<'StopTerminal'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { session } = input.target
    if (!terminalOf(d.moment.work, session)) return yield* fail(R.StopTerminal.noTerminal(session))
    return [move('Terminal', session, { _tag: 'Stopped' })]
  })

const ResumeTerminal: Action<'ResumeTerminal'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { session } = input.target
    if (!terminalOf(d.moment.work, session)) {
      return yield* fail(R.ResumeTerminal.noTerminal(session))
    }
    return [move('Terminal', session, { _tag: 'Resumed' })]
  })

// --- sends ---------------------------------------------------------------------------------------

const tmux = (session: SessionId) => ({ _tag: 'Terminal', session, via: { _tag: 'Tmux' } }) as const

// The host's input for the terminal of its child; the author is the sender.
const Send: Action<'Send'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { session } = input.target
    if (![...d.moment.work.sessions.values()].some((s) => s.session === session)) {
      return yield* fail(R.Send.noTerminal(session))
    }
    const from = { _tag: 'Agent' as const, to: tmux(session) }
    return [create('Send', { _tag: 'Sent', from, keys: input.content.keys } as never) as Event]
  })

// The supervisor's send: a start sends only its start words, and every other reason a line or
// Enter (the input pairs them).
const SupervisorSend: Action<'SupervisorSend'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    const from = { _tag: 'Supervisor' as const, reason: input.target.reason }
    return [create('Send', { _tag: 'Sent', from, keys: input.content.keys } as never) as Event]
  })

// A send that is no longer pending makes no event: it was delivered or dropped already (D12).
const sendState = (d: Derived, send: string) => d.states.sends.get(send as never)?._tag

const SendDelivered: Action<'SendDelivered'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { send } = input.target
    const state = sendState(d, send)
    if (state === undefined) return yield* fail(R.SendDelivered.noSend(send))
    if (state !== 'Pending') return []
    return [move('Send', send, { _tag: 'Delivered' })]
  })

const SendDropped: Action<'SendDropped'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { send } = input.target
    const state = sendState(d, send)
    if (state === undefined) return yield* fail(R.SendDropped.noSend(send))
    if (state === 'Delivered' || state === 'Dropped') return []
    return [move('Send', send, { _tag: 'Dropped', why: input.content.why })]
  })

export const ACTIONS = {
  JoinRun,
  ContinueRun,
  EndRun,
  CloseRun,
  DraftTask,
  RecordProblem,
  FixProblem,
  WriteHostWords,
  StartSession,
  StartAgent,
  ReportTerminal,
  StopTerminal,
  ResumeTerminal,
  Send,
  SupervisorSend,
  SendDelivered,
  SendDropped,
}
