// The notices (ruling 10.1): what the watcher typed into a terminal before the ruling of
// 2026-11-13, as steps of the actor that it was for. A child at a prompt of its AI CLI, a child
// whose terminal failed, the end of a project that waits for its host's words, an open problem
// of the host, and a question that waits for its answer. nextFor lists them after the other
// steps, so `work wait` returns on them and invariant 4.2 checks their intents.
import type { Intent, WordsOn } from '../schema/actions.ts'
import type {
  AssignmentId,
  EventRef,
  Failure,
  SessionId,
  TaskId,
  Work,
} from '../schema/index.ts'
import { explainerOf } from './authors.ts'
import { hostOf, placementOf } from './catalog.ts'
import { currentTask, openedTopOf, refOf } from './reads.ts'
import type { Derived, StepWhat } from './types.ts'
import { waitingFor } from './waiting.ts'

type NoticeTag =
  | 'AnswerPrompt'
  | 'RecordFailure'
  | 'RecordAgentFailure'
  | 'WriteEndWords'
  | 'TestProblem'
  | 'WaitsForAnswer'
  | 'Answered'
  | 'Resolved'
export type NoticeWhat = Extract<StepWhat, { readonly _tag: NoticeTag }>

// --- the facts of the log, in seq order ----------------------------------------------------------

type Move = { readonly seq: number; readonly ref: EventRef } & (
  | { readonly _tag: 'Prompted'; readonly line: string }
  | { readonly _tag: 'Failed'; readonly why: Failure; readonly lastLines: string }
  | { readonly _tag: 'Other' }
)
interface Facts {
  // The last terminal move of each session.
  readonly lastMove: ReadonlyMap<SessionId, Move>
  // The last act of each agent (seq, time).
  readonly lastAct: ReadonlyMap<AssignmentId, { readonly seq: number; readonly at: number }>
  // The last input of a host for each session (work send).
  readonly lastSend: ReadonlyMap<SessionId, number>
  // The problems recorded on each task (seq).
  readonly problemsOn: ReadonlyMap<TaskId, ReadonlyArray<number>>
}

const factsOf = (w: Work): Facts => {
  const lastMove = new Map<SessionId, Move>()
  const lastAct = new Map<AssignmentId, { seq: number; at: number }>()
  const lastSend = new Map<SessionId, number>()
  const problemsOn = new Map<TaskId, Array<number>>()
  for (const { recorded } of w.events) {
    const { seq, event: e, author } = recorded
    const at = Date.parse(recorded.at)
    if (author._tag === 'Agent') lastAct.set(author.assignment, { seq, at })
    if (e._tag === 'Terminal') {
      const ref = refOf(seq)
      const m = e.move
      const move: Move =
        m._tag === 'Prompted'
          ? { seq, ref, _tag: 'Prompted', line: m.line }
          : m._tag === 'Failed'
            ? { seq, ref, _tag: 'Failed', why: m.why, lastLines: m.lastLines }
            : { seq, ref, _tag: 'Other' }
      lastMove.set(e.id, move)
    } else if (e._tag === 'Send' && 'create' in e && e.create.from._tag === 'Agent') {
      lastSend.set(e.create.from.to.session, seq)
    } else if (e._tag === 'Problem' && 'create' in e) {
      problemsOn.set(e.create.stopped, [...(problemsOn.get(e.create.stopped) ?? []), seq])
    }
  }
  return { lastMove, lastAct, lastSend, problemsOn }
}

// --- the notices of an actor ---------------------------------------------------------------------

const isRunSession = (w: Work, sid: SessionId): boolean =>
  [...w.runs.values()].some((r) => r.session === sid)

// The assignment that hosts a task's tree now (S11: from its placement).
const hostAssignmentOf = (d: Derived, task: TaskId): AssignmentId | undefined => {
  const host = hostOf(d.moment, placementOf(d.moment, task, d.states), d.states)
  return host._tag === 'Host' ? host.assignment : undefined
}

// Whether an assignment that runs in a terminal acted after a seq: the terminal went on.
const actedAfter = (w: Work, f: Facts, sid: SessionId, seq: number): boolean =>
  [...w.sessions.values()].some(
    (s) => s.session === sid && (f.lastAct.get(s.assignment)?.seq ?? 0) > seq,
  )

