// Onboarding's activation, the store side (contract 6c v6, core/model/activation.qnt): the store
// is made INACTIVE under a generation (Workflow.Defined.activation), Workflow.Activated makes it
// active and binds a launch and the hash of its host credential (the verifier), and
// Workflow.HostRebound moves that binding to a relaunched host before the first top. Each write
// here is ONE store write that checks the events read inside it, so a check and its append are
// one step. The activation record, the lock, the launches and the delivery are the startup side's
// (src/files/activation.ts); this file only reads the events and writes these three events.
import { Effect } from 'effect'
import {
  type Author,
  type Draft,
  type Event,
  kindOf,
  type Recorded,
  writtenBy,
} from '../schema/index.ts'
import { Refusal } from '../schema/errors.ts'
import { NonBlank } from '../schema/index.ts'
import { Dir, Now, rowsOf, Store } from '../services/index.ts'
import { fold } from '../state/index.ts'
import { folding, STORE } from './dispatch.ts'

export type Binding = { readonly launch: string; readonly verifier: string }
export type ActivationState = {
  readonly generation: number
  readonly active: boolean // an Activated exists
  readonly binding: Binding | null // the last Activated or HostRebound
  readonly topOpened: boolean // a Work.Opened exists
} | null // a workflow defined without activation (work init), or no workflow yet

// The activation of a dir, read from its events.
export const activationOf = (events: ReadonlyArray<Recorded>): ActivationState => {
  const first = events[0]?.event
  if (first?._tag !== 'Workflow' || !('create' in first)) return null
  const defined = first.create.activation
  if (defined === null) return null
  let active = false
  let binding: Binding | null = null
  let topOpened = false
  for (const { event } of events) {
    if (event._tag === 'Workflow' && 'move' in event) {
      const m = event.move
      if (m._tag === 'Activated' || m._tag === 'HostRebound') {
        active = true
        binding = { launch: m.launch, verifier: m.hostVerifier }
      }
    }
    if (event._tag === 'Work' && 'create' in event && event.create._tag === 'Opened') {
      topOpened = true
    }
  }
  return { generation: defined.generation, active, binding, topOpened }
}

// A dir whose workflow waits for its activation: every work act is refused `inactive`.
export const isInactive = (events: ReadonlyArray<Recorded>): boolean => {
  const a = activationOf(events)
  return a !== null && !a.active
}

const named = (refused: 'inactive' | 'legal', message: string, next: string): Refusal =>
  new Refusal({
    message,
    choice: { kind: refused === 'inactive' ? 'Wait' : 'Pick', words: NonBlank.make(next) },
    refused,
    words: message,
    next,
  })
export const ACTIVATION = {
  inactive: () =>
    named(
      'inactive',
      'the project is not activated yet',
      'finish the activation (work activation resume), or roll it back',
    ),
  legal: (why: string) => named('legal', why, 'Read the activation again.'),
} as const

// The authoritative gate, called inside a store write before anything else.
export const gate = (events: ReadonlyArray<Recorded>): Effect.Effect<void, Refusal> =>
  isInactive(events) ? Effect.fail(ACTIVATION.inactive()) : Effect.void

// One workflow event, appended if `check` passes on the events read inside the write.
const appendChecked = (
  by: Author,
  event: Event,
  check: (events: ReadonlyArray<Recorded>) => string | null,
) =>
  Effect.gen(function* () {
    const store = yield* Store
    const { cwd } = yield* Dir
    const clock = yield* Now
    if (!writtenBy(by, event)) return yield* Effect.die(`${by._tag} does not write ${kindOf(event)}`)
    const opened = yield* store
      .open(cwd, { create: false })
      .pipe(Effect.catchTag('Refused', (e) => Effect.fail(STORE.noStore(e.message, cwd))))
    const seq = yield* opened.write((events) =>
      Effect.gen(function* () {
        const why = check(events)
        if (why !== null) return yield* Effect.fail(ACTIVATION.legal(why))
        const draft: Draft = { at: yield* clock.read, author: by, event }
        const next = (events.at(-1)?.seq ?? 0) + 1
        const work = yield* folding(() => fold([...events, { ...draft, seq: next } as Recorded]))
        return { draft, rows: rowsOf(work, opened.dir) }
      }),
    )
    if (seq === null) return yield* Effect.die('activation: the store wrote nothing')
    return seq
  }).pipe(Effect.scoped)

// Step 5: the store becomes active, bound to the launch whose current acknowledgement the startup
// side observed under its lock. Refused `legal` unless the store is inactive at generation g.
export const appendActivated = (
  by: Author,
  a: { readonly generation: number; readonly launch: string; readonly hostVerifier: string },
) =>
  appendChecked(
    by,
    { _tag: 'Workflow', move: { _tag: 'Activated' as const, ...a } } as Event,
    (events) => {
      const s = activationOf(events)
      if (s === null) return 'this store was not made inactive by an activation'
      if (s.generation !== a.generation) return `the store is generation ${s.generation}`
      if (s.active) return 'the store is active already'
      return null
    },
  )

// A pre-top relaunch commits: refused `legal` unless active at generation g, no top opened, and
// the current binding is the launch it replaces.
export const appendHostRebound = (
  by: Author,
  a: {
    readonly generation: number
    readonly launch: string
    readonly expected: string
    readonly hostVerifier: string
  },
) =>
  appendChecked(
    by,
    { _tag: 'Workflow', move: { _tag: 'HostRebound' as const, ...a } } as Event,
    (events) => {
      const s = activationOf(events)
      if (s === null || !s.active) return 'the store is not active'
      if (s.generation !== a.generation) return `the store is generation ${s.generation}`
      if (s.topOpened) return 'the top is open: the host moves as a top host now'
      if (s.binding?.launch !== a.expected) return 'the host binding moved since the relaunch began'
      return null
    },
  )

// Roll back: the dir's rows leave the store, only if it is inactive at generation g (an active
// store is never removed); refused `legal` otherwise. The shared store file stays.
export const deleteInactive = (generation: number) =>
  Effect.gen(function* () {
    const store = yield* Store
    const { cwd } = yield* Dir
    const opened = yield* store
      .open(cwd, { create: false })
      .pipe(Effect.catchTag('Refused', (e) => Effect.fail(STORE.noStore(e.message, cwd))))
    let why: string | null = null
    const removed = yield* opened.forget((events) =>
      Effect.sync(() => {
        const s = activationOf(events)
        why = s === null
          ? 'this store was not made by an activation'
          : s.active
          ? 'the store is active: it is never rolled back'
          : s.generation !== generation
          ? `the store is generation ${s.generation}`
          : null
        return why === null
      }),
    )
    if (!removed) return yield* Effect.fail(ACTIVATION.legal(why ?? 'not removed'))
  }).pipe(Effect.scoped)
