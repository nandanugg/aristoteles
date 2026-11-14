// work wait (BUILD.md 10.1): an agent or a host holds this command while it has nothing to do. It
// returns at once when the actor has ready work that its last wait did not print, else when its
// next steps change (tags and ids, as stepKey), else after `ms` with nothing changed. Nothing is
// typed into a terminal: what the watcher typed before is a step of nextFor now (notices.ts).
//
// A host waits by its run before its top task opens: then it gets the Sol of that task (the CLI
// gives it a new token). A host whose Sol ended by a remake of the top task gets the new Sol too.
// The loop reads the store through a cheap probe of its last seq, and derives again on a new
// seq, or each deriveMs (a hold, a time or the outside can change alone).
import { Clock, Effect } from 'effect'
import {
  type Derived,
  derive,
  hostOf,
  type NextStep,
  nextFor,
  stepKey,
} from '../derived/index.ts'
import type {
  AssignmentId,
  Author,
  OutsideFailed,
  RunId,
  SessionId,
  StoreDamaged,
} from '../schema/index.ts'
import { Now, type Readings } from '../services/index.ts'
import { momentOf, WorkCache } from '../state/index.ts'

export type Waiter =
  | { readonly _tag: 'Agent'; readonly assignment: AssignmentId }
  | { readonly _tag: 'Host'; readonly run: RunId }

export interface Steps {
  readonly next: ReadonlyArray<NextStep>
  // stepKey of next.
  readonly key: string
  readonly ready: boolean
}

export type WaitEnd =
  | { readonly _tag: 'Ready'; readonly d: Derived; readonly steps: Steps }
  | { readonly _tag: 'Changed'; readonly d: Derived; readonly steps: Steps }
  | { readonly _tag: 'Quiet'; readonly d: Derived; readonly steps: Steps }
  // The top task of the host's run opened: its Sol takes the run's terminal.
  | {
      readonly _tag: 'Opened'
      readonly d: Derived
      readonly run: RunId
      readonly sol: AssignmentId
      readonly session: SessionId
    }
  | { readonly _tag: 'Ended'; readonly d: Derived }
  | { readonly _tag: 'NoStore' }

export interface WaitOptions {
  // The key that the last return of this actor printed: ready work with this key is not new.
  readonly seen: string | null
  // The longest wait.
  readonly ms: number
  readonly pollMs: number
  readonly deriveMs: number
  // A burst of acts (a report and its checks) comes back as one return.
  readonly settleMs: number
  // The last seq of the store, read cheaply.
  readonly lastSeq: Effect.Effect<number>
  // Runs once, when the wait starts to block (the CLI marks the actor as waiting).
  readonly blocking: Effect.Effect<void>
}

const authorOf = (w: Waiter): Author =>
  w._tag === 'Agent' ? { _tag: 'Agent', assignment: w.assignment } : { _tag: 'Host', run: w.run }

export const stepsOf = (d: Derived, waiter: Waiter): Steps => {
  const actor = authorOf(waiter)
  const next = nextFor(d, actor)
  return { next, key: stepKey(next), ready: next.some((s) => s._tag === 'Do') }
}

// The Sol of a run's top task now, when the run goes on.
const solOf = (d: Derived, run: RunId): WaitEnd | null => {
  const state = d.states.runs.get(run)
  if (state?._tag !== 'Working' && state?._tag !== 'AwaitingEndAccept') return null
  const host = hostOf(d.moment, { _tag: 'OnTask', task: state.top }, d.states)
  return host._tag === 'Host' && host.run === run
    ? { _tag: 'Opened', d, run, sol: host.assignment, session: host.session }
    : null
}

// An end that needs no steps: the actor ended, or the host's top task opened. The Sol of a run
// that ended (its top task was remade) hands the run's terminal to the new Sol.
const endOf = (d: Derived, waiter: Waiter): WaitEnd | null => {
  const w = d.moment.work
  if (waiter._tag === 'Agent') {
    const state = d.states.assignments.get(waiter.assignment)
    if (state !== undefined && state._tag !== 'Ended') return null
    const session = w.sessions.get(waiter.assignment)?.session
    const run = [...w.runs.values()].find((r) => r.session === session)
    const next = run === undefined ? null : solOf(d, run.id)
    return next?._tag === 'Opened' && next.sol !== waiter.assignment ? next : { _tag: 'Ended', d }
  }
  const state = d.states.runs.get(waiter.run)
  if (state === undefined || state._tag === 'Done' || state._tag === 'Closed') {
    return { _tag: 'Ended', d }
  }
  return solOf(d, waiter.run)
}

// The store now, derived; null before work init.
export const look: Effect.Effect<
  Derived | null,
  StoreDamaged | OutsideFailed,
  WorkCache | Readings | Now
> = Effect.gen(function* () {
  const cached = yield* (yield* WorkCache).refresh
  if (cached._tag === 'NoStore') return null
  const at = yield* (yield* Now).read
  return derive(yield* momentOf(cached.work, at))
})

export const waitFor = (
  waiter: Waiter,
  o: WaitOptions,
): Effect.Effect<WaitEnd, StoreDamaged | OutsideFailed, WorkCache | Readings | Now> =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis
    const first = yield* look
    if (first === null) return { _tag: 'NoStore' } as const
    const ended = endOf(first, waiter)
    if (ended !== null) return ended
    const steps = stepsOf(first, waiter)
    if (steps.ready && steps.key !== o.seen) return { _tag: 'Ready', d: first, steps } as const
    yield* o.blocking
    let seq = yield* o.lastSeq
    let derivedAt = start
    for (;;) {
      yield* Effect.sleep(o.pollMs)
      const now = yield* Clock.currentTimeMillis
      const last = yield* o.lastSeq
      const due = now - start >= o.ms
      if (!due && last === seq && now - derivedAt < o.deriveMs) continue
      seq = last
      derivedAt = now
      const d = yield* look
      if (d === null) return { _tag: 'NoStore' } as const
      const end = endOf(d, waiter)
      if (end !== null) return end
      const fresh = stepsOf(d, waiter)
      if (fresh.key !== steps.key) {
        yield* Effect.sleep(o.settleMs)
        const settled = (yield* look) ?? d
        const later = endOf(settled, waiter)
        if (later !== null) return later
        return { _tag: 'Changed', d: settled, steps: stepsOf(settled, waiter) } as const
      }
      if (due) return { _tag: 'Quiet', d, steps: fresh } as const
    }
  })
