// The steps of the page's records: runs, task drafts, system problems, the terminals of agents,
// the sends of the supervisor and of a host, and the host's words about a decision.
import {
  type AssignmentId,
  type Author,
  type EventOf,
  type EventRef,
  human,
  Moves,
  nextId,
  type ProblemActor,
  type RecordedOf,
  type SentPair,
  type Stepped,
  type Time,
  type Work,
} from '../../schema/index.ts'
import { damaged, put, unchanged } from '../act.ts'

type Seq = { readonly seq: number }
export const eventRef = (seq: number) => `e${seq}` as EventRef

// A new record of the page with the next id of its kind.
const named = <K extends 'run' | 'taskDraft' | 'problem'>(work: Work, kind: K) => {
  const { id, counters } = nextId(work.counters, kind)
  return { id, work: { ...work, counters } }
}
// Who records or fixes a system problem: the host (an agent), the supervisor, or the person.
const problemActorOf = (a: Author): ProblemActor => {
  switch (a._tag) {
    case 'Agent':
      return { _tag: 'Host', assignment: a.assignment }
    case 'Supervisor':
      return { _tag: 'Supervisor', name: a.name }
    default:
      return human('name' in a ? a.name : a._tag)
  }
}

// --- runs ----------------------------------------------------------------------------------------

export const hostJoined = (
  work: Work,
  e: EventOf<'Run.HostJoined'>,
  r: RecordedOf<'Run.HostJoined'>,
): Stepped => {
  const { id, work: next } = named(work, 'run')
  const { session, socket, pane } = e.create
  const terminal = { _tag: 'Pane' as const, socket, pane }
  const run = Moves.startRun({
    _tag: 'Host',
    id,
    session,
    terminal,
    formerSessions: [],
    startedAt: r.at,
  })
  return { work: { ...next, runs: put(next.runs, id, run) }, created: [id] }
}
export const hostStarted = (
  work: Work,
  e: EventOf<'Run.HostStarted'>,
  r: RecordedOf<'Run.HostStarted'>,
): Stepped => {
  const { id, work: next } = named(work, 'run')
  const terminal = { _tag: 'Window' as const }
  const session = e.create.session
  const run = Moves.startRun({
    _tag: 'Host',
    id,
    session,
    terminal,
    formerSessions: [],
    startedAt: r.at,
  })
  return { work: { ...next, runs: put(next.runs, id, run) }, created: [id] }
}
export const hostMoved = (work: Work, e: EventOf<'Run.HostMoved'>, r: Seq): Stepped => {
  const run = work.runs.get(e.id)
  if (run === undefined || run.end._tag !== 'NotEnded') return damaged(r, `${e.id} is no open run`)
  const { session, socket, pane } = e.move
  const terminal = { _tag: 'Pane' as const, socket, pane }
  const moved = Moves.MOVES['Run.HostMoved']({ ...run, end: run.end }, session, terminal)
  return unchanged({ ...work, runs: put(work.runs, e.id, moved) })
}
export const runDone = (
  work: Work,
  e: EventOf<'Run.Done'>,
  r: RecordedOf<'Run.Done'>,
): Stepped => {
  const run = work.runs.get(e.id)
  if (run?._tag !== 'Host' || run.end._tag !== 'NotEnded') {
    return damaged(r, `${e.id} is no open host run`)
  }
  const done = Moves.MOVES['Run.Done']({ ...run, end: run.end }, r.at)
  return unchanged({ ...work, runs: put(work.runs, e.id, done) })
}
export const runClosed = (
  work: Work,
  e: EventOf<'Run.Closed'>,
  r: RecordedOf<'Run.Closed'>,
): Stepped => {
  const run = work.runs.get(e.id)
  if (run === undefined || run.end._tag !== 'NotEnded') return damaged(r, `${e.id} is no open run`)
  const closed = Moves.MOVES['Run.Closed']({ ...run, end: run.end }, r.at)
  return unchanged({ ...work, runs: put(work.runs, e.id, closed) })
}
export const taskDrafted = (
  work: Work,
  e: EventOf<'TaskDraft.Drafted'>,
  r: RecordedOf<'TaskDraft.Drafted'>,
): Stepped => {
  const { id, work: next } = named(work, 'taskDraft')
  const d = e.create
  const draft = Moves.draftTask({ id, run: d.run, task: d.task, role: d.role, at: r.at })
  return { work: { ...next, taskDrafts: put(next.taskDrafts, id, draft) }, created: [id] }
}

// --- system problems -----------------------------------------------------------------------------

