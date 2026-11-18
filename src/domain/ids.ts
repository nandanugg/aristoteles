// The ids of the records, as the CLI prints them (v4, d3, s2). Each kind has its own branded
// string, so a draft id cannot go where a review id is wanted. The names of the kinds are the
// page's (Review, Revision).
import { Schema } from 'effect'

// A string that matches the pattern of its kind.
const matching = (pattern: RegExp) => Schema.String.pipe(Schema.check(Schema.isPattern(pattern)))

// One Review record: an accept or a reject of a draft (v4).
export const ReviewId = matching(/^v\d+$/).pipe(Schema.brand('ReviewId'))
export type ReviewId = typeof ReviewId.Type
// A Review that is a Reject: its id is a ReviewId too.
export const RejectId = ReviewId.pipe(Schema.brand('RejectId'))
export type RejectId = typeof RejectId.Type
// A Revision of a direction: the CLI calls it a draft (d3).
export const RevisionId = matching(/^d\d+$/).pipe(Schema.brand('RevisionId'))
export type RevisionId = typeof RevisionId.Type
// A stored act by its seq, as the person's confirm (work confirm) names it: e12.
export const EventRef = matching(/^e\d+$/).pipe(Schema.brand('EventRef'))
export type EventRef = typeof EventRef.Type

// What a draft answers: a Reject.
export const AnswerId = RejectId
export type AnswerId = typeof AnswerId.Type

// Names from the files. A direction id is lower case words with dashes, so that a version id
// (tsd-writing@2) and an entry id (d1/facts-not-proof) read back with no doubt.
export const DirectionId = matching(/^[a-z0-9-]+$/).pipe(Schema.brand('DirectionId'))
export type DirectionId = typeof DirectionId.Type
export const RoleName = Schema.String.pipe(Schema.brand('RoleName'))
export type RoleName = typeof RoleName.Type

// A version of a direction, as the CLI names it: tsd-writing@2.
export const VersionId = matching(/^[a-z0-9-]+@\d+$/).pipe(Schema.brand('VersionId'))
export type VersionId = typeof VersionId.Type
// Each standard and each rule is its own entry in aristoteles. The entry keeps one id while the
// drafts keep the same words: the draft that made it first, then its key (d1/facts-not-proof,
// d1/facts-not-proof/no-code-proof).
export const StandardEntry = matching(/^d\d+\/[^/]+$/).pipe(Schema.brand('StandardEntry'))
export type StandardEntry = typeof StandardEntry.Type
export const RuleEntry = matching(/^d\d+\/[^/]+\/[^/]+$/).pipe(Schema.brand('RuleEntry'))
export type RuleEntry = typeof RuleEntry.Type

// A terminal session of the UI (letters, digits, dot, dash).
export const SessionId = matching(/^[A-Za-z0-9._-]+$/).pipe(Schema.brand('SessionId'))
export type SessionId = typeof SessionId.Type
// The page's Time: the time of an act, as the tool gives it: an ISO date, with a time of day
// and a zone when the tool gives them (2026-10-25T09:07:00.000Z).
export const Time = matching(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
).pipe(Schema.brand('Time'))
export type Time = typeof Time.Type

// A whole number above zero: a limit, an attempt count.
export const PositiveInt = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
  Schema.brand('PositiveInt'),
)
export type PositiveInt = typeof PositiveInt.Type
// A text with at least one letter that is not a space: a reason, a question, a comment. The
// compiler checks it too: a text of the run comes in through NonBlank.make (it checks, and
// brands), and a literal in the code needs one visible ASCII sign, so '' and '  ' do not compile.
type CharsOf<S extends string, Acc = never> = S extends `${infer C}${infer R}`
  ? CharsOf<R, Acc | C>
  : Acc
type Visible =
  | CharsOf<'!"#$%&\'()*+,-./0123456789:;<=>?@'>
  | CharsOf<'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'>
declare const checked: unique symbol
export type NonBlank =
  | (string & { readonly [checked]: 'NonBlank' })
  | `${string}${Visible}${string}`
export const NonBlank = Schema.String.pipe(
  Schema.refine((s: string): s is NonBlank => /\S/.test(s)),
)
export const isNonBlank = Schema.is(NonBlank)

// The prefix of each kind of id.
export const PREFIX = { review: 'v', revision: 'd' } as const
export type Counted = keyof typeof PREFIX
export type Prefix = (typeof PREFIX)[Counted]

// The noun of a prefix, as a refusal names it ("there is no draft d9").
export const NOUN: { readonly [P in Prefix]: string } = {
  v: 'review',
  d: 'draft',
}
export const isPrefix = (word: string): word is Prefix => Object.hasOwn(NOUN, word)

// The letters before the number: "v" of v4; undefined for a word.
export const prefixOf = (id: string): string | undefined => /^[a-z]+/.exec(id)?.[0]

export interface IdByKind {
  readonly review: ReviewId
  readonly revision: RevisionId
}

// The counters of the ids, one per kind.
export type Counters = Readonly<Record<Counted, number>>
export const noCounters: Counters = { review: 0, revision: 0 }

// The next id of a kind, and the counters after it. The order of the names
// within one step is golden (BUILD.md, parity notes).
export const nextId = <K extends Counted>(
  counters: Counters,
  kind: K,
): { readonly id: IdByKind[K]; readonly counters: Counters } => {
  const n = counters[kind] + 1
  return { id: `${PREFIX[kind]}${n}` as IdByKind[K], counters: { ...counters, [kind]: n } }
}

export const versionId = (direction: DirectionId, n: number): VersionId =>
  `${direction}@${n}` as VersionId
