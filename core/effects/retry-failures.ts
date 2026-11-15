// RetryFailures (C1, S1): the live terminals of agents that are not Ended and of runs that are
// not Done or Closed (the selector reads AgentState and RunState: an agent of an ended project is
// not supervised, and a closed run's pane is not watched). Ruling 10.1: nothing is typed.
// - A terminal of an agent that ended, shows error words or is silent restarts with its resume
//   command and the retry prompt as its argument (its launch command and first prompt while it
//   never ran: ranOnce), up to 3 times; then its failure is stored, and the host sees it as a
//   step (core/derived/notices.ts).
// - A prompt of an AI CLI is stored once while it shows: the host of a child sees it as a step and
//   answers it with work send; the host's own prompt is a problem for the person.
// - An agent that waits in `work wait`, or returned from it within its silentMinutes (its marker,
//   livenessOf), is there: it is not silent. An agent Between assignments waits too: its silence
//   and its error words are no fault (ruling 9); an end of its process is.
// - P8: an agent that has a ready step, runs no wait, and showed no sign of life (an act, a
//   return of its wait) for its silentMinutes has stalled at its prompt: it restarts once for that
//   stall, whatever its screen and its tree show. Its work waits for it; nobody else takes it.
// - The host's own pane is the person's: it never restarts. A host that stopped waiting longer
//   than its silentMinutes ago is a problem for the person, once; a host that never waited and is
//   silent or shows an error is one too; a host that ended and never waited is the person's.
import { Effect } from 'effect'
import {
  type Derived,
  nextFor,
  onPage,
  ranOnce,
  type ToWatch,
  terminalsToWatch,
  waitingFor,
  type WaitingItem,
} from '../derived/index.ts'
import { clockOf, lastSeenOf, type Liveness, livenessOf } from '../derived/liveness.ts'
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
  modelsNow,
  to,
} from './acting.ts'
import { clean, DEFAULT_RETRY, fill, hostGoneSays, hostPromptSays, hostStuckSays } from './lines.ts'
import { conversationOf, lastActOf, modelOfSession, retriesOf, timeOf } from './terminals.ts'
import { type Memory, Supervision, type WorkEffect } from './types.ts'

// An error shows on the screen until it scrolls away: it counts only when the tool is this quiet.
const ERROR_QUIET = 60000

interface Round {
  readonly d: Derived
  readonly all: ReadonlyArray<ToWatch>
  readonly terminals: Memory['terminals']
  readonly status: Readonly<Record<string, TerminalReading>>
  readonly models: Settings['models']
  readonly items: ReadonlyArray<WaitingItem>
  readonly now: number
}

// The tasks that a terminal works on: the top task of a run (none while its host still talks), or
// the tasks of an agent's open assignments (none while it is Between).
const tasksOf = (d: Derived, owner: ToWatch['owner']): ReadonlyArray<TaskId> => {
  if (owner._tag === 'Run') {
    const state = d.states.runs.get(owner.run)
    return state?._tag === 'Working' || state?._tag === 'AwaitingEndAccept' ? [state.top] : []
  }
  const state = d.states.agents.get(owner.agent)
  if (state?._tag !== 'OnAssignment') return []
  return state.assignments.flatMap((a) => {
    const task = d.moment.work.assignments.get(a)?.task
    return task === undefined ? [] : [task]
  })
}

// A session waits, and is not silent, when its work wait runs or returned lately, when it has no
// task (a host that talks, an agent Between assignments), when the person must act in the tree of
// its task (a decision, the end of the project), or while another terminal in that tree works.
const waits = (
  r: Round,
  x: ToWatch,
  tasks: ReadonlyArray<TaskId>,
  silentMs: number,
  life: Liveness,
): boolean => {
  const w = r.d.moment.work
  if (life._tag === 'Waits' || life._tag === 'Returned') return true
  if (tasks.length === 0) return true
  return tasks.some((top) => {
    const root = rootOf(w, top)
    const decides = r.items.some((i) =>
      i.placement._tag === 'OnTask' ? within(w, i.placement.task, root) : true,
    )
    const works = r.all.some((y) => {
      if (y.session === x.session || y.owner._tag !== 'Agent') return false
      const reading = r.status[y.session]
      return (
        tasksOf(r.d, y.owner).some((task) => within(w, task, top)) &&
        reading?._tag === 'Live' &&
        r.now - reading.lastOutput < silentMs
      )
    })
    return decides || works
  })
}

