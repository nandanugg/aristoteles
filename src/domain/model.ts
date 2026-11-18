// The records of the work before a top: the owner's types of the design page
// (plan/intelligent-work, Part 2: sharedTypes and the parts Direction and Review), with their
// names, fields and structure.
// Types only: core/actions holds the operations and their refusals; src/domain/moves.ts holds the
// moves of each record with a lifecycle.
//
// Rule 1 (the one change of representation): a record names another record by its id. The Work
// is immutable, so a record is replaced by a new copy when it changes, and a held object would go
// stale. Each record carries its own id (the CLI's id: d3, v4).
// Rule 3: at is the old engine's clock, the place of a record among all records ("before" in
// the rules compares at); when is the time of the act.
// Rule 4 (the owner's review, 2026-11-11): no field is optional. A missing value that something
// reacts to is a tagged member; a value that only some records have is its own member; a value
// that only adds words when given is `| null`.
// Rule 5 (the owner's rulings, 2026-11-12): `_tag` is the tag of every union; a fact lives in
// one field, and what follows from it is derived (src/domain/derived.ts).
import type { Actor, Agent, Human } from './actor.ts'
import type { Level, Principle, Reason } from './closed.ts'
// The Schemas of the stored events hold the shapes that a record keeps as they are, once.
import type { Outside, Why as WhySchema } from './events.ts'
import type { ContextKey, FlowStep, Snapshot } from './files.ts'
import type {
  AnswerId,
  DirectionId,
  EventRef,
  NonBlank,
  PositiveInt,
  RejectId,
  ReviewId,
  RevisionId,
  RoleName,
  RuleEntry,
  StandardEntry,
  SuggestionId,
  Time,
  VersionId,
} from './ids.ts'

export type Text = string
export type { NonBlank }
export type NonEmpty<A> = readonly [A, ...A[]]
export type { Level, Principle, Reason, Snapshot }

// A map with at least one key. Only a smart constructor makes one (context.ts whereOf).
declare const nonEmptyMap: unique symbol
export type NonEmptyMap<K, V> = ReadonlyMap<K, V> & { readonly [nonEmptyMap]: true }

// --- sharedTypes ------------------------------------------------------------------------------

// page: Context. Where a task sits, so that only the standards for that place apply. The keys
// are closed (ContextKey of the files). The section is the one key that the CLI acts on: a task
// with a section writes one heading of its file, which is one unit (a split, a report and the
// brief read it). The other keys only select standards: a where matches them. Each key once, in
// the file's order.
export interface Context {
  readonly section: Section
  readonly facts: ReadonlyMap<FactKey, Text>
}
export type FactKey = Exclude<ContextKey, 'section'>
export type Section =
  | { readonly _tag: 'NoSection' } // a whole file, a repo, or a task to split into sections
  | { readonly _tag: 'Section'; readonly id: Text } // a heading of the file, as its id
// The key of a condition: a fact, or the section.
export type ConditionKey = FactKey | 'section'

// page: Standard.where. A filter, not a context: the standard applies where every condition
// matches the task's context. A condition holds the values that match: one, or several, when one
// standard is for some sections (Nanda, 2026-11-13). The conditions keep the order of the file
// (the words print them).
export type Where =
  | { readonly _tag: 'Everywhere' }
  | { readonly _tag: 'Where'; readonly conditions: NonEmptyMap<ConditionKey, NonEmpty<Text>> }

// page: Source: an outside source at the revision that the host read (events.ts).
export type Source = typeof Outside.Type

// Who acts on a record: a person, or a model run outside any top.
export type By = Actor
// Who writes a draft of a direction: a model run.
export type Reviser = Agent

// A limit of the page's Limits, and of a maker's attempts.
export type Limit =
  | { readonly _tag: 'Unlimited' } // the file sets none: nothing checks it
  | { readonly _tag: 'AtMost'; readonly max: PositiveInt }

// The records that have versions: the page's T of Version<T> and Revision<T>. Each maps to the
// id that names it (rule 1) and to what one version of it holds.
export type Versioned = Direction
export type IdOf<T extends Versioned> = T['id']
export type ContentOf<T extends Versioned> = T extends Direction ? DirectionContent : never
// What a direction says in one version (the engine's shape: each version keeps its words).
// summary: one or two plain sentences for a person who reads it the first time (Nanda,
// 2026-11-15); a revise may change it.
export interface DirectionContent {
  readonly summary: Text
  // How it works, from the first act down to the output (Nanda, 2026-11-15); none: no diagram.
  readonly flow: ReadonlyArray<FlowStep>
  readonly says: Text
  readonly standards: ReadonlyArray<StandardEntry>
}

// page: Version<T>. One official version of T: the content that a draft made official. Its id
// (tsd-writing@2) and whether it is current follow from of, number and its place among the
// versions of T (derived.ts versionIdOf, currentVersion).
// A company direction's version names its commit through its revision (origin Imported).
export type Version<T extends Versioned> = ContentOf<T> & {
  readonly of: IdOf<T>
  readonly number: PositiveInt // 1, 2, 3: each official draft adds the next one
  readonly revision: RevisionId // the draft that made it; version 1 too
  readonly when: Time
}

