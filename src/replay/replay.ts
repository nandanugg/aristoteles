// The fold of a dir's events into a Work. Like the owner's fold.ts:
// local builders inside, an immutable Work out. The replay trusts the store: it applies, it never
// checks; a row that does not apply is StoreDamaged at its seq. A new act is checked first
// (checkEvent: the engine's check, or the old handler's refusals of a UI event), then applied.
import { Effect } from 'effect'
import { type Author, human } from '../domain/actor.ts'
import { type Refused, refuse, StoreDamaged } from '../domain/errors.ts'
import {
  type ConfirmableAct,
  type CountedAct,
  type Draft,
  type Event,
  type EventOf,
  type ForwardedAct,
  type Kind,
  kindOf,
  type Recorded,
  type RecordedOf,
} from '../domain/events.ts'
import { isRejectRef, openEscalationOf, topOfRun } from '../domain/derived.ts'
import {
  type AnswerId,
  type AssignmentId,
  type EventRef,
  nextId,
  type PointId,
  type RejectId,
  rejectOf,
  type ReviewId,
  type RoleName,
  type SuggestionId,
  type TaskId,
} from '../domain/ids.ts'
import type { Answerer, By, Review, Stop } from '../domain/model.ts'
import type { ProblemActor, SentPair } from '../domain/ui-model.ts'
import {
  draftTask,
  MOVES,
  recordProblem,
  sendText,
  startRun,
  waitForConfirm,
} from '../domain/moves.ts'
import type { CheckContext, CreatedId, Logged, Stepped, Work } from '../domain/work.ts'
import { type Act, applyAct, checkAct, isEngineEvent, newWork } from '../engine/acts.ts'
import { checked, found, no, refusing } from '../engine/guard.ts'
import { taskAccepted, within } from '../engine/queries.ts'
import { currentTask, hostOf, runOf, topOf } from '../engine/runs.ts'
import { byOf } from './by.ts'

// --- the steps of the fold, one per kind -------------------------------------------------------

// One step per kind of event: a new kind fails the compile here until it has one. A move finds
// the record that it names, narrows it to the state that the move may leave (else the store is
// damaged), and calls its typed transition (domain/moves.ts MOVES); a creation names its record
// with the next id of its kind. The engine's kinds go through applyAct (src/engine/acts.ts),
// after the fold's check of the references that two kinds share a pattern for. A step gives the
// ids that it made, in the old naming order; the replay adds the log entry around it.
type Step<K extends Kind> = (work: Work, event: EventOf<K>, recorded: RecordedOf<K>) => Stepped

// A stored move of a record that is not there, or not in the state that the move leaves.
const damaged = (recorded: { readonly seq: number }, issue: string): never => {
  throw new StoreDamaged({ seq: recorded.seq, issue })
}
const none = (work: Work): Stepped => ({ work, created: [] })
const eventRef = (seq: number) => `e${seq}` as EventRef

// The act of a stored engine event, as the engine judges it.
const actOf = (work: Work, recorded: Recorded): Act => ({
  event: recorded.event as Act['event'],
  by: byOf(work, recorded.author),
  when: recorded.at,
  seq: recorded.seq,
})
const engine =
  <K extends Kind>(): Step<K> =>
  (work, _event, recorded) =>
    applyAct(work, actOf(work, recorded as Recorded))

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
// Only an agent or the person answers (events.ts WRITTEN_BY).
const answererOf = (recorded: RecordedOf<'Question.Answered'>): Answerer =>
  recorded.author._tag === 'Agent' ? recorded.author.assignment : human(recorded.author.name)

const put = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> =>
  new Map(map).set(key, value)

// The fold checks each stored reference whose kinds share one pattern (an escalation, a
// resolve, a reject): the record that it names is of that kind (events.ts, the header).
const referenceIs = (work: Work, id: string, tag: Review['_tag']): boolean =>
  work.reviews.get(id as ReviewId)?._tag === tag
