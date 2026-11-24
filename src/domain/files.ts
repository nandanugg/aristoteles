// The files that a person or a model writes, as config.ts reads them: aristoteles.yaml (the
// mechanism and the settings), a direction file, a company folder. Their parsed
// forms are stored inside events, so each one is a Schema.
import { Schema } from 'effect'
import { Authority, Principle, RoleIcon } from './closed.ts'
import { DirectionId, NonBlank, PositiveInt, RoleName } from './ids.ts'

// The key of a standard or a rule in a file (Standard.id, Rule.id of the page).
const Key = Schema.String

// The closed keys a task context or standard scope may name. Output is the type being made.
export const CONTEXT_KEYS = ['system', 'field', 'language', 'repo', 'section', 'audience', 'output'] as const
export const ContextKey = Schema.Literals(CONTEXT_KEYS)
export type ContextKey = typeof ContextKey.Type
// A context or a where as a file writes it: named keys, each a text, in the file's order (a
// Record over the literals would ask for every key; a checked string keeps the order).
const ContextFileKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(new RegExp(`^(${CONTEXT_KEYS.join('|')})$`))),
)
const FactFileKey = ContextFileKey.pipe(Schema.check(
  Schema.makeFilter((key) => key !== 'section' || 'use sections for the section scope'),
))
export const ContextFacts = Schema.Record(FactFileKey, Schema.String)
export type ContextFacts = typeof ContextFacts.Type
export const ScopeConditions = Schema.Record(ContextFileKey, Schema.NonEmptyArray(Schema.String))
export type ScopeConditions = typeof ScopeConditions.Type
export const ContextFile = Schema.Record(ContextFileKey, Schema.String)
export type ContextFile = typeof ContextFile.Type
// A where as a file writes it: each key names one value, or a list of values, any one of which
// matches (where: { section: [introduction, design] }).
export const WhereFile = Schema.Record(
  ContextFileKey,
  Schema.Union([Schema.String, Schema.NonEmptyArray(Schema.String)]),
)
export type WhereFile = typeof WhereFile.Type

export { Authority } from './closed.ts'

// Who decides: a name (a role; for a direction, a person too), or one of or / and / order.
export type DeciderFile =
  | string
  | { readonly or: ReadonlyArray<DeciderFile> }
  | { readonly and: ReadonlyArray<DeciderFile> }
  | { readonly order: ReadonlyArray<DeciderFile> }
export const DeciderFile: Schema.Codec<DeciderFile> = Schema.Union([
  Schema.String,
  Schema.Struct({ or: Schema.Array(Schema.suspend((): Schema.Codec<DeciderFile> => DeciderFile)) }),
  Schema.Struct({
    and: Schema.Array(Schema.suspend((): Schema.Codec<DeciderFile> => DeciderFile)),
  }),
  Schema.Struct({
    order: Schema.Array(Schema.suspend((): Schema.Codec<DeciderFile> => DeciderFile)),
  }),
])

// One act of a role, as aristoteles.yaml writes it: one key, or one word (split, direct, fit).
export const ActFile = Schema.Union([
  Schema.Struct({ do: Schema.String }),
  Schema.Struct({ review: Schema.Array(RoleName) }),
  Schema.Struct({ approve: Schema.Array(RoleName) }),
  Schema.Struct({ change: Schema.Array(DirectionId) }),
  Schema.Struct({ assign: Schema.Array(RoleName) }),
  Authority,
])
export type ActFile = typeof ActFile.Type

// How an agent role runs, apart from its model (ruling 7): a persistent role gets a terminal of
// its own; a disposable role runs as a subagent of a terminal. why: the reason on its card.
export const PersistenceFile = Schema.Struct({ persistent: Schema.Boolean, why: NonBlank })
export type PersistenceFile = typeof PersistenceFile.Type

