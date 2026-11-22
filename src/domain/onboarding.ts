// The files of onboarding (the part Onboarding of the page): what the host drafts and what the
// person decides before any store exists (ruling 1: files first). One file of .work/assess holds
// one direction; .work/assess/roles.yaml holds the onboarding state of each role, apart from the
// config draft (P4). Nothing here is stored as an event: the store starts with the result only.
import { Schema } from 'effect'
import { Principle } from './closed.ts'
import { Example, Flow, type RoleFile, SearchScope, Spot, StandardFile } from './files.ts'
import { DirectionId, NonBlank, RoleName } from './ids.ts'
import type { NonEmpty } from './model.ts'

const Text = Schema.String

// page: AiQuestion. What the AI must know to draft a direction: it names an example, and gives
// the options A and B (ruling 5). An answered one names the option that the person chose.
export const Discovery = Schema.Struct({
  summary: Schema.optionalKey(NonBlank),
  app: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  scope: SearchScope,
  sources: Schema.Array(Spot),
})
export type Discovery = typeof Discovery.Type

const Candidate = Schema.Struct({ words: NonBlank, source: Spot })
export const QuestionTarget = Schema.Union([
  Schema.TaggedStruct('Candidates', { topic: NonBlank, a: Candidate, b: Candidate }),
  Schema.TaggedStruct('Deviation', {
    rule: NonBlank, code: Candidate, principle: Candidate,
    cases: Schema.optionalKey(Schema.Array(Schema.Struct({ code: Candidate, principle: Candidate }))),
  }),
])
type Deviation = Extract<typeof QuestionTarget.Type, { readonly _tag: 'Deviation' }>
export const deviationCases = (target: Deviation) =>
  [{ code: target.code, principle: target.principle }, ...(target.cases ?? [])]

export const OnboardingChoice = Schema.Union([Schema.Literals(['A', 'B']), Schema.Struct({ words: NonBlank })])
const QuestionFields = {
  target: Schema.optionalKey(QuestionTarget),
  says: NonBlank,
  example: Schema.optionalKey(Example),
  options: Schema.Tuple([NonBlank, NonBlank]),
}
export const AiQuestion = Schema.Struct(QuestionFields)
export type AiQuestion = typeof AiQuestion.Type
export const AnsweredQuestion = Schema.Struct({
  ...QuestionFields,
  chosen: OnboardingChoice,
})
export type AnsweredQuestion = typeof AnsweredQuestion.Type

// The evidence belongs to the standards' rules. The flow only shows where they apply.
const OnboardingFlow = Flow.pipe(Schema.check(Schema.makeFilter((flow) =>
  flow.every((step) => step.examples === undefined) || 'cases belong to rules, not the onboarding flow')))
const Content = Schema.Struct({
  summary: NonBlank,
  flow: OnboardingFlow,
  says: Text,
  standards: Schema.Array(StandardFile),
  discovery: Schema.optionalKey(Discovery),
})
// What the draft said before the host drafted it again (Nanda, 2026-11-15): the page shows what
// changed.
const Previous = Schema.Struct({
  summary: NonBlank,
  says: Text,
  standards: Schema.Array(StandardFile),
})
export type Previous = typeof Previous.Type
// The host's draft and the previous words for comparison.
export const DraftOfFile = Schema.Struct({
  name: Text,
  from: Schema.Array(Principle),
  content: Content,
  previous: Schema.optionalKey(Previous),
})
export type DraftOfFile = typeof DraftOfFile.Type

// Where a direction comes from.
export const Asked = Schema.Union([
  Schema.TaggedStruct('Found', {}), // the host found it in the project
  Schema.TaggedStruct('New', { principle: NonBlank, example: Schema.NullOr(Text) }),
  Schema.TaggedStruct('Company', { repo: Text, path: Text }),
  Schema.TaggedStruct('AdoptedCompany', { repo: Text, path: Text }),
])
// A company URL keeps the project-relative folder in its fragment.
export const companyDirectionAt = (url: string): { repo: string; path: string } | undefined => {
  try {
    const source = new URL(url)
    const path = decodeURIComponent(source.hash.slice(1))
    if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password ||
      !path || path.split('/').some((part) => !part || part === '.' || part === '..')) return undefined
    source.hash = ''
    return { repo: source.href, path }
  } catch {
    return undefined
  }
}

