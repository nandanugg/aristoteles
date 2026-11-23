// The types of the derived catalog (plan/rebuild/BUILD.md 3.4, 3.5): the state of each record
// that the person's acts before a top read, the check of state, and the values that the effects
// select. index.ts is the export surface; the functions live in catalog.ts, can.ts, selectors.ts.
//
// R1 is in the signatures: a dependent takes the state of its dependency as a parameter (deps),
// so a test gives a dependency and checks the dependent, with no store. Only derive() wires the
// edges.
import type { Intent } from '../schema/actions.ts'
import type { Refusal } from '../schema/errors.ts'
import type {
  Author,
  DirectionId,
  DropReason,
  EventRef,
  RejectId,
  RevisionId,
  SessionId,
  Time,
  VersionId,
} from '../schema/index.ts'
import type { Moment } from '../state/index.ts'

// The derived value: the state of every record, once
export interface States {
  readonly directions: ReadonlyMap<DirectionId, DirectionState>
  readonly revisions: ReadonlyMap<RevisionId, RevisionState>
  readonly sends: ReadonlyMap<EventRef, SendState>
}

// What every reader reads: the moment, and the state of each record at that moment.
export interface Derived {
  readonly moment: Moment
  readonly states: States
}

// Computes each state once, in the order of the edges (BUILD.md 3.4).
export type Derive = (m: Moment) => Derived

// --- 1. DirectionState: the edge version -> draft ------------------------------------------------
// Drafted: no version yet (its first draft waits). Official: the version that is current now.
export type DirectionState =
  | { readonly _tag: 'Drafted' }
  | { readonly _tag: 'Official'; readonly current: VersionId }
export type DirectionStateOf = (m: Moment, direction: DirectionId) => DirectionState

// --- 2. RevisionState: S2, S6, S7 ----------------------------------------------------------------
// The order is fixed (S6): Official, then Outdated, then Conflicted, then Vetoed, then Waiting
// (for the accept of the owner). Outdated before Vetoed: a draft on an old base is not revised
// again; a new draft is made on the current version.
export type RevisionState =
  | { readonly _tag: 'Official'; readonly version: VersionId }
  | { readonly _tag: 'Outdated'; readonly current: VersionId; readonly evidenceChanged?: true }
  // S7: a rule id that another open draft of the direction, or the current version, also adds.
  | { readonly _tag: 'Conflicted'; readonly rule: string; readonly with: RevisionId | VersionId }
  | { readonly _tag: 'Vetoed'; readonly by: RejectId }
  | { readonly _tag: 'Waiting' }
export type RevisionStateOf = (
  m: Moment,
  draft: RevisionId,
  deps: { readonly direction: DirectionState },
) => RevisionState

// --- 3. SendState: C5 ----------------------------------------------------------------------------
export type SendState =
  | { readonly _tag: 'Pending' }
  | { readonly _tag: 'Delivered'; readonly at: Time }
  | { readonly _tag: 'Dropped'; readonly at: Time; readonly why: DropReason }
export type SendStateOf = (m: Moment, send: EventRef) => SendState

// The one check behind every refusal of state. It reads only Derived and never checks content.
export type CanAct =
  | { readonly _tag: 'May' }
  | { readonly _tag: 'MayNot'; readonly refusal: Refusal }
export type CanActOf = (d: Derived, actor: Author, intent: Intent) => CanAct

// Each send whose SendState is Pending, with the session that it goes to (C5).
export interface PendingSend {
  readonly send: EventRef
  readonly to: SessionId
}
export type SendsPending = (d: Derived) => ReadonlyArray<PendingSend>
