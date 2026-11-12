// What the store says about the terminals of the UI (package P9). The supervisor (watcher.ts)
// reads these each tick: the state of each terminal, folded from its stored moves and the acts
// of its agent (ui-model.ts TerminalState, through the moves of moves.ts); the Sends that wait
// and where each goes; the retries since the agent last acted; whom a new act wakes, and the
// words of a wake. Pure: no pump, no store write.
import { human } from '../domain/actor.ts'
import { answererOf, topOfRun } from '../domain/derived.ts'
import type { Event, ForwardedAct, ReviewWritten, WakeCause } from '../domain/events.ts'
import type { AssignmentId, EventRef, ResultId, SessionId, TaskId } from '../domain/ids.ts'
import type { Assignment } from '../domain/model.ts'
import {
  closeTerminal,
  promptTerminal,
  recoverTerminal,
  resumeTerminal,
  startTerminal,
  stopTerminal,
  failTerminal,
} from '../domain/moves.ts'
import type { Run, Send, TerminalState } from '../domain/ui-model.ts'
import type { Logged, Work } from '../domain/work.ts'
import { taskAccepted, within } from '../engine/queries.ts'
import { currentTask, hostOf, rootOf, runOf } from '../engine/runs.ts'

export type Cause = typeof WakeCause.Type

// The tiers that run in a terminal of their own; a Luna runs inside its parent's.
export const TIER = { high: 'sol', medium: 'terra' } as const
export type TerminalTier = (typeof TIER)[keyof typeof TIER]

export const seqOf = (ref: EventRef): number => Number(ref.slice(1))
export const refOf = (seq: number): EventRef => `e${seq}` as EventRef

// The terminal tier of an assignment's role, or undefined for a Luna or a program.
export const tierOf = (work: Work, a: Assignment): TerminalTier | undefined => {
  const role = work.workflow.roles.get(a.role)
  if (role?._tag !== 'Model') return undefined
  return role.tier === 'high' || role.tier === 'medium' ? TIER[role.tier] : undefined
}

// The nearest real agent (a Sol or a Terra) at or above an assignment.
export const realAgentOf = (work: Work, id: AssignmentId | undefined): Assignment | undefined => {
  for (let a = id === undefined ? undefined : work.assignments.get(id); a !== undefined; ) {
    if (tierOf(work, a) !== undefined) return a
    a = a.parent._tag === 'Parent' ? work.assignments.get(a.parent.id) : undefined
  }
  return undefined
}

// The top task of a run now (after its remakes), or undefined while the host still talks.
export const topNow = (work: Work, run: Run): TaskId | undefined => {
  const opened = topOfRun(work, run.id)
  return opened === undefined ? undefined : currentTask(work, opened)
}
const isOpen = (run: Run) => run.end._tag === 'NotEnded'

// --- the state of each terminal, folded ------------------------------------------------------

// The terminal whose agent wrote an event: an agent's own, or a run's (its host's task draft).
export const sessionOfAuthor = (work: Work, author: Logged['recorded']['author']) => {
  if (author._tag === 'Agent') return work.sessions.get(author.assignment)?.session
  if (author._tag === 'Host') return work.runs.get(author.run)?.session
  return undefined
}

// Folds stored events into the states of the terminals (into is changed): a run's start and a
// Terminal move name their session; any act of an agent touches the terminal it runs in, and
// brings a failed one back with no person. A move that the state does not allow (a prompt of a
// stopped terminal, a second close) leaves the state as it is: only the person leaves Stopped.
export const foldTerminals = (
  into: Map<SessionId, TerminalState>,
  work: Work,
  events: ReadonlyArray<Logged>,
): void => {
  for (const { recorded } of events) {
    const { event: e, at, author } = recorded
    if (e._tag === 'Run' && 'create' in e) {
      into.set(e.create.session, startTerminal(at))
      continue
    }
    if (e._tag === 'Terminal') {
      const prev = into.get(e.id)
      const next = terminalMove(prev, e.move, at, author)
      if (next !== undefined) into.set(e.id, next)
      continue
    }
    const sid = sessionOfAuthor(work, author)
    const prev = sid === undefined ? undefined : into.get(sid)
    if (sid !== undefined && prev?._tag === 'Failed') into.set(sid, recoverTerminal(prev, at))
  }
}

