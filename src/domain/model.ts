// The records of the work: the owner's types of the design page (plan/intelligent-work, Part 2:
// sharedTypes and the parts Workflow, Direction, Task, Assignment, Result, Review, Evaluation,
// Checkpoint, Note), with their names, fields and structure. Types only: the engine
// (src/engine) holds the operations of the page (Workflow.define, Task.start, Review.decide...)
// and their refusals; src/domain/moves.ts holds the moves of each record with a lifecycle.
//
// Rule 1 (the one change of representation): a record names another record by its id, where
// the page draws the record itself (needs: TaskId[] for the page's needs: Task[]). The Work is
// immutable, so a record is replaced by a new copy when it changes, and a held object would go
// stale. Each record carries its own id (the CLI's id: t3, a7). BUILD.md lists this for the owner.
// Rule 2: a field marked "not on the page" is the old engine's, with its old name.
// Rule 3: at is the old engine's clock, the place of a record among all records ("before" in
// the rules compares at); when is the time of the act. The page's Time is the type of when.
// Rule 4 (the owner's review, 2026-11-11): no field is optional. A missing value that something
// reacts to is a tagged member; a value that only some records have is its own member; a value
// that only adds words when given is `| null` (BUILD.md section 7 lists each field).
// Rule 5 (the owner's rulings, 2026-11-12): `_tag` is the tag of every union; a fact lives in
// one field, and what follows from it is derived (src/domain/derived.ts). The design page's old
// names: its Raise is Escalate, its settles is Resolve, its Executive is Permission.
//
// The derived states at the end (TaskState of the page, and the additions of plan/types
// PLAN.md section 5) are computed by the engine; nothing stores them.
import type { Actor, Agent, Human } from './actor.ts'
import type { Level, Principle, Reason, Tier } from './closed.ts'
// The Schemas of the stored events hold the shapes that a record keeps as they are, once.
import type {
  GrantedAct as GrantedActSchema,
  ReportedWork,
  SourceSchema,
  Stop as StopSchema,
  Why as WhySchema,
} from './events.ts'
import type { ContextKey, Snapshot } from './files.ts'
import type {
  AnswerId,
  AssignmentId,
  CheckpointId,
  DirectionId,
  EscalationId,
  EvaluationId,
  ExhaustionId,
  NonBlank,
  NoteId,
  PermissionId,
  PointId,
  PositiveInt,
  QuestionId,
  RejectId,
  ResultId,
  ReviewId,
  RevisionId,
  RoleName,
  RuleEntry,
  StandardEntry,
  SuggestionId,
  TaskId,
  Time,
  VersionId,
} from './ids.ts'

export type Text = string
export type { NonBlank }
export type NonEmpty<A> = readonly [A, ...A[]]
export type { Level, Principle, Reason, Snapshot, Tier }

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
// matches the task's context. The conditions keep the order of the file (the words print them).
export type Where =
  | { readonly _tag: 'Everywhere' }
  | { readonly _tag: 'Where'; readonly conditions: NonEmptyMap<ConditionKey, Text> }

// page: Source: a git source at a commit, or an outside source at a revision (events.ts).
export type Source = typeof SourceSchema.Type

// Who acts on a record: an assignment, or an actor (a person, or a model run outside any task).
// page: "by: Assignment | Actor". The narrower kinds say who the old engine allows.
export type By = AssignmentId | Actor
// Who answers a question or decides an escalation: an assignment, or the owner.
export type Answerer = AssignmentId | Human
// Who writes a draft of a direction: a model (an assignment, or a run outside any task).
export type Reviser = AssignmentId | Agent

