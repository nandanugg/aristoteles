// What the store says about the terminals, read by the effects. The state of each terminal is
// folded from its stored moves and refined by what the pump saw (D13): the fold is here; the
// refinement is the effects'. Pure: no pump, no store write.
import {
  type AgentId,
  type AssignmentId,
  type EventRef,
  human,
  type Logged,
  Moves,
  type PersistentAgent,
  type RunId,
  type SessionId,
  type Supervised,
  type TerminalMove,
  type TerminalState,
  type TerminalTier,
  type Time,
  type Work,
} from '../schema/index.ts'

export const seqOf = (ref: EventRef): number => Number(ref.slice(1))
export const refOf = (seq: number): EventRef => `e${seq}` as EventRef
export const msOf = (at: Time): number => Date.parse(at)
export const timeOf = (ms: number): Time => new Date(ms).toISOString() as Time

// The terminal tier of a persistent agent: the tier it kept from its birth (ruling 13). Any tier
// can be persistent, so each has its commands (ruling 10).
const TERMINAL_TIER = { high: 'sol', medium: 'terra', low: 'luna' } as const
export const tierOf = (x: PersistentAgent): TerminalTier => TERMINAL_TIER[x.tier]

// The persistent agent whose terminal a session is.
export const agentOfSession = (w: Work, sid: SessionId): PersistentAgent | undefined =>
  [...w.agents.values()].find((x) => x.terminal._tag === 'Started' && x.terminal.session === sid)

// The terminal whose agent wrote an event: an agent's own, or a run's (its host's task draft).
const sessionOfAuthor = (w: Work, author: Logged['recorded']['author']): SessionId | undefined => {
  if (author._tag === 'Agent') return w.sessions.get(author.assignment)?.session
  if (author._tag === 'Host') return w.runs.get(author.run)?.session
  return undefined
}

// The run, the persistent agent or the assignment that a session stands for. An agent's session
// holds its assignments too (ruling 9), so the agent comes first.
const ownerOf = (w: Work, sid: SessionId): RunId | AgentId | AssignmentId | undefined =>
  [...w.runs.values()].find((r) => r.session === sid)?.id ??
  agentOfSession(w, sid)?.id ??
  [...w.sessions.values()].find((s) => s.session === sid)?.assignment

type Move = typeof TerminalMove.Type
const moved = (
  prev: TerminalState | undefined,
  move: Move,
  at: Time,
  author: Logged['recorded']['author'],
): TerminalState | undefined => {
  switch (move._tag) {
    // A new token for an agent with no terminal: it starts again (never out of a Stop).
    case 'Started':
      return prev?._tag === 'Stopped' ? prev : Moves.startTerminal(at)
    case 'Prompted':
      return prev?._tag === 'Live' ? Moves.promptTerminal(prev, move.line) : prev
    case 'Failed':
      return prev?._tag === 'Live' ? Moves.failTerminal(prev, move.why, at) : prev
    case 'Stopped':
      return Moves.stopTerminal(prev ?? Moves.startTerminal(at), at)
    case 'Resumed': {
      const by = human(author._tag === 'Person' ? author.name : '')
      if (prev?._tag === 'Stopped' || prev?._tag === 'Failed') {
        return Moves.resumeTerminal(prev, by, at)
      }
      // The person's Resume of a live or closed terminal starts it again.
      return Moves.startTerminal(at)
    }
    case 'Closed':
      return prev === undefined || prev._tag === 'Stopped' || prev._tag === 'Closed'
        ? prev
        : Moves.closeTerminal(prev, at)
  }
}

