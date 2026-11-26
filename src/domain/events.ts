import { AdmissionPolicy, ChildRelease, ChildReservation, RecheckUse, RuntimeEvent, SerialAssignment, Turn, WorkerDelivery, WorkerPlacement } from './worker-runtime.ts'
// The stored events, grouped by the record that they happen to (the owner's rulings, 2026-11-12):
//   - a creation goes under the record that it creates: { _tag: 'Revision', create: Drafted{...} };
//   - a move goes under the record that it moves, which it names once, by its id: { _tag:
//     'Revision', id: 'd3', move: ExamplesAdded{...} }; the moves of a record are its <Record>Move
//     union, in the past tense, and each has its typed transition (domain/moves.ts);
//   - a record that is written once (a review) is a creation only.
// What is stored is what the actor wrote (its written input): the fold makes the id (one counter,
// no stored id of a new record), the clock, when (the event's time), by (the author), and every
// record that follows from the act (a version); it maps the words of a file to the records (a
// rule named by its key becomes its entry). Every key is present: null is "none given", and a
// value that only some acts have is its own member. A refusal never comes from the replay: every
// event was checked when it was written.
import { Schema } from 'effect'
import { Author } from './actor.ts'
import { Reason } from './closed.ts'
import { RuleEvidence,
  CompanyCheckers,
  CompanyFolder,
  ConfigFile,
  ContextFacts,
  DirectionFile,
  ExternalSource,
  Flow,
  ReviseFile,
  RoleWords,
} from './files.ts'
import {
  AnswerId,
  DirectionId,
  EventRef,
  NonBlank,
  RevisionId,
  RoleName,
  SessionId,
  Time,
} from './ids.ts'
import { ActEnvelope, Body } from './c16-acts.ts'
import { ItemRec, RoleDraft } from './work-acts.ts'

const Text = Schema.String
const NonEmpty = Schema.NonEmptyArray

// page: Source. An outside source and the revision that the host read (work source). When it was
// seen is the time of the stored act that named it or checked it, so no source keeps a time.
export const Outside = Schema.TaggedStruct('Outside', { name: Text, revision: Text })

// The two forms of an event of a group: a creation, and a move of one record by its id.
const created = <G extends string, C extends Schema.Top>(group: G, create: C) =>
  Schema.TaggedStruct(group, { create })
const moved = <G extends string, I extends Schema.Top, M extends Schema.Top>(
  group: G,
  id: I,
  move: M,
) => Schema.TaggedStruct(group, { id, move })

// --- the workflow and the fit of a role -------------------------------------------------------

// An accepted direction of onboarding, as the store start keeps it (Question 20, option A): its
// file (its flow holds its examples), and where it comes from, so that a company direction stays one and the
// daily refresh follows it (P8).
export const OnboardedDirection = Schema.Struct({
  direction: DirectionFile,
  source: Schema.Union([
    Schema.TaggedStruct('Local', {}),
    Schema.TaggedStruct('External', ExternalSource.fields),
  ]),
})
export type OnboardedDirection = typeof OnboardedDirection.Type

// work init (old config), or the store start of onboarding with the accepted directions; later
// changes of the words of roles (old config.text). A dir has one workflow: its move names no id.
export const WorkflowMove = Schema.Union([
  Schema.TaggedStruct('RoleWordsChanged', {
    roles: Schema.Record(Text, RoleWords),
    hashes: Schema.Record(Text, Text),
    texts: Schema.Record(Text, Text),
  }),
])
const Workflow = Schema.Union([
  created(
    'Workflow',
    Schema.TaggedStruct('Initialized', {
      config: ConfigFile,
      hashes: Schema.Record(Text, Text),
      texts: Schema.Record(Text, Text),
      directions: Schema.Array(OnboardedDirection),
    }),
  ),
  Schema.TaggedStruct('Workflow', { move: WorkflowMove }),
])
// The fit of a role (work role fit): the latest one counts. It holds the answer to each question
// of guides/fitness.yaml (its id): a yes with its why, as the CLI records a fit only then.
export const FitAnswer = Schema.Struct({
  id: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
  yes: Schema.Literal(true),
  why: NonBlank,
})
// The fit of a role records the yes and why of each question of guides/fitness.yaml. The words of
// a role change only by a config apply (Workflow.RoleWordsChanged).
export const RoleMove = Schema.Union([
  Schema.TaggedStruct('Fitted', { hash: Text, answers: NonEmpty(FitAnswer) }),
])
const Role = moved('Role', RoleName, RoleMove)