type Seq = { readonly seq: number }
const needReject = (work: Work, r: Seq, id: RejectId | PointId | null): void => {
  if (id !== null && !isRejectRef(work, id)) damaged(r, `${id} is no reject`)
}
const needAnswers = (work: Work, r: Seq, answers: ReadonlyArray<AnswerId>): void => {
  for (const id of answers) {
    if (id.startsWith('s')) {
      if (!work.suggestions.has(id as SuggestionId)) damaged(r, `${id} is no suggestion`)
    } else needReject(work, r, id as RejectId | PointId)
  }
}
// The stop that an evaluation answers: a last try, or the person's Reject.
const needStop = (work: Work, r: Seq, stop: Stop): void => {
  switch (stop._tag) {
    case 'Exhaustion':
      if (!work.exhaustions.has(stop.id)) damaged(r, `${stop.id} is no exhaustion`)
      return
    case 'PersonReject': {
      needReject(work, r, stop.id)
      const reject = work.reviews.get(
        stop.id.includes('.') ? rejectOf(stop.id as PointId) : (stop.id as RejectId),
      )
      if (reject?.by === undefined || typeof reject.by === 'string' || reject.by._tag !== 'Human') {
        damaged(r, `${stop.id} is no reject of the person`)
      }
      return
    }
  }
}
// The review of an evaluation is decided once.
type Target = { readonly _tag: string; readonly id: string }
const needUndecided = (work: Work, r: Seq, of: Target): void => {
  if (of._tag !== 'Evaluation') return
  for (const v of work.reviews.values()) {
    if ((v._tag === 'Accept' || v._tag === 'Reject') && v.of.id === of.id) {
      damaged(r, `${of.id} is decided already`)
    }
  }
}

const makes = (work: Work, role: RoleName): boolean =>
  work.workflow.roles.get(role)?.acts.some((a) => a._tag === 'Do') ?? false

// A new record of the UI with the next id of its kind.
const named = <K extends 'run' | 'taskDraft' | 'problem'>(work: Work, kind: K) => {
  const { id, counters } = nextId(work.counters, kind)
  return { id, work: { ...work, counters } }
}

// The host of a project: the Sol on the top task of a run continues in the session of the run,
// so the UI starts no second terminal for it.
const hostSession = (work: Work, stepped: Stepped, at: Recorded['at']): Stepped => {
  const a = stepped.created.find((id) => id.startsWith('a')) as AssignmentId | undefined
  const given = a === undefined ? undefined : stepped.work.assignments.get(a)
  if (given === undefined) return stepped
  const task = work.tasks.get(given.task)
  const role = work.workflow.roles.get(given.role)
  const run = task?.serves._tag === 'TopTask' ? runOf(work, task.id) : undefined
  if (run === undefined || role?._tag !== 'Model' || role.tier !== 'high') return stepped
  const taken = [...stepped.work.sessions.values()].some(
    (s) =>
      stepped.work.assignments.get(s.assignment)?.task === given.task && s.session === run.session,
  )
  if (taken) return stepped
  const session = { assignment: given.id, session: run.session, at }
  return {
    ...stepped,
    work: { ...stepped.work, sessions: put(stepped.work.sessions, given.id, session) },
  }
}

// A forwarded act that only stops work or informs counts at once (a reject, a question, a
// comment); one that moves work on waits for the person's confirm (an accept, a resolve).
const counts = (inner: ForwardedAct): inner is CountedAct => {
  if (inner._tag === 'Note') return true
  if (inner._tag === 'Question') return 'create' in inner
  return 'create' in inner && inner.create._tag === 'Reject'
}
// The forward that a confirm names, and the person that it is for.
const forwardOf = (work: Work, ref: EventRef) => {
  const logged = work.events.find((l) => eventRef(l.recorded.seq) === ref)
  const e = logged?.recorded.event
  return e?._tag === 'Forward' && 'create' in e ? e.create : undefined
}
// The inner act of a forward, as the person's act at a time.
const innerAct = (
  inner: ForwardedAct,
  person: string,
  recorded: Seq & { readonly at: Recorded['at'] },
): Act => ({
  event: inner,
  by: human(person),
  when: recorded.at,
  seq: recorded.seq,
})

