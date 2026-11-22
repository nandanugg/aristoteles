// The moves of each record with a lifecycle (plan/types REVIEW-1 section 5): one function per
// move, from the state that it may leave to the state that it makes, so that a move back (a
// delivered send dropped) does not compile. MOVES ties each stored move kind to its function, so
// a new kind fails the compile there until it has one; the fold (core/state) calls them, and no
// other code writes a state (architecture.test.ts). Pure: the caller finds the record by its id,
// and puts the new copy in the Work.
import type { EventGroup, MoveTag } from './events.ts'
import type { Time } from './ids.ts'
import type { ConfigFile, FlowStep, RoleWords } from './files.ts'
import type { Direction, NonEmpty, OfficialDirection, Revision, Version } from './model.ts'
import type { DropReason, Send } from './ui-model.ts'

// A record whose field F is in the state T: Send & { state: Pending } is a pending send.
type In<R, F extends keyof R, T extends string> = R & {
  readonly [K in F]: Extract<R[F], { readonly _tag: T }>
}

// --- the first state of each record ------------------------------------------------------------

// A new record starts in the first state of its lifecycle; these are the only writers of it.
export type PendingSend = In<Send, 'state', 'Pending'>
export const sendText = (fields: Omit<Send, 'state'>): PendingSend => ({
  ...fields,
  state: { _tag: 'Pending' },
})

// --- the workflow -----------------------------------------------------------------------------

// Workflow.RoleWordsChanged: only the words of roles change (description, intro, responsibilities,
// output), never their acts or models.
export const changeRoleWords = (
  config: ConfigFile,
  roles: Readonly<Record<string, RoleWords>>,
): ConfigFile => ({
  ...config,
  roles: Object.fromEntries(
    Object.entries(config.roles).map(([name, file]) => [name, { ...file, ...roles[name] }]),
  ),
})

// --- Direction ---------------------------------------------------------------------------------

// The owner's accept of a draft makes its version official: a new direction
// becomes official with it; an official one adds it as its current version.
export const makeOfficial = (d: Direction, version: Version<Direction>): OfficialDirection =>
  d._tag === 'NewDirection'
    ? { ...d, _tag: 'Official', versions: [version] }
    : { ...d, versions: [...d.versions, version] as NonEmpty<Version<Direction>> }

// Revision.ExamplesAdded: a model gives a company draft of a new direction its flow, the marked
// steps with their examples, before the accept (P10 rejected, onboarding 2026-11-14). The latest
// counts.
export const addExamples = (
  x: Extract<Revision<Direction>, { readonly _tag: 'New' }>,
  flow: ReadonlyArray<FlowStep>,
): Extract<Revision<Direction>, { readonly _tag: 'New' }> => ({ ...x, flow })

// --- Send ----------------------------------------------------------------------------------------

// Send.Delivered: the text reached its terminal.
export const deliverSend = (s: PendingSend, at: Time): In<Send, 'state', 'Delivered'> => ({
  ...s,
  state: { _tag: 'Delivered', at },
})

// Send.Dropped: the text never reached its terminal, for a reason that the UI knows.
export const dropSend = (
  s: PendingSend,
  at: Time,
  why: DropReason,
): In<Send, 'state', 'Dropped'> => ({ ...s, state: { _tag: 'Dropped', at, why } })

// --- every stored move, and its function -------------------------------------------------------

type MoveKind = { [G in EventGroup]: `${G}.${MoveTag<G> & string}` }[EventGroup]

// One entry per stored move kind (events.ts <Record>Move). null: the move changes no state of
// its record.
export const MOVES = {
  'Workflow.RoleWordsChanged': changeRoleWords,
  // The latest fit of a role replaces the one before (Work.fits); a fit has no state.
  'Role.Fitted': null,
  'Revision.ExamplesAdded': addExamples,
  'Send.Delivered': deliverSend,
  'Send.Dropped': dropSend,
  // The source keeps its revision; when it was seen is the time of the move in the log.
  'Source.Checked': null,
  // Activation changes no record: it is read from the events (core/actions/activation.ts).
  'Workflow.Activated': null,
  'Workflow.HostRebound': null,
} as const satisfies { readonly [K in MoveKind]: ((...args: never) => unknown) | null }
