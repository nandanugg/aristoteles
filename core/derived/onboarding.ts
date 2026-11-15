// The derived states of onboarding and of cases: each reads its input only. The reading of a
// file (the text of a case's file, an onboarding file) is the adapter's, so these stay pure.
import {
  type AiQuestion,
  type Case,
  type NonEmpty,
  type OnboardingDirection,
  type OnboardingDirectionState,
  type Spot,
  spotsOf,
} from '../schema/index.ts'

// A spot is current while the text of its file holds its excerpt; the line is only where the
// page points.
export const spotCurrent = (text: string | null, s: Spot): boolean =>
  text?.includes(s.excerpt.trim()) ?? false
// page: CaseState. Current while every spot of the ladder is current: each rung and the output
// (Nanda, 2026-11-15). Stale: an excerpt is gone (or its file is), and the person asks for other
// cases. textOf gives the text of a file now (null: no such file).
export type CaseState = { readonly _tag: 'Current' } | { readonly _tag: 'Stale' }
export const caseStateOf = (textOf: (file: string) => string | null, c: Case): CaseState =>
  spotsOf(c).every((s) => spotCurrent(textOf(s.file), s)) ? { _tag: 'Current' } : { _tag: 'Stale' }

// The state of one direction of onboarding (the page's list). Loading: a draft, a Revise, or
// submitted answers wait for the host. Question: a question waits for the person. Then Ready.
export const onboardingStateOf = (file: OnboardingDirection): OnboardingDirectionState => {
  if (file.accepted._tag === 'Accepted') return { _tag: 'Accepted' }
  const open = file.questions.filter((q) => q.answer._tag === 'Open')
  const answered = file.questions.length > 0 && open.length === 0
  if (file.draft._tag === 'Drafting' || file.request._tag === 'Revise' || answered) {
    return { _tag: 'Loading' }
  }
  const [first, ...rest] = open
  if (first !== undefined) {
    return { _tag: 'Question', open: [first, ...rest] as NonEmpty<AiQuestion> }
  }
  return { _tag: 'Ready' }
}
