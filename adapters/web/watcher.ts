// createWatcher (frozen; package P6): the supervisor of the terminals. tick() renews the Work from
// the store (its own WorkCache), reads the outside (the pump's status, and the markers of the
// agents that wait in `work wait`), derives, and runs reconcile(EFFECTS) once (core/effects). The
// person's acts on the terminals (open, stop, resume, fixed, close) dispatch actions (core/effects
// person.ts); they and the tick run one at a time (bug 14). What a restart must keep is in the
// store; the rest is the memory of this one. Ruling 10.1: the watcher types nothing but a host's
// `work send` into the terminal of its child. The person's acts go through core/actions dispatch,
// not the CLI.
import { Cause, Effect, Exit, Layer, ManagedRuntime, Ref } from 'effect'
import {
  closeRun,
  DispatcherLive,
  EFFECTS,
  EffectLog,
  fixedProblem,
  latest,
  NO_MEMORY,
  type Opened,
  openDraft,
  reconcile,
  resumeSession,
  stopSession,
  Supervision,
  SupervisorMemory,
  TIMING,
} from '../../core/effects/index.ts'
import {
  type ProblemId,
  type RunId,
  SessionId,
  type TaskDraftId,
  type Time,
  type Work,
} from '../../core/schema/index.ts'
import {
  Dir,
  Env,
  FilesLive,
  Now,
  pathOf,
  Readings,
  SpawnLive,
  StoreLive,
  Tokens,
} from '../../core/services/index.ts'
import { workCacheLayer } from '../../core/state/index.ts'
import { pumpLayerOf } from '../live/pump.ts'
import { readWaiting } from '../live/waiting.ts'
import { ReadingsLive } from '../live/readings.ts'
import { tokenSecret } from '../live/tokens.ts'
import { withBriefMeasure } from '../words/index.ts'
import type { Watcher, WatcherOptions } from './frozen.ts'

export type { Watcher, WatcherOptions, WatcherTiming } from './frozen.ts'

// The timer of the ticks.
const TICK_MS = 2000

// The words of an Open on the page, as `work task open <td>` writes them. No token: the host gets
// the token of its Sol from its own `work wait --by=<run>` (ruling 10.1).
const openWords = (opened: Opened): string => {
  const w = opened.acted.dispatched.work
  const task = opened.task === null ? undefined : w.tasks.get(opened.task)
  const head = `${opened.task ?? ''} opened: ${task?.name ?? ''}`
  const { host } = opened
  if (host === null) return head
  const a = w.assignments.get(host.assignment)
  const role = a === undefined ? undefined : w.workflow.roles.get(a.role)
  const tier = role?._tag === 'Model' ? role.tier : 'program'
  return [
    head,
    `${host.assignment} · ${a?.role ?? ''} (${tier}) on ${a?.task ?? ''} ${task?.name ?? ''}`,
    `${host.assignment} is the host of ${host.run}; the host gets its token from work wait.`,
  ].join('\n')
}

export const createWatcher = (options: WatcherOptions): Watcher => {
  const { dir, pump, log = () => {}, clock = () => Date.now() } = options
  const env = options.env ?? process.env
  // The person on whose page the supervisor runs: the author name of its acts.
  // env: git is found on the PATH of process.env.
  const argv = [pathOf('git'), '-C', dir, 'config', 'user.name']
  const person = Bun.spawnSync(argv, { env: process.env })
    .stdout.toString()
    .trim()

  const store = StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env })))
  const io = Layer.mergeAll(
    store,
    FilesLive,
    SpawnLive,
    Layer.succeed(Dir, { cwd: dir }),
    Layer.succeed(Env, { vars: env }),
    Layer.succeed(Now, { read: Effect.sync(() => new Date(clock()).toISOString() as Time) }),
    Layer.succeed(Tokens, { random: Effect.sync(tokenSecret) }),
  )
  // The readings of the outside, with the terminals of this pump, the agents that wait, and the
  // measure of a brief (ruling 10.9, as the CLI measures it).
  const readings = Layer.effect(
    Readings,
    Readings.useSync((base) => ({
      read: (work: Work, at: Time) =>
        Effect.map(base.read(work, at), (outside) =>
          withBriefMeasure(
            { ...outside, terminals: pump.status(), waiting: readWaiting(env) },
            at,
          ),
        ),
    })),
  ).pipe(Layer.provide(ReadingsLive), Layer.provide(Layer.succeed(Dir, { cwd: dir })))
  const services = Layer.mergeAll(io, readings)
  const layer = Layer.mergeAll(
    services,
    pumpLayerOf(pump),
    Layer.effect(
      SupervisorMemory,
      Effect.map(Ref.make(NO_MEMORY), (ref) => ({ ref })),
    ),
    Layer.succeed(EffectLog, { line: (text) => Effect.sync(() => log(text)) }),
    Layer.succeed(Supervision, {
      timing: { ...TIMING, ...options.timing },
      person,
      startedAt: clock(),
    }),
    workCacheLayer(dir).pipe(Layer.provide(store)),
    DispatcherLive.pipe(Layer.provide(services)),
  )
  const runtime = ManagedRuntime.make(layer)

  // An Effect of the watcher as a Promise: a failure is an Error with its words, as the page
  // shows it.
  const run = async <A, E>(
    effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>,
  ): Promise<A> => {
    const exit = await runtime.runPromiseExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    const error = Cause.squash(exit.cause)
    throw error instanceof Error ? new Error(error.message) : new Error(String(error))
  }

  // One act at a time: the tick and the person's acts on the terminals run in turn, so a Fixed
  // and a tick never try one problem together (bug 14).
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <A>(fn: () => Promise<A>): Promise<A> => {
    const next = queue.then(fn, fn)
    queue = next.catch(() => undefined)
    return next
  }

  const round = Effect.gen(function* () {
    const d = yield* latest
    if (d !== null) yield* reconcile(EFFECTS, d)
  })
  let ticking = false
  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      await serial(() =>
        run(round).catch((error: Error) => {
          log(`the watcher: ${error.message}`)
        }),
      )
    } finally {
      ticking = false
    }
  }

  const timer = setInterval(() => void tick(), TICK_MS)
  timer.unref?.()

  return {
    tick,
    stop: () => clearInterval(timer),
    open: (draft) =>
      serial(() => run(openDraft(draft as TaskDraftId)).then((opened) => openWords(opened))),
    stopSession: (sid) => serial(() => run(stopSession(SessionId.make(sid)))),
    resumeSession: (sid, tier) =>
      serial(() => {
        if (tier !== 'sol' && tier !== 'terra') {
          return Promise.reject(new Error(`"${tier}" is not a tier of a terminal (sol, terra)`))
        }
        return run(resumeSession(SessionId.make(sid), tier))
      }),
    fixed: (problem) => serial(() => run(fixedProblem(problem as ProblemId))),
    close: (runId, reason) => serial(() => run(closeRun(runId as RunId, reason))),
  }
}
