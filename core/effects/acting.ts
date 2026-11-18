// What the effects share: the acts of the supervisor (through the Dispatcher), the typing of a
// host's send (the only text that goes into a terminal, ruling 10.1), and the newest Derived.
import { Cause, Effect } from 'effect'
import type { ActionCall, InputOf } from '../actions/types.ts'
import { type Derived, derive } from '../derived/index.ts'
import type { Author, DropReason, EventRef, SessionId } from '../schema/index.ts'
import { Now, Pump, type Readings } from '../services/index.ts'
import { momentOf, WorkCache } from '../state/index.ts'
import { Dispatcher, EffectLog, Supervision } from './types.ts'

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

// --- the clock ----------------------------------------------------------------------------------

export const nowMs: Effect.Effect<number, never, Now> = Now.use((now) =>
  Effect.map(now.read, (at) => Date.parse(at)),
)

// --- the acts -----------------------------------------------------------------------------------

export const supervisor: Effect.Effect<Author, never, Supervision> = Supervision.useSync(
  (s): Author => ({ _tag: 'Supervisor', name: s.person }),
)
export const act = (call: ActionCall) => Dispatcher.use((d) => d.dispatch(call))

// An act of the supervisor.
export const supervise = <K extends ActionCall['input']['_tag']>(input: InputOf<K>) =>
  Effect.gen(function* () {
    yield* act({ by: yield* supervisor, input })
  })

export const delivered = (send: EventRef) =>
  supervise<'SendDelivered'>({ _tag: 'SendDelivered', target: { send }, content: {} })
export const dropped = (send: EventRef, why: DropReason) =>
  supervise<'SendDropped'>({ _tag: 'SendDropped', target: { send }, content: { why } })

// --- typing -------------------------------------------------------------------------------------

// A host's send for an AI tool: the text, then Enter as its own key a moment later. In one read,
// an interactive tool takes the Enter as part of a paste, and the line stays unsent.
const typeLine = (sid: SessionId, text: string) =>
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

// --- the newest Derived ------------------------------------------------------------------------

export const latest: Effect.Effect<Derived | null, never, WorkCache | Readings | Now | EffectLog> =
  Effect.gen(function* () {
    const cache = yield* WorkCache
    const cached = yield* cache.refresh
    if (cached._tag === 'NoStore') return null
    const at = yield* (yield* Now).read
    return derive(yield* momentOf(cached.work, at))
  }).pipe(Effect.catch((e) => Effect.as(logLine(`the store: ${e.message}`), null)))
