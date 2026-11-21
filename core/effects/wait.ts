// work wait: an agent or the host holds this command while it has nothing to do. It returns ONE
// step, the first that the actor owes (c16 dos: the oldest first; an answerer that just answered
// is told its own steps first), at once when there is one, else when the store changes and there
// is one. A step stays owed until it is done: the same wait again returns the same step; printing
// consumes nothing. A Hear step carries the answer it is about. It also returns when the actor's
// token is of an old epoch, when the project ended, and when the installed code changed (P8: no
// actor waits on old code).
import { Clock, Effect } from 'effect'
import { folding } from '../actions/dispatch.ts'
import { dos } from '../derived/c16/obligations.ts'
import type { Recorded, StoreDamaged } from '../schema/index.ts'
import type { DirStore } from '../services/index.ts'
import type { WorkFolded } from '../state/c16/fold.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf } from '../state/c16/reads.ts'
import type { Actor, Answered, Step } from '../state/c16/types.ts'

export type WaitEnd =
  | {
    readonly _tag: 'Step'
    readonly folded: WorkFolded
    readonly events: ReadonlyArray<Recorded>
    readonly step: Step
    // The answer of a Hear step (its typed answer, its occurrence id in answered.ask.id).
    readonly heard: Answered | null
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
export const inspectWait = (
  store: DirStore,
  o: Pick<WaitOptions, 'actor' | 'ep'>,
): Effect.Effect<WaitEnd | null, StoreDamaged> =>
  Effect.gen(function* () {
    const events = yield* store.events
    const folded = yield* folding(() => foldWork(events))
    if (folded === null) return { _tag: 'NoTop' } as const
    const now = epochOf(folded.state, o.actor)
    if (o.ep < now) return { _tag: 'Old', now } as const
    if (folded.state.top.ended) return { _tag: 'Ended' } as const
    const [step] = dos(folded.state, o.actor)
    if (step === undefined) return null
    const heard = step.act === 'Hear' && step.ask !== null
      ? folded.state.answered.get(step.ask) ?? null
      : null
    return { _tag: 'Step', folded, events, step, heard } as const
  })

export const waitFor = (store: DirStore, o: WaitOptions): Effect.Effect<WaitEnd, StoreDamaged> =>
  Effect.gen(function* () {
    // The seq first, then the look: an event after this seq is a new seq, never a missed one.
    let seq = yield* lastSeq(store)
    const first = yield* inspectWait(store, o)
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
      const end = yield* inspectWait(store, o)
      if (end !== null) return end
    }
  })