// --- sends ------------------------------------------------------------------------------------

// Every text that goes into a terminal: the destination fixes its way in.
export const Destination = Schema.TaggedStruct('Terminal', {
  session: SessionId,
  via: Schema.TaggedStruct('Tmux', {}),
})
// Why a send never reached its terminal.
export const DropReason = Schema.Union([
  Schema.TaggedStruct('TerminalNotLive', {}), // its pane is not running (closed, or exited)
  Schema.TaggedStruct('TypingFailed', {}), // the pump could not type it
])
export const SendMove = Schema.Union([
  Schema.TaggedStruct('Delivered', {}),
  Schema.TaggedStruct('Dropped', { why: DropReason }),
])
// What is typed: a line then Enter, or Enter alone (the default answer of a prompt).
export const Line = Schema.TaggedStruct('Line', { text: NonBlank })
export const Enter = Schema.TaggedStruct('Enter', {})
const Send = Schema.Union([
  // work send: the person's input for a pane; the author is the sender.
  created(
    'Send',
    Schema.TaggedStruct('Sent', {
      from: Schema.TaggedStruct('Person', { to: Destination }),
      keys: Schema.Union([Line, Enter]),
    }),
  ),
  // The Sent event names the send.
  moved('Send', EventRef, SendMove),
])

// --- the owner's decision of a draft ----------------------------------------------------------

// The owner's accept of a draft, with a comment that only words read, and the reject of it.
const reason = Schema.NullOr(NonBlank)
export const ReviewWritten = Schema.Union([
  Schema.TaggedStruct('Accept', {
    of: Schema.TaggedStruct('Revision', { id: RevisionId }),
    reason,
  }),
  Schema.TaggedStruct('Reject', {
    of: Schema.TaggedStruct('Revision', { id: RevisionId, reason: NonBlank }),
  }),
])
export type ReviewWritten = typeof ReviewWritten.Type
const Review = created('Review', ReviewWritten)

// --- drafts of directions, sources -------------------------------------------------------------