export const problemRecorded = (
  work: Work,
  e: EventOf<'Problem.Recorded'>,
  r: RecordedOf<'Problem.Recorded'>,
): Stepped => {
  const { id, work: next } = named(work, 'problem')
  const problem = Moves.recordProblem({
    id,
    stopped: e.create.stopped,
    says: e.create.says,
    recordedBy: problemActorOf(r.author),
    at: r.at,
  })
  return { work: { ...next, problems: put(next.problems, id, problem) }, created: [id] }
}
export const problemFixed = (
  work: Work,
  e: EventOf<'Problem.Fixed'>,
  r: RecordedOf<'Problem.Fixed'>,
): Stepped => {
  const p = work.problems.get(e.id)
  if (p?.fixed._tag !== 'NotFixed') return damaged(r, `${e.id} is no open problem`)
  const by = problemActorOf(r.author)
  const fixed = Moves.MOVES['Problem.Fixed']({ ...p, fixed: p.fixed }, by, r.at)
  return unchanged({ ...work, problems: put(work.problems, e.id, fixed) })
}

// --- terminals -----------------------------------------------------------------------------------

// The session of a real agent, so that the page can resume it; a new token stops the old one.
export const terminalStarted = (
  work: Work,
  e: EventOf<'Terminal.Started'>,
  r: RecordedOf<'Terminal.Started'>,
): Stepped => {
  const a: AssignmentId = e.move.for
  const session = { assignment: a, session: e.id, at: r.at }
  const meta = work.meta.get(a)
  const secret = e.move.secret
  const metas =
    meta === undefined || secret === null ? work.meta : put(work.meta, a, { ...meta, secret })
  return unchanged({ ...work, sessions: put(work.sessions, a, session), meta: metas })
}
// A report of a terminal: it fails, prompts, stops, resumes or closes.
export const terminalReported = (
  work: Work,
  e:
    | EventOf<'Terminal.Failed'>
    | EventOf<'Terminal.Prompted'>
    | EventOf<'Terminal.Stopped'>
    | EventOf<'Terminal.Resumed'>
    | EventOf<'Terminal.Closed'>,
  r: { readonly at: Time },
): Stepped =>
  unchanged({
    ...work,
    terminalEvents: [...work.terminalEvents, { session: e.id, report: e.move, at: r.at }],
  })

// --- sends ---------------------------------------------------------------------------------------

export const sent = (work: Work, e: EventOf<'Send.Sent'>, r: RecordedOf<'Send.Sent'>): Stepped => {
  const s = e.create
  // An agent's send keeps its sender's assignment, the author of the stored event.
  type ByAgent = Extract<SentPair, { readonly from: { readonly _tag: 'Agent' } }>
  const pair: SentPair =
    s.from._tag === 'Agent' && r.author._tag === 'Agent'
      ? {
          from: { _tag: 'Agent', assignment: r.author.assignment, to: s.from.to },
          keys: s.keys as ByAgent['keys'],
        }
      : (s as SentPair)
  const send = Moves.sendText({ ...pair, id: eventRef(r.seq), at: r.at })
  return unchanged({ ...work, sends: [...work.sends, send] })
}
export const delivered = (
  work: Work,
  e: EventOf<'Send.Delivered'>,
  r: RecordedOf<'Send.Delivered'>,
): Stepped => {
  const s = work.sends.find((x) => x.id === e.id)
  if (s?.state._tag !== 'Pending') return damaged(r, `${e.id} is no pending send`)
  const done = Moves.MOVES['Send.Delivered']({ ...s, state: s.state }, r.at)
  return unchanged({ ...work, sends: work.sends.map((x) => (x.id === e.id ? done : x)) })
}
export const dropped = (
  work: Work,
  e: EventOf<'Send.Dropped'>,
  r: RecordedOf<'Send.Dropped'>,
): Stepped => {
  const s = work.sends.find((x) => x.id === e.id)
  if (s?.state._tag !== 'Pending') return damaged(r, `${e.id} is no pending send`)
  const done = Moves.MOVES['Send.Dropped']({ ...s, state: s.state }, r.at, e.move.why)
  return unchanged({ ...work, sends: work.sends.map((x) => (x.id === e.id ? done : x)) })
}

// The host's words about a decision for the person: the latest counts.
export const hostWords = (
  work: Work,
  e:
    | EventOf<'HostWords.ProblemWords'>
    | EventOf<'HostWords.DraftWords'>
    | EventOf<'HostWords.EndWords'>,
  r: { readonly author: { readonly assignment: AssignmentId }; readonly at: Time },
): Stepped => {
  const words = { ...e.create, by: r.author.assignment, at: r.at }
  return unchanged({ ...work, hostWords: put(work.hostWords, e.create.on, words) })
}
