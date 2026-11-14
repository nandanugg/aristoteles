// The failures of a command. Three are expected and typed (a refusal, a usage mistake, an outside
// failure); a bug is a defect (Effect.die), never a typed error. main prints each expected one as
// "refused: <message>" and "next: ...", with exit 1 (a refusal), 2 (a usage mistake) or 3 (an
// outside failure, a damaged store); a bug exits 70 (plan/types/BUILD.md, the error model).
import { Data } from 'effect'

// The act is not allowed now; nothing is stored. next: the one line that says what to do.
export class Refused extends Data.TaggedError('Refused')<{
  readonly message: string
  readonly next: string | null
}> {}

// The command line is wrong: an unknown command, flag, or a flag with no value.
export class UsageError extends Data.TaggedError('UsageError')<{
  readonly message: string
  readonly next: string | null
}> {}

// Something outside failed: git, tmux, a fetch, the file system, a busy store.
export class OutsideFailed extends Data.TaggedError('OutsideFailed')<{
  readonly system: 'git' | 'tmux' | 'files' | 'store' | 'fetch' | 'program'
  readonly message: string
  readonly next: string | null
}> {}

// A stored row that does not decode or does not apply: the store is damaged at that seq. main
// prints the old words: refused: the store is damaged at e<seq>: <issue>; the person restores
// the store from a copy. It is never a refusal of the new act (the replay trusts the store).
export class StoreDamaged extends Data.TaggedError('StoreDamaged')<{
  readonly seq: number
  readonly issue: string
}> {}

// A short way to refuse, as the old refuse(message, next) did.
export const refuse = (message: string, next: string | null = null) =>
  new Refused({ message, next })

// What main prints for an expected failure; exit codes: the comment at the top.
export type Expected = Refused | UsageError | OutsideFailed | StoreDamaged
