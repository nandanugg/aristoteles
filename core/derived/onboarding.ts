// The derived states of onboarding and of cases: each reads its input only. The reading of a
// file (the text of a case's file, an onboarding file) is the adapter's, so these stay pure.
import type {
  AiQuestion,
  Case,
  NonEmpty,
  OnboardingDirection,
  OnboardingDirectionState,
} from '../schema/index.ts'

// page: CaseState. Current while the file's text holds the excerpt; the line is only where the
// page points. Stale: the excerpt is gone (or the file is), and the person asks for other cases.
export type CaseState = { readonly _tag: 'Current' } | { readonly _tag: 'Stale' }
export const caseStateOf = (text: string | null, c: Case): CaseState =>
  text?.includes(c.excerpt.trim()) ? { _tag: 'Current' } : { _tag: 'Stale' }

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