export const STEPS: { readonly [K in Kind]: Step<K> } = {
  'Workflow.Defined': (_work, _e, r) => damaged(r, 'the workflow of a dir is defined once'),
  'Workflow.RoleWordsChanged': engine(),
  'Role.Fitted': (work, e, r) => {
    const fit = { hash: e.move.hash, by: r.author, answers: e.move.answers }
    return none({ ...work, fits: put(work.fits, e.id, fit) })
  },
  'Run.HostStarted': (work, e, r) => {
    const { id, work: next } = named(work, 'run')
    const run = startRun({ _tag: 'Host', id, session: e.create.session, startedAt: r.at })
    return { work: { ...next, runs: put(next.runs, id, run) }, created: [id] }
  },
  'Run.AssessStarted': (work, e, r) => {
    const { id, work: next } = named(work, 'run')
    const run = startRun({ _tag: 'Assess', id, session: e.create.session, startedAt: r.at })
    return { work: { ...next, runs: put(next.runs, id, run) }, created: [id] }
  },
  'Run.Done': (work, e, r) => {
    const run = work.runs.get(e.id)
    if (run?._tag !== 'Host' || run.end._tag !== 'NotEnded') {
      return damaged(r, `${e.id} is no open host run`)
    }
    const done = MOVES['Run.Done']({ ...run, end: run.end }, r.at)
    return none({ ...work, runs: put(work.runs, e.id, done) })
  },
  'Run.Closed': (work, e, r) => {
    const run = work.runs.get(e.id)
    if (run === undefined || run.end._tag !== 'NotEnded') {
      return damaged(r, `${e.id} is no open run`)
    }
    const closed = MOVES['Run.Closed']({ ...run, end: run.end }, r.at)
    return none({ ...work, runs: put(work.runs, e.id, closed) })
  },
  'TaskDraft.Drafted': (work, e, r) => {
    const { id, work: next } = named(work, 'taskDraft')
    const d = e.create
    const draft = draftTask({ id, run: d.run, task: d.task, role: d.role, at: r.at })
    return { work: { ...next, taskDrafts: put(next.taskDrafts, id, draft) }, created: [id] }
  },
  'Problem.Recorded': (work, e, r) => {
    const { id, work: next } = named(work, 'problem')
    const problem = recordProblem({
      id,
      stopped: e.create.stopped,
      says: e.create.says,
      recordedBy: problemActorOf(r.author),
      at: r.at,
    })
    return { work: { ...next, problems: put(next.problems, id, problem) }, created: [id] }
  },
  'Problem.Fixed': (work, e, r) => {
    const p = work.problems.get(e.id)
    if (p?.fixed._tag !== 'NotFixed') return damaged(r, `${e.id} is no open problem`)
    const fixed = MOVES['Problem.Fixed']({ ...p, fixed: p.fixed }, problemActorOf(r.author), r.at)
    return none({ ...work, problems: put(work.problems, e.id, fixed) })
  },
  // The session of a real agent, so that the UI can resume it; a new token stops the old one.
  'Terminal.Started': (work, e, r) => {
    const a = e.move.for
    const session = { assignment: a, session: e.id, at: r.at }
    const meta = work.meta.get(a)
    const secret = e.move.secret
    const metas =
      meta === undefined || secret === null ? work.meta : put(work.meta, a, { ...meta, secret })
    return none({ ...work, sessions: put(work.sessions, a, session), meta: metas })
  },
  'Terminal.Failed': (work, e, r) =>
    none({
      ...work,
      terminalEvents: [...work.terminalEvents, { session: e.id, report: e.move, at: r.at }],
    }),
  'Terminal.Prompted': (work, e, r) =>
    none({
      ...work,
      terminalEvents: [...work.terminalEvents, { session: e.id, report: e.move, at: r.at }],
    }),
  'Terminal.Stopped': (work, e, r) =>
    none({
      ...work,
      terminalEvents: [...work.terminalEvents, { session: e.id, report: e.move, at: r.at }],
    }),
  'Terminal.Resumed': (work, e, r) =>
    none({
      ...work,
      terminalEvents: [...work.terminalEvents, { session: e.id, report: e.move, at: r.at }],
    }),
  'Terminal.Closed': (work, e, r) =>
    none({
      ...work,
      terminalEvents: [...work.terminalEvents, { session: e.id, report: e.move, at: r.at }],
    }),
  'Send.Sent': (work, e, r) => {
    const sent = e.create
    // An agent's send keeps its sender's assignment, the author of the stored event.
    type ByAgent = Extract<SentPair, { readonly from: { readonly _tag: 'Agent' } }>
    const pair: SentPair =
      sent.from._tag === 'Agent' && r.author._tag === 'Agent'
        ? {
            from: { _tag: 'Agent', assignment: r.author.assignment, to: sent.from.to },
            keys: sent.keys as ByAgent['keys'],
          }
        : (sent as SentPair)
    const send = sendText({ ...pair, id: eventRef(r.seq), at: r.at })
    return none({ ...work, sends: [...work.sends, send] })
  },
  'Send.Delivered': (work, e, r) => {
    const s = work.sends.find((x) => x.id === e.id)
    if (s?.state._tag !== 'Pending') return damaged(r, `${e.id} is no pending send`)
    const done = MOVES['Send.Delivered']({ ...s, state: s.state }, r.at)
    return none({ ...work, sends: work.sends.map((x) => (x.id === e.id ? done : x)) })
  },
  'Send.Dropped': (work, e, r) => {
    const s = work.sends.find((x) => x.id === e.id)
    if (s?.state._tag !== 'Pending') return damaged(r, `${e.id} is no pending send`)
    const dropped = MOVES['Send.Dropped']({ ...s, state: s.state }, r.at, e.move.why)
    return none({ ...work, sends: work.sends.map((x) => (x.id === e.id ? dropped : x)) })
  },
  // The host's words about a decision for the person: the latest counts.
  'HostWords.ProblemWords': (work, e, r) => {
    const words = { ...e.create, by: r.author.assignment, at: r.at }
    return none({ ...work, hostWords: put(work.hostWords, e.create.on, words) })
  },
  'HostWords.DraftWords': (work, e, r) => {
    const words = { ...e.create, by: r.author.assignment, at: r.at }
    return none({ ...work, hostWords: put(work.hostWords, e.create.on, words) })
  },
  'HostWords.EndWords': (work, e, r) => {
    const words = { ...e.create, by: r.author.assignment, at: r.at }
    return none({ ...work, hostWords: put(work.hostWords, e.create.on, words) })
  },
  'Task.Opened': engine(),
  'Task.OpenedFromDraft': engine(),
  'Task.Remade': (work, e, r) => {
    needReject(work, r, e.move.review)
    return engine<'Task.Remade'>()(work, e, r)
  },
  'Task.Split': (work, e, r) => {
    needReject(work, r, e.move.review)
    return engine<'Task.Split'>()(work, e, r)
  },
  'Task.Closed': engine(),
  'Task.Described': (work, e, r) => {
    const task = work.tasks.get(e.id) ?? damaged(r, `there is no task ${e.id}`)
    return none({
      ...work,
      tasks: put(work.tasks, e.id, MOVES['Task.Described'](task, e.move.text)),
    })
  },
  // A maker's assignment is of a role that makes, and a reviewer's of one that does not.
  'Assignment.GivenMaker': (work, e, r) => {
    if (!makes(work, e.create.role)) damaged(r, `${e.create.role} makes no result`)
    return hostSession(work, engine<'Assignment.GivenMaker'>()(work, e, r), r.at)
  },
  'Assignment.GivenReviewer': (work, e, r) => {
    if (makes(work, e.create.role)) damaged(r, `${e.create.role} makes results: it has attempts`)
    return hostSession(work, engine<'Assignment.GivenReviewer'>()(work, e, r), r.at)
  },
  'Assignment.Briefed': engine(),
  'Assignment.BriefedToCheck': engine(),
  'Assignment.BriefedFirst': engine(),
  'Assignment.Freed': (work, e, r) => {
    const meta = work.meta.get(e.id) ?? damaged(r, `${e.id} has no claim`)
    return none({ ...work, meta: put(work.meta, e.id, MOVES['Assignment.Freed'](meta)) })
  },
  'Assignment.Finished': engine(),
  'Result.Result': engine(),
  'Review.Accept': (work, e, r) => {
    needUndecided(work, r, e.create.of)
    return engine<'Review.Accept'>()(work, e, r)
  },
  'Review.Reject': (work, e, r) => {
    needUndecided(work, r, e.create.of)
    return engine<'Review.Reject'>()(work, e, r)
  },
  'Review.Recheck': engine(),
  'Review.Escalate': engine(),
  // A resolved escalation has no move back to open: a second Resolve of it is damage.
  'Review.Resolve': (work, e, r) => {
    const id = e.create.escalation
    if (!referenceIs(work, id, 'Escalate')) return damaged(r, `${id} is no escalation`)
    if (openEscalationOf(work, id) === undefined) return damaged(r, `${id} is resolved already`)
    return engine<'Review.Resolve'>()(work, e, r)
  },
  'Question.Asked': engine(),
  'Question.Escalated': engine(),
  'Question.Answered': (work, e, r) => {
    const q = work.questions.get(e.id)
    if (q?.status._tag !== 'Open') {
      return damaged(r, `${e.id} is no open question`)
    }
    const open = { ...q, status: q.status }
    const answered = MOVES['Question.Answered'](open, e.move.text, answererOf(r), r.at)
    return none({ ...work, questions: put(work.questions, e.id, answered) })
  },
  'Note.Message': engine(),
  'Note.Finding': engine(),
  'Evaluation.Evaluation': (work, e, r) => {
    needStop(work, r, e.create.stop)
    return engine<'Evaluation.Evaluation'>()(work, e, r)
  },
  'Suggestion.Suggestion': engine(),
  'Revision.Drafted': (work, e, r) => {
    needAnswers(work, r, e.create.answers)
    return engine<'Revision.Drafted'>()(work, e, r)
  },
  'Revision.Revised': (work, e, r) => {
    needAnswers(work, r, e.create.answers)
    return engine<'Revision.Revised'>()(work, e, r)
  },
  'Revision.Imported': engine(),
  'Permission.Granted': engine(),
  'Permission.Revoked': (work, e, r) => {
    const x = work.permissions.get(e.id)
    if (x?.revoked._tag !== 'NotRevoked') return damaged(r, `${e.id} is no permission in force`)
    const revoked = MOVES['Permission.Revoked']({ ...x, revoked: x.revoked }, r.at)
    return none({ ...work, permissions: put(work.permissions, e.id, revoked) })
  },
  'Source.Moved': (work, e) =>
    none({ ...work, sources: put(work.sources, e.create.source.name, e.create.source) }),
  // The same revision read again: when it was seen is the time of this event (the log's).
  'Source.Checked': (work, e, r) =>
    work.sources.get(e.id)?._tag === 'Outside'
      ? none(work)
      : damaged(r, `${e.id} is no outside source`),
  'Checkpoint.Checkpoint': engine(),
  // The person's act, by the top agent: one that only stops work or informs counts at once.
  'Forward.Forwarded': (work, e, r) => {
    const ref = eventRef(r.seq)
    const { inner, person } = e.create
    if (counts(inner)) {
      const stepped = applyAct(work, innerAct(inner, person, r))
      const forward = { event: ref, _tag: 'Counted' as const, inner }
      return {
        ...stepped,
        work: { ...stepped.work, forwards: put(stepped.work.forwards, ref, forward) },
      }
    }
    const waiting = waitForConfirm(ref, inner as ConfirmableAct)
    return none({ ...work, forwards: put(work.forwards, ref, waiting) })
  },
  'Forward.Confirmed': (work, e, r) => {
    const f = work.forwards.get(e.id)
    if (f?._tag !== 'Confirmable' || f.state._tag !== 'Waiting') {
      return damaged(r, `${e.id} is no forward that waits`)
    }
    const confirmed = MOVES['Forward.Confirmed']({ ...f, state: f.state }, eventRef(r.seq))
    const next = { ...work, forwards: put(work.forwards, e.id, confirmed) }
    // The inner act counts now: the engine applies it, at the time of the confirm.
    const person = forwardOf(work, e.id)?.person ?? damaged(r, `${e.id} is no forward`)
    return applyAct(next, innerAct(f.inner, person, r))
  },
}

