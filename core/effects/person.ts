// The person's acts on the terminals, from the page (Open, Stop, Resume, Fixed, Close): each one
// dispatches its action as the person on the ui channel and drives the pump. The watcher runs
// them one at a time with its ticks (bug 14). The host's pane is the person's own (Nanda,
// 2026-11-13): the page neither stops nor resumes it, and a Close only stops copying it. Ruling
// 10.1: no act types into a terminal; the host hears of an Open or a Fixed through `work wait`.
import { Effect } from 'effect'
import { canAct, type Derived, hostOf, placementOf, sendsPending } from '../derived/index.ts'
import { currentTask, openedTopOf, runOfTree, within } from '../derived/reads.ts'
import { intentOf } from '../schema/actions.ts'
import { type Refusal, refusal } from '../schema/errors.ts'
import {
  type AssignmentId,
  isNonBlank,
  type NonBlank,
  type ProblemId,
  RoleName,
  type RunId,
  type SessionId,
  type TaskDraftId,
  type TaskId,
  type Time,
} from '../schema/index.ts'
import { Now, Pump, Tokens } from '../services/index.ts'
import {
  act,
  dropped,
  latest,
  personOnPage,
  sendLine,
  stateIn,
  terminalsOf,
  tiersNow,
} from './acting.ts'
import { DEFAULT_RETRY, fill, problemRetryLine } from './lines.ts'
import type { Acted } from './types.ts'

// The words of a choice are never blank here: each one is a literal of this file.
const refuse = (
  message: string,
  kind: 'Pick' | 'Wait',
  next: string,
): Effect.Effect<never, Refusal> =>
  Effect.fail(refusal(message, kind, (isNonBlank(next) ? next : 'wait') as NonBlank))

const now = Effect.flatMap(latest, (d): Effect.Effect<Derived, Refusal> =>
  d === null ? refuse('this dir has no store', 'Wait', 'run work init first') : Effect.succeed(d),
)

// The person's Stop: the terminal goes, the Stop is stored (no retry, no restart, no input until
// the person's Resume), and each send that waits for it is dropped.
export const stopSession = (sid: SessionId) =>
  Effect.gen(function* () {
    yield* (yield* Pump).stop(sid)
    const by = yield* personOnPage
    yield* act({ by, input: { _tag: 'StopTerminal', target: { session: sid }, content: {} } })
    const d = yield* now
    for (const x of sendsPending(d)) {
      if (x.to === sid) yield* dropped(x.send, { _tag: 'StoppedByPerson' })
    }
  })

// The person's Resume, also of a failed terminal: its tries start again.
// canAct first: a refused Resume (a finished agent, the host's own pane) starts no process.
export const resumeSession = (sid: SessionId, tier: 'sol' | 'terra') =>
  Effect.gen(function* () {
    const by = yield* personOnPage
    const input = { _tag: 'ResumeTerminal', target: { session: sid }, content: { tier } } as const
    const may = canAct(yield* now, by, intentOf(input))
    if (may._tag === 'MayNot') return yield* Effect.fail(may.refusal)
    const t = (yield* tiersNow)[tier]
    const retry = t?.retryInput ?? DEFAULT_RETRY
    const command = fill(t?.resume ?? t?.launch ?? '', { session: sid, prompt: retry })
    yield* (yield* Pump).resume(sid, { command, env: {}, cols: 160, rows: 48 })
    yield* act({ by, input })
  })

// Fixed (the person): the UI tries the problem at once. A problem that its host recorded ends
// when the host records its fix: the person's ask is stored (a ProblemRetry send, never typed),
// and the host's `work wait` returns with it. One that the UI recorded (the host itself failed)
// ends now, when the host runs again. The UI starts no host and restarts none.
export const fixedProblem = (problem: ProblemId) =>
  Effect.gen(function* () {
    const d = yield* now
    const p = d.moment.work.problems.get(problem)
    if (p === undefined || d.states.problems.get(problem)?._tag !== 'Open') {
      return yield* refuse(`${problem} is no open system problem`, 'Pick', 'pick an open problem')
    }
    const host = hostOf(d.moment, placementOf(d.moment, p.stopped, d.states), d.states)
    const pump = yield* Pump
    const reading = host._tag === 'Host' ? (yield* pump.status)[host.session] : undefined
    const noHost = () =>
      refuse(
        `${problem}: no host runs to try it; ` +
          'trigger the host in your AI CLI again, then click Fixed',
        'Wait',
        'trigger the host in your AI CLI again',
      )
    if (p.recordedBy._tag === 'Host') {
      if (host._tag === 'NoHost' || reading?.live !== true) return yield* noHost()
      yield* sendLine({ _tag: 'ProblemRetry', problem }, problemRetryLine(problem, p.says))
      return (
        `${problem}: the host tries it again now; ` +
        'the decision goes when the host records the fix.'
      )
    }
    // The host itself failed: its run's terminal now (a continue may have moved it).
    const run = runOfTree(d.moment.work, p.stopped)
    const runState = run === undefined ? undefined : d.states.runs.get(run.id)?._tag
    if (run === undefined || runState === 'Done' || runState === 'Closed') return yield* noHost()
    const terminals = yield* terminalsOf(d.moment.work)
    if (stateIn(terminals, run.session)?._tag === 'Stopped') {
      return yield* refuse(
        `${problem}: you stopped the host; Resume it, then click Fixed`,
        'Wait',
        'resume the host',
      )
    }
    if ((yield* pump.status)[run.session]?.live !== true) return yield* noHost()
    const by = yield* personOnPage
    yield* act({ by, input: { _tag: 'FixProblem', target: { problem }, content: {} } })
    return `${problem}: the host runs, and the problem is fixed.`
  })

