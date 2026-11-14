// RetryFailures (C1, S1): the live terminals of owners that are not Ended, in runs that are not
// Done or Closed (the selector reads AssignmentState and RunState: an agent of an ended task is not
// supervised, and a closed run's pane is not watched). Ruling 10.1: nothing is typed.
// - A terminal of an agent that ended, shows error words or is silent restarts with its resume
//   command and the retry prompt as its argument, up to 3 times; then its failure is stored, and
//   the host sees it as a step (core/derived/notices.ts).
// - A prompt of an AI CLI is stored once while it shows: the host of a child sees it as a step and
//   answers it with work send; the host's own prompt is a problem for the person.
// - An agent that waits in `work wait` (its marker, Outside.waiting) waits: it is not silent.
// - The host's own pane is the person's: it never restarts. A host that is silent or shows an
//   error, and does not wait, is a problem for the person; a host that ended is the person's.
import { Effect } from 'effect'
import {
  type Derived,
  SURFACES,
  type ToWatch,
  terminalsToWatch,
  waitingFor,
  type WaitingItem,
} from '../derived/index.ts'
import { rootOf, within } from '../derived/reads.ts'
import type { TerminalReading } from '../schema/outside.ts'
import type { Failure, Settings, TaskId } from '../schema/index.ts'
import { Pump } from '../services/index.ts'
import {
  delivered,
  dropped,
  logLine,
  nowMs,
  see,
  sendLine,
  stateIn,
  step,
  supervise,
  terminalsOf,
  tiersNow,
  to,
} from './acting.ts'
import { clean, DEFAULT_RETRY, fill, hostPromptSays, hostStuckSays } from './lines.ts'
import { lastActOf, retriesOf, tierOf, timeOf } from './terminals.ts'
import { type Memory, Supervision, type WorkEffect } from './types.ts'

// An error shows on the screen until it scrolls away: it counts only when the tool is this quiet.
const ERROR_QUIET = 60000

interface Round {
  readonly d: Derived
  readonly all: ReadonlyArray<ToWatch>
  readonly terminals: Memory['terminals']
  readonly status: Readonly<Record<string, TerminalReading>>
  readonly tiers: Settings['tiers']
  readonly items: ReadonlyArray<WaitingItem>
  readonly now: number
}

// The top task of a run now; none while its host still talks.
const topNowOf = (d: Derived, run: ToWatch['owner']): TaskId | undefined => {
  if (run._tag !== 'Run') return undefined
  const state = d.states.runs.get(run.run)
  return state?._tag === 'Working' || state?._tag === 'AwaitingEndAccept' ? state.top : undefined
}

// A session waits, and is not silent, when it blocks in `work wait`, when the person must act in
// its tree (a talk, a decision, the end of the project), or while another terminal of its tree
// works.
const waits = (r: Round, x: ToWatch, top: TaskId | undefined, silentMs: number): boolean => {
  const w = r.d.moment.work
  if (r.d.moment.outside.waiting?.has(x.session) === true) return true
  if (x.owner._tag === 'Run' && top === undefined) return true
  const root = top === undefined ? undefined : rootOf(w, top)
  const inTree = (task: TaskId) => root !== undefined && within(w, task, root)
  const decides = r.items.some((i) =>
    i.placement._tag === 'OnTask' ? inTree(i.placement.task) : root !== undefined,
  )
  const works = r.all.some((y) => {
    if (y.session === x.session || y.owner._tag !== 'Agent' || top === undefined) return false
    const task = w.assignments.get(y.owner.assignment)?.task
    const reading = r.status[y.session]
    return (
      task !== undefined &&
      within(w, task, top) &&
      reading?.live === true &&
      r.now - reading.lastOutput < silentMs
    )
  })
  return decides || works
}

