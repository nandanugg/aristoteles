// The body of a module that a porter has not built yet: a defect that names it. The tests of the
// new code fail on this line, not on a missing import (plan/types/BUILD.md, the stubs).
import { Effect } from 'effect'
import { NotBuilt } from './errors.ts'

const defect = (what: string) =>
  new NotBuilt({ message: `${what} is not built yet (plan/types/BUILD.md)` })

// For a function that returns an Effect.
export const notBuilt = (what: string): Effect.Effect<never> => Effect.die(defect(what))

// For a plain function: it throws the same defect.
export const notBuiltSync = (what: string): never => {
  throw defect(what)
}