// The step of one stored event, through the table, with the ids that it made.
export const stepWith = (work: Work, recorded: Recorded): Stepped =>
  (STEPS[kindOf(recorded.event)] as (w: Work, e: Event, r: Recorded) => Stepped)(
    work,
    recorded.event,
    recorded,
  )
// The Work after one stored event.
export const stepOf = (work: Work, recorded: Recorded): Work => stepWith(work, recorded).work

// --- the fold ---------------------------------------------------------------------------------

// Runs a fold that throws StoreDamaged; any other throw is a bug.
const folding = <A>(run: () => A): Effect.Effect<A, StoreDamaged> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(run())
    } catch (error) {
      return error instanceof StoreDamaged ? Effect.fail(error) : Effect.die(error)
    }
  })

// The Work of a dir. Its first event defines the workflow (work init writes it with the dir), so
// a Work always has its workflow; an empty list or another first event is damage. The log grows
// in one list during the fold; each step reads the events before it. each: called with the Work
// after each event (the migration compares the reader rows that each write would have added).
export const replay = (
  events: ReadonlyArray<Recorded>,
  each?: (work: Work, recorded: Recorded) => void,
): Effect.Effect<Work, StoreDamaged> =>
  folding(() => {
    const [first, ...rest] = events
    const e = first?.event
    if (first === undefined || e?._tag !== 'Workflow' || !('create' in e)) {
      return damaged(first ?? { seq: 0 }, 'the first event does not define the workflow')
    }
    const who = first.author._tag === 'Person' ? first.author.name : first.author._tag
    const log: Array<Logged> = [{ recorded: first, created: [] }]
    let work: Work = { ...newWork(e, who, first.at), events: log }
    each?.(work, first)
    for (const recorded of rest) {
      const stepped = stepWith(work, recorded)
      log.push({ recorded, created: stepped.created })
      work = { ...stepped.work, events: log }
      each?.(work, recorded)
    }
    return work
  })

