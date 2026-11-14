// The Work of a dir as a command loads it, and as the long process caches it (BUILD.md 3.1):
// the store is the source of truth, other processes write it, and the cache folds again only
// when the store has a new seq. The writes here are the CLI's, a connection of its own.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Deferred, Effect, Fiber, Layer, Stream, SubscriptionRef } from 'effect'
import type { Recorded } from '../schema/index.ts'
import { Env, Store, StoreLive } from '../services/index.ts'
import { type Cached, fold, loadWork, WorkCache, workCacheLayer } from './index.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harnessJs from '../../test/harness.js'

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}
interface Project {
  readonly dir: string
  readonly nanda: (line: string, typed?: string) => Promise<Ran>
}
const harness = harnessJs as {
  readonly project: () => Project
  readonly init: (p: Project) => Promise<void>
  readonly started: () => Promise<{ p: Project; lead: string }>
  readonly ok: (r: Ran) => Ran
}
const { ok } = harness

const dbOf = (dir: string) => join(dir, '.work', 'aristoteles.db')
const storeOf = (dir: string) =>
  StoreLive.pipe(
    Layer.provide(Layer.succeed(Env, { vars: { ARISTOTELES_DB: dbOf(dir) } })),
  )
const eventsOf = (dir: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const opened = yield* (yield* Store).open(dir, { create: false })
      return yield* opened.events
    }),
  )
const folded = (cached: Cached) => {
  if (cached._tag !== 'Folded') throw new Error('the dir has a store')
  return cached
}
const lastSeq = (events: ReadonlyArray<Recorded>) => events.at(-1)?.seq

describe('loadWork', () => {
  test('a dir with no store is NoStore; a dir with one is the fold of its events', async () => {
    const p = harness.project()
    const load = Effect.scoped(loadWork(p.dir)).pipe(Effect.provide(storeOf(p.dir)))
    expect(await Effect.runPromise(load)).toEqual({ _tag: 'NoStore' })
    await harness.init(p)
    const events = await Effect.runPromise(eventsOf(p.dir).pipe(Effect.provide(storeOf(p.dir))))
    const cached = folded(await Effect.runPromise(load))
    expect(cached.seq).toBe(lastSeq(events) ?? -1)
    expect(cached.work).toStrictEqual(fold(events))
  }, 30000)
})

describe('the WorkCache of the long process', () => {
  test('refresh folds only on a new seq; changes gives the value now, then a change', async () => {
    const { p } = await harness.started()
    const program = Effect.gen(function* () {
      const cache = yield* WorkCache
      const first = folded(yield* SubscriptionRef.get(cache.ref))
      // The store has no new event: the same value, not a new fold.
      expect(yield* cache.refresh).toBe(first)
      const ready = yield* Deferred.make<void>()
      const seen = yield* SubscriptionRef.changes(cache.ref).pipe(
        Stream.tap(() => Deferred.succeed(ready, undefined)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      )
      yield* Deferred.await(ready)
      expect(yield* cache.refresh).toBe(first)
      // Another process (the CLI, with its own connection) writes the store.
      ok(yield* Effect.promise(() => p.nanda('task open --file=task.yaml')))
      const next = folded(yield* cache.refresh)
      const events = yield* eventsOf(p.dir)
      expect(next.seq).toBe(lastSeq(events) ?? -1)
      expect(next.seq).toBeGreaterThan(first.seq)
      // The new events fold onto the cached Work: the same Work as a fold of every event.
      expect(next.work).toStrictEqual(fold(events))
      const values = Array.from(yield* Fiber.join(seen))
      expect(values).toHaveLength(2)
      expect(values[0]).toBe(first)
      expect(values[1]).toBe(next)
      expect(yield* SubscriptionRef.get(cache.ref)).toBe(next)
    })
    const layer = workCacheLayer(p.dir).pipe(Layer.provideMerge(storeOf(p.dir)))
    await Effect.runPromise(program.pipe(Effect.provide(layer)))
  }, 30000)

  test('a dir with no store yet is NoStore until work init writes it', async () => {
    const p = harness.project()
    const program = Effect.gen(function* () {
      const cache = yield* WorkCache
      expect(yield* SubscriptionRef.get(cache.ref)).toEqual({ _tag: 'NoStore' })
      expect(yield* cache.refresh).toEqual({ _tag: 'NoStore' })
      yield* Effect.promise(() => harness.init(p))
      const now = folded(yield* cache.refresh)
      const events = yield* eventsOf(p.dir)
      expect(now.seq).toBe(lastSeq(events) ?? -1)
      expect(now.work).toStrictEqual(fold(events))
    })
    const layer = workCacheLayer(p.dir).pipe(Layer.provideMerge(storeOf(p.dir)))
    await Effect.runPromise(program.pipe(Effect.provide(layer)))
  }, 30000)
})