// Close: every terminal of the project stops (the host's own pane is only released), its top
// task closes, then the run (D11: CloseTask, then CloseRun).
export const closeRun = (run: RunId, reason: string) =>
  Effect.gen(function* () {
    const d = yield* now
    const w = d.moment.work
    const r = w.runs.get(run)
    if (r === undefined) return yield* refuse(`there is no run ${run}`, 'Pick', 'pick a run')
    const opened = openedTopOf(w, run)
    const top = opened === undefined ? undefined : currentTask(w, opened)
    const pump = yield* Pump
    const ownPane = (sid: SessionId) =>
      Effect.map(pump.paneOf(sid), (p) => p._tag === 'PersonPane')
    for (const s of w.sessions.values()) {
      const a = w.assignments.get(s.assignment)
      if (top === undefined || a === undefined || !within(w, a.task, top)) continue
      if (s.session === r.session || (yield* ownPane(s.session))) continue
      yield* stopSession(s.session)
    }
    if (yield* ownPane(r.session)) yield* pump.release(r.session)
    else yield* stopSession(r.session)
    const by = yield* personOnPage
    const state = top === undefined ? undefined : d.states.tasks.get(top)?._tag
    if (top !== undefined && state !== 'Closed' && state !== 'Replaced') {
      yield* act({ by, input: { _tag: 'CloseTask', target: { task: top }, content: { reason } } })
    }
    yield* act({ by, input: { _tag: 'CloseRun', target: { run }, content: {} } })
  })

// Open: the person opens the drafted top task, then gives it to the Sol role of the draft, and
// lets that role change it (its split) for 30 days (D11: three actions, as `work task open <td>`).
// The host gets the token of its Sol from its own `work wait --by=<run>` (ruling 10.1): no token
// is shown here, and nothing is typed. host: the assignment that the act made, or null.
export interface Opened {
  readonly acted: Acted
  readonly task: TaskId | null
  readonly host: { readonly run: RunId; readonly assignment: AssignmentId } | null
}
const CHANGE_DAYS = 30
export const openDraft = (draft: TaskDraftId) =>
  Effect.gen(function* () {
    const by = yield* personOnPage
    const opened = yield* act({
      by,
      input: { _tag: 'OpenTaskFromDraft', target: { draft }, content: {} },
    })
    const w = opened.dispatched.work
    const td = w.taskDrafts.get(draft)
    const task = opened.dispatched.created.find((id): id is TaskId => /^t\d+$/.test(id))
    if (td === undefined || task === undefined) {
      const none: Opened = { acted: opened, task: task ?? null, host: null }
      return none
    }
    const role = RoleName.make(td.role)
    // The token of this Give is never shown: the host's wait gives the Sol a new one.
    const secret = yield* (yield* Tokens).random
    const given = yield* act({
      by,
      input: { _tag: 'Give', target: { task, role }, content: { maxAttempts: null, secret } },
    })
    const at = Date.parse(yield* (yield* Now).read) + CHANGE_DAYS * 24 * 3600 * 1000
    const until = new Date(at).toISOString() as Time
    const act3 = { _tag: 'Change', changesOf: [task] } as const
    const granted = yield* act({
      by,
      input: { _tag: 'Grant', target: { act: act3, to: role }, content: { until } },
    })
    const assignment = given.dispatched.created.find((id): id is AssignmentId => /^a\d+$/.test(id))
    const result: Opened = {
      acted: granted,
      task,
      host: assignment === undefined ? null : { run: td.run, assignment },
    }
    return result
  })