// Where a direction stands: one tag with only its own fields, so an accept always has a draft,
// and a question always has one. Drafting, Reset, Answered and Revising wait for the host (the
// page shows Loading); Question waits for the person's answers; Ready for the person's accept,
// revise or remove. Reset: the file was in an older shape, so the reader did not read its draft
// (Nanda, 2026-11-15: no old shape reads); the host drafts it again.
const draft = DraftOfFile
export const DirectionStage = Schema.Union([
  Schema.TaggedStruct('Drafting', {}),
  Schema.TaggedStruct('Reset', {}),
  Schema.TaggedStruct('Question', {
    draft: Schema.optionalKey(draft), revision: Schema.optionalKey(Text), open: Schema.NonEmptyArray(AiQuestion),
  }).pipe(Schema.check(Schema.makeFilter((s) =>
    s.draft !== undefined || s.open.every((q) => q.target?._tag === 'Candidates') ||
    'only a source question can precede the first draft'))),
  Schema.TaggedStruct('Answered', {
    draft: Schema.optionalKey(draft), revision: Schema.optionalKey(Text), answered: Schema.NonEmptyArray(AnsweredQuestion),
  }).pipe(Schema.check(Schema.makeFilter((s) =>
    s.draft !== undefined || s.answered.every((q) => q.target?._tag === 'Candidates') ||
    'only a source answer can precede the first draft'))),
  // The person's words; answers given before them stay for the next draft.
  Schema.TaggedStruct('Revising', {
    draft,
    words: NonBlank,
    checkerChanged: Schema.optionalKey(Schema.Literal(true)),
    answered: Schema.Array(AnsweredQuestion),
  }),
  Schema.TaggedStruct('Ready', { draft }),
  Schema.TaggedStruct('Accepted', { draft }),
  Schema.TaggedStruct('Removed', {}),
])
export type DirectionStage = typeof DirectionStage.Type
// page: OnboardingDirection. One file of .work/assess: where the direction comes from, and where
// it stands.
export const OnboardingDirection = Schema.Struct({
  id: DirectionId,
  asked: Asked,
  stage: DirectionStage,
})
export type OnboardingDirection = typeof OnboardingDirection.Type
// The host's draft, once the direction has one.
export const draftIn = (stage: DirectionStage): DraftOfFile | undefined =>
  'draft' in stage ? stage.draft : undefined
// The answers that the next draft follows.
export const answersIn = (stage: DirectionStage): ReadonlyArray<AnsweredQuestion> =>
  'answered' in stage ? stage.answered : []
// The status of a file in an older shape, which the host drafts again.
export const resetWords = (id: string): string =>
  `${id} is not in the current shape: the host drafts it again`

// The state that the list of the directions page shows, derived from one file (core/derived
// onboardingStateOf).
export type OnboardingDirectionState =
  | { readonly _tag: 'Loading' } // a draft, a Revise, or submitted answers wait for the host
  | { readonly _tag: 'Question'; readonly open: NonEmpty<AiQuestion> } // the person answers
  | { readonly _tag: 'Ready' } // the person accepts, revises, or removes it
  | { readonly _tag: 'Accepted' }
  | { readonly _tag: 'Removed' }

// One entry of .work/assess/roles.yaml (P4): the onboarding state of a role, apart from its
// config. found: the roles that the project has come first on the agents page. decision: the
// person's, or the words of a Revise that wait for the host.
const RoleDecision = Schema.Union([
  Schema.TaggedStruct('Waiting', {}),
  Schema.TaggedStruct('Revising', { words: NonBlank }),
  Schema.TaggedStruct('Accepted', {}),
])
export const RoleReview = Schema.Struct({
  principles: Schema.optionalKey(Schema.Array(Principle)),
  directions: Schema.optionalKey(Schema.Array(DirectionId)),
  questions: Schema.optionalKey(Schema.Array(Schema.Struct({
    says: NonBlank, choices: Schema.Array(NonBlank),
  }))),
})
export const OnboardingRoleState = Schema.Struct({
  ...RoleReview.fields,
  summary: Text,
  found: Schema.Union([
    Schema.TaggedStruct('InProject', { path: Text }),
    Schema.TaggedStruct('New', {}),
  ]),
  decision: RoleDecision,
})
export type OnboardingRoleState = typeof OnboardingRoleState.Type

