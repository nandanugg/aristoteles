// The Work of a dir as the store holds it. The CLI loads it once per command (loadWork). The long
// process (the server and its watcher) holds it in a SubscriptionRef that refresh renews: other
// processes (the agents' CLIs) write the store, so the store is the source of truth and the ref
// is only a copy (BUILD.md 3.1).
import { Context, Effect, Layer, Option, type Scope, SubscriptionRef } from 'effect'
import {
  type OutsideFailed,
  type Recorded,
  type Refused,
  StoreDamaged,
  type Work,
} from '../schema/index.ts'
import { type DirStore, Store } from '../services/index.ts'
import { fold, foldStep } from './fold.ts'

// NoStore: work init has not run in the dir yet. seq: the last stored event that the fold read.
export type Cached =
  | { readonly _tag: 'NoStore' }
  | { readonly _tag: 'Folded'; readonly work: Work; readonly seq: number }
const NO_STORE: Cached = { _tag: 'NoStore' }

// changes(ref) gives the value now, then each change; refresh changes it only on a new seq.
export class WorkCache extends Context.Service<
  WorkCache,
  {
    readonly ref: SubscriptionRef.SubscriptionRef<Cached>
    readonly refresh: Effect.Effect<Cached, StoreDamaged | OutsideFailed>
  }
>()('aristoteles/WorkCache') {}

// A fold that throws StoreDamaged becomes a typed failure; any other throw is a bug.
const folding = <A>(run: () => A): Effect.Effect<A, StoreDamaged> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(run())
    } catch (error) {
      return error instanceof StoreDamaged ? Effect.fail(error) : Effect.die(error)
    }
  })

// The store of a dir, open; null when the dir has no store (the store refuses with these words).
const openedOf = (
  store: Context.Service.Shape<typeof Store>,
  dir: string,
): Effect.Effect<DirStore | null, OutsideFailed | Refused | StoreDamaged, Scope.Scope> =>
  store.open(dir, { create: false }).pipe(
    Effect.catchTag('Refused', (e) =>
      /^no work store/.test(e.message) ? Effect.succeed(null) : Effect.fail(e),
    ),
  )

// The events of a dir; null when the dir has no store.
const eventsOf = (
  store: Context.Service.Shape<typeof Store>,
  dir: string,
): Effect.Effect<
  ReadonlyArray<Recorded> | null,
  StoreDamaged | OutsideFailed | Refused,
  Scope.Scope
> =>
  Effect.flatMap(openedOf(store, dir), (opened) =>
    opened === null ? Effect.succeed(null) : opened.events,
  )

// The last seq of an open store, without reading its events.
const lastSeqOf = (opened: DirStore): Effect.Effect<number> =>
  Effect.map(
    opened.query('SELECT MAX(seq) AS seq FROM event WHERE project = ?', opened.dir),
    (rows) => Number(rows[0]?.seq ?? 0),
  )

const foldedOf = (events: ReadonlyArray<Recorded> | null): Effect.Effect<Cached, StoreDamaged> => {
  const last = events?.at(-1)
  if (events === null || last === undefined) return Effect.succeed(NO_STORE)
  return folding(() => ({ _tag: 'Folded', work: fold(events), seq: last.seq }))
}

// The events of a dir, folded. A dir with no store is NoStore, not a failure.
export type LoadWork = (
  dir: string,
) => Effect.Effect<Cached, StoreDamaged | OutsideFailed | Refused, Store | Scope.Scope>
export const loadWork: LoadWork = (dir) =>
  Effect.gen(function* () {
    const store = yield* Store
    return yield* foldedOf(yield* eventsOf(store, dir))
  })

// The cached Work after the events of now. The store only appends, so the events after the
// cached seq fold onto the cached Work; a store with fewer events (replaced) folds again whole.
const renewed = (
  cached: Cached,
  events: ReadonlyArray<Recorded> | null,
): Effect.Effect<Option.Option<Cached>, StoreDamaged> => {
  const last = events?.at(-1)?.seq
  if (cached._tag === 'NoStore') {
    if (last === undefined) return Effect.succeed(Option.none())
    return Effect.map(foldedOf(events), Option.some)
  }
  if (last === cached.seq) return Effect.succeed(Option.none())
  if (events === null || last === undefined || last < cached.seq) {
    return Effect.map(foldedOf(events), Option.some)
  }
  const fresh = events.filter((r) => r.seq > cached.seq)
  return folding(() => {
    const work = fresh.reduce((w, r) => foldStep(w, r).work, cached.work)
    return Option.some<Cached>({ _tag: 'Folded', work, seq: last })
  })
}

// The cache of one dir. It folds the store once when it is made; each refresh probes the last
// seq, and reads, decodes and folds the events only when it moved (a new seq, or a smaller one:
// a replaced store). The ref's own lock keeps two refreshes in order.
export const workCacheLayer = (
  dir: string,
): Layer.Layer<WorkCache, StoreDamaged | OutsideFailed | Refused, Store> =>
  Layer.effect(
    WorkCache,
    Effect.gen(function* () {
      const store = yield* Store
      const ref = yield* SubscriptionRef.make(yield* Effect.scoped(loadWork(dir)))
      const renew = (cached: Cached) =>
        Effect.gen(function* () {
          const opened = yield* openedOf(store, dir)
          if (opened === null) return yield* renewed(cached, null)
          const same = cached._tag === 'Folded' && (yield* lastSeqOf(opened)) === cached.seq
          return same ? Option.none<Cached>() : yield* renewed(cached, yield* opened.events)
        })
      const refresh = SubscriptionRef.modifySomeEffect(ref, (cached) =>
        Effect.scoped(renew(cached)).pipe(
          // Store.open refuses only a dir with no store, which openedOf reads as null.
          Effect.catchTag('Refused', (e) => Effect.die(e)),
          Effect.map((next) => [Option.getOrElse(next, () => cached), next] as const),
        ),
      )
      return { ref, refresh }
    }),
  )