// One step: the engine acts, the UI events, the forwards and the confirms. The ids that it made
// come back in the old naming order, and the log has the event.
export const applyEvent = (work: Work, recorded: Recorded): Effect.Effect<Stepped, StoreDamaged> =>
  folding(() => {
    const stepped = stepWith(work, recorded)
    const events = [...work.events, { recorded, created: stepped.created }]
    return { work: { ...stepped.work, events }, created: stepped.created }
  })

// --- the checks of the UI events and the forwards ----------------------------

const DIR_WORDS = 'only the host of a project writes the words of a decision'

// An agent records and fixes the problems of its own project only.
const ownProject = (work: Work, author: Author, task: TaskId): void => {
  if (author._tag !== 'Agent') return
  const a = work.assignments.get(author.assignment)
  if (a === undefined || topOf(work, a.task) === topOf(work, task)) return
  no(`${author.assignment} works in another project; the host of that project records its problems`)
}
const runNamed = (work: Work, id: string) => {
  const f = found(work, id, ['h'], refusing)
  return f?._tag === 'Run' ? f.run : no(`there is no run ${id}`)
}
const topTaskOf = (work: Work, run: string): TaskId | undefined => topOfRun(work, run as never)

const checkUi = (work: Work, draft: Draft): void => {
  const recorded = { ...draft, seq: 0 } as Recorded
  const e = recorded.event
  const kind = kindOf(e)
  switch (kind) {
    case 'Run.HostStarted':
    case 'Run.AssessStarted': {
      const session = (e as EventOf<'Run.HostStarted'>).create.session
      const used =
        [...work.runs.values()].some((r) => r.session === session) ||
        [...work.sessions.values()].some((s) => s.session === session)
      if (used) no(`the session ${session} is in use`)
      return
    }
    case 'Run.Done': {
      const id = (e as EventOf<'Run.Done'>).id
      const run = runNamed(work, id)
      const opened = topTaskOf(work, run.id)
      const top = opened === undefined ? undefined : currentTask(work, opened)
      if (top === undefined || !taskAccepted(work, top, draft.at)) {
        no(`${id} is not done: its top task is not accepted${top ? ` (${top})` : ''}`)
      }
      if (run.end._tag === 'Done') no(`${id} is done`)
      if (run.end._tag === 'Closed') no(`${id} is closed`)
      return
    }
    case 'Run.Closed': {
      const id = (e as EventOf<'Run.Closed'>).id
      const run = runNamed(work, id)
      if (run.end._tag === 'Closed') no(`${id} is closed`)
      if (run.end._tag === 'Done') no(`${id} is done; a done project stays done`)
      return
    }
    case 'TaskDraft.Drafted': {
      const d = (e as EventOf<'TaskDraft.Drafted'>).create
      const run = runNamed(work, d.run)
      if (run._tag !== 'Host') no(`${d.run} is an assess run; a host drafts the top task`)
      if (run.end._tag === 'Closed') no(`${d.run} is closed`)
      const top = topTaskOf(work, run.id)
      if (top !== undefined) no(`${d.run} has its top task ${top}; a part of it comes from a split`)
      const role = work.workflow.roles.get(d.role as RoleName)
      if (role === undefined) no(`the draft names the role "${d.role}", which does not exist`)
      const tier = role?._tag === 'Model' ? role.tier : undefined
      if (tier !== 'high') {
        no(`the draft names ${d.role}, a ${tier} role; a top task goes to a high (Sol) role`)
      }
      return
    }
    case 'Problem.Recorded': {
      const d = (e as EventOf<'Problem.Recorded'>).create
      const f = found(work, d.stopped, ['t'], refusing)
      if (f?._tag === 'Task' && f.task.end._tag !== 'NotEnded') {
        no(`${d.stopped} is closed; a closed task is stopped by nothing`)
      }
      ownProject(work, draft.author, d.stopped)
      return
    }
    case 'Problem.Fixed': {
      const id = (e as EventOf<'Problem.Fixed'>).id
      const f = found(work, id, ['sp'], refusing)
      if (f?._tag !== 'Problem') return
      if (f.problem.fixed._tag === 'Fixed') no(`${id} is fixed`)
      ownProject(work, draft.author, f.problem.stopped)
      return
    }
    case 'Terminal.Started': {
      const m = e as EventOf<'Terminal.Started'>
      const f = found(work, m.move.for, ['a'], refusing)
      if (f?._tag !== 'Assignment') return
      const a = f.assignment
      if (a.end._tag !== 'NotEnded') no(`${a.id} is finished`)
      const other = [...work.sessions.values()].some(
        (s) => s.assignment !== a.id && s.session === m.id,
      )
      // The session of a run belongs to the Sol on its top task.
      const task = work.tasks.get(a.task)
      const ofRun = (run: { readonly id: string }) =>
        task?.serves._tag === 'TopTask' && runOf(work, a.task)?.id === run.id
      const taken = [...work.runs.values()].some((r) => r.session === m.id && !ofRun(r))
      if (other || taken) no(`the session ${m.id} is in use`)
      return
    }
    case 'Send.Sent': {
      const sent = (e as EventOf<'Send.Sent'>).create
      if (sent.from._tag !== 'Agent' || draft.author._tag !== 'Agent') return
      const by = work.assignments.get(draft.author.assignment)
      if (by === undefined) return
      const role = work.workflow.roles.get(by.role)
      if (role?._tag !== 'Model' || role.tier !== 'high') {
        no('only the host (a Sol) sends input to the terminal of a child')
      }
      const session = sent.from.to.session
      const to = [...work.sessions.values()].find((s) => s.session === session)?.assignment
      const child = to === undefined ? undefined : work.assignments.get(to)
      if (child === undefined) return
      if (child.id === by.id || !within(work, child.task, by.task)) {
        no(`${child.id} is not a child of ${by.id}`)
      }
      return
    }
    case 'HostWords.ProblemWords':
    case 'HostWords.DraftWords':
    case 'HostWords.EndWords': {
      if (draft.author._tag !== 'Agent') return
      const a = work.assignments.get(draft.author.assignment)
      if (a === undefined || hostOf(work, a.task) !== a.id) no(DIR_WORDS)
      return
    }
    default:
      return
  }
}

