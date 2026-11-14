// What the effects share: the acts of the supervisor (through the Dispatcher), the typing of a
// host's send (the only text that goes into a terminal, ruling 10.1), the memory of the
// terminals, and the newest Derived.
import { Cause, Effect, Ref } from 'effect'
import type { ActionCall, InputOf } from '../actions/types.ts'
import { type Derived, derive } from '../derived/index.ts'
import {
  type Activity,
  type Author,
  type DropReason,
  type EventRef,
  isNonBlank,
  Moves,
  type SessionId,
  type TerminalState,
  type Work,
} from '../schema/index.ts'
import { Dir, Now, Pump, type Readings, readSettings, readSettingsOf } from '../services/index.ts'
import { momentOf, WorkCache } from '../state/index.ts'
import { foldTerminals, refOf } from './terminals.ts'
import { Dispatcher, EffectLog, type Memory, Supervision, SupervisorMemory } from './types.ts'

// --- the log, and a step that fails alone -------------------------------------------------------

export const logLine = (text: string): Effect.Effect<void, never, EffectLog> =>
  EffectLog.use((log) => log.line(text))

const messageOf = <E>(cause: Cause.Cause<E>): string => {
  const e = Cause.squash(cause)
  return e instanceof Error ? e.message : String(e)
}

// One step of an effect: its failure is logged with what it was, and the round goes on.
export const step = <A, E, R>(
  what: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, R | EffectLog> =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : logLine(`${what}: ${messageOf(cause)}`),
    ),
  )

// --- the clock and the settings -----------------------------------------------------------------

export const nowMs: Effect.Effect<number, never, Now> = Now.use((now) =>
  Effect.map(now.read, (at) => Date.parse(at)),
)

// The tiers of the settings now: they can change after work start (the page, the roles that the
// person accepts). Settings that do not read have no tiers, and the log says why.
export const tiersNow = Effect.gen(function* () {
  const { cwd } = yield* Dir
  return yield* readSettings(cwd).pipe(
    Effect.map((s) => s.tiers),
    Effect.catch((e) =>
      Effect.as(logLine(`the settings: ${e.message}`), readSettingsOf({}).tiers),
    ),
  )
})

// --- the acts -----------------------------------------------------------------------------------

export const supervisor: Effect.Effect<Author, never, Supervision> = Supervision.useSync(
  (s): Author => ({ _tag: 'Supervisor', name: s.person }),
)
export const personOnPage: Effect.Effect<Author, never, Supervision> = Supervision.useSync(
  (s): Author => ({ _tag: 'Person', name: s.person, channel: 'ui' }),
)

export const act = (call: ActionCall) => Dispatcher.use((d) => d.dispatch(call))

// An act of the supervisor; the ref of its event, or null when the act made none (it was done).
export const supervise = <K extends ActionCall['input']['_tag']>(input: InputOf<K>) =>
  Effect.gen(function* () {
    const acted = yield* act({ by: yield* supervisor, input })
    const seq = acted.dispatched.seq
    return seq === null ? null : refOf(seq)
  })

type LineReason = InputOf<'SupervisorSend'>['target']['reason']
const keysOf = (text: string) =>
  isNonBlank(text) ? ({ _tag: 'Line', text } as const) : ({ _tag: 'Enter' } as const)

// A line of the supervisor, stored as a Send that waits for its terminal.
export const sendLine = (reason: LineReason, text: string) =>
  supervise<'SupervisorSend'>({
    _tag: 'SupervisorSend',
    target: { reason },
    content: { keys: keysOf(text) },
  })
export const sendStart = (reason: LineReason) =>
  supervise<'SupervisorSend'>({
    _tag: 'SupervisorSend',
    target: { reason },
    content: { keys: { _tag: 'StartPrompt' } },
  })
export const delivered = (send: EventRef) =>
  supervise<'SendDelivered'>({ _tag: 'SendDelivered', target: { send }, content: {} })
export const dropped = (send: EventRef, why: DropReason) =>
  supervise<'SendDropped'>({ _tag: 'SendDropped', target: { send }, content: { why } })

export const to = (session: SessionId) =>
  ({ _tag: 'Terminal', session, via: { _tag: 'Tmux' } }) as const

// --- typing -------------------------------------------------------------------------------------

// A host's send for an AI tool: the text, then Enter as its own key a moment later. In one read,
// an interactive tool takes the Enter as part of a paste, and the line stays unsent.
export const typeLine = (sid: SessionId, text: string) =>
  Effect.gen(function* () {
    const pump = yield* Pump
    const { timing } = yield* Supervision
    if (text) yield* pump.input(sid, text)
    yield* Effect.sleep(timing.enterPause)
    yield* pump.enter(sid)
  })

// Types a stored send now, and stores its fate: Delivered, or Dropped when the pump fails.
export const deliver = (send: EventRef, sid: SessionId, text: string) =>
  Effect.gen(function* () {
    const typed = yield* Effect.result(typeLine(sid, text))
    if (typed._tag === 'Failure') {
      yield* logLine(`${sid}: ${typed.failure.message}`)
      yield* dropped(send, { _tag: 'TypingFailed' })
      return
    }
    yield* delivered(send)
  })

// --- the memory of the terminals ----------------------------------------------------------------

// The states of the terminals with the new stored events folded in (D13).
export const terminalsOf = (work: Work) =>
  Effect.gen(function* () {
    const { ref } = yield* SupervisorMemory
    return yield* Ref.modify(ref, (m): [Memory['terminals'], Memory] => {
      const fresh = work.events.filter((l) => l.recorded.seq > m.folded)
      if (fresh.length === 0) return [m.terminals, m]
      const terminals = foldTerminals(m.terminals, work, fresh)
      const folded = work.events.at(-1)?.recorded.seq ?? m.folded
      return [terminals, { ...m, terminals, folded }]
    })
  })
export const stateIn = (
  terminals: Memory['terminals'],
  sid: SessionId,
): TerminalState | undefined => terminals.get(sid)?.state

// A live terminal shows something new: its activity changes (nothing stores it).
export const see = (sid: SessionId, activity: Activity) =>
  Effect.gen(function* () {
    const { ref } = yield* SupervisorMemory
    yield* Ref.update(ref, (m) => {
      const known = m.terminals.get(sid)
      if (known?.state._tag !== 'Live') return m
      const terminals = new Map(m.terminals)
      terminals.set(sid, { ...known, state: Moves.tick(known.state, activity) })
      return { ...m, terminals }
    })
  })

// --- the newest Derived ------------------------------------------------------------------------

export const latest: Effect.Effect<Derived | null, never, WorkCache | Readings | Now | EffectLog> =
  Effect.gen(function* () {
    const cache = yield* WorkCache
    const cached = yield* cache.refresh
    if (cached._tag === 'NoStore') return null
    const at = yield* (yield* Now).read
    return derive(yield* momentOf(cached.work, at))
  }).pipe(Effect.catch((e) => Effect.as(logLine(`the store: ${e.message}`), null)))