// An agent has a ready step: one of its open assignments may act now.
const readyOf = (d: Derived, owner: ToWatch['owner']): boolean => {
  if (owner._tag !== 'Agent') return false
  const state = d.states.agents.get(owner.agent)
  if (state?._tag !== 'OnAssignment') return false
  return state.assignments.some((assignment) =>
    nextFor(d, { _tag: 'Agent', assignment }).some((s) => s._tag === 'Do'),
  )
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
    const model = modelOfSession(w, sid)
    const t = model === undefined ? undefined : r.models[model]
    const id = x.owner._tag === 'Run' ? x.owner.run : x.owner.agent
    const tasks = tasksOf(r.d, x.owner)
    const top = host ? tasks[0] : undefined
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
    const life = livenessOf(r.d.moment.outside.markers, sid, r.now, silentMs)
    const waiting = waits(r, x, tasks, silentMs, life)
    const errorShows = (t?.errors ?? []).some((e) => recent.join('\n').includes(e))
    // P8: a host gone from its wait; an agent stalled at its prompt with a ready step (once for
    // each stall: no try since its last sign of life).
    const seen = Math.max(lastAct, lastSeenOf(life, r.now))
    // An act counts as life too: a host that resumed acts before its wait starts (live, 23:21).
    const gone = host && life._tag === 'Gone' && r.now - seen > silentMs
    const stalled =
      !host &&
      life._tag !== 'Waits' &&
      r.now - Math.max(seen, startedAt) > silentMs &&
      lastTry < seen &&
      readyOf(r.d, x.owner)
    const kind: Failure | 'prompt' | undefined = gone
      ? 'silent'
      : reading._tag === 'Ended'
        ? 'ended'
        : asked !== undefined
          ? 'prompt'
          : stalled
            ? 'silent'
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
      const says =
        life._tag === 'Gone' ? hostGoneSays(String(id), clockOf(life.since)) : hostStuckSays(kind, last)
      yield* supervise<'RecordProblem'>({
        _tag: 'RecordProblem',
        target: { task: top },
        content: { says },
      })
    })
    // The host's own pane never restarts: the person tells it to go on.
    if (host || tries >= 3) return yield* fail
    if (r.now - lastTry < timing.retryGap) return

    // A restart: the resume command with the retry prompt as its argument, which names the
    // agent's own wait (ruling 9). A terminal that never ran has no conversation to resume: its
    // launch command again, with its first prompt. A live process stops first (the pump resumes
    // only a terminal that does not run).
    const attempt = tries === 0 ? 1 : tries === 1 ? 2 : 3
    const ran = ranOnce(w, sid)
    const words = ran ? (t?.retryInput ?? DEFAULT_RETRY) : (t?.start ?? '')
    const prompt = fill(words, { agent: id })
    yield* logLine(`${id}: ${kind}, try ${attempt} of 3`)
    const via = ran ? ({ _tag: 'ResumeArgument' } as const) : ({ _tag: 'LaunchArgument' } as const)
    const retry = yield* sendLine({ _tag: 'Retry', to: to(sid), attempt, via }, prompt)
    yield* see(sid, { _tag: 'Retrying', why: kind, tries: attempt, lastTry: timeOf(r.now) })
    if (retry === null) return
    const template = ran ? (t?.resume ?? t?.launch) : t?.launch
    const session = conversationOf(w, sid, !ran)
    const command = fill(template ?? '', { session, model, prompt })
    const restart = Effect.gen(function* () {
      if (reading._tag === 'Live') yield* pump.stop(sid)
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
        models: yield* modelsNow,
        // The page decisions: the person must act in the tree of each.
        items: waitingFor(d, { _tag: 'Everyone' }).filter(onPage),
        now: yield* nowMs,
      }
      for (const x of all) yield* step(`session ${x.session}`, watch(round, x))
    }),
}