// A role of aristoteles.yaml after readConfig: an agent of a model, or a program that checks on
// each report. The keys keep the file's order, and an absent key stays absent, so that the JSON
// of a role (its fit hash) is the old one; what each kind needs is required. persistence and
// icon go last (onboarding), so the old keys keep their order.
export const RoleFile = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('agent'),
    // the name of an entry of the models table
    model: Schema.String,
    description: Schema.String,
    intro: Schema.String,
    responsibilities: Schema.Array(Schema.String),
    output: Schema.optionalKey(Schema.String),
    acts: Schema.Array(ActFile),
    checks: Schema.Array(Key),
    persistence: PersistenceFile,
    // The pipeline role (DESIGN 1): the one persistent role that is PIPE, not a role card.
    pipeline: Schema.optionalKey(Schema.Boolean),
    icon: RoleIcon,
  }),
  Schema.Struct({
    kind: Schema.Literal('program'),
    description: Schema.String,
    intro: Schema.String,
    responsibilities: Schema.Array(Schema.String),
    output: Schema.optionalKey(Schema.String),
    acts: Schema.Array(ActFile),
    run: Schema.String,
    on: Schema.Literal('report'),
    checks: Schema.Array(Key),
    timeout: Schema.optionalKey(Schema.Number),
    // A program runs in the CLI, never in a terminal: it has an icon and no persistence.
    icon: RoleIcon,
  }),
])
export type RoleFile = typeof RoleFile.Type

// The checker of a rule can give evidence that counts: a role that reviews or approves a role
// that does the work, and a program that lists the rule in its checks. null: the checker is fine.
export const checkerProblem = (
  roles: Readonly<Record<string, RoleFile>>,
  id: string,
  checkedBy: string | undefined,
): string | null => {
  if (checkedBy === undefined) return null
  if (checkedBy === 'Human') {
    return (
      `rule ${id} is checked by Human; the person approves directions and standards, ` +
      'not results: name the role that reviews it'
    )
  }
  const role = roles[checkedBy]
  if (!role) return `rule ${id} is checked by "${checkedBy}", which is not a role`
  const checked = role.acts.flatMap((a) =>
    typeof a === 'string' ? [] : [...('review' in a ? a.review : []), ...('approve' in a ? a.approve : [])],
  )
  const makes = (name: string) =>
    roles[name]?.acts.some((a) => typeof a !== 'string' && 'do' in a && Boolean(a.do))
  if (!checked.some(makes)) {
    return (
      `rule ${id} is checked by ${checkedBy}, which reviews or approves no role that does ` +
      'the work, so its evidence never counts'
    )
  }
  if (role.kind === 'program' && !role.checks.includes(id)) {
    return `rule ${id} is checked by the program ${checkedBy}, which does not list it in its checks`
  }
  return null
}

// The limits of one model, by the part that checks them: the brief fits its context window.
export const ModelLimits = Schema.Struct({
  Assignment: Schema.optionalKey(
    Schema.Struct({
      briefChars: Schema.optionalKey(PositiveInt),
      attempts: Schema.optionalKey(PositiveInt),
    }),
  ),
  Review: Schema.optionalKey(Schema.Struct({ rules: Schema.optionalKey(PositiveInt) })),
  Result: Schema.optionalKey(Schema.Struct({ size: Schema.optionalKey(PositiveInt) })),
})
export type ModelLimits = typeof ModelLimits.Type

// The mechanism of aristoteles.yaml: what the store keeps (the settings stay in the file).
export const ConfigFile = Schema.Struct({
  // The name of the dir: its folder name.
  project: Schema.String,
  people: Schema.Array(Schema.String),
  // The limits of each model of the models table, by its name.
  models: Schema.Record(Schema.String, ModelLimits),
  roles: Schema.Record(Schema.String, RoleFile),
  // Who decides the results of each maker: one entry per maker (the file's list, by its role).
  decide: Schema.Record(RoleName, DeciderFile),
})
export type ConfigFile = typeof ConfigFile.Type

// The words of a role that `work config apply` may change without a new mechanism.
export const RoleWords = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  intro: Schema.optionalKey(Schema.String),
  responsibilities: Schema.optionalKey(Schema.Array(Schema.String)),
  output: Schema.optionalKey(Schema.String),
})
export type RoleWords = typeof RoleWords.Type

