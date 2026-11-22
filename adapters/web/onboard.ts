// The words for the person’s file-only onboarding acts.
import { type DirectionId, type OnboardingAct } from '../../core/schema/index.ts'
import { type OnboardingFiles } from '../../core/services/index.ts'
import { answersWords } from '../words/index.ts'

type PersonAct = Exclude<OnboardingAct, { readonly act: 'approve-all-roles' }>

// The words of the answer, after the act wrote the files (the directions that it made, accepted,
// and the files as the act left them).
export const onboardingWords = (
  act: PersonAct,
  made: ReadonlyArray<DirectionId>,
  files: OnboardingFiles,
): string => {
  switch (act.act) {
    case 'add-direction':
      return `${made.join(', ')}: a new direction; it shows Loading until the host drafts it.`
    case 'add-company-direction':
      return `${made.join(', ')}: a company direction; it shows Loading until the host drafts it.`
    case 'answer': {
      const answered = files.directions.find((f) => f.id === act.direction)
      const words = answered === undefined ? `the answers of ${act.direction} are in` : answersWords(answered)
      return `${words}; the host drafts it again.`
    }
    case 'accept':
      return `${act.direction} is accepted.`
    case 'revise':
      return `${act.direction}: the host drafts it again from your words.`
    case 'remove':
      return `${act.direction} is removed; nothing keeps it.`
    case 'approve-all-directions':
      return `accepted: ${made.join(', ')}.`
    case 'add-role':
      return 'The role request is ready for the host.'
    case 'review-all-roles':
      return 'All roles accepted.'
    case 'accept-role':
      return `${act.role} is accepted.`
    case 'revise-role':
      return `${act.role}: the host writes it again from your words.`
    case 'remove-role':
      return `${act.role} is removed; nothing keeps it.`
    case 'model':
      return `${act.role} runs on ${act.model}.`
    case 'persistence':
      return act.persistent
        ? `${act.role} is persistent: it gets a terminal of its own.`
        : `${act.role} is disposable: it runs as a subagent of a terminal.`
  }
}
