// The action contract (plan/rebuild/BUILD.md 3.6). An action is (call) => Effect<events, Refusal,
// R>. It does, in this order:
//   1. normalise the input from the state (N1..N12: what the state decides, it never refuses);
//   2. canAct(derived, by, intentOf(input)): fail with its refusal;
//   3. check the content: fail only with a Write or Pick choice;
//   4. build the event, or none (D11: zero or one event; the store writes one per transaction).
// The derived value comes from the Current service: the derive of the events inside the store
// write, so two agents cannot both pass a check that only one may pass.
import { Context, type Effect, type Scope } from 'effect'
import type { Derived } from '../derived/index.ts'
import type { ActionTag, InputOf } from '../schema/actions.ts'
import type { Refusal } from '../schema/errors.ts'
import type {
  Author,
  CreatedId,
  Event,
  OutsideFailed,
  StoreDamaged,
  Work,
} from '../schema/index.ts'
import type { Dir, Files, Now, Readings, Spawn, Store, Tokens } from '../services/index.ts'

export type {
  ActionInput,
  ActionTag,
  InputOf,
  Intent,
  FilePath,
  Words,
  RawSecret,
} from '../schema/actions.ts'
export { intentOf } from '../schema/actions.ts'
export { Refusal, refusal } from '../schema/errors.ts'
export type { Choice, ChoiceKind } from '../schema/errors.ts'

// Who acts, and what. The author is the store's (actor.ts Author): an agent by its assignment,
// the person with a channel, a model run, the supervisor, the system, a program, the refresh.
export interface ActionCall<K extends ActionTag = ActionTag> {
  readonly by: Author
  readonly input: InputOf<K>
}

// The derive of the events inside the store write.
export class Current extends Context.Service<Current, { readonly derived: Derived }>()(
  'aristoteles/Current',
) {}

export type ActionServices = Current | Files | Spawn | Now | Tokens

export type Action<K extends ActionTag> = (
  call: ActionCall<K>,
) => Effect.Effect<ReadonlyArray<Event>, Refusal, ActionServices>

// One action per tag: a new tag fails the compile of the table until it has one.
export type Actions = { readonly [K in ActionTag]: Action<K> }

// What a dispatch gives back: the seq of the new event (null: the act made none, as N9..N12),
// the Work after it, and the ids that its step made (the CLI words and the page's answer).
export interface Dispatched {
  readonly seq: number | null
  readonly work: Work
  readonly created: ReadonlyArray<CreatedId>
}

// Runs one action in one store write: read the events, fold, read the outside, derive, run the
// action with Current, append its event and the reader rows (rowsOf), fold the new event.
export type Dispatch = (
  call: ActionCall,
) => Effect.Effect<
  Dispatched,
  Refusal | OutsideFailed | StoreDamaged,
  Store | Readings | Dir | Files | Spawn | Now | Tokens | Scope.Scope
>