// page: Revision.why (the owner's ruling, 2026-11-12): none given, or one of the five reasons
// (the CLI word --why) with the reviser's words or none (--why-words).
export const Why = Schema.Union([
  Schema.TaggedStruct('NoneGiven', {}),
  Schema.TaggedStruct('Given', { reason: Reason, words: Schema.NullOr(NonBlank) }),
])
// A draft (a Revision) of a direction: the whole of a new one (the CLI word: direction new), a
// change of its current version (direction revise), or a commit of a company direction (the
// daily refresh). Its state (waiting, vetoed, official) follows from the reviews. A new direction
// starts with its flow, whose marked steps hold the examples; a revise that changes the flow
// brings its examples with it. A company draft of a new direction gets its flow (of this
// project, its steps marked, each with its examples) from a model before the accept
// (ExamplesAdded: the latest counts).
export const RevisionMove = Schema.Union([
  // The flow (where the rules apply) and each rule's evidence with its cases (pass 3b: cases live
  // on rules): [rule id, evidence].
  Schema.TaggedStruct('ExamplesAdded', {
    flow: Flow,
    evidence: Schema.Array(Schema.Tuple([Schema.String, RuleEvidence])),
  }),
])
const Revision = Schema.Union([
  created(
    'Revision',
    Schema.Union([
      Schema.TaggedStruct('Drafted', {
        direction: DirectionFile,
        answers: Schema.Array(AnswerId),
        why: Why,
      }),
      Schema.TaggedStruct('Revised', {
        direction: DirectionId,
        edit: ReviseFile,
        answers: Schema.Array(AnswerId),
        why: Why,
      }),
      Schema.TaggedStruct('Imported', {
        direction: DirectionId,
        source: ExternalSource,
        folder: CompanyFolder,
        owner: Text,
        checkers: CompanyCheckers,
      }),
    ]),
  ),
  moved('Revision', RevisionId, RevisionMove),
])
// The host reads an outside source (work source): a new revision is a Moved; the same revision
// again is a Checked of the source by its name, which only renews when it was seen.
export const SourceMove = Schema.Union([Schema.TaggedStruct('Checked', {})])
const Source = Schema.Union([
  created('Source', Schema.TaggedStruct('Moved', { source: Outside })),
  moved('Source', Text, SourceMove),
])
// The work model (core/state/c16): the person opens the top; each accepted act is one event.
const Int = Schema.Number.pipe(Schema.check(Schema.isInt()))
// A token as the store keeps it: the actor key and the hash of its secret.
const TokenHash = Schema.Tuple([Text, Text])
// The person opened the top: its items, the cards of the persistent roles, the tries of a task
// before a raise, and the tokens (actor key, hash) of the host, the pipe and each role at epoch 0.
export const WorkOpened = Schema.TaggedStruct('Opened', {
  top: Schema.Struct({
    name: Text,
    goal: Text,
    sections: Schema.Array(Text),
    facts: ContextFacts,
    directions: Schema.Array(Text),
  }),
  items: Schema.Array(Schema.Tuple([Text, ItemRec])),
  cards: Schema.Array(Schema.Tuple([Text, RoleDraft])),
  maxTries: Int,
  tokens: Schema.Array(TokenHash),
  // An activated workflow (contract 6c): the bound host's managed session; the host starts UP at
  // epoch 0 there (its bootstrap credential is its epoch-0 token). null: every actor starts down.
  hostSession: Schema.NullOr(Text),
  placements: Schema.optionalKey(Schema.Array(WorkerPlacement)),
  admission: Schema.optionalKey(Schema.Array(AdmissionPolicy)),
  placementRevision: Schema.optionalKey(Text),
})
// One act the store accepted; token: the new token the act makes (a new maker, a revived actor, a
// resumed maker, the host of a move), else null.
export const WorkActed = Schema.TaggedStruct('Acted', {
  act: ActEnvelope,
  delivery: Schema.optionalKey(Schema.NullOr(WorkerDelivery)),
  recheck: Schema.optionalKey(RecheckUse),
  inlineOffer: Schema.optionalKey(Turn),
  childReserved: Schema.optionalKey(ChildReservation),
  childReleased: Schema.optionalKey(ChildRelease),
  serialAssigned: Schema.optionalKey(SerialAssignment),
  request: Text,
  forward: Schema.NullOr(Text),
  token: Schema.NullOr(TokenHash),
})
// The pane of the host in the person's own tmux (its socket and pane id): bookkeeping that the
// page and the engine read, not an act of the protocol.
export const WorkHostPane = Schema.TaggedStruct('HostPane', { socket: Text, pane: Text })
// The host carries the person's words from its chat as the person's act (a Body the page may
// send): it waits on the page for the person's confirm (Confirm dispatches it with its `on`) or
// drop. Bookkeeping, not an act.
export const WorkForwarded = Schema.TaggedStruct('Forwarded', {
  id: Text,
  act: Body,
  on: Schema.NullOr(Int),
  quote: Text,
})
// The forward is spent: the person dropped it, or confirmed it.
export const WorkForwardDropped = Schema.TaggedStruct('ForwardDropped', { id: Text })
const WorkEvent = created(
  'Work',
  Schema.Union([WorkOpened, WorkActed, WorkHostPane, WorkForwarded, WorkForwardDropped]),
)

// --- every event --------------------------------------------------------------------------------