// The prompts and failures of the children of a host: one notice for each terminal, also when it
// holds several assignments of one persistent agent (ruling 9).
const childNotices = (d: Derived, host: AssignmentId, f: Facts): ReadonlyArray<NoticeWhat> => {
  const w = d.moment.work
  const out: Array<NoticeWhat> = []
  const noticed = new Set<SessionId>()
  for (const s of w.sessions.values()) {
    const a = w.assignments.get(s.assignment)
    if (a === undefined || isRunSession(w, s.session) || noticed.has(s.session)) continue
    if (d.states.assignments.get(a.id)?._tag === 'Ended') continue
    const move = f.lastMove.get(s.session)
    if (move === undefined || move._tag === 'Other') continue
    // A later act of the child, or of another assignment in its terminal, shows that it went on.
    if (actedAfter(w, f, s.session, move.seq)) continue
    if (hostAssignmentOf(d, a.task) !== host) continue
    noticed.add(s.session)
    if (move._tag === 'Prompted') {
      if ((f.lastSend.get(s.session) ?? 0) > move.seq) continue
      out.push({
        _tag: 'AnswerPrompt',
        agent: a.id,
        task: a.task,
        session: s.session,
        line: move.line,
        prompt: move.ref,
      })
      continue
    }
    if ((f.problemsOn.get(a.task) ?? []).some((seq) => seq > move.seq)) continue
    out.push({
      _tag: 'RecordFailure',
      agent: a.id,
      task: a.task,
      why: move.why,
      lastLines: move.lastLines,
      failure: move.ref,
    })
  }
  // A persistent agent between assignments has no open assignment, so the loop above does not see
  // its terminal: when it failed, the host of its project hears of it on the project's top task.
  for (const x of w.agents.values()) {
    if (x.terminal._tag !== 'Started' || d.states.agents.get(x.id)?._tag !== 'Between') continue
    const move = f.lastMove.get(x.terminal.session)
    if (move?._tag !== 'Failed') continue
    const opened = openedTopOf(w, x.run)
    if (opened === undefined) continue
    const top = currentTask(w, opened)
    if (hostAssignmentOf(d, top) !== host) continue
    if ((f.problemsOn.get(top) ?? []).some((seq) => seq > move.seq)) continue
    out.push({
      _tag: 'RecordAgentFailure',
      agent: x.id,
      task: top,
      why: move.why,
      lastLines: move.lastLines,
      failure: move.ref,
    })
  }
  return out
}

// The host of the decision's project writes its words (an end or a problem has a project).
const hostExplains = (d: Derived, on: WordsOn, host: AssignmentId): boolean => {
  const e = explainerOf(d, on)
  return e._tag === 'Host' && e.assignment === host
}
// The ends that the page holds for this host's words, and its own open problems.
const hostNotices = (d: Derived, host: AssignmentId): ReadonlyArray<NoticeWhat> => {
  const w = d.moment.work
  const out: Array<NoticeWhat> = []
  for (const item of waitingFor(d, { _tag: 'Everyone' })) {
    if (item._tag !== 'RunEnd' || item.hold._tag !== 'HeldForHost') continue
    if (!hostExplains(d, { _tag: 'End', id: item.run }, host)) continue
    out.push({ _tag: 'WriteEndWords', run: item.run })
  }
  for (const [id, state] of d.states.problems) {
    const p = w.problems.get(id)
    if (state._tag !== 'Open' || p === undefined || p.recordedBy._tag !== 'Host') continue
    if (!hostExplains(d, { _tag: 'Problem', id }, host)) continue
    const asks = w.sends.filter(
      (s) =>
        s.from._tag === 'Supervisor' &&
        s.from.reason._tag === 'ProblemRetry' &&
        s.from.reason.problem === id,
    )
    out.push({ _tag: 'TestProblem', problem: id, asked: asks.at(-1)?.id ?? null })
  }
  return out
}

// The questions that the actor asked: open, or answered after its last act. An escalation of a
// result that was resolved after its last act (the old ResolveDone wake).
const askerNotices = (d: Derived, asker: AssignmentId, f: Facts): ReadonlyArray<NoticeWhat> => {
  const out: Array<NoticeWhat> = []
  const last = f.lastAct.get(asker)?.at ?? 0
  for (const [id, state] of d.states.escalations) {
    const x = d.moment.work.reviews.get(id)
    if (state._tag !== 'Resolved' || x?._tag !== 'Escalate' || x.by !== asker) continue
    const resolve = d.moment.work.reviews.get(state.by)
    if (resolve !== undefined && last <= Date.parse(resolve.when)) {
      out.push({ _tag: 'Resolved', escalation: id, result: x.of })
    }
  }
  for (const q of d.moment.work.questions.values()) {
    if (q.from !== asker) continue
    const state = d.states.questions.get(q.id)
    if (state?._tag === 'Open') out.push({ _tag: 'WaitsForAnswer', question: q.id })
    if (state?._tag === 'Answered' && (f.lastAct.get(asker)?.at ?? 0) <= Date.parse(state.when)) {
      out.push({ _tag: 'Answered', question: q.id })
    }
  }
  return out
}

const intentsOf = (what: NoticeWhat): ReadonlyArray<Intent> => {
  switch (what._tag) {
    case 'AnswerPrompt':
      return [{ _tag: 'Send', target: { session: what.session } }]
    case 'RecordFailure':
    case 'RecordAgentFailure':
      return [{ _tag: 'RecordProblem', target: { task: what.task } }]
    case 'WriteEndWords':
      return [{ _tag: 'WriteHostWords', target: { on: { _tag: 'End', id: what.run } } }]
    // A problem waits for the outside: a Do step would end every wait at once while it is broken.
    case 'TestProblem':
    case 'WaitsForAnswer':
    case 'Answered':
    case 'Resolved':
      return []
  }
}

// The notices of an agent that has not ended, each with the intents that would answer it.
export const noticesOf = (
  d: Derived,
  agent: AssignmentId,
): ReadonlyArray<{ readonly what: NoticeWhat; readonly intents: ReadonlyArray<Intent> }> => {
  if (d.states.assignments.get(agent)?._tag === 'Ended') return []
  const f = factsOf(d.moment.work)
  const whats = [
    ...childNotices(d, agent, f),
    ...hostNotices(d, agent),
    ...askerNotices(d, agent, f),
  ]
  return whats.map((what) => ({ what, intents: intentsOf(what) }))
}