// The settings of the UI, from aristoteles.yaml now (never stored). Every model has its commands
// (ruling 10): a role of any model can be persistent. launch and resume name the model as {model}.
export const ModelSettings = Schema.Struct({
  launch: Schema.optionalKey(Schema.String),
  resume: Schema.optionalKey(Schema.String),
  start: Schema.String,
  skills: Schema.optionalKey(Schema.String),
  errors: Schema.Array(Schema.String),
  prompts: Schema.Array(Schema.String),
  silentMinutes: PositiveInt,
  retryInput: Schema.String,
})
export type ModelSettings = typeof ModelSettings.Type
export const Settings = Schema.Struct({
  // The commands of each model of the models table, by its name.
  models: Schema.Record(Schema.String, ModelSettings),
  retryMinutes: PositiveInt,
  hostWaitMinutes: PositiveInt,
  // How long an outside source that an agent read stays fresh (core/derived).
  outsideSourceHours: PositiveInt,
  sound: Schema.Boolean,
  theme: Schema.Literals(['light', 'dark']),
})
export type Settings = typeof Settings.Type

// The evidence of a rule (DESIGN 4). test: a shell command; no output means the rule holds, each
// printed line is a point. ref: file#anchor:lines (docs/x.md#tables:10-20). A rule with neither is
// judged by a reader only.
export const RuleTest = NonBlank
export const RuleRef = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (s: string) =>
        /^[^#\s]+#[^:\s]+:\d+(-\d+)?$/.test(s) ||
        'a ref is file#anchor:lines, e.g. docs/x.md#tables:10-20',
    ),
  ),
)
// One place in a file of the project: the file, the line the page points to, and a short excerpt.
export const Spot = Schema.Struct({ file: Schema.String, line: PositiveInt, excerpt: NonBlank })
export type Spot = typeof Spot.Type
const Fit = Schema.Literals(['Follows', 'Breaks'])
// page: Sample. An input or an output of an example: a real place of the project, or words that
// the host wrote when the project has none yet (Nanda, 2026-11-15).
const Written = Schema.Struct({ written: NonBlank, mark: Schema.optionalKey(NonBlank) }).pipe(
  Schema.check(Schema.makeFilter(({ written, mark }) =>
    mark === undefined || written.includes(mark) || 'mark must appear in the written sample',
  )),
)
export const Sample = Schema.Union([Spot, Written])
export type Sample = typeof Sample.Type
export const isSpot = (s: Sample): s is Spot => 'file' in s

// page: Example. An output of a marked step of the flow that follows the direction or breaks it
// (Nanda, 2026-11-15); a step that checks or decides gives the input that it got too. A break is
// information only: it makes no task (ruling 17).
export const Example = Schema.Struct({
  fit: Fit,
  input: Schema.optionalKey(Sample),
  output: Sample,
})
export type Example = typeof Example.Type
// Search scope and the result recorded for a rule in onboarding.
export const SearchScope = Schema.Struct({
  searched: Schema.Array(NonBlank),
  unknown: Schema.Array(NonBlank),
})
export type SearchScope = typeof SearchScope.Type
export const RuleEvidence = Schema.Struct({
  scope: SearchScope,
  cases: Schema.Array(Example),
  knownBreaks: Schema.Array(Spot),
  check: Schema.Union([
    Schema.TaggedStruct('Command', { result: NonBlank }),
    Schema.TaggedStruct('Reference', { checker: NonBlank, result: NonBlank }),
    Schema.TaggedStruct('Absent', {}),
    Schema.TaggedStruct('Unknown', { question: NonBlank }),
  ]),
})
export type RuleEvidence = typeof RuleEvidence.Type
// A rule and a standard, as a direction file or a revise file writes them.
export const RuleFile = Schema.Struct({
  id: Key,
  says: Schema.String,
  test: Schema.optionalKey(RuleTest),
  ref: Schema.optionalKey(RuleRef),
  checkedBy: Schema.optionalKey(RoleName),
  supersedes: Schema.Array(Key),
  evidence: Schema.optionalKey(RuleEvidence),
})
export type RuleFile = typeof RuleFile.Type
export const StandardFile = Schema.Struct({
  id: Key,
  says: Schema.String,
  where: Schema.optionalKey(WhereFile),
  rules: Schema.Array(RuleFile),
})
export type StandardFile = typeof StandardFile.Type