// The check of a forward: an act that counts at once is checked as the person's act now; one
// that waits is checked at the confirm. The person confirms only their own.
const checkForward = (work: Work, draft: Draft, seq: number, ctx: CheckContext) =>
  Effect.gen(function* () {
    const e = draft.event
    if (e._tag !== 'Forward') return
    if ('create' in e) {
      const { inner, person } = e.create
      if (counts(inner)) yield* checkAct(work, innerAct(inner, person, { seq, at: draft.at }), ctx)
      return
    }
    const f = work.forwards.get(e.id)
    const forward = forwardOf(work, e.id)
    if (f?._tag !== 'Confirmable' || f.state._tag !== 'Waiting' || forward === undefined) {
      return yield* Effect.fail(
        refuse(`${e.id} is not a forwarded act that waits for a confirm`),
      )
    }
    const who = draft.author._tag === 'Person' ? draft.author.name : ''
    if (forward.person !== who) {
      return yield* Effect.fail(refuse(`${e.id} is ${forward.person}'s to confirm`))
    }
    yield* checkAct(work, innerAct(f.inner, forward.person, { seq, at: draft.at }), ctx)
  })

// The check of a new event before it is stored: the engine's check for an engine act, the old
// handler's refusals for the others (a run that is closed, a session in use...). seq is the seq
// that the event will get (a forward names itself e<seq>).
export const checkEvent = (
  work: Work,
  draft: Draft,
  seq: number,
  ctx: CheckContext,
): Effect.Effect<void, Refused> => {
  const e = draft.event
  if (e._tag === 'Forward') return checkForward(work, draft, seq, ctx)
  if (isEngineEvent(e)) {
    const act: Act = { event: e, by: byOf(work, draft.author), when: draft.at, seq }
    return checkAct(work, act, ctx)
  }
  return checked(() => checkUi(work, draft))
}

// A write in one call: check, then apply. What src/cli/run.ts uses. A passed check that does not
// apply is a bug.
export const stepNew = (
  work: Work,
  draft: Draft,
  seq: number,
  ctx: CheckContext,
): Effect.Effect<Stepped, Refused> =>
  Effect.gen(function* () {
    yield* checkEvent(work, draft, seq, ctx)
    return yield* Effect.orDie(applyEvent(work, { ...draft, seq } as Recorded))
  })

export type { By, CreatedId }
