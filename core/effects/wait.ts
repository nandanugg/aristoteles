// work wait: an agent or the host holds this command while it has nothing to do. It returns ONE
// step, the first that the actor owes (dos: the oldest first), at once when there is one, else
// when the store changes and there is one. A step stays owed until it is done: the same wait
// again returns the same step. It also returns when the actor's token is of an old epoch, when
// the project ended, and when the installed code changed (P8: no actor waits on old code).
import { Clock, Effect } from 'effect'
import { folding } from '../actions/dispatch.ts'
import { dos, type Step } from '../derived/work/obligations.ts'
import type { Recorded, StoreDamaged } from '../schema/index.ts'
import type { DirStore } from '../services/index.ts'
import type { WorkFolded } from '../state/work/fold.ts'
import { foldWork } from '../state/work/fold.ts'
import { epOf } from '../state/work/reads.ts'
import type { Actor } from '../state/work/types.ts'

export type WaitEnd =
  | {
    readonly _tag: 'Step'
    readonly folded: WorkFolded
    readonly events: ReadonlyArray<Recorded>
    readonly step: Step
  }
  // The token is of an epoch below the actor's current one.
  | { readonly _tag: 'Old'; readonly now: number }
  | { readonly _tag: 'Ended' }
  | { readonly _tag: 'Updated' }
  // No top is open yet.
  | { readonly _tag: 'NoTop' }

export interface WaitOptions {
  readonly actor: Actor
  // The epoch of the token.
  readonly ep: number
  readonly pollMs: number
  // Runs once, when the wait starts to block (the CLI marks the actor as waiting).
  readonly blocking: Effect.Effect<void>
  // The build of the installed code (adapters/live/build.ts), read each buildMs.
  readonly build: Effect.Effect<string>
  readonly buildMs: number
}

const lastSeq = (store: DirStore): Effect.Effect<number> =>
  Effect.map(
    store.query('SELECT MAX(seq) AS seq FROM event WHERE project = ?', store.dir),
    (rows) => Number(rows[0]?.seq ?? 0),
  )

// The store now: the end that its state gives, or null when the actor has nothing to do yet.
const look = (store: DirStore, o: WaitOptions): Effect.Effect<WaitEnd | null, StoreDamaged> =>
  Effect.gen(function* () {
    const events = yield* store.events
    const folded = yield* folding(() => foldWork(events))
    if (folded === null) return { _tag: 'NoTop' } as const
    const now = epOf(folded.state, o.actor)
    if (o.ep < now) return { _tag: 'Old', now } as const
    if (folded.state.top.ended) return { _tag: 'Ended' } as const
    const [step] = dos(folded.state, o.actor)
    return step === undefined ? null : ({ _tag: 'Step', folded, events, step } as const)
  })

export const waitFor = (store: DirStore, o: WaitOptions): Effect.Effect<WaitEnd, StoreDamaged> =>
  Effect.gen(function* () {
    // The seq first, then the look: an event after this seq is a new seq, never a missed one.
    let seq = yield* lastSeq(store)
    const first = yield* look(store, o)
    if (first !== null) return first
    yield* o.blocking
    const build = yield* o.build
    let builtAt = yield* Clock.currentTimeMillis
    for (;;) {
      yield* Effect.sleep(o.pollMs)
      const now = yield* Clock.currentTimeMillis
      if (now - builtAt >= o.buildMs) {
        builtAt = now
        if ((yield* o.build) !== build) return { _tag: 'Updated' } as const
      }
      const last = yield* lastSeq(store)
      if (last === seq) continue
      seq = last
      const end = yield* look(store, o)
      if (end !== null) return end
    }
  })
