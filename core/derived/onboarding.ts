// The derived states of onboarding and of examples: each reads its input only. The reading of a
// file (the text of an example's file, an onboarding file) is the adapter's, so these stay pure.
import {
  type AiQuestion,
  type Example,
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
// page: ExampleState. Current while every real place of the example is current: its input and
// its output (Nanda, 2026-11-15). Stale: an excerpt is gone (or its file is), and the person asks
// for other examples. The host's words have no place, so they are never stale. textOf gives the
// text of a file now (null: no such file).
export type ExampleState = { readonly _tag: 'Current' } | { readonly _tag: 'Stale' }
export const exampleStateOf = (
  textOf: (file: string) => string | null,
  e: Example,
): ExampleState =>
  spotsOf(e).every((s) => spotCurrent(textOf(s.file), s)) ? { _tag: 'Current' } : { _tag: 'Stale' }

// The state of one direction of onboarding (the page's list). Loading: a draft (a first one, or
// one again for a file in an older shape), a Revise, or submitted answers wait for the host. Question: a question waits for the person. Then Ready.
export const onboardingStateOf = (file: OnboardingDirection): OnboardingDirectionState => {
  if (file.accepted._tag === 'Accepted') return { _tag: 'Accepted' }
  const open = file.questions.filter((q) => q.answer._tag === 'Open')
  const answered = file.questions.length > 0 && open.length === 0
  if (file.draft._tag !== 'Drafted' || file.request._tag === 'Revise' || answered) {
    return { _tag: 'Loading' }
  }
  const [first, ...rest] = open
  if (first !== undefined) {
    return { _tag: 'Question', open: [first, ...rest] as NonEmpty<AiQuestion> }
  }
  return { _tag: 'Ready' }
}