// The role of the top task: the only persistent role that splits, which the host plays (ruling
// 15). It has no toggle and no remove. With two or more, none is the only one.
export const onlyLead = (roles: Readonly<Record<string, RoleFile>>): string | undefined => {
  const leads = Object.entries(roles).filter(
    ([, r]) => r.kind === 'agent' && r.acts.includes('split') && r.persistence.persistent,
  )
  return leads.length === 1 ? leads[0]?.[0] : undefined
}

type Block = Readonly<Record<string, unknown>> | undefined
const part = (raw: unknown, key: string): Block =>
  (raw as Record<string, Block> | undefined)?.[key] ?? undefined
// Equal values with their keys in any order.
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  ) ?? ''
const changed = (a: Block, b: Block, key: string): boolean => canon(a?.[key]) !== canon(b?.[key])
// What a change of the config draft clears before the store (O2): the accept of each role whose
// card it changes. A role's card is its own block, its entry of decide, and for an agent the
// entry of its model in the models table (its commands and its limits). people and the other
// settings are on no card, so they clear nothing; a role that goes takes its accept with it.
export const touchedRoles = (
  before: unknown,
  after: unknown,
  roles: Readonly<Record<string, RoleFile>>,
): ReadonlyArray<string> =>
  Object.entries(roles)
    .filter(([name, role]) => {
      if (changed(part(before, 'roles'), part(after, 'roles'), name)) return true
      if (changed(part(before, 'decide'), part(after, 'decide'), name)) return true
      if (role.kind === 'program') return false
      return changed(part(before, 'models'), part(after, 'models'), role.model)
    })
    .map(([name]) => name)

// page: OnboardingRole. One card of the agents page: the role of the config draft, joined with
// its entry of roles.yaml.
export type OnboardingRole = OnboardingRoleState & {
  readonly role: RoleName
  readonly file: RoleFile
}

// page: OnboardingAct. The acts of the person on the two pages (POST /api/onboarding): each one
// writes the files and stores nothing. The optional key is the wire format, as PageAct's are.
const Reviewed = Schema.Array(Schema.Struct({ id: Text, revision: Text }))
export const OnboardingAct = Schema.Union([
  Schema.Struct({ act: Schema.Literal('add-role'), words: NonBlank }),
  Schema.Struct({ act: Schema.Literal('review-all-roles'), reviewed: Reviewed }),
  Schema.Struct({
    act: Schema.Literal('add-direction'),
    principle: NonBlank,
    example: Schema.optionalKey(Text),
  }),
  Schema.Struct({ act: Schema.Literal('add-company-direction'), repo: Text, path: Text }),
  Schema.Struct({ act: Schema.Literal('add-company-url'), url: NonBlank }),
  // One option for each question: the submit.
  Schema.Struct({
    act: Schema.Literal('answer'),
    direction: DirectionId,
    options: Schema.NonEmptyArray(OnboardingChoice),
    revision: Schema.optionalKey(Text),
  }),
  Schema.Struct({ act: Schema.Literals(['accept', 'remove']), direction: DirectionId }),
  Schema.Struct({ act: Schema.Literal('revise'), direction: DirectionId, words: NonBlank }),
  Schema.Struct({ act: Schema.Literal('approve-all-directions'), reviewed: Schema.optionalKey(Reviewed) }),
  Schema.Struct({ act: Schema.Literals(['accept-role', 'remove-role']), role: RoleName }),
  Schema.Struct({ act: Schema.Literal('revise-role'), role: RoleName, words: NonBlank }),
  Schema.Struct({ act: Schema.Literal('persistence'), role: RoleName, persistent: Schema.Boolean }),
  // The model of a role: a name of the models table of the draft.
  Schema.Struct({ act: Schema.Literal('model'), role: RoleName, model: NonBlank }),
  // After a confirmation: the store starts (BUILD.md 1c).
  Schema.Struct({ act: Schema.Literal('approve-all-roles') }),
])
export type OnboardingAct = typeof OnboardingAct.Type