export const Event = Schema.Union([
  ...Workflow.members,
  Role,
  ...Send.members,
  Review,
  ...Revision.members,
  ...Source.members,
  WorkEvent,
  created('Runtime', RuntimeEvent),
])
export type Event = typeof Event.Type
// The record that an event happens to.
export type EventGroup = Event['_tag']
export type GroupOf<G extends EventGroup> = Extract<Event, { readonly _tag: G }>
// The data of an event: its creation, or its move.
type DataOf<E> = E extends { readonly create: infer D }
  ? D
  : E extends { readonly move: infer D }
    ? D
    : never
export type CreateOf<G extends EventGroup> = Extract<GroupOf<G>, { readonly create: unknown }>
export type MoveOf<G extends EventGroup> = Extract<GroupOf<G>, { readonly move: unknown }>
export type MoveTag<G extends EventGroup> = DataOf<MoveOf<G>> extends { readonly _tag: infer T }
  ? T
  : never
// Every kind of event, as its group and its member: 'Task.Opened', 'Review.Accept'.
export type Kind = {
  [G in EventGroup]: DataOf<GroupOf<G>> extends { readonly _tag: infer T extends string }
    ? `${G}.${T}`
    : never
}[EventGroup]
// A table with one entry per kind: a new kind fails the compile of each table until it has one.
export type Total<V> = { readonly [K in Kind]: V }
// The event of one kind: its creation, or its move with the id of the record that it moves.
type CreateData<G extends EventGroup> = DataOf<CreateOf<G>>
type MoveData<G extends EventGroup> = DataOf<MoveOf<G>>
// One event per member of the data, so that a pair of the data (a sender and its keys) stays one.
type Created<G extends EventGroup, M> =
  Extract<CreateData<G>, { readonly _tag: M }> extends infer D
    ? D extends unknown
      ? { readonly _tag: G; readonly create: D }
      : never
    : never
// A move keeps the form of its group: with the id of the record, or none (the one workflow).
type Moved<G extends EventGroup, M> = [Extract<MoveData<G>, { readonly _tag: M }>] extends [never]
  ? never
  : Omit<MoveOf<G>, 'move'> & { readonly move: Extract<MoveData<G>, { readonly _tag: M }> }
export type EventOf<K extends Kind> = K extends `${infer G extends EventGroup}.${infer M}`
  ? Created<G, M> | Moved<G, M>
  : never

export const dataOf = (event: Event): { readonly _tag: string } =>
  'create' in event ? event.create : event.move
export const memberOf = (event: Event): string => dataOf(event)._tag
export const kindOf = (event: Event): Kind =>
  `${event._tag}.${memberOf(event)}` as Kind

// Builders: create('Task', { _tag: 'Opened', ... }), move('Task', id, { _tag: 'Closed', ... }).
export const create = <G extends EventGroup>(
  group: G,
  data: DataOf<CreateOf<G>>,
): GroupOf<G> => ({ _tag: group, create: data }) as unknown as GroupOf<G>
export const move = <G extends EventGroup>(
  group: G,
  id: MoveOf<G> extends { readonly id: infer I } ? I : never,
  data: DataOf<MoveOf<G>>,
): GroupOf<G> => ({ _tag: group, id, move: data }) as unknown as GroupOf<G>

// --- who writes each kind -----------------------------------------------------------------------

