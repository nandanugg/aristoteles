// The input of every act (plan/rebuild/BUILD.md D7, 3.6). Each member has:
//   target  the ids that the act acts on: canAct (core/derived) checks only these;
//   content what only the actor writes or chooses: the action checks it (a Write or Pick choice).
// Intent is an input with no content, made by a mapped type, so there is no second list of acts.
// The CLI and the page decode their input into one ActionInput; the action reads the files that
// a content names (FilePath) through the Files service. Where a content type says "P5 decides",
// the actions package fixes the decoded form (an additive change).
import type {
  DropReason,
  Enter,
  Line,
  OnboardedDirection,
} from '../../src/domain/events.ts'
import type {
  CompanyCheckers,
  CompanyFolder,
  ExternalSource,
  Settings,
} from '../../src/domain/files.ts'
import type {
  AnswerId,
  DirectionId,
  EventRef,
  RevisionId,
  RoleName,
  SessionId,
} from '../../src/domain/ids.ts'

// A path that the actor names; the action reads the file.
export type FilePath = string
// Free words of the actor. The action refuses blank words with a Write choice.
export type Words = string
// What a suggestion is about, by the key that the person or agent typed (events.ts Suggestion).
export type SuggestAbout =
  | { readonly _tag: 'NewDirection' }
  | { readonly _tag: 'Roles' }
  | { readonly _tag: 'Direction'; readonly direction: DirectionId }
  | { readonly _tag: 'Standard'; readonly key: string }
  | { readonly _tag: 'Rule'; readonly key: string }
// The target of an accept and of a reject: a draft of a direction, decided by its owner.
export interface OfRevision {
  readonly _tag: 'Revision'
  readonly id: RevisionId
}
type Keys = typeof Line.Type | typeof Enter.Type
// Why a draft changes its direction, as typed: --why, one of the five reasons, and --why-words.
// The action makes the stored Why: a reason that is no reason is a Pick refusal, and blank words
// are none given (N5).
export interface WhyInput {
  readonly reason: string | null
  readonly words: Words | null
}

type None = { readonly [K in never]: never }
type In<K extends string, T, C> = {
  readonly _tag: K
  readonly target: T
  readonly content: C
}

export type ActionInput =
  // --- the workflow and its config ------------------------------------------------------------
  // work init (no directions), or the store start of onboarding with the accepted directions:
  // reads aristoteles.yaml of the dir
  | In<'DefineWorkflow', None, { readonly directions: ReadonlyArray<OnboardedDirection> }>
  | In<'ApplyConfig', None, None> // work config apply
  | In<'RestoreConfig', None, None> // work config restore: files only, no event
  | In<'FitRole', { readonly role: RoleName }, { readonly answers: FilePath }>
  | In<'SaveSettings', None, { readonly settings: Settings }> // page settings: files only
  // --- the person's typed sends --------------------------------------------------------------
  | In<'Send', { readonly session: SessionId }, { readonly keys: Keys }> // work send
  | In<'SendDelivered', { readonly send: EventRef }, None>
  | In<'SendDropped', { readonly send: EventRef }, { readonly why: typeof DropReason.Type }>
  // --- directions, suggestions, sources ---------------------------------------------------------
  | In<'DraftDirection', None, { readonly file: FilePath; readonly answers: ReadonlyArray<AnswerId>; readonly why: WhyInput }>
  | In<'ReviseDirection', { readonly direction: DirectionId }, { readonly file: FilePath; readonly answers: ReadonlyArray<AnswerId>; readonly why: WhyInput }>
  | In<'ImportCompany', { readonly direction: DirectionId }, { readonly source: typeof ExternalSource.Type; readonly folder: typeof CompanyFolder.Type; readonly owner: string; readonly checkers: typeof CompanyCheckers.Type }>
  // A model gives a company draft of a new direction its flow and its examples; the file holds
  // flow: and examples:.
  | In<'AddExamples', { readonly draft: RevisionId }, { readonly file: FilePath }>
  | In<'Suggest', { readonly about: SuggestAbout }, { readonly says: Words }>
  // The owner (the person) accepts or rejects a draft before a top is open.
  | In<'Accept', { readonly of: OfRevision }, { readonly reason: Words | null }>
  | In<'Reject', { readonly of: OfRevision }, { readonly reason: Words }>
  // work source: the host read an outside source again.
  | In<'ReadSource', { readonly name: string }, { readonly revision: string }>

export type ActionTag = ActionInput['_tag']
export type InputOf<K extends ActionTag> = Extract<ActionInput, { readonly _tag: K }>

// An act with no content: what canAct checks.
export type Intent = {
  readonly [K in ActionTag]: { readonly _tag: K; readonly target: InputOf<K>['target'] }
}[ActionTag]

export const intentOf = (input: ActionInput): Intent =>
  ({ _tag: input._tag, target: input.target }) as Intent
