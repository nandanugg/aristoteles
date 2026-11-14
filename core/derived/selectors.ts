// The selectors of the effects (BUILD.md 3.4 end, 3.7): pure reads of Derived that each effect
// reacts to. They read RunState and AgentState, never run.end or an assignment's end (C1, S1);
// an irrelevant send is never pending (C5). Only a persistent agent or a run has a terminal
// (ruling 7); an agent's terminal lives to the end of its project (ruling 9). Under ruling 10.1
// no wake, retry of a problem or ask for words is typed: those are steps of nextFor
// (notices.ts). What the pump sees (quiet, busy, at a prompt) is the effect's own memory (D13),
// not here.
import type { Run, SessionId, Work } from '../schema/index.ts'
import { sendSessionOf } from './catalog.ts'
import type {
  Derived,
  HostPanesOf,
  SendsPending,
  TerminalsToClose,
  TerminalsToStart,
  TerminalsToWatch,
  ToStart,
} from './types.ts'

const LIVE = new Set(['Talking', 'Working', 'AwaitingEndAccept'])
const runLive = (d: Derived, run: Run): boolean => LIVE.has(d.states.runs.get(run.id)?._tag ?? '')
// The person's Stop holds until the person's Resume; the end of work closes a terminal once.
const stopped = (w: Work, sid: SessionId): boolean =>
  w.terminalEvents
    .filter(
      (t) => t.session === sid && (t.report._tag === 'Stopped' || t.report._tag === 'Resumed'),
    )
    .at(-1)?.report._tag === 'Stopped'
const closedOnce = (w: Work, sid: SessionId): boolean =>
  w.terminalEvents.some((t) => t.session === sid && t.report._tag === 'Closed')

// S1: the host pane of each live run (RunState, not run.end).
export const hostPanesOf: HostPanesOf = (d) =>
  [...d.moment.work.runs.values()].flatMap((r) =>
    runLive(d, r) && r.terminal._tag === 'Pane'
      ? [
          {
            run: r.id,
            session: r.session,
            socket: r.terminal.socket,
            pane: r.terminal.pane,
            former: r.formerSessions,
          },
        ]
      : [],
  )

// C1, ruling 7: each persistent agent on an assignment with no terminal, or with one that took no
// assignment yet (its launch failed). OnAssignment holds only in a run that is not Done or Closed.
export const terminalsToStart: TerminalsToStart = (d) => {
  const w = d.moment.work
  return [...w.agents.values()].flatMap((x): ReadonlyArray<ToStart> => {
    if (d.states.agents.get(x.id)?._tag !== 'OnAssignment') return []
    if (x.terminal._tag === 'NotStarted') return [{ agent: x.id, session: { _tag: 'New' } }]
    const sid = x.terminal.session
    const again =
      d.moment.outside.terminals[sid] === undefined &&
      !stopped(w, sid) &&
      !closedOnce(w, sid) &&
      ![...w.sessions.values()].some((s) => s.session === sid)
    return again ? [{ agent: x.id, session: { _tag: 'Again', session: sid } }] : []
  })
}

// The started terminal of each persistent agent, with its AgentState.
const agentTerminals = (d: Derived) =>
  [...d.moment.work.agents.values()].flatMap((x) =>
    x.terminal._tag === 'Started'
      ? [{ agent: x.id, session: x.terminal.session, state: d.states.agents.get(x.id) }]
      : [],
  )

// C1, S1, ruling 9: the terminal of an agent whose project is Done or Closed (the end of one
// assignment closes nothing), or of a run that is Done or Closed, once; the person's own pane
// and a stopped terminal stay.
export const terminalsToClose: TerminalsToClose = (d) => {
  const w = d.moment.work
  const out: Array<ReturnType<TerminalsToClose>[number]> = []
  for (const x of agentTerminals(d)) {
    if (x.state?._tag !== 'Ended') continue
    if (closedOnce(w, x.session) || stopped(w, x.session)) continue
    out.push({ session: x.session, owner: { _tag: 'Agent', agent: x.agent } })
  }
  for (const r of w.runs.values()) {
    const state = d.states.runs.get(r.id)?._tag
    if ((state !== 'Done' && state !== 'Closed') || r.terminal._tag === 'Pane') continue
    if (closedOnce(w, r.session) || stopped(w, r.session)) continue
    out.push({ session: r.session, owner: { _tag: 'Run', run: r.id } })
  }
  return out
}

// C1, S1: the terminals that the supervisor watches: live runs, and agents that are not Ended
// (a Between agent too: its process can end), each with a reading of the pump.
export const terminalsToWatch: TerminalsToWatch = (d) => {
  const w = d.moment.work
  const seen = (sid: SessionId) => d.moment.outside.terminals[sid] !== undefined
  const out: Array<ReturnType<TerminalsToWatch>[number]> = []
  for (const r of w.runs.values()) {
    if (runLive(d, r) && seen(r.session)) {
      out.push({ session: r.session, owner: { _tag: 'Run', run: r.id } })
    }
  }
  for (const x of agentTerminals(d)) {
    if (x.state === undefined || x.state._tag === 'Ended' || !seen(x.session)) continue
    out.push({ session: x.session, owner: { _tag: 'Agent', agent: x.agent } })
  }
  return out
}

// C5: each Pending send (an irrelevant one is not), with the terminal that it goes into now.
export const sendsPending: SendsPending = (d) =>
  d.moment.work.sends.flatMap((send) => {
    if (d.states.sends.get(send.id)?._tag !== 'Pending') return []
    const to = sendSessionOf(d.moment, send, d.states)
    return to === undefined ? [] : [{ send: send.id, to }]
  })
