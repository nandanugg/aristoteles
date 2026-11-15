// The derived states of onboarding and of examples: each reads its input only. The reading of a
// file (the text of an example's file, an onboarding file) is the adapter's, so these stay pure.
import type {
  Example,
  OnboardingDirection,
  OnboardingDirectionState,
  Spot,
} from '../schema/index.ts'
import { spotsOf } from '../schema/index.ts'

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

// The state of one direction of onboarding (the page's list): the stage of its file. Loading: the
// host acts (a first draft, a draft again for a file in an older shape, a Revise, or submitted
// answers).
export const onboardingStateOf = (file: OnboardingDirection): OnboardingDirectionState => {
  switch (file.stage._tag) {
    case 'Question':
      return { _tag: 'Question', open: file.stage.open }
    case 'Ready':
    case 'Accepted':
      return { _tag: file.stage._tag }
    default:
      return { _tag: 'Loading' }
  }
}
