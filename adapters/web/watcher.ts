import { fileURLToPath } from 'node:url'
import { quote } from '../../core/effects/lines.ts'
import { isBootstrapSession, observeBootstrap, stopBootstrap } from '../live/bootstrap.ts'
import { launchOpening } from '../live/markers.ts'
// createWatcher (frozen; package P6): the engine of the terminals. tick() runs engineTick (the
// revives of the work model, from the store alone), then renews the Work from the store (its own
// WorkCache), reads the outside, derives, and runs reconcile(EFFECTS) once (core/effects). Ticks
// run one at a time. What a restart must keep is in the store; the rest is the memory of this
// one. Ruling 10.1: the watcher types nothing but a host's `work send` into the terminal of its
// child.
import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect'
import {
  DispatcherLive,
  EFFECTS,
  EffectLog,
  backoffMemory,
  engineTick,
  latest,
  reconcile,
  Supervision,
  TIMING,
} from '../../core/effects/index.ts'
import type { Time } from '../../core/schema/index.ts'
import {
  Dir,
  Env,
  FilesLive,
  Now,
  pathOf,
  SpawnLive,
  StoreLive,
  Tokens,
} from '../../core/services/index.ts'
import { workCacheLayer } from '../../core/state/index.ts'
import { pumpLayerOf } from '../live/pump.ts'
import { readingsLive } from '../live/readings.ts'
import { tokenSecret } from '../live/tokens.ts'
import type { Watcher, WatcherOptions } from './frozen.ts'

export type { Watcher, WatcherOptions, WatcherTiming } from './frozen.ts'

// The timer of the ticks.
const TICK_MS = 2000

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
  // The readings of the outside, with the terminals of this pump.
  const readings = readingsLive({ terminals: () => pump.status() }).pipe(
    Layer.provide(
      Layer.mergeAll(Layer.succeed(Dir, { cwd: dir }), Layer.succeed(Env, { vars: env })),
    ),
  )
  const services = Layer.mergeAll(io, readings)
  const layer = Layer.mergeAll(
    services,
    pumpLayerOf(pump),
    Layer.succeed(EffectLog, { line: (text) => Effect.sync(() => log(text)) }),
    Layer.succeed(Supervision, { timing: { ...TIMING, ...options.timing }, person }),
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

  // The engine (the revives, the evidence, the rule runs) for a store with a top; then the
  // person's typed sends.
  const say = {
    workerAck: `${quote(process.execPath)} ${quote(fileURLToPath(new URL('../../bin/work.js', import.meta.url)))} worker ack`,
    workerPrompt: (members: ReadonlyArray<string>) =>
      `${launchOpening('a worker')} Your identities are ${members.join(', ')}. Use the identity and receipt selected by each wait.`,
    bootstrap: (session: string) => {
      if (!isBootstrapSession(session)) return null
      const launch = session.slice('boot-'.length)
      return { state: observeBootstrap(dir, launch), stop: () => stopBootstrap(dir, launch) }
    },
  }
  const memory = Effect.runSync(backoffMemory)
  const round = Effect.gen(function* () {
    for (const line of yield* engineTick(say, memory).pipe(
      Effect.catch((e) => Effect.succeed([`the engine: ${e.message}`])),
    )) {
      log(line)
    }
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
  }
}