// Folds stored events into the states of the terminals: a run's start (and its move to another
// pane), an agent's start and a Terminal move name their session; any act of an agent touches the
// terminal it runs in, and brings a failed one back with no person. A move that the state does not
// allow (a prompt of a stopped terminal, a second close) leaves the state as it is: only the
// person leaves Stopped.
export const foldTerminals = (
  from: ReadonlyMap<SessionId, Supervised>,
  w: Work,
  events: ReadonlyArray<Logged>,
): ReadonlyMap<SessionId, Supervised> => {
  const into = new Map(from)
  const put = (sid: SessionId, state: TerminalState | undefined) => {
    const owner = into.get(sid)?.for ?? ownerOf(w, sid)
    if (state !== undefined && owner !== undefined) {
      into.set(sid, { session: sid, for: owner, state })
    }
  }
  for (const { recorded } of events) {
    const { event: e, at, author } = recorded
    if (e._tag === 'Run' && 'create' in e) {
      put(e.create.session, Moves.startTerminal(at))
    } else if (e._tag === 'Run' && 'move' in e && e.move._tag === 'HostMoved') {
      put(e.move.session, Moves.startTerminal(at))
    } else if (e._tag === 'Agent') {
      put(e.move.session, Moves.startTerminal(at))
    } else if (e._tag === 'Terminal') {
      put(e.id, moved(into.get(e.id)?.state, e.move, at, author))
    } else {
      const sid = sessionOfAuthor(w, author)
      const prev = sid === undefined ? undefined : into.get(sid)?.state
      if (sid !== undefined && prev?._tag === 'Failed') put(sid, Moves.recoverTerminal(prev, at))
    }
  }
  return into
}

// --- the readers of the store -------------------------------------------------------------------

// The last stored event that started, stopped or resumed a terminal, or 0: the tries of a
// terminal count from it.
const lastRestartSeq = (w: Work, sid: SessionId): number => {
  let seq = 0
  for (const { recorded } of w.events) {
    const e = recorded.event
    const restart =
      (e._tag === 'Run' && 'create' in e && e.create.session === sid) ||
      (e._tag === 'Agent' && e.move.session === sid) ||
      (e._tag === 'Terminal' &&
        e.id === sid &&
        (e.move._tag === 'Started' || e.move._tag === 'Stopped' || e.move._tag === 'Resumed'))
    if (restart) seq = recorded.seq
  }
  return seq
}

// The last act of the agent (or the run) of a terminal: its seq and time; seq 0 when none.
export const lastActOf = (
  w: Work,
  sid: SessionId,
): { readonly seq: number; readonly at: number } => {
  for (let i = w.events.length - 1; i >= 0; i--) {
    const recorded = w.events[i]?.recorded
    if (recorded !== undefined && sessionOfAuthor(w, recorded.author) === sid) {
      return { seq: recorded.seq, at: msOf(recorded.at) }
    }
  }
  return { seq: 0, at: 0 }
}

// The retries of a terminal since its agent last acted, or since it last started: a work act
// shows that it works, and its tries start again.
export const retriesOf = (
  w: Work,
  sid: SessionId,
): { readonly tries: number; readonly lastTry: number } => {
  const since = Math.max(lastActOf(w, sid).seq, lastRestartSeq(w, sid))
  const tries = w.sends.filter((s) => {
    const reason = s.from._tag === 'Supervisor' ? s.from.reason : undefined
    return reason?._tag === 'Retry' && reason.to.session === sid && seqOf(s.id) > since
  })
  const last = tries.at(-1)
  return { tries: tries.length, lastTry: last === undefined ? 0 : msOf(last.at) }
}

// The conversation of the AI CLI that a command of a terminal names ({session}). Each launch
// starts a new one: an AI CLI that started a conversation and crashed before its first wait
// refuses that id as in use. The store keeps the launches (the Start send, and each Retry given
// to the launch command); the first names the session itself, launch n names <session>.n. A
// launch names the next one, a resume the last.
export const conversationOf = (w: Work, sid: SessionId, launch: boolean): string => {
  const launches = w.sends.filter((s) => {
    const r = s.from._tag === 'Supervisor' ? s.from.reason : undefined
    if (r?._tag === 'Start') return r.to.session === sid
    return r?._tag === 'Retry' && r.via._tag === 'LaunchArgument' && r.to.session === sid
  }).length
  const n = launch ? launches + 1 : launches
  return n <= 1 ? sid : `${sid}.${n}`
}