type TerminalMove = Extract<Event, { readonly _tag: 'Terminal' }>['move']
const terminalMove = (
  prev: TerminalState | undefined,
  move: TerminalMove,
  at: Logged['recorded']['at'],
  author: Logged['recorded']['author'],
): TerminalState | undefined => {
  switch (move._tag) {
    // A new token for an agent with no terminal: it starts again (never out of a Stop).
    case 'Started':
      return prev?._tag === 'Stopped' ? prev : startTerminal(at)
    case 'Prompted':
      return prev?._tag === 'Live' ? promptTerminal(prev, move.line) : prev
    case 'Failed':
      return prev?._tag === 'Live' ? failTerminal(prev, move.why, at) : prev
    case 'Stopped':
      return stopTerminal(prev ?? startTerminal(at), at)
    case 'Resumed': {
      const by = human(author._tag === 'Person' ? author.name : '')
      if (prev?._tag === 'Stopped' || prev?._tag === 'Failed') return resumeTerminal(prev, by, at)
      // The person's Resume of a live or closed terminal starts it again.
      return startTerminal(at)
    }
    case 'Closed':
      return prev === undefined || prev._tag === 'Stopped' || prev._tag === 'Closed'
        ? prev
        : closeTerminal(prev, at)
  }
}

// The end of work closed this terminal once already (a Resume of the person keeps it open).
export const closedOnce = (work: Work, sid: SessionId): boolean =>
  work.terminalEvents.some((t) => t.session === sid && t.report._tag === 'Closed')

// The last stored event that started, stopped or resumed a terminal, or 0: a send that is older
// was for a process that is gone (bug 15).
const lastRestartSeq = (work: Work, sid: SessionId): number => {
  let seq = 0
  for (const { recorded } of work.events) {
    const e = recorded.event
    const restart =
      (e._tag === 'Run' && 'create' in e && e.create.session === sid) ||
      (e._tag === 'Terminal' &&
        e.id === sid &&
        (e.move._tag === 'Started' || e.move._tag === 'Stopped' || e.move._tag === 'Resumed'))
    if (restart) seq = recorded.seq
  }
  return seq
}
export const staleFor = (work: Work, send: Send, sid: SessionId): boolean =>
  lastRestartSeq(work, sid) > seqOf(send.id)

// The last act of the agent (or the run) of a terminal: its seq and time; seq 0 when none.
export const lastActOf = (
  work: Work,
  sid: SessionId,
): { readonly seq: number; readonly at: number } => {
  for (let i = work.events.length - 1; i >= 0; i--) {
    const { recorded } = work.events[i]!
    if (sessionOfAuthor(work, recorded.author) === sid) {
      return { seq: recorded.seq, at: Date.parse(recorded.at) }
    }
  }
  return { seq: 0, at: 0 }
}

// The retries of a terminal since its agent last acted, or since it last started: a work act
// shows that it works, and its tries start again (the old watcher's retry map).
export const retriesOf = (
  work: Work,
  sid: SessionId,
): { readonly tries: number; readonly lastTry: number } => {
  const since = Math.max(lastActOf(work, sid).seq, lastRestartSeq(work, sid))
  const tries = work.sends.filter((s) => {
    const reason = s.from._tag === 'Supervisor' ? s.from.reason : undefined
    return reason?._tag === 'Retry' && reason.to.session === sid && seqOf(s.id) > since
  })
  const last = tries.at(-1)
  return { tries: tries.length, lastTry: last === undefined ? 0 : Date.parse(last.at) }
}

// The time of the last wake that reached a terminal, or 0: a wake goes out at most each 90 s.
export const lastWakeAt = (work: Work, sid: SessionId): number => {
  const woke = work.sends.filter((s) => {
    const reason = s.from._tag === 'Supervisor' ? s.from.reason : undefined
    return reason?._tag === 'Wake' && reason.to.session === sid && s.state._tag === 'Delivered'
  })
  const last = woke.at(-1)
  return last?.state._tag === 'Delivered' ? Date.parse(last.state.at) : 0
}

// The last try of a system problem: its last ProblemRetry send, else the problem's own time.
export const lastProblemTry = (work: Work, problem: string): number => {
  const tries = work.sends.filter(
    (s) =>
      s.from._tag === 'Supervisor' &&
      s.from.reason._tag === 'ProblemRetry' &&
      s.from.reason.problem === problem,
  )
  const last = tries.at(-1)
  const at = last?.at ?? work.problems.get(problem as never)?.at
  return at === undefined ? 0 : Date.parse(at)
}

// --- where a send goes ---------------------------------------------------------------------