// The kinds that each author writes: one table, so that a refresh accepts no review and a model
// run opens no top. The store keeps no other pair.
export const WRITTEN_BY = {
  // The person at a terminal or on the page.
  Person: [
    'Workflow.Initialized',
    'Workflow.RoleWordsChanged',
    'Role.Fitted',
    'Runtime.ProjectUsageMeasured',
    'Send.Sent',
    'Review.Accept',
    'Review.Reject',
    'Work.Opened',
    'Work.HostPane',
    'Work.ForwardDropped',
    'Work.Acted',
  ],
  // A model run outside any top: its draft of a new direction, its revise of a direction that has
  // a version, the fit of a role, and the examples of a company draft.
  ModelRun: [
    'Revision.Drafted',
    'Revision.Revised',
    'Revision.ExamplesAdded',
    'Role.Fitted',
    'Work.Acted',
  ],
  // The engine's acts, and the host's reads of a source.
  System: [
    'Source.Moved', 'Source.Checked', 'Work.Forwarded', 'Work.Acted',
    'Runtime.WorkerReserved', 'Runtime.WorkerFenced', 'Runtime.TurnOffered', 'Runtime.TurnClosed',
    'Runtime.ChildReserved', 'Runtime.ChildStarted', 'Runtime.RecheckQueued', 'Runtime.CheckpointSaved',
    'Runtime.WorkerParkRequested', 'Runtime.RecheckDeferred', 'Runtime.RecheckReported', 'Runtime.RecheckCancelled',
    'Runtime.WorkerRecoveryRequested',
  ],
  // The supervisor of the terminals: the fate of a send.
  Supervisor: [
    'Send.Delivered', 'Send.Dropped', 'Work.Acted',
    'Runtime.WorkerBound', 'Runtime.WorkerEnded', 'Runtime.WorkerFenced',
    'Runtime.ChildBound', 'Runtime.ChildReleased', 'Runtime.WorkerParkConfirmed', 'Runtime.WorkerParkCancelled',
    'Runtime.RecheckHelperBound',
  ],
  // The daily refresh of the company directions.
  Refresh: ['Revision.Imported', 'Work.Acted'],
} as const satisfies { readonly [A in Author['_tag']]: ReadonlyArray<Kind> }
export type AuthorTag = Author['_tag']
export type WrittenBy = { readonly [A in AuthorTag]: (typeof WRITTEN_BY)[A][number] }

// The events of an author: the kinds of its row, and a send only from itself as the sender.
type EventBy<A extends AuthorTag> =
  EventOf<WrittenBy[A]> extends infer E
    ? E extends { readonly create: { readonly _tag: 'Sent'; readonly from: infer F } }
      ? F extends { readonly _tag: A }
        ? E
        : never
      : E
    : never
export interface RecordedBy<A extends AuthorTag> {
  readonly seq: number
  readonly at: Time
  readonly author: Extract<Author, { readonly _tag: A }>
  readonly event: EventBy<A>
}
// The authors that write a kind, and one event of that kind with its author (a fold step).
type AuthorsOf<K extends Kind> = { [A in AuthorTag]: K extends WrittenBy[A] ? A : never }[AuthorTag]
export type RecordedOf<K extends Kind> = {
  readonly seq: number
  readonly at: Time
  readonly author: Extract<Author, { readonly _tag: AuthorsOf<K> }>
  readonly event: EventOf<K>
}

// The pair is one that the table holds: its kind is in the author's row, and a send comes from
// its author.
export const writtenBy = (author: Author, event: Event): boolean => {
  const kinds: ReadonlyArray<Kind> = WRITTEN_BY[author._tag]
  if (!kinds.includes(kindOf(event))) return false
  if (event._tag === 'Send' && 'create' in event) return event.create.from._tag === author._tag
  return true
}

// One event as the store keeps it: its seq in the dir, its time, and who wrote it; the store
// refuses a pair of an author and an event that the table does not hold.
export type Recorded = { [A in AuthorTag]: RecordedBy<A> }[AuthorTag]
export const Recorded = Schema.Struct({
  seq: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
  at: Time,
  author: Author,
  event: Event,
}).pipe(
  Schema.refine((r): r is Recorded => writtenBy(r.author, r.event), {
    message: 'an author that does not write this kind of event',
  }),
)

// An event before the store gives it a seq.
export interface Draft {
  readonly at: Time
  readonly author: Author
  readonly event: Event
}

// Every row decodes strictly: a key that the schema does not know is a damaged row.
export const decodeRecorded = Schema.decodeUnknownSync(Recorded, { onExcessProperty: 'error' })
export const encodeEvent = Schema.encodeSync(Event)
export const encodeAuthor = Schema.encodeSync(Author)