const watch = (r: Round, x: ToWatch) =>
  Effect.gen(function* () {
    const pump = yield* Pump
    const { timing, startedAt } = yield* Supervision
    const w = r.d.moment.work
    const sid = x.session
    const reading = r.status[sid]
    const state = stateIn(r.terminals, sid)
    if (reading === undefined || state === undefined) return
    // The person's Stop holds, and a closed terminal stays closed.
    if (state._tag === 'Stopped' || state._tag === 'Closed') return
    const host = x.owner._tag === 'Run'
    const a = x.owner._tag === 'Agent' ? w.assignments.get(x.owner.assignment) : undefined
    const tier = host ? 'sol' : a === undefined ? undefined : tierOf(w, a)
    const t = tier === undefined ? undefined : r.tiers[tier]
    const id = x.owner._tag === 'Run' ? x.owner.run : x.owner.assignment
    const top = host ? topNowOf(r.d, x.owner) : a?.task
    const lastAct = lastActOf(w, sid).at
    const { tries, lastTry } = retriesOf(w, sid)
    const tail = yield* pump.tail(sid, 12)
    // A prompt of an AI tool shows its question above its options: the last lines tell.
    const recent = tail.split('\n').slice(-8)
    const asked = recent.findLast((l) => (t?.prompts ?? []).some((p) => l.includes(p)))
    if (asked === undefined && state._tag === 'Live' && state.activity._tag === 'AtPrompt') {
      yield* see(sid, { _tag: 'Busy', lastOutput: timeOf(reading.lastOutput || r.now) })
    }
    const quiet = (ms: number) => r.now - Math.max(ms || startedAt, lastAct)
    const silentMs = (t?.silentMinutes ?? 10) * 60000
    const waiting = waits(r, x, top, silentMs)
    const errorShows = (t?.errors ?? []).some((e) => recent.join('\n').includes(e))
    const kind: Failure | 'prompt' | undefined = reading.ended
      ? 'ended'
      : asked !== undefined
        ? 'prompt'
        : errorShows && !waiting && quiet(reading.lastOutput) > ERROR_QUIET
          ? 'error'
          : quiet(reading.lastOutput) > silentMs && !waiting
            ? 'silent'
            : undefined
    if (kind === undefined || (kind === 'ended' && host)) return

    if (kind === 'prompt') {
      // A prompt is stored once while it shows; the host sees a child's as a step.
      const line = clean(asked ?? '')
      if (state._tag !== 'Live') return
      if (state.activity._tag === 'AtPrompt' && state.activity.line === line) return
      yield* supervise<'ReportTerminal'>({
        _tag: 'ReportTerminal',
        target: { session: sid },
        content: { move: { _tag: 'Prompted', line } },
      })
      yield* see(sid, { _tag: 'AtPrompt', line })
      if (host && top !== undefined) {
        yield* supervise<'RecordProblem'>({
          _tag: 'RecordProblem',
          target: { task: top },
          content: { says: hostPromptSays(line) },
        })
      }
      return
    }

    // A failure goes up once; a new act of the agent, or the person's Resume, brings it back.
    const fail = Effect.gen(function* () {
      if (state._tag === 'Failed') return
      const last = clean(tail.split('\n').slice(-3).join(' / '))
      yield* supervise<'ReportTerminal'>({
        _tag: 'ReportTerminal',
        target: { session: sid },
        content: { move: { _tag: 'Failed', why: kind, lastLines: clean(tail, 600) } },
      })
      if (!host || top === undefined || kind === 'ended') return
      yield* supervise<'RecordProblem'>({
        _tag: 'RecordProblem',
        target: { task: top },
        content: { says: hostStuckSays(kind, last) },
      })
    })
    // The host's own pane never restarts: the person tells it to go on.
    if (host || tries >= 3) return yield* fail
    if (r.now - lastTry < timing.retryGap) return

    // A restart: the resume command with the retry prompt as its argument. A live process stops
    // first (the pump resumes only a terminal that does not run).
    const attempt = tries === 0 ? 1 : tries === 1 ? 2 : 3
    const prompt = t?.retryInput ?? DEFAULT_RETRY
    yield* logLine(`${id}: ${kind}, try ${attempt} of 3`)
    const via = { _tag: 'ResumeArgument' } as const
    const retry = yield* sendLine({ _tag: 'Retry', to: to(sid), attempt, via }, prompt)
    yield* see(sid, { _tag: 'Retrying', why: kind, tries: attempt, lastTry: timeOf(r.now) })
    if (retry === null) return
    const command = fill(t?.resume ?? t?.launch ?? '', { session: sid, prompt })
    const restart = Effect.gen(function* () {
      if (!reading.ended) yield* pump.stop(sid)
      yield* pump.resume(sid, { command, env: {}, cols: 160, rows: 48 })
    })
    const resumed = yield* Effect.result(restart)
    if (resumed._tag === 'Failure') {
      yield* dropped(retry, { _tag: 'TypingFailed' })
      return yield* Effect.fail(resumed.failure)
    }
    yield* delivered(retry)
  })

export const RetryFailures: WorkEffect<'RetryFailures'> = {
  name: 'RetryFailures',
  select: terminalsToWatch,
  react: (all, d) =>
    Effect.gen(function* () {
      const round: Round = {
        d,
        all,
        terminals: yield* terminalsOf(d.moment.work),
        status: yield* (yield* Pump).status,
        tiers: yield* tiersNow,
        // The page decisions: the person must act in the tree of each.
        items: waitingFor(d, { _tag: 'Everyone' }).filter((i) => SURFACES[i._tag].page !== 'None'),
        now: yield* nowMs,
      }
      for (const x of all) yield* step(`session ${x.session}`, watch(round, x))
    }),
}