// The terminal of the host of a task's tree now.
export const hostSessionOf = (work: Work, task: TaskId): SessionId | undefined => {
  const host = hostOf(work, task)
  return host === undefined ? undefined : work.sessions.get(host)?.session
}
// The host's terminal for a decision: the host of the tree of a problem's or a draft's task, or
// of a run's top task.
const decisionHost = (work: Work, decision: string): SessionId | undefined => {
  const problem = work.problems.get(decision as never)
  if (problem !== undefined) return hostSessionOf(work, problem.stopped)
  const run = work.runs.get(decision as never)
  if (run !== undefined) {
    const top = topNow(work, run)
    return top === undefined ? undefined : hostSessionOf(work, top)
  }
  // A draft shows on the task of the first Reject that it answers (view.ts decisionsOf).
  const draft = work.drafts.get(decision as never)
  const task = draft?.answers.map((a) => taskOfAnswer(work, a)).find((t) => t !== undefined)
  return task === undefined ? undefined : hostSessionOf(work, task)
}
const taskOfAnswer = (work: Work, answer: string): TaskId | undefined => {
  const reject = work.reviews.get(answer.split('.')[0] as never)
  if (reject?._tag !== 'Reject') return undefined
  if (reject.of._tag === 'Result') return work.results.get(reject.of.id)?.task
  return reject.of._tag === 'Task' ? reject.of.id : undefined
}

// The agent of a terminal (its session's assignment that is not a run's host, if any).
const agentOfSession = (work: Work, sid: SessionId): AssignmentId | undefined =>
  [...work.sessions.values()].find((s) => s.session === sid)?.assignment

// The terminal that a send goes into: its destination, or for a reason that names the host of a
// task, that host's terminal now.
export const destinationOf = (work: Work, send: Send): SessionId | undefined => {
  if (send.from._tag === 'Agent') return send.from.to.session
  const reason = send.from.reason
  switch (reason._tag) {
    case 'Start':
    case 'Wake':
    case 'Retry':
      return reason.to.session
    case 'AgentAtPrompt':
    case 'AgentFailed': {
      const ref = reason._tag === 'AgentAtPrompt' ? reason.prompt : reason.failure
      const e = work.events.find((l) => l.recorded.seq === seqOf(ref))?.recorded.event
      const a = e?._tag === 'Terminal' ? agentOfSession(work, e.id) : undefined
      const task = a === undefined ? undefined : work.assignments.get(a)?.task
      return task === undefined ? undefined : hostSessionOf(work, task)
    }
    case 'DecisionNeedsWords':
      return decisionHost(work, reason.decision)
    case 'ProblemRetry': {
      const problem = work.problems.get(reason.problem)
      if (problem === undefined) return undefined
      return hostSessionOf(work, problem.stopped) ?? runOf(work, problem.stopped)?.session
    }
    case 'DraftOpened': {
      const draft = work.taskDrafts.get(reason.draft)
      return draft === undefined ? undefined : work.runs.get(draft.run)?.session
    }
  }
}

// --- whom a new act wakes --------------------------------------------------------------------

// The act of a stored event as the watcher reads it: who acted (the words), whether an agent or
// the person, and the act itself. A forwarded act that counts at once, and the confirm of one
// that waited, are the person's act of their own kind (watcher.ts wakesOf).
export interface ActRead {
  readonly who: string
  readonly agent: AssignmentId | undefined // the agent or program that acted
  readonly person: boolean
  readonly event: Event | ForwardedAct
}
export const actRead = (work: Work, logged: Logged): ActRead => {
  const { event, author } = logged.recorded
  if (event._tag === 'Forward') {
    const forwarded = forwardedOf(work, 'create' in event ? refOf(logged.recorded.seq) : event.id)
    const counted = 'create' in event && forwarded?._tag === 'Counted'
    const confirmed = 'move' in event && forwarded?._tag === 'Confirmable'
    if (forwarded !== undefined && (counted || confirmed)) {
      return { who: forwarded.person, agent: undefined, person: true, event: forwarded.inner }
    }
  }
  const agent =
    author._tag === 'Agent' || author._tag === 'Program' ? author.assignment : undefined
  const who =
    author._tag === 'Person'
      ? author.name
      : agent !== undefined
        ? agent
        : author._tag === 'Host'
          ? author.run
          : author._tag
  return { who, agent, person: author._tag === 'Person', event }
}
const forwardedOf = (work: Work, ref: EventRef) => {
  const forward = work.forwards.get(ref)
  const e = work.events.find((l) => l.recorded.seq === seqOf(ref))?.recorded.event
  const person = e?._tag === 'Forward' && 'create' in e ? e.create.person : undefined
  return forward === undefined || person === undefined ? undefined : { ...forward, person }
}

