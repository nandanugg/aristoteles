// The refusal of the new tree (plan/rebuild/BUILD.md D10, 3.2). An act is not allowed now, and the
// actor has a real choice to make. A refusal with no real choice is a bug: the action normalises
// the input in its place (BUILD.md 3.6). A mistake of the command line is not a refusal: it is the
// domain UsageError, and only the adapters make it.
import { Data } from 'effect'
import type { NonBlank } from '../../src/domain/ids.ts'

// What kind of choice the actor has:
//   Write    words that only the actor knows (a reason, a point, the evidence of a rule);
//   Pick     another target or option (a lower role, another draft, another result);
//   Wait     the act comes later; the actor chooses what to do until then;
//   Escalate only the level above can decide.
export type ChoiceKind = 'Write' | 'Pick' | 'Wait' | 'Escalate'

// The words are the `next:` line of the CLI and the hint of the page.
export interface Choice {
  readonly kind: ChoiceKind
  readonly words: NonBlank
}

// message: the old words of the refusal (the golden text of the tests).
export class Refusal extends Data.TaggedError('Refusal')<{
  readonly message: string
  readonly choice: Choice
}> {}

// A short way to refuse. The words of the choice are required: no refusal without a choice.
export const refusal = (message: string, kind: ChoiceKind, words: NonBlank): Refusal =>
  new Refusal({ message, choice: { kind, words } })
