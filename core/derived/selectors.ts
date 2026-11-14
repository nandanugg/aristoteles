// The selectors of the effects (BUILD.md 3.4 end, 3.7): pure reads of Derived that each effect
// reacts to. They read RunState and AssignmentState, never run.end or an assignment's end (C1,
// S1); an irrelevant send is never pending (C5). Under ruling 10.1 no wake, retry of a problem
// or ask for words is typed: those are steps of nextFor (notices.ts). What the pump sees (quiet,
// busy, at a prompt) is the effect's own memory (D13), not here.
import type { Assignment, AssignmentId, Run, SessionId, TaskId, Work } from '../schema/index.ts'
import { sendSessionOf } from './catalog.ts'
import { currentTask, openedTopOf, within } from './reads.ts'
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
// A Sol or a Terra runs in a terminal of its own; a Luna runs inside its parent's.
const realTier = (w: Work, a: Assignment): boolean => {
  const role = w.workflow.roles.get(a.role)
  return role?._tag === 'Model' && (role.tier === 'high' || role.tier === 'medium')
}
const ended = (d: Derived, a: AssignmentId): boolean =>
  d.states.assignments.get(a)?._tag === 'Ended'
// The top task of a run now, after its remakes.
const topNow = (w: Work, run: Run): TaskId | undefined => {
  const opened = openedTopOf(w, run.id)
  return opened === undefined ? undefined : currentTask(w, opened)
}
// The run that holds an assignment's tree, if any.
const runOfAssignment = (w: Work, a: Assignment): Run | undefined =>
  [...w.runs.values()].find((r) => {
    const top = topNow(w, r)
    return top !== undefined && within(w, a.task, top)
  })
const isRunSession = (w: Work, sid: SessionId): boolean =>
  [...w.runs.values()].some((r) => r.session === sid)
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

// C1: each Working Sol or Terra of a live run's tree, with no terminal, or one that never briefed.
export const terminalsToStart: TerminalsToStart = (d) => {
  const w = d.moment.work
  return [...w.assignments.values()].flatMap((a): ReadonlyArray<ToStart> => {
    if (d.states.assignments.get(a.id)?._tag !== 'Working' || !realTier(w, a)) return []
    const run = runOfAssignment(w, a)
    if (run === undefined || !runLive(d, run)) return []
    const sid = w.sessions.get(a.id)?.session
    if (sid === undefined) return [{ assignment: a.id, session: { _tag: 'New' } }]
    const again =
      d.moment.outside.terminals[sid] === undefined &&
      !stopped(w, sid) &&
      !closedOnce(w, sid) &&
      (w.meta.get(a.id)?.briefs ?? 0) === 0 &&
      !isRunSession(w, sid)
    return again ? [{ assignment: a.id, session: { _tag: 'Again', session: sid } }] : []
  })
}

// C1, S1: the terminal of an Ended agent, or of a run that is Done or Closed, once; the person's
// own pane and a stopped terminal stay.
export const terminalsToClose: TerminalsToClose = (d) => {
  const w = d.moment.work
  const out: Array<ReturnType<TerminalsToClose>[number]> = []
  for (const s of w.sessions.values()) {
    const a = w.assignments.get(s.assignment)
    if (a === undefined || isRunSession(w, s.session)) continue
    const run = runOfAssignment(w, a)
    const runEnded = run !== undefined && !runLive(d, run) && topNow(w, run) !== undefined
    if (!ended(d, a.id) && !runEnded) continue
    if (closedOnce(w, s.session) || stopped(w, s.session)) continue
    out.push({ session: s.session, owner: { _tag: 'Agent', assignment: a.id } })
  }
  for (const r of w.runs.values()) {
    const state = d.states.runs.get(r.id)?._tag
    if ((state !== 'Done' && state !== 'Closed') || r.terminal._tag === 'Pane') continue
    if (closedOnce(w, r.session) || stopped(w, r.session)) continue
    out.push({ session: r.session, owner: { _tag: 'Run', run: r.id } })
  }
  return out
}

// C1, S1: the terminals that the supervisor watches: live runs, and agents that are not Ended in
// a run that is not Done or Closed, each with a reading of the pump.
export const terminalsToWatch: TerminalsToWatch = (d) => {
  const w = d.moment.work
  const seen = (sid: SessionId) => d.moment.outside.terminals[sid] !== undefined
  const out: Array<ReturnType<TerminalsToWatch>[number]> = []
  for (const r of w.runs.values()) {
    if (runLive(d, r) && seen(r.session)) {
      out.push({ session: r.session, owner: { _tag: 'Run', run: r.id } })
    }
  }
  for (const s of w.sessions.values()) {
    const a = w.assignments.get(s.assignment)
    if (a === undefined || ended(d, a.id) || isRunSession(w, s.session) || !seen(s.session))
      continue
    const run = runOfAssignment(w, a)
    if (run !== undefined && !runLive(d, run)) continue
    out.push({ session: s.session, owner: { _tag: 'Agent', assignment: a.id } })
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
