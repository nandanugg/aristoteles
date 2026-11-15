// work wait (BUILD.md 10.1): an agent or a host holds this command while it has nothing to do. It
// returns at once when the actor has ready work that its last wait did not print, else when its
// next steps change (tags and ids, as stepKey), else after `ms` with nothing changed. Nothing is
// typed into a terminal: what the watcher typed before is a step of nextFor now (notices.ts).
//
// A host waits by its run before its top task opens: then it gets the assignment of that task (the CLI
// gives it a new token). A host whose assignment ended by a remake of the top task gets the new one too.
// A persistent agent waits by its id in its own terminal (ruling 9): each new assignment of the
// agent ends the wait (the CLI gives each a token), and the steps of all its open assignments
// count as its steps.
// The loop reads the store through a cheap probe of its last seq, and derives again on a new
// seq, when the clock passes the next edge (nextChangeAt: a hold, a grant, a source), or each
// deriveMs (the outside, git and the files, can change alone). It returns when the installed code
// changes (P8), so that no actor waits on old code.
import { Clock, Effect } from 'effect'
import {
  type Derived,
  derive,
  hostOf,
  type NextStep,
  nextChangeAt,
  nextFor,
  stepKey,
} from '../derived/index.ts'
import type {
  AgentId,
  AssignmentId,
  Author,
  NonEmpty,
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
  | { readonly _tag: 'Persistent'; readonly agent: AgentId }

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
  // The top task of the host's run opened: its assignment takes the run's terminal.
  | {
      readonly _tag: 'Opened'
      readonly d: Derived
      readonly run: RunId
      readonly host: AssignmentId
      readonly session: SessionId
    }
  // New assignments of a persistent agent: they take its terminal, each with a new token.
  | {
      readonly _tag: 'Given'
      readonly d: Derived
      readonly agent: AgentId
      readonly session: SessionId
      readonly assignments: NonEmpty<AssignmentId>
    }
  | { readonly _tag: 'Ended'; readonly d: Derived }
  // P8: the installed code changed while the wait blocked: the actor waits again on the new code.
  | { readonly _tag: 'Updated' }
  | { readonly _tag: 'NoStore' }

const READY_AGAIN_MS = 60_000

export interface WaitOptions {
  // The key that the last return of this actor printed: ready work with this key is not new.
  readonly seen: string | null
  // The longest wait.
  readonly ms: number
  readonly pollMs: number
  readonly deriveMs: number
  // A burst of acts (a report and its checks) comes back as one return.
  readonly settleMs: number
  // Ready work that the last return printed comes back after this long if it is still there:
  // an agent that waited again without doing it is reminded (live, 2026-11-15: a lead printed
  // "decide r8", waited again, and the run waited 500 s for it).
  readonly readyAgainMs?: number
  // The last seq of the store, read cheaply.
  readonly lastSeq: Effect.Effect<number>
  // Runs once, when the wait starts to block (the CLI marks the actor as waiting).
  readonly blocking: Effect.Effect<void>
  // The build of the installed code (adapters/live/build.ts), read each buildMs.
  readonly build: Effect.Effect<string>
  readonly buildMs: number
}

// The open assignments of a persistent agent (P6: a split can give it several at once).
export const heldBy = (d: Derived, agent: AgentId): ReadonlyArray<AssignmentId> => {
  const state = d.states.agents.get(agent)
  return state?._tag === 'OnAssignment' ? state.assignments : []
}

// Ready work: a Do step, or the start of the waiter's own subagent, which no act of the engine
// does (the parent runs it in its AI CLI) but which only the parent can do (live, 2026-11-15: a
// lead never started its structure-judge again, and t16 waited).
const isReady = (s: NextStep): boolean =>
  s._tag === 'Do' ||
  ((s.what._tag === 'GiveMakerCommand' || s.what._tag === 'GiveCheckerCommand') && s.what.ownChild)

// The actors whose steps a waiter waits for: a persistent agent acts by each open assignment.
const actorsOf = (d: Derived, w: Waiter): ReadonlyArray<Author> => {
  switch (w._tag) {
    case 'Agent':
      return [{ _tag: 'Agent', assignment: w.assignment }]
    case 'Host':
      return [{ _tag: 'Host', run: w.run }]
    case 'Persistent':
      return heldBy(d, w.agent).map((assignment) => ({ _tag: 'Agent', assignment }))
  }
}

export const stepsOf = (d: Derived, waiter: Waiter): Steps => {
  const next = actorsOf(d, waiter).flatMap((actor) => nextFor(d, actor))
  return { next, key: stepKey(next), ready: next.some(isReady) }
}

// The host's assignment on a run's top task now, when the run goes on.
const solOf = (d: Derived, run: RunId): WaitEnd | null => {
  const state = d.states.runs.get(run)
  if (state?._tag !== 'Working' && state?._tag !== 'AwaitingEndAccept') return null
  const host = hostOf(d.moment, { _tag: 'OnTask', task: state.top }, d.states)
  return host._tag === 'Host' && host.run === run
    ? { _tag: 'Opened', d, run, host: host.assignment, session: host.session }
    : null
}

// The open assignments of a persistent agent that its terminal has not taken yet.
const givenTo = (d: Derived, agent: AgentId): WaitEnd | null => {
  const w = d.moment.work
  const x = w.agents.get(agent)
  if (x?.terminal._tag !== 'Started') return null
  const session = x.terminal.session
  const [first, ...rest] = heldBy(d, agent).filter((a) => w.sessions.get(a)?.session !== session)
  return first === undefined
    ? null
    : { _tag: 'Given', d, agent, session, assignments: [first, ...rest] }
}

// An end that needs no steps: the actor ended, the host's top task opened, or a persistent agent
// got a new assignment. The host of a run whose assignment ended (its top task was remade) hands the
// run's terminal to the new one.
const endOf = (d: Derived, waiter: Waiter): WaitEnd | null => {
  const w = d.moment.work
  if (waiter._tag === 'Persistent') {
    const state = d.states.agents.get(waiter.agent)
    if (state === undefined || state._tag === 'Ended') return { _tag: 'Ended', d }
    return givenTo(d, waiter.agent)
  }
  if (waiter._tag === 'Agent') {
    const state = d.states.assignments.get(waiter.assignment)
    if (state !== undefined && state._tag !== 'Ended') return null
    const session = w.sessions.get(waiter.assignment)?.session
    const run = [...w.runs.values()].find((r) => r.session === session)
    const next = run === undefined ? null : solOf(d, run.id)
    return next?._tag === 'Opened' && next.host !== waiter.assignment ? next : { _tag: 'Ended', d }
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

// The next clock edge of a Derived, in ms; never when none.
const edgeOf = (d: Derived): number => {
  const next = nextChangeAt(d)
  return next === null ? Number.POSITIVE_INFINITY : Date.parse(next)
}

export const waitFor = (
  waiter: Waiter,
  o: WaitOptions,
): Effect.Effect<WaitEnd, StoreDamaged | OutsideFailed, WorkCache | Readings | Now> =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis
    // The seq first, then the look: an event after this seq is a new seq, never a missed one.
    let seq = yield* o.lastSeq
    const first = yield* look
    if (first === null) return { _tag: 'NoStore' } as const
    const ended = endOf(first, waiter)
    if (ended !== null) return ended
    const steps = stepsOf(first, waiter)
    if (steps.ready && steps.key !== o.seen) return { _tag: 'Ready', d: first, steps } as const
    yield* o.blocking
    const build = yield* o.build
    let builtAt = start
    let derivedAt = start
    let edge = edgeOf(first)
    for (;;) {
      yield* Effect.sleep(o.pollMs)
      const now = yield* Clock.currentTimeMillis
      if (now - builtAt >= o.buildMs) {
        builtAt = now
        if ((yield* o.build) !== build) return { _tag: 'Updated' } as const
      }
      const last = yield* o.lastSeq
      const due = now - start >= o.ms
      const passed = Date.parse(yield* (yield* Now).read) >= edge
      if (!due && !passed && last === seq && now - derivedAt < o.deriveMs) continue
      seq = last
      derivedAt = now
      const d = yield* look
      if (d === null) return { _tag: 'NoStore' } as const
      edge = edgeOf(d)
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
      const again = o.readyAgainMs ?? READY_AGAIN_MS
      if (fresh.ready && now - start >= again) return { _tag: 'Ready', d, steps: fresh } as const
      if (due) return { _tag: 'Quiet', d, steps: fresh } as const
    }
  })
