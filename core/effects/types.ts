// The effect contract (plan/rebuild/BUILD.md 3.7, D12, D13). An effect selects a derived value and
// reacts to it: it dispatches actions and drives the pump. The watcher runs every effect against
// the newest Derived on each tick, in EFFECT_ORDER (level-triggered). An effect is idempotent:
// what it did is in the store (a send, a terminal move), and the next derive shows it. An effect
// catches and logs its own failures; one failure does not stop the round. A refusal of an action
// that an effect dispatches is a bug of its selector.
//
// Ruling 10.1 (2026-11-13): no effect types into a terminal. Only a host's `work send` (the answer
// to a permission dialog of a child's AI CLI) is typed. A wake, a word to a host, a request for
// the words of a decision, a retry line and a problem retry are derived steps of the actor now
// (core/derived/notices.ts), and its `work wait` returns on them.
//
// The memory of the supervisor (what the pump sees every few seconds: the activity of a live
// terminal) is in SupervisorMemory, not in the fold. TerminalState (ui-model part 2) is made from
// it and the stored terminal moves. EFFECTS and reconcile live in index.ts.
import { Context, type Effect, type Ref } from 'effect'
import type { ActionCall, Dispatched } from '../actions/types.ts'
import type {
  Derived,
  HostPane,
  PendingSend,
  ToClose,
  ToStart,
  ToWatch,
} from '../derived/index.ts'
import type { Refusal } from '../schema/errors.ts'
import type { OutsideFailed, SessionId, StoreDamaged, Supervised } from '../schema/index.ts'
import type {
  Dir,
  Env,
  Files,
  Now,
  Pump,
  Readings,
  Spawn,
  Store,
  Tokens,
} from '../services/index.ts'
import type { WorkCache } from '../state/index.ts'

export type EffectName =
  | 'HostPanes' // S1: adopt the host's pane of each live run; release the others
  | 'StartTerminals' // the terminals of new Sol and Terra agents, the first prompt an argument
  | 'DeliverSends' // C5: type a host's work send into the terminal of its child
  | 'CloseEnded' // C1, S1: close the terminal of an ended owner, once, when quiet
  | 'RetryFailures' // C1, S1: up to 3 restarts of a failed terminal; a prompt and a failure stored

// The order of one round: the order of the old tick.
export const EFFECT_ORDER: ReadonlyArray<EffectName> = [
  'HostPanes',
  'StartTerminals',
  'DeliverSends',
  'CloseEnded',
  'RetryFailures',
]

// What each effect selects from the derived value.
export interface Selected {
  readonly HostPanes: ReadonlyArray<HostPane>
  readonly StartTerminals: ReadonlyArray<ToStart>
  readonly DeliverSends: ReadonlyArray<PendingSend>
  readonly CloseEnded: ReadonlyArray<ToClose>
  readonly RetryFailures: ReadonlyArray<ToWatch>
}

// The memory of the supervisor. Lost on a restart: what must survive one is in the store.
export interface Memory {
  // The state of each terminal: its stored moves, refined by what the pump saw (D13).
  readonly terminals: ReadonlyMap<SessionId, Supervised>
  // The last stored event folded into terminals.
  readonly folded: number
}
export const NO_MEMORY: Memory = { terminals: new Map(), folded: 0 }

export class SupervisorMemory extends Context.Service<
  SupervisorMemory,
  { readonly ref: Ref.Ref<Memory> }
>()('aristoteles/SupervisorMemory') {}

// The log of the watcher (its `log` option): what an effect did, and each failure it caught.
export class EffectLog extends Context.Service<
  EffectLog,
  { readonly line: (text: string) => Effect.Effect<void> }
>()('aristoteles/EffectLog') {}

// An act of the supervisor or of the person on the page, through core/actions dispatch. secrets:
// what the act drew from Tokens (a new token's secret is shown only at its act, never stored).
export interface Acted {
  readonly dispatched: Dispatched
  readonly secrets: ReadonlyArray<string>
}
export class Dispatcher extends Context.Service<
  Dispatcher,
  {
    readonly dispatch: (
      call: ActionCall,
    ) => Effect.Effect<Acted, Refusal | OutsideFailed | StoreDamaged>
  }
>()('aristoteles/Dispatcher') {}

// The times of the supervisor, in ms. The windows and gaps are read on the clock (Now); the
// pauses are real waits.
export interface Timing {
  // A terminal with output within this window is busy: a close waits for it.
  readonly outputWindow: number
  // The tries of a failed terminal are at least this far apart.
  readonly retryGap: number
  // The pause between the text of a host's send and its Enter.
  readonly enterPause: number
}
export const TIMING: Timing = { outputWindow: 8000, retryGap: 30000, enterPause: 250 }

// The supervisor of one start: its times, the person whose UI it is (the author of its acts), and
// when it started (an act or a send this much older was handled before it).
export class Supervision extends Context.Service<
  Supervision,
  {
    readonly timing: Timing
    readonly person: string
    readonly startedAt: number
  }
>()('aristoteles/Supervision') {}

export type EffectServices =
  | Pump
  | SupervisorMemory
  | EffectLog
  | Dispatcher
  | Supervision
  | WorkCache
  | Store
  | Readings
  | Dir
  | Env
  | Now
  | Tokens
  | Files
  | Spawn

export interface WorkEffect<K extends EffectName> {
  readonly name: K
  readonly select: (d: Derived) => Selected[K]
  readonly react: (selected: Selected[K], d: Derived) => Effect.Effect<void, never, EffectServices>
}

export type Effects = { readonly [K in EffectName]: WorkEffect<K> }

// One round: each effect of EFFECT_ORDER against one Derived.
export type Reconcile = (effects: Effects, d: Derived) => Effect.Effect<void, never, EffectServices>