// Cases: at least one that follows and one that breaks (the cases of the rules a marked step uses).
export const Examples = Schema.Array(Example).pipe(
  Schema.check(
    Schema.makeFilter((xs: ReadonlyArray<Example>) => {
      const lacks = (['Follows', 'Breaks'] as const).find((fit) => !xs.some((e) => e.fit === fit))
      return lacks === undefined || `no case ${lacks.toLowerCase()} the direction`
    }),
  ),
)
export type Examples = typeof Examples.Type
// The real places of an example, the input first.
export const spotsOf = (e: Example): ReadonlyArray<Spot> =>
  [e.input, e.output].filter((s): s is Spot => s !== undefined && isSpot(s))

// One step of the flow of a direction (Nanda, 2026-11-15: a direction has a flow): an actor does
// something to another actor, or to a file that it acts on (from equal to to: an act on its own).
// place: where the project defines the step, when it does; a line needs its file. A marked step
// is one that the direction governs: uses are the ids that apply there (the direction, its
// standards, its rules). Cases live on RULES (RuleEvidence.cases: onboarding v2 U13, pass 3b),
// never on a flow step: the flow only shows where the rules apply.
const Place = Schema.Struct({ file: NonBlank, line: Schema.optionalKey(PositiveInt) })
const StepAt = {
  from: NonBlank, to: NonBlank, says: NonBlank, place: Schema.optionalKey(Place),
  // Refuse legacy inputs even when the decoder strips other excess properties.
  examples: Schema.optionalKey(Schema.Never),
}
const Marked = Schema.Struct({
  ...StepAt,
  uses: Schema.NonEmptyArray(NonBlank),
})
const Unmarked = Schema.Struct({
  ...StepAt,
  uses: Schema.optionalKey(Schema.Never),
})
export const FlowStep = Schema.Union([Marked, Unmarked])
export type FlowStep = typeof FlowStep.Type
export type MarkedStep = typeof Marked.Type
export const isMarked = (s: FlowStep): s is MarkedStep => s.uses !== undefined

// A flow marks at least one step: the direction governs something.
export const Flow = Schema.Array(FlowStep).pipe(
  Schema.check(
    Schema.makeFilter(
      (flow: ReadonlyArray<FlowStep>) =>
        flow.some(isMarked) || 'no flow step has uses: mark each step that the direction governs',
    ),
  ),
)
export type Flow = typeof Flow.Type
// The cases of the rules of a direction, in the order of its standards and rules.
type RulesOf<R> = ReadonlyArray<{ readonly id: string; readonly rules: ReadonlyArray<R> }>
type RuleCases = { readonly id: string; readonly evidence?: RuleEvidence }
export const casesOfRules = (standards: RulesOf<RuleCases>): ReadonlyArray<Example> =>
  standards.flatMap((s) => s.rules.flatMap((r) => r.evidence?.cases ?? []))

// A step can name the whole direction, a standard, or an individual rule.
export const rulesUsedBy = <R extends { readonly id: string }>(
  id: string, step: MarkedStep, standards: RulesOf<R>,
): ReadonlyArray<R> => {
  const uses = new Set<string>(step.uses)
  return standards.flatMap((s) =>
    uses.has(id) || uses.has(s.id) ? s.rules : s.rules.filter((r) => uses.has(r.id)))
}

export const casesProblem = <R extends RuleCases>(
  id: string,
  flow: ReadonlyArray<FlowStep>,
  standards: RulesOf<R>,
  keepsNoObservedBreak?: (step: MarkedStep, rules: ReadonlyArray<R>) => boolean,
): string | undefined => {
  for (const [i, s] of flow.entries()) {
    if (!isMarked(s)) continue
    const rules = rulesUsedBy(id, s, standards)
    const cases = rules.flatMap((r) => r.evidence?.cases ?? [])
    const lacks = (['Follows', 'Breaks'] as const).find((fit) => !cases.some((e) => e.fit === fit))
    if (lacks !== undefined && !(lacks === 'Breaks' && keepsNoObservedBreak?.(s, rules))) {
      return `flow step ${i + 1}: the rules it uses have no case that ${lacks.toLowerCase()}; ` +
        'put the cases in the evidence of those rules'
    }
  }
  return undefined
}

