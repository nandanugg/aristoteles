// The runtime of one CLI call (plan/rebuild/BUILD.md 3.1): the Layers from io, a read (fold the
// store, read the outside, derive) and an act (dispatch, then the Derived of the new Work). The
// CLI gives no terminals; its measure is the length of the brief that adapters/words prints.
import { Effect, Layer, type Scope } from 'effect'
import { dispatch } from '../../core/actions/index.ts'
import type { ActionCall } from '../../core/actions/types.ts'
import { derive, type Derived } from '../../core/derived/index.ts'
import type { ActionInput } from '../../core/schema/actions.ts'
import type {
  Author,
  CreatedId,
  OutsideFailed,
  Refused,
  StoreDamaged,
  Time,
  Work,
} from '../../core/schema/index.ts'
import {
  Dir,
  FilesLive,
  layerOfIo,
  Now,
  Readings,
  SpawnLive,
  Store,
  StoreLive,
  type WorkIo,
} from '../../core/services/index.ts'
import { loadWork, momentOf } from '../../core/state/index.ts'
import { ReadingsLive } from '../live/index.ts'
import { withBriefMeasure } from '../words/index.ts'

// The live readings, with the measure of a brief (ruling 10.9), at the time of the read.
const readingsOfCli: Layer.Layer<Readings, never, Dir> = Layer.effect(
  Readings,
  Effect.gen(function* () {
    const live = yield* Readings.pipe(Effect.provide(ReadingsLive))
    return {
      read: (work, at) => Effect.map(live.read(work, at), (o) => withBriefMeasure(o, at)),
    }
  }),
)

export const layerOf = (io: WorkIo) => {
  const ioLayer = layerOfIo(io)
  return Layer.mergeAll(
    ioLayer,
    FilesLive,
    SpawnLive,
    StoreLive.pipe(Layer.provide(ioLayer)),
    readingsOfCli.pipe(Layer.provide(ioLayer)),
  )
}

export interface Read {
  readonly work: Work
  readonly d: Derived
  // The time of the read: a status is computed at it, so an until that passed has ended.
  readonly at: Time
  readonly dir: string
}

// A read: fold the events, read the clock once, read the outside, derive. A dir with no store
// fails with the words of the store.
export const readWork: Effect.Effect<
  Read,
  Refused | StoreDamaged | OutsideFailed,
  Store | Dir | Now | Readings | Scope.Scope
> = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const loaded = yield* loadWork(cwd)
  if (loaded._tag === 'NoStore') {
    const store = yield* Store
    // The store says why: the same words as an act in a dir with no store.
    yield* store.open(cwd, { create: false })
    return yield* Effect.die(`no work store in ${cwd}, and the store opened`)
  }
  const at = yield* (yield* Now).read
  const d = derive(yield* momentOf(loaded.work, at))
  return { work: loaded.work, d, at, dir: cwd }
})

// A look at the Work before an act (to show something, or to find who may act): no clock reading
// of its own, so the act keeps the clock count of the old command. Derived at the last event.
export const peekWork: Effect.Effect<
  Read,
  Refused | StoreDamaged | OutsideFailed,
  Store | Dir | Readings | Scope.Scope
> = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const loaded = yield* loadWork(cwd)
  if (loaded._tag === 'NoStore') {
    yield* (yield* Store).open(cwd, { create: false })
    return yield* Effect.die(`no work store in ${cwd}, and the store opened`)
  }
  const d = yield* derivedAfter(loaded.work)
  return { work: loaded.work, d, at: d.moment.at, dir: cwd }
})

// The Derived of a Work after an act, at the time of its last event: no clock reading of its own.
export const derivedAfter = (work: Work): Effect.Effect<Derived, never, Readings> =>
  Effect.gen(function* () {
    const at = work.events.at(-1)?.recorded.at
    if (at === undefined) return yield* Effect.die('an act left a Work with no event')
    return derive(yield* momentOf(work, at))
  })

// One act: dispatch, in one store write.
export const act = (by: Author, input: ActionInput) => dispatch({ by, input } as ActionCall)

export const firstCreated = (created: ReadonlyArray<CreatedId>): string => String(created[0])