// The versions that an act read: the number of the version of each direction, so the key names
// the direction once (derived.ts versionId gives the id: tsd-writing@2).
export type Under = ReadonlyMap<DirectionId, PositiveInt>

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
export interface DirectionContent {
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

// Who wrote a draft, and where from: one fact with two forms. A model of this dir writes it, or
// the daily refresh imports a commit of the company repo of its direction (the repo and the
// folder are the Direction's source).
export type RevisionOrigin =
  | { readonly _tag: 'Written'; readonly by: Reviser }
  | {
      readonly _tag: 'Imported'
      readonly commit: Text
      readonly ref:
        | { readonly _tag: 'DefaultBranch' }
        | { readonly _tag: 'Tag'; readonly tag: Text }
    }

// page: Revision<T>. A draft of T: a new one, or a change of a version. Its reviews point to it
// (Review.of); it is official when a version has it as its revision.
export type Revision<T extends Versioned> = ContentOf<T> &
  (
    | { readonly _tag: 'New' } // page: no base; it becomes version 1
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

// page: Permission. One act, for a time: it covers an act from its own time (when) to its until,
// and before its revoke. No grant gives Do: a maker is a role. The CLI words: grant, revoke.
export interface Permission {
  readonly id: PermissionId // not on the page
  readonly act: GrantedAct
  readonly to: RoleName
  readonly by: By // page: by: Actor; the engine lets a model give the acts of its assignment
  readonly until: Time // the last time of an act that it covers
  // page: revoked?: Time.
  readonly revoked:
    | { readonly _tag: 'NotRevoked' }
    | { readonly _tag: 'Revoked'; readonly at: Time }
  readonly when: Time
  readonly at: number
}

// --- Workflow ----------------------------------------------------------------------------------

// page: Workflow. The roles of one system, who plays them, their tiers, and the limits.
export interface Workflow {
  readonly system: Text // the work CLI uses the name of its project
  // not on the page: the person who made the store owns the roles
  readonly owner: Human
  readonly roles: ReadonlyMap<RoleName, Role> // with the three tiers
  // The CLI sets no limit for the whole workflow (all Unlimited): each role has its tier's.
  readonly limits: Limits
  // page: measure?: (a) => number. Not stored: the CLI gives it to each check (CheckContext).
  // page: decide?: who decides the results of a maker, one entry per maker; a maker with none:
  // any one role with an Approve act on it decides.
  readonly decide: ReadonlyMap<RoleName, Deciders>
}

// page: Deciders = Role | Actor | Or | And | Order. A role by its name (rule 1); a person by
// name too. A model run never decides.
export type Deciders = DeciderLeaf | Or | And | Order
export type DeciderLeaf = { readonly _tag: 'Role'; readonly role: RoleName } | Human
// page: Or(items), And(items), Order(items). Each leaf once, one person, the person last in an
// Order: the decoder of the file checks these (engine decidersOf).
export interface Or {
  readonly _tag: 'Or' // any one of them
  readonly items: NonEmpty<Deciders>
}
export interface And {
  readonly _tag: 'And' // each of them, in any order
  readonly items: NonEmpty<Deciders>
}
export interface Order {
  readonly _tag: 'Order' // each of them, in this order
  readonly items: NonEmpty<Deciders>
}

// page: Limits. Each part reads only the limits under its name; every limit is there.
export interface Limits {
  readonly Assignment: { readonly briefChars: Limit; readonly attempts: Limit }
  readonly Review: { readonly rules: Limit }
  readonly Result: { readonly size: Limit }
}

// page: Role. A role of a model tier, or a check program (page: "a check program has no tier").
// page: playedBy: derived (derived.ts playedBy): the tier's model, or the program's name; a
// person plays no role. Its words are the Work's config (Work.config.roles), kept once.
export type Role = RoleBase &
  ({ readonly _tag: 'Model'; readonly tier: Tier } | { readonly _tag: 'Program' })
interface RoleBase {
  readonly role: RoleName // the system's own name: 'writer', 'linter'
  readonly acts: ReadonlyArray<Act>
  readonly limits: Limits // the CLI: those of its tier; a program's are all Unlimited
}

// page: Act. The engine knows four acts; each says on what.
export type Act =
  | { readonly _tag: 'Do'; readonly work: Text }
  | { readonly _tag: 'Review'; readonly resultsOf: ReadonlyArray<RoleName> }
  | { readonly _tag: 'Approve'; readonly resultsOf: ReadonlyArray<RoleName> }
  // A role's change act names directions by id before they exist; only an official direction
  // counts.
  | { readonly _tag: 'Change'; readonly changesOf: ReadonlyArray<DirectionId | TaskId> }
// The acts that a permission gives: every act but Do (events.ts GrantedAct).
export type GrantedAct = typeof GrantedActSchema.Type

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
  // page: none: the owner; then a high role with a Change act on it accepts in the owner's place.
  readonly approvedBy:
    | { readonly _tag: 'Owner' }
    | { readonly _tag: 'Deciders'; readonly deciders: Deciders }
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
  // page: checkedBy?; none: the decider of the result checks it.
  readonly checkedBy:
    | { readonly _tag: 'Decider' }
    | { readonly _tag: 'Role'; readonly role: RoleName }
  readonly supersedes: ReadonlyArray<RuleEntry> // [] when it replaces none
}

// --- Task ----------------------------------------------------------------------------------------

// page: Task. A remake is the old task's end (Replaced.next); the old task of a remake and the
// parts that a part runs after are derived (derived.ts).
export interface Task {
  readonly id: TaskId
  readonly name: Text
  readonly owner: Human
  // For people; its own fact. The text of the task file until the person writes it (work task
  // describe).
  readonly descriptionHuman: Text
  readonly descriptionAi: {
    readonly text: Text
    // The text of the bigger task, after a split; only the brief prints it.
    readonly partOf: Text | null
    readonly directions: ReadonlyArray<DirectionId>
    readonly references: ReadonlyArray<Text>
    readonly notes: ReadonlyArray<NoteId>
    readonly context: Context
    readonly from: ResultId | null // the starting point: older accepted work; null: none
    readonly workspace: ReadonlyArray<Workspace> // not on the page: the files of the work
  }
  // page: serves?: a part serves the task that it was split from; none: a top task.
  readonly serves:
    | { readonly _tag: 'TopTask' }
    | { readonly _tag: 'Serves'; readonly task: TaskId }
  readonly needs: ReadonlyArray<TaskId> // a remake moves the needs of other tasks to the new one
  readonly when: Time // not on the page
  readonly end: TaskEnd // page: closed?, with replacedBy for a remake
  // not on the page: how each file looked at the first brief (a report equal to it is
  // untouched work), and for a maker that writes in place, the text of each file then (the
  // start of the task's own diff).
  readonly untouched:
    | { readonly _tag: 'NotBriefed' }
    | {
        readonly _tag: 'AtFirstBrief'
        readonly files: Readonly<Record<string, Snapshot>>
        readonly inPlace:
          | { readonly _tag: 'NotInPlace' }
          | {
              readonly _tag: 'InPlace'
              readonly texts: Readonly<Record<string, Text>>
              readonly at: Time
            }
      }
}

// page: closed?: TaskClosed. Closed by the owner or a Change act, or replaced by a remake.
export type TaskEnd =
  | { readonly _tag: 'NotEnded' }
  | { readonly _tag: 'Closed'; readonly by: By; readonly reason: NonBlank; readonly when: Time }
  | {
      readonly _tag: 'Replaced'
      readonly by: By
      readonly reason: NonBlank
      readonly next: TaskId // page: replacedBy
      readonly when: Time
    }

// not on the page: a workspace entry of a task file. A repo has the base that a commit is new
// work against; a file or a folder has none. verify: a command, exit 0 when the work is ready;
// only the brief prints it.
export type Workspace =
  | {
      readonly _tag: 'Files'
      readonly source: Text
      readonly path: Text
      readonly verify: Text | null
    }
  | {
      readonly _tag: 'Repo'
      readonly source: Text
      readonly path: Text
      readonly base: Text
      readonly verify: Text | null
    }

// not on the page: the engine's changes, a split or a remake that answers Rejects.
export interface Change {
  readonly _tag: 'Split' | 'Remake'
  readonly task: TaskId // the task split, or the old task of a remake
  readonly answers: ReadonlyArray<RejectId | PointId>
  readonly by: By
  readonly when: Time
  readonly at: number
}

// --- Assignment --------------------------------------------------------------------------------

// page: Assignment. One actor in one workflow role on one task. A maker is an assignment of a
// role with a Do act; any other (it reviews, approves or changes) has no attempts. The role
// fixes which one when the assignment is given.
export type Assignment = Maker | Reviewer
interface AssignmentBase {
  readonly id: AssignmentId // not on the page
  readonly actor: Actor // the person, or the run that plays the role
  readonly role: RoleName
  readonly task: TaskId
  // The snapshot: the version of each direction at the last brief read.
  readonly under: Under
  // page: parent?: the assignment that gave this one; none: the person gave it.
  readonly parent:
    | { readonly _tag: 'GivenByPerson' }
    | { readonly _tag: 'Parent'; readonly id: AssignmentId }
  readonly when: Time // not on the page
  readonly end: AssignmentEnd // not on the page: the engine's finished
}
export type Maker = AssignmentBase & {
  readonly _tag: 'Maker'
  // page: maxAttempts?: how many faults it may make: its parent's number, else its role's limit.
  readonly maxAttempts: Limit
}
export type Reviewer = AssignmentBase & { readonly _tag: 'Reviewer' }
// A finish ends an assignment, and so does a new maker of the task for the maker before it
// (what waited for it goes up, as at a finish; nothing tells the two apart).
export type AssignmentEnd =
  | { readonly _tag: 'NotEnded' }
  | { readonly _tag: 'Finished'; readonly when: Time }

// not on the page: what only the CLI uses (the token and the claim). Who gave
// the assignment and when are the Assignment's (parent, when).
export interface Meta {
  readonly secret: Text // the sha256 of the secret part of the token
  // The brief that the agent works from now. "Your unit is done" stays the old scan (BUILD.md,
  // parity note 8), not a third state.
  readonly claim:
    | { readonly _tag: 'Free' } // never briefed, freed, or its one low unit ended
    | { readonly _tag: 'Held'; readonly since: Time }
    // A low checker's claim names the result that it reviews.
    | { readonly _tag: 'Checking'; readonly since: Time; readonly result: ResultId }
  readonly briefs: number
}

// --- Result --------------------------------------------------------------------------------------

// page: Result. What one attempt produced.
export interface Result {
  readonly id: ResultId // not on the page
  readonly task: TaskId
  readonly by: AssignmentId // one attempt of it
  readonly output: Text
  // page: Source[]: a result that it was made from also goes here.
  readonly madeFrom: ReadonlyArray<MadeFrom>
  // page: size?, digest?, patch?: a file (or a section) has a size; a commit has a patch.
  readonly work: ReportedWork
  readonly under: Under
  readonly when: Time
  readonly at: number // not on the page
}
export type MadeFrom = Source | { readonly _tag: 'Result'; readonly result: ResultId }

// --- Review --------------------------------------------------------------------------------------

// page: Review. One act of a reviewer on a result, a task, a draft, or an evaluation. The page's
// decision is the tag (Accept, Reject, Escalate); the page's redo is a Recheck, and a Resolve
// ends an escalation. Each member holds only the fields of its act, and an
// Accept or a Reject holds the fields of its target (of). How a person's review came (typed,
// forwarded, confirmed) is the forward's (Work.forwards). Who reviews depends on the target, so
// by sits in each target's member: an agent by its assignment, or the person (a model run
// outside any task reviews nothing).
export type Review = Accept | Reject | Recheck | Escalate | Resolve
interface ReviewBase {
  readonly id: ReviewId // not on the page
  readonly under: Under
  readonly when: Time // not on the page
  readonly at: number // not on the page
}
export type Accept = ReviewBase & {
  readonly _tag: 'Accept'
  readonly reason: Text | null // a comment; only words read it
} & (
    | {
        readonly by: AssignmentId | Human
        readonly of: {
          readonly _tag: 'Result'
          readonly id: ResultId
          readonly evidence: NonEmpty<Evidence>
        }
      }
    // The person's accept of a draft needs no evidence; a model's has some (the CLI's check).
    | {
        readonly by: Human
        readonly of: {
          readonly _tag: 'Revision'
          readonly id: RevisionId
          readonly evidence: ReadonlyArray<Evidence>
        }
      }
    | {
        readonly by: AssignmentId
        readonly of: {
          readonly _tag: 'Revision'
          readonly id: RevisionId
          readonly evidence: NonEmpty<Evidence>
        }
      }
    // Only the owner of its task reviews an evaluation.
    | {
        readonly by: Human
        readonly of: {
          readonly _tag: 'Evaluation'
          readonly id: EvaluationId
          readonly evidence: NonEmpty<Evidence>
        }
      }
  )
// A Reject of a result or a task has points (v4.1, v4.2: one act, one stop for the person); a
// Reject of a task names no rule. A Reject of a draft or an evaluation has one reason.
export type Reject = ReviewBase & {
  readonly _tag: 'Reject'
  readonly id: RejectId
} & (
    | {
        readonly by: AssignmentId | Human
        readonly of: {
          readonly _tag: 'Result'
          readonly id: ResultId
          readonly points: NonEmpty<Point>
        }
      }
    | {
        readonly by: AssignmentId | Human
        readonly of: {
          readonly _tag: 'Task'
          readonly id: TaskId
          readonly points: NonEmpty<TaskPoint>
        }
      }
    | {
        readonly by: AssignmentId | Human
        readonly of: {
          readonly _tag: 'Revision'
          readonly id: RevisionId
          readonly reason: NonBlank
        }
      }
    | {
        readonly by: Human
        readonly of: {
          readonly _tag: 'Evaluation'
          readonly id: EvaluationId
          readonly reason: NonBlank
        }
      }
  )
// A point's id is its Reject's id and its place (ids.ts pointId): v4.1 is the first point of v4.
export interface Point {
  readonly text: NonBlank
  readonly breaks: Breaks
}
export interface TaskPoint {
  readonly text: NonBlank
}
// work recheck: a Reject that any later result answers (page: redo). Only an agent asks one.
export type Recheck = ReviewBase & {
  readonly _tag: 'Recheck'
  readonly by: AssignmentId
  readonly of: ResultId
  readonly reason: NonBlank
}
// page: Escalate. A review that cannot decide: it tells the level above. answerBy is the first
// one that it went to; who answers it now is derived (derived.ts answererOf: it moves up as
// that one finishes), and so is whether a Resolve closed it.
export type Escalate = ReviewBase & {
  readonly _tag: 'Escalate'
  readonly by: AssignmentId // the reviewer that cannot decide
  readonly id: EscalationId
  readonly of: ResultId
  readonly reason: NonBlank
  readonly answerBy: Answerer
}
// page: Resolve. It ends one escalation with an agreement or a direction, in words (the CLI's
// --resolution). It has no verdict (the owner's ruling, 2026-11-12): it never accepts or rejects
// the result, which its deciders review after it as usual. evidence: where it read, if anywhere.
export type Resolve = ReviewBase & {
  readonly _tag: 'Resolve'
  readonly by: Answerer
  readonly escalation: EscalationId
  readonly resolution: NonBlank
  readonly evidence: ReadonlyArray<Evidence>
}
// page: breaks?: the rule that a Reject says the result breaks. A Reject that names no rule is
// answered by a change of a direction, a split or a remake, not by new work alone.
export type Breaks =
  | { readonly _tag: 'Rule'; readonly rule: RuleEntry }
  | { readonly _tag: 'NoRule' }

// page: Evidence.
export interface Evidence {
  readonly says: Text // what the reviewer saw
  readonly meets: RuleEntry | null // the rule it supports; null: a line that names no rule
  readonly at: Text // where it looked (a place, not a time)
  // page: covers? is gone: the CLI never writes it, and nothing reads it.
  readonly uses: ReadonlyArray<ResultId> // the results of other tasks it relies on; [] today
}

// --- Evaluation --------------------------------------------------------------------------------

// page: Exhaustion. The last attempt of a maker ended on a fault: the task stops. Its maker and
// its result follow from the fault (derived.ts).
export interface Exhaustion {
  readonly id: ExhaustionId // not on the page
  readonly fault: PointId // the point of the Reject that used the last attempt
  readonly when: Time // not on the page
  readonly at: number // not on the page: the fault's at, or a new one when a finish made it
}

// What stops a task until an evaluation answers it: the last try of a maker, or a Reject of the
// person (as a whole, or one point of it) (events.ts Stop).
export type Stop = typeof StopSchema.Type

// page: Evaluation.
export interface Evaluation {
  readonly id: EvaluationId // not on the page
  readonly answers: Stop // the last attempt of a maker, or the person's Reject
  readonly by: AssignmentId | Human // the high role of the task's tree, or the person
  readonly wrong: NonBlank
  readonly why: NonBlank
  readonly improve: NonEmpty<NonBlank>
  readonly level: Level
  // not on the page: whether the owner rejected an evaluation of the task before it (the old
  // needsPerson). When it counts is derived: an evaluation of the person, or of the level task
  // or standard after no such reject, counts when written; else after the owner's accept.
  readonly after:
    | { readonly _tag: 'FirstTry' }
    | { readonly _tag: 'OwnerRejected'; readonly reject: RejectId }
  readonly when: Time // not on the page
  readonly at: number // not on the page
}

// --- Checkpoint ---------------------------------------------------------------------------------

// page: Checkpoint. A saved point where work can stop and continue later. The saved one has an
// id (k3); the parts saved inside it have none.
export interface Checkpoint extends CheckpointPart {
  readonly id: CheckpointId // not on the page
}
export interface CheckpointPart {
  readonly task: TaskId
  readonly open: {
    readonly blockers: ReadonlyArray<Blocker>
    readonly rejects: ReadonlyArray<PointId>
    readonly escalations: ReadonlyArray<EscalationId>
    readonly unfinishedReviews: ReadonlyArray<AssignmentId>
    readonly pendingApprovals: ReadonlyArray<AssignmentId>
    readonly questions: ReadonlyArray<QuestionId>
  }
  readonly parts: ReadonlyArray<CheckpointPart> // the open smaller tasks
  readonly seenOutside: ReadonlyArray<Source>
  readonly next: Text
  readonly when: Time // not on the page
}

// --- Note ----------------------------------------------------------------------------------------

// page: Note. A message and a finding are about a task.
export type Note =
  | {
      readonly _tag: 'Message'
      readonly id: NoteId // not on the page
      readonly about: TaskId
      readonly text: Text
      readonly by: By // not on the page: the engine keeps who wrote it
      readonly when: Time // not on the page
    }
  | {
      readonly _tag: 'Finding' // something seen; it changes no state
      readonly id: NoteId
      readonly about: TaskId
      readonly text: Text
      readonly when: Time
    }
  | {
      readonly _tag: 'Lesson'
      readonly id: NoteId
      readonly from: ReadonlyArray<AnswerId>
      readonly text: Text
      // page: rule?: Version<Direction>; the CLI makes a lesson only with the version that has it
      readonly rule: VersionId
      readonly when: Time
    }
  | Question

// page: Question.
export interface Question {
  readonly _tag: 'Question'
  readonly id: QuestionId // not on the page
  readonly text: NonBlank
  readonly stops: TaskId // only this task waits for the answer (every writer sets its own)
  // The first one that it went to; who answers it now is derived (derived.ts answererOf).
  readonly answerBy: Answerer
  readonly from: AssignmentId | Human // page: from?: Assignment; the person's forwarded question
  // page: answer?: the question stays after the answer, which keeps who answered and when.
  readonly status: QuestionStatus
  readonly when: Time
}
export type QuestionStatus =
  | { readonly _tag: 'Open' }
  | {
      readonly _tag: 'Answered'
      readonly answer: NonBlank
      readonly by: Answerer
      readonly when: Time
    }

// --- derived states: computed by the engine, never stored --------------------------------------

// page: Task.state(task, when). The old words (words/common.ts taskStateWord) are Open, In
// review, Returned, Accepted, Closed; a task that waits for an evaluation has a Reject that is
// not answered, so its word is Returned, and a replaced task's is Closed.
export type TaskState =
  | { readonly _tag: 'Open' }
  | { readonly _tag: 'InReview' }
  // A Reject of the task itself (the person's criticism) that no change answered.
  | { readonly _tag: 'Returned'; readonly reject: PointId }
  | { readonly _tag: 'Accepted' }
  // No maker starts until an evaluation answers the stop (engine workStop).
  | { readonly _tag: 'WaitsForEvaluation'; readonly stop: Stop }
  | { readonly _tag: 'Closed' }
  | { readonly _tag: 'Replaced'; readonly next: TaskId }

// The page's blockers(result, when) as items: the engine's blockerItems, one tag each, in its
// order. The words module writes the text (golden: "no evidence for ...", "rejected: ...").
export type Blocker =
  | {
      readonly _tag: 'OldVersion'
      readonly ref: DirectionId
      readonly rules: ReadonlyArray<RuleEntry>
    }
  | { readonly _tag: 'Evidence'; readonly ref: RuleEntry; readonly rejects: ReadonlyArray<PointId> }
  | { readonly _tag: 'OldEvidence'; readonly ref: RuleEntry }
  // Accepted by its decider under an old version: the decider accepts it again.
  | { readonly _tag: 'DeciderAcceptedUnderOld' }
  // The deciders whose accept the result still waits for.
  | { readonly _tag: 'DeciderWaits'; readonly leaves: NonEmpty<DeciderLeaf> }
  // No decide entry: any one role with an Approve act on the maker decides.
  | { readonly _tag: 'DeciderAnyApprover' }
  | { readonly _tag: 'OldNeed'; readonly ref: TaskId; readonly newer: ResultId }
  | { readonly _tag: 'Maker'; readonly ref: ReviewId | PointId } // reviewed by its own maker
  | { readonly _tag: 'Recheck'; readonly ref: ReviewId } // the old kind redo
  | { readonly _tag: 'Reject'; readonly ref: PointId }
  | { readonly _tag: 'Unchanged'; readonly ref: PointId }
  | { readonly _tag: 'Change'; readonly ref: PointId }
  | { readonly _tag: 'Escalation'; readonly ref: EscalationId }
  | { readonly _tag: 'Question'; readonly ref: QuestionId }

// Addition (PLAN.md 5.3). The state of a result: what the page's card shows.
export type ResultState =
  | { readonly _tag: 'Accepted' }
  | { readonly _tag: 'Rejected' }
  | { readonly _tag: 'InReview' }

// Addition (PLAN.md 5.3, MakerStatus; bug 9). One attempt count for the brief, next and the
// page: number <= max.
export interface Attempt {
  readonly number: number
  readonly max: Limit
}
export type MakerState =
  | { readonly _tag: 'Working'; readonly used: number; readonly max: Limit } // it may report
  // A fault used its last try: the task waits for an evaluation.
  | { readonly _tag: 'OutOfTries'; readonly used: number; readonly max: PositiveInt }
  | { readonly _tag: 'Finished' } // finished, or ended by a new maker of the task

// Addition (PLAN.md 5.3, DraftStatus). The state of a Revision.
export type RevisionState =
  | { readonly _tag: 'Waiting'; readonly waitsFor: NonEmpty<DeciderLeaf> } // not all accepted
  | { readonly _tag: 'Vetoed'; readonly by: RejectId } // a decider rejected it; the reviser revises
  | { readonly _tag: 'Outdated'; readonly current: VersionId } // its base is no longer current
  | { readonly _tag: 'Official'; readonly version: VersionId } // a version has it as its revision

// Addition (PLAN.md 5.3, GrantStatus). The state of a Permission at a time.
export type PermissionState =
  | { readonly _tag: 'NotYet' }
  | { readonly _tag: 'Covers' }
  | { readonly _tag: 'Ended' }
  | { readonly _tag: 'Revoked' }

// Addition (the owner's ruling, 2026-11-12). An outside source at a time: fresh within the limit
// of aristoteles.yaml (outsideSourceHours, 72 by default) from when an agent last read it, then
// expired, and work made from it waits for an agent to read it again (derived.ts sourceStateOf).
export type SourceState =
  | { readonly _tag: 'Fresh'; readonly seenAt: Time }
  | { readonly _tag: 'Expired'; readonly seenAt: Time }

// Addition. When an evaluation counts (the page's rules under Evaluation).
export type EvaluationState =
  | { readonly _tag: 'Counts' }
  | { readonly _tag: 'WaitsForOwner' } // level direction or principle, or after a rejected one
  | { readonly _tag: 'Rejected'; readonly by: RejectId } // the owner asks for a new one
