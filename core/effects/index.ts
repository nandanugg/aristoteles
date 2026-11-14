// The effects (plan/rebuild/BUILD.md 3.7): the export surface of this folder. EFFECTS is total (a
// new EffectName fails the compile here); reconcile runs one round of them against one Derived.
import { Context, Effect, Layer } from 'effect'
import { dispatch } from '../actions/index.ts'
import type { Derived } from '../derived/index.ts'
import { Dir, Files, Now, Readings, Spawn, Store, Tokens } from '../services/index.ts'
import { step } from './acting.ts'
import { CloseEnded } from './close-ended.ts'
import { DeliverSends } from './deliver-sends.ts'
import { HostPanes } from './host-panes.ts'
import { RetryFailures } from './retry-failures.ts'
import { StartTerminals } from './start-terminals.ts'
import {
  Dispatcher,
  EFFECT_ORDER,
  type EffectName,
  type Effects,
  type Reconcile,
} from './types.ts'

export * from './types.ts'
export {
  closeRun,
  fixedProblem,
  type Opened,
  openDraft,
  resumeSession,
  stopSession,
} from './person.ts'
export { latest } from './acting.ts'

export const EFFECTS: Effects = {
  HostPanes,
  StartTerminals,
  DeliverSends,
  CloseEnded,
  RetryFailures,
}

// One effect of a round: its failure (also a defect) is logged, and the round goes on.
const runOne = <K extends EffectName>(effects: Effects, name: K, d: Derived) => {
  const effect = effects[name]
  return step(name, Effect.suspend(() => effect.react(effect.select(d), d)))
}

export const reconcile: Reconcile = (effects, d) =>
  Effect.forEach(EFFECT_ORDER, (name) => runOne(effects, name, d), { discard: true })

// The live Dispatcher: core/actions dispatch, in its own store write, with the services of the
// watcher; it keeps the secrets that the act drew (the token of a new host).
export const DispatcherLive: Layer.Layer<
  Dispatcher,
  never,
  Store | Readings | Dir | Files | Spawn | Now | Tokens
> = Layer.effect(
  Dispatcher,
  Effect.gen(function* () {
    const services = yield* Effect.context<Store | Readings | Dir | Files | Spawn | Now | Tokens>()
    const tokens = Context.get(services, Tokens)
    return {
      dispatch: (call) =>
        Effect.gen(function* () {
          const secrets: Array<string> = []
          const random = Effect.tap(tokens.random, (s) => Effect.sync(() => secrets.push(s)))
          const dispatched = yield* Effect.scoped(dispatch(call)).pipe(
            Effect.provideService(Tokens, { random }),
            Effect.provide(services),
          )
          return { dispatched, secrets }
        }),
    }
  }),
)