// page: Revision.why: none given, or one of the five reasons with the reviser's words or none.
export type Why = typeof WhySchema.Type

// Who wrote a draft, and where from: one fact with three forms. A model of this dir writes it,
// the daily refresh imports a commit of the company repo of its direction (the repo and the
// folder are the Direction's source), or the store start of onboarding holds it (Question 20,
// option A: the person accepted it on the page, so no draft event and no accept event exist).
export type RevisionOrigin =
  | { readonly _tag: 'Written'; readonly by: Reviser }
  | { readonly _tag: 'Onboarded'; readonly event: EventRef } // the start event: e1
  | {
      readonly _tag: 'Imported'
      readonly commit: Text
      readonly ref:
        | { readonly _tag: 'DefaultBranch' }
        | { readonly _tag: 'Tag'; readonly tag: Text }
    }

// page: Revision<T>. A draft of T: a new one, or a change of a version. Its reviews point to it
// (Review.of); it is official when a version has it as its revision. The examples are in the
// steps of its flow: a company draft of a new direction has no flow until a model adds it.
export type Revision<T extends Versioned> = ContentOf<T> &
  (
    | { readonly _tag: 'New' } // page: no base; version 1
    | { readonly _tag: 'Change'; readonly base: VersionId } // the version that it changes
  ) & {
    readonly id: RevisionId // not on the page: d3
    readonly of: IdOf<T>
    readonly origin: RevisionOrigin // page: by
    // The Rejects (or their points) and the suggestions that it answers.
    readonly answers: ReadonlyArray<AnswerId>
    readonly why: Why
    readonly when: Time
    readonly at: number
  }

// page: Suggestion. Feedback in words, from anyone.
export interface Suggestion {
  readonly id: SuggestionId // not on the page
  readonly about: SuggestionAbout
  readonly says: Text
  readonly by: By
  readonly when: Time // not on the page
  readonly at: number
}
// page: about?: Direction | Standard | Rule, by id (rule 1); the page's "none" is NewDirection.
export type SuggestionAbout =
  | { readonly _tag: 'NewDirection' }
  | { readonly _tag: 'Direction'; readonly direction: DirectionId }
  | { readonly _tag: 'Standard'; readonly standard: StandardEntry }
  | { readonly _tag: 'Rule'; readonly rule: RuleEntry }
  | { readonly _tag: 'Roles' } // the roles of the workflow

// --- Direction -----------------------------------------------------------------------------------

// page: Direction. Its says and standards are those of its current version (the engine keeps
// them per version). A direction is drafted first (its whole text is a draft that waits); the
// accept that makes its first version official makes it Official.
export type Direction = DirectionBase &
  (
    | { readonly _tag: 'NewDirection' } // drafted, with no version yet
    | { readonly _tag: 'Official'; readonly versions: NonEmpty<Version<Direction>> }
  )
interface DirectionBase {
  readonly id: DirectionId // not on the page: the key of the direction in the dir
  readonly name: Text
  readonly owner: Human // page: Actor; the CLI's owner is a person of aristoteles.yaml
  readonly from: ReadonlyArray<Principle>
  readonly maxStandards: Limit
  // not on the page: written in this dir, or a folder of a company repo (aristoteles.lock).
  readonly source:
    | { readonly _tag: 'Local' }
    | { readonly _tag: 'External'; readonly repo: Text; readonly path: Text }
}
export type OfficialDirection = Extract<Direction, { readonly _tag: 'Official' }>

// page: Standard. How the output looks.
export interface Standard {
  readonly entry: StandardEntry // not on the page: its entry in aristoteles (rule 1)
  readonly id: Text // e.g. 'facts-not-proof'; revise names a standard by it; every file has it
  readonly says: Text
  readonly where: Where
  readonly rules: ReadonlyArray<RuleEntry>
}

// page: Rule. A check that the standard is met.
export interface Rule {
  readonly entry: RuleEntry // not on the page: its entry in aristoteles (rule 1)
  readonly id: Text // e.g. 'no-ticket-ids': one rule in the project; every file has it
  readonly says: Text
  readonly test?: string // a shell command: no output = the rule holds, each line a point
  readonly ref?: string // file#anchor:lines
  // page: checkedBy?; none: the decider of the result checks it.
  readonly checkedBy:
    | { readonly _tag: 'Decider' }
    | { readonly _tag: 'Role'; readonly role: RoleName }
  readonly supersedes: ReadonlyArray<RuleEntry> // [] when it replaces none
}

// --- Review --------------------------------------------------------------------------------------

// page: Review. One act of the owner on a draft: an accept makes its version, a reject ends it.
// The page's decision is the tag.
export type Review = Accept | Reject
interface ReviewBase {
  readonly id: ReviewId // not on the page
  readonly by: Human
  readonly when: Time // not on the page
  readonly at: number // not on the page
}
export type Accept = ReviewBase & {
  readonly _tag: 'Accept'
  readonly reason: Text | null // a comment; only words read it
  readonly of: { readonly _tag: 'Revision'; readonly id: RevisionId }
}
export type Reject = ReviewBase & {
  readonly _tag: 'Reject'
  readonly id: RejectId
  readonly of: { readonly _tag: 'Revision'; readonly id: RevisionId; readonly reason: NonBlank }
}
