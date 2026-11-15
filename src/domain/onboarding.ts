// The files of onboarding (the part Onboarding of the page): what the host drafts and what the
// person decides before any store exists (ruling 1: files first). One file of .work/assess holds
// one direction; .work/assess/roles.yaml holds the onboarding state of each role, apart from the
// config draft (P4). Nothing here is stored as an event: the store starts with the result only.
import { Schema, SchemaGetter } from 'effect'
import { Principle } from './closed.ts'
import { CaseFile, CasesFile, firstSentence, FlowStep, RoleFile, StandardFile } from './files.ts'
import { DirectionId, NonBlank, RoleName } from './ids.ts'
import type { NonEmpty } from './model.ts'

const Text = Schema.String
const Waiting = Schema.TaggedStruct('Waiting', {})
const Accepted = Schema.TaggedStruct('Accepted', {})
// What the host does next: nothing, or the words of the person's text box (ruling 2).
const Request = Schema.Union([
  Schema.TaggedStruct('None', {}),
  Schema.TaggedStruct('Revise', { words: NonBlank }),
])

// page: AiQuestion. What the AI must know to draft a direction: it names a case, and gives the
// options A and B (ruling 5). The files of onboarding hold a case in either form (CaseFile).
export const AiQuestion = Schema.Struct({
  says: NonBlank,
  case: CaseFile,
  options: Schema.Tuple([Text, Text]),
  answer: Schema.Union([
    Schema.TaggedStruct('Open', {}),
    Schema.TaggedStruct('Chosen', { option: Schema.Literals(['A', 'B']) }),
  ]),
})
export type AiQuestion = typeof AiQuestion.Type

// What a draft says: its summary and its flow (Nanda, 2026-11-15), its words, and its standards;
// each rule names the role that the AI proposes to check it. The file of an onboarding that
// started before them has neither: there, the summary is the first sentence of says, and the flow
// is none.
const Content = Schema.Struct({
  summary: NonBlank,
  flow: Schema.Array(FlowStep),
  says: Text,
  standards: Schema.Array(StandardFile),
})
const ContentFile = Schema.Struct({
  ...Content.fields,
  summary: Schema.optionalKey(NonBlank),
  flow: Schema.optionalKey(Schema.Array(FlowStep)),
})
const DraftContent = Schema.toEncoded(ContentFile).pipe(
  Schema.decodeTo(Content, {
    decode: SchemaGetter.transform((c) => ({
      summary: c.summary ?? firstSentence(c.says),
      flow: c.flow ?? [],
      says: c.says,
      standards: c.standards,
    })),
    encode: SchemaGetter.transform((c) => c),
  }),
)

// page: OnboardingDirection. One file of .work/assess: where the direction comes from, the
// host's draft with its cases (3 or more, real), the questions, the person's request, the accept.
export const OnboardingDirection = Schema.Struct({
  id: DirectionId,
  asked: Schema.Union([
    Schema.TaggedStruct('Found', {}), // the host found it in the project
    Schema.TaggedStruct('New', { principle: NonBlank, example: Schema.NullOr(Text) }),
    Schema.TaggedStruct('Company', { repo: Text, path: Text }),
  ]),
  draft: Schema.Union([
    Schema.TaggedStruct('Drafting', {}),
    Schema.TaggedStruct('Drafted', {
      name: Text,
      from: Schema.Array(Principle),
      content: DraftContent,
      cases: CasesFile,
    }),
  ]),
  questions: Schema.Array(AiQuestion),
  request: Request,
  accepted: Schema.Union([Waiting, Accepted]),
})
export type OnboardingDirection = typeof OnboardingDirection.Type

// The state that the list of the directions page shows, derived from one file (core/derived
// onboardingStateOf).
export type OnboardingDirectionState =
  | { readonly _tag: 'Loading' } // a draft, a Revise, or submitted answers wait for the host
  | { readonly _tag: 'Question'; readonly open: NonEmpty<AiQuestion> } // the person answers
  | { readonly _tag: 'Ready' } // the person accepts, revises, or removes it
  | { readonly _tag: 'Accepted' }

// One entry of .work/assess/roles.yaml (P4): the onboarding state of a role, apart from its
// config. found: the roles that the project has come first on the agents page.
export const OnboardingRoleState = Schema.Struct({
  summary: Text,
  found: Schema.Union([
    Schema.TaggedStruct('InProject', { path: Text }),
    Schema.TaggedStruct('New', {}),
  ]),
  request: Request,
  accepted: Schema.Union([Waiting, Accepted]),
})
export type OnboardingRoleState = typeof OnboardingRoleState.Type

// page: OnboardingRole. One card of the agents page: the role of the config draft, joined with
// its entry of roles.yaml.
export type OnboardingRole = OnboardingRoleState & {
  readonly role: RoleName
  readonly file: RoleFile
}

// page: OnboardingAct. The acts of the person on the two pages (POST /api/onboarding): each one
// writes the files and stores nothing. The optional key is the wire format, as PageAct's are.
export const OnboardingAct = Schema.Union([
  Schema.Struct({
    act: Schema.Literal('add-direction'),
    principle: NonBlank,
    example: Schema.optionalKey(Text),
  }),
  Schema.Struct({ act: Schema.Literal('add-company-direction'), repo: Text, path: Text }),
  // One option for each question: the submit.
  Schema.Struct({
    act: Schema.Literal('answer'),
    direction: DirectionId,
    options: Schema.NonEmptyArray(Schema.Literals(['A', 'B'])),
  }),
  Schema.Struct({ act: Schema.Literals(['accept', 'remove']), direction: DirectionId }),
  Schema.Struct({ act: Schema.Literal('revise'), direction: DirectionId, words: NonBlank }),
  Schema.Struct({ act: Schema.Literal('approve-all-directions') }),
  Schema.Struct({ act: Schema.Literals(['accept-role', 'remove-role']), role: RoleName }),
  Schema.Struct({ act: Schema.Literal('revise-role'), role: RoleName, words: NonBlank }),
  Schema.Struct({ act: Schema.Literal('persistence'), role: RoleName, persistent: Schema.Boolean }),
  // After a confirmation: the store starts (BUILD.md 1c).
  Schema.Struct({ act: Schema.Literal('approve-all-roles') }),
])
export type OnboardingAct = typeof OnboardingAct.Type
