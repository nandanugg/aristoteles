// The ids of the records, as the CLI prints them (t3, a7, r12, v4, v4.1). Each kind has its own
// branded string, so a task id cannot go where a result id is wanted. The names of the kinds are
// the page's (Review, Revision, Exhaustion, Permission) and the UI's
// (TaskDraft, Problem, Run).
import { Schema } from 'effect'

// A string that matches the pattern of its kind.
const matching = (pattern: RegExp) => Schema.String.pipe(Schema.check(Schema.isPattern(pattern)))

export const TaskId = matching(/^t\d+$/).pipe(Schema.brand('TaskId'))
export type TaskId = typeof TaskId.Type
export const AssignmentId = matching(/^a\d+$/).pipe(Schema.brand('AssignmentId'))
export type AssignmentId = typeof AssignmentId.Type
export const ResultId = matching(/^r\d+$/).pipe(Schema.brand('ResultId'))
export type ResultId = typeof ResultId.Type
// One Review record: an accept, a reject, a recheck, an escalation, a resolve (v4).
export const ReviewId = matching(/^v\d+$/).pipe(Schema.brand('ReviewId'))
export type ReviewId = typeof ReviewId.Type
// A Review that is a Reject: its id is a ReviewId too. A Reject of a result or a task has
// points (v4.1, v4.2); a Reject of a draft or an evaluation has one reason and no points.
export const RejectId = ReviewId.pipe(Schema.brand('RejectId'))
export type RejectId = typeof RejectId.Type
// An Escalate: a ReviewId too. The kinds share one pattern, so the fold
// checks each stored reference against the record that it names.
export const EscalationId = ReviewId.pipe(Schema.brand('EscalationId'))
export type EscalationId = typeof EscalationId.Type
// One point of a Reject: the Reject's id and its number.
export const PointId = matching(/^v\d+\.\d+$/).pipe(Schema.brand('PointId'))
export type PointId = typeof PointId.Type
// A Permission: the CLI prints x3.
export const PermissionId = matching(/^x\d+$/).pipe(Schema.brand('PermissionId'))
export type PermissionId = typeof PermissionId.Type
export const CheckpointId = matching(/^k\d+$/).pipe(Schema.brand('CheckpointId'))
export type CheckpointId = typeof CheckpointId.Type
export const QuestionId = matching(/^q\d+$/).pipe(Schema.brand('QuestionId'))
export type QuestionId = typeof QuestionId.Type
export const NoteId = matching(/^n\d+$/).pipe(Schema.brand('NoteId'))
export type NoteId = typeof NoteId.Type
export const SuggestionId = matching(/^s\d+$/).pipe(Schema.brand('SuggestionId'))
export type SuggestionId = typeof SuggestionId.Type
// A Revision of a direction: the CLI calls it a draft (d3).
export const RevisionId = matching(/^d\d+$/).pipe(Schema.brand('RevisionId'))
export type RevisionId = typeof RevisionId.Type
export const ExhaustionId = matching(/^ex\d+$/).pipe(Schema.brand('ExhaustionId'))
export type ExhaustionId = typeof ExhaustionId.Type
export const EvaluationId = matching(/^ev\d+$/).pipe(Schema.brand('EvaluationId'))
export type EvaluationId = typeof EvaluationId.Type
export const RunId = matching(/^h\d+$/).pipe(Schema.brand('RunId'))
export type RunId = typeof RunId.Type
export const TaskDraftId = matching(/^td\d+$/).pipe(Schema.brand('TaskDraftId'))
export type TaskDraftId = typeof TaskDraftId.Type
export const ProblemId = matching(/^sp\d+$/).pipe(Schema.brand('ProblemId'))
export type ProblemId = typeof ProblemId.Type
// A stored act by its seq, as the person's confirm (work confirm) names it: e12.
export const EventRef = matching(/^e\d+$/).pipe(Schema.brand('EventRef'))
export type EventRef = typeof EventRef.Type

// What a draft, a split or a remake answers: a Reject (all its points), one point, a suggestion.
export const AnswerId = Schema.Union([RejectId, PointId, SuggestionId])
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
export const isTime = Schema.is(Time)

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
export const PREFIX = {
  task: 't',
  assignment: 'a',
  result: 'r',
  review: 'v',
  permission: 'x',
  checkpoint: 'k',
  question: 'q',
  note: 'n',
  suggestion: 's',
  revision: 'd',
  exhaustion: 'ex',
  evaluation: 'ev',
  run: 'h',
  taskDraft: 'td',
  problem: 'sp',
} as const
export type Counted = keyof typeof PREFIX
export type Prefix = (typeof PREFIX)[Counted]

// The noun of a prefix, as a refusal names it ("there is no task t9").
export const NOUN: { readonly [P in Prefix]: string } = {
  t: 'task',
  a: 'assignment',
  r: 'result',
  v: 'review',
  q: 'question',
  x: 'permission',
  k: 'checkpoint',
  n: 'note',
  s: 'suggestion',
  d: 'draft',
  ex: 'stop',
  ev: 'evaluation',
  h: 'run',
  td: 'task draft',
  sp: 'system problem',
}
export const isPrefix = (word: string): word is Prefix => Object.hasOwn(NOUN, word)

// The letters before the number: "ex" of ex3, "v" of v4.1; undefined for a word.
export const prefixOf = (id: string): string | undefined => /^[a-z]+/.exec(id)?.[0]

export interface IdByKind {
  readonly task: TaskId
  readonly assignment: AssignmentId
  readonly result: ResultId
  readonly review: ReviewId
  readonly permission: PermissionId
  readonly checkpoint: CheckpointId
  readonly question: QuestionId
  readonly note: NoteId
  readonly suggestion: SuggestionId
  readonly revision: RevisionId
  readonly exhaustion: ExhaustionId
  readonly evaluation: EvaluationId
  readonly run: RunId
  readonly taskDraft: TaskDraftId
  readonly problem: ProblemId
}

// The counters of the ids, one per kind.
export type Counters = Readonly<Record<Counted, number>>
export const noCounters: Counters = {
  task: 0,
  assignment: 0,
  result: 0,
  review: 0,
  permission: 0,
  checkpoint: 0,
  question: 0,
  note: 0,
  suggestion: 0,
  revision: 0,
  exhaustion: 0,
  evaluation: 0,
  run: 0,
  taskDraft: 0,
  problem: 0,
}

// The next id of a kind, and the counters after it. The order of the names
// within one step is golden (BUILD.md, parity notes).
export const nextId = <K extends Counted>(
  counters: Counters,
  kind: K,
): { readonly id: IdByKind[K]; readonly counters: Counters } => {
  const n = counters[kind] + 1
  return { id: `${PREFIX[kind]}${n}` as IdByKind[K], counters: { ...counters, [kind]: n } }
}

// The points of the Reject v4 are v4.1, v4.2...; a point names its Reject.
export const pointId = (reject: RejectId, n: number): PointId => `${reject}.${n}` as PointId
export const rejectOf = (point: PointId): RejectId => point.replace(/\.\d+$/, '') as RejectId
export const versionId = (direction: DirectionId, n: number): VersionId =>
  `${direction}@${n}` as VersionId