// A review as the old words read it: its decision word and its target (the old data keys).
export const reviewRead = (
  work: Work,
  review: ReviewWritten,
): {
  readonly decision: string
  readonly target: string
  readonly result: ResultId | undefined
} => {
  switch (review._tag) {
    case 'Accept':
    case 'Reject': {
      const result = review.of._tag === 'Result' ? review.of.id : undefined
      const decision = review._tag === 'Accept' ? 'accept' : 'reject'
      return { decision, target: review.of.id, result }
    }
    case 'Recheck':
      return { decision: 'recheck', target: review.of, result: review.of }
    case 'Escalate':
      return { decision: 'escalate', target: review.of, result: review.of }
    case 'Resolve': {
      const e = work.reviews.get(review.escalation)
      const result = e?._tag === 'Escalate' ? e.of : undefined
      return { decision: 'resolve', target: result ?? review.escalation, result }
    }
  }
}

// The sessions that a decision of the person concerns. A direction draft concerns every real
// agent of the open projects: each next brief follows the new version, and an agent can wait
// for it. A task concerns the host of its project.
export const decisionSessions = (work: Work, target: string): ReadonlyArray<SessionId> => {
  const open = [...work.runs.values()].filter(isOpen)
  if (/^t\d+$/.test(target)) {
    const top = rootOf(work, target as TaskId)
    return open
      .filter((r) => {
        const opened = topOfRun(work, r.id)
        return opened !== undefined && (opened === top || currentTask(work, opened) === top)
      })
      .map((r) => r.session)
  }
  const inOpen = (a: Assignment) =>
    open.some((r) => {
      const top = topNow(work, r)
      return top !== undefined && within(work, a.task, top)
    })
  const agents = [...work.sessions.values()]
    .filter((s) => {
      const a = work.assignments.get(s.assignment)
      return a !== undefined && a.end._tag === 'NotEnded' && inOpen(a)
    })
    .map((s) => s.session)
  return [...new Set([...open.map((r) => r.session), ...agents])]
}

// The open question that a real agent answers now, if it has a terminal.
export const questionWaits = (work: Work) =>
  [...work.questions.values()].flatMap((q) => {
    if (q.status._tag !== 'Open') return []
    const by = answererOf(work, q.answerBy)
    if (typeof by !== 'string') return []
    const a = work.assignments.get(by)
    const sid = a?.end._tag === 'NotEnded' ? work.sessions.get(by)?.session : undefined
    return sid === undefined ? [] : [{ question: q.id, session: sid }]
  })

// The open tasks that need a task, when every task that they need is accepted now.
export const neederTasks = (work: Work, done: TaskId, at: Logged['recorded']['at']) => {
  const accepted = (t: TaskId) => taskAccepted(work, t, at)
  if (!accepted(done)) return []
  return [...work.tasks.values()].filter((t) => t.needs.includes(done) && t.needs.every(accepted))
}

// --- the words of a wake ---------------------------------------------------------------------

// The words of one cause, as the old watcher wrote who acted.
export const causeWords = (work: Work, cause: Cause): string => {
  const reviewAt = (ref: EventRef) => {
    const logged = work.events.find((l) => l.recorded.seq === seqOf(ref))
    if (logged === undefined) return undefined
    const act = actRead(work, logged)
    const e = act.event
    return e._tag === 'Review' && 'create' in e ? { act, ...reviewRead(work, e.create) } : undefined
  }
  switch (cause._tag) {
    case 'ChildActed':
      return cause.child
    case 'QuestionAnswered': {
      const q = work.questions.get(cause.question)
      const by = q?.status._tag === 'Answered' ? q.status.by : undefined
      const who = by === undefined ? '' : typeof by === 'string' ? by : by.name
      return `${who} (the answer to ${cause.question})`
    }
    case 'EscalationReviewed': {
      const r = reviewAt(cause.review)
      return `${r?.act.who} (${r?.decision} of ${r?.target}, on the escalation ${cause.escalation})`
    }
    case 'NeedAccepted': {
      const r = reviewAt(cause.review)
      const done = r?.result === undefined ? undefined : work.results.get(r.result)?.task
      return `${r?.act.who} (the accept of ${done}, which ${cause.needer} needs)`
    }
    case 'PersonDecided': {
      const r = reviewAt(cause.review)
      return `${r?.act.who} (${r?.decision} of ${r?.target})`
    }
    case 'QuestionWaits':
      return `${cause.question} (a question for you)`
  }
}

const NEXT = 'Run work next with your token, and do what it says.'
// The line of a wake: who acted, or that the next step changed while the agent waited.
export const wakeLine = (work: Work, causes: ReadonlyArray<Cause>): string =>
  causes.length
    ? `${causes.map((c) => causeWords(work, c)).join(', ')} acted. ${NEXT}`
    : `Your next step changed while you waited. ${NEXT}`

export const sameCause = (a: Cause, b: Cause): boolean => JSON.stringify(a) === JSON.stringify(b)