// What is wrong with the marks of a flow, for a draft: each id of uses is the direction, or a
// standard or a rule of it.
export const usesProblem = (
  id: string,
  flow: ReadonlyArray<FlowStep>,
  standards: ReadonlyArray<{ readonly id: string; readonly rules: ReadonlyArray<{ readonly id: string }> }>,
): string | undefined => {
  const ids = new Set([id, ...standards.flatMap((s) => [s.id, ...s.rules.map((r) => r.id)])])
  for (const [i, s] of flow.entries()) {
    const other = s.uses?.find((u) => !ids.has(u))
    if (other !== undefined) {
      return `flow step ${i + 1} uses "${other}", which is not ${id} or a standard or rule of it`
    }
  }
  return undefined
}

// A direction file after readDirection and readApprovedBy. summary: one or two plain sentences
// that say what the direction asks and why it matters, for a person who reads it the first time
// (Nanda, 2026-11-15); the page and the CLI show it before the words. flow: how the direction
// works, from the first act of an actor down to the output, the steps that it governs marked
// (Nanda, 2026-11-15).
export const DirectionFile = Schema.Struct({
  id: DirectionId,
  name: Schema.String,
  owner: Schema.String,
  from: Schema.Array(Principle),
  summary: NonBlank,
  flow: Flow,
  says: Schema.String,
  maxStandards: Schema.optionalKey(PositiveInt),
  standards: Schema.Array(StandardFile),
  approvedBy: Schema.optionalKey(DeciderFile),
})
export type DirectionFile = typeof DirectionFile.Type

// A revise file: the change of a direction from its current version.
export const ReviseFile = Schema.Struct({
  summary: Schema.optionalKey(NonBlank),
  flow: Schema.optionalKey(Flow),
  says: Schema.optionalKey(Schema.String),
  add: Schema.optionalKey(Schema.Array(StandardFile)),
  remove: Schema.optionalKey(Schema.Array(Key)),
  replace: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Key, with: StandardFile }))),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (r: object) =>
        Object.keys(r).length > 0 ||
        'a revise changes nothing: give a summary, a flow, the words, or standards to add, remove or replace',
    ),
  ),
)
export type ReviseFile = typeof ReviseFile.Type

// page: Revision.source (was CompanySource). A commit of a company direction: its repo and
// folder, the ref that the daily refresh follows (aristoteles.lock: a tag, or none for the
// newest commit of the default branch), and the commit that it read. The record and the stored
// CompanyImported keep this shape; the lock file's entry is files/company.ts LockEntry.
export const ExternalSource = Schema.Struct({
  repo: Schema.String,
  path: Schema.String,
  ref: Schema.Union([
    Schema.TaggedStruct('DefaultBranch', {}),
    Schema.TaggedStruct('Tag', { tag: Schema.String }),
  ]),
  commit: Schema.String,
})
export type ExternalSource = typeof ExternalSource.Type

// The first sentence of the words of a direction, in its first paragraph that is no heading. It
// is the summary of a company direction: its folder has none (its words are the company's).
export const firstSentence = (says: string): string => {
  const words = says
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
  const paragraph = words.trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ') ?? ''
  const end = paragraph.search(/[.!?](\s|$)/)
  return end === -1 ? paragraph : paragraph.slice(0, end + 1)
}

// A company folder, as company.ts reads it at a commit.
export const CompanyFolder = Schema.Struct({
  name: Schema.String,
  says: Schema.String,
  standards: Schema.Array(
    Schema.Struct({
      id: Key,
      says: Schema.String,
      rules: Schema.Array(Schema.Struct({ id: Key, says: Schema.String })),
    }),
  ),
})
export type CompanyFolder = typeof CompanyFolder.Type

// Who checks the rules of a company direction: one role for all, and one per rule.
export const CompanyCheckers = Schema.Struct({
  checkedBy: Schema.optionalKey(RoleName),
  rules: Schema.optionalKey(Schema.Record(Schema.String, RoleName)),
})
export type CompanyCheckers = typeof CompanyCheckers.Type

// How a file looked at a first brief: its digest, and the digest of each section.
export const Snapshot = Schema.Struct({
  digest: Schema.String,
  sections: Schema.Record(Schema.String, Schema.String),
})
export type Snapshot = typeof Snapshot.Type
