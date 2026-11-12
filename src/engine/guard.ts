// How a rule of the engine refuses. A check runs the same code as its apply up to the first
// problem: a guard either refuses there (the check) or lets the build go on (the apply, which
// trusts the store). Internal to src/engine.
import { Effect, Result } from 'effect'
import { refuse, type Refused } from '../domain/errors.ts'
import { type Found, lookup } from '../domain/lookup.ts'
import type { Work } from '../domain/work.ts'

// A refusal inside a check; checkAct turns it into Refused with the same words.
export class Refusal {
  constructor(readonly message: string) {}
}
export const no = (message: string): never => {
  throw new Refusal(message)
}

// The problem of a build, or none.
export type Guard = (problem: string | undefined) => void
export const refusing: Guard = (problem) => {
  if (problem !== undefined) no(problem)
}
export const trusting: Guard = () => undefined

// Runs a check that throws a Refusal; any other throw is a bug.
export const checked = (f: () => void): Effect.Effect<void, Refused> =>
  Effect.suspend(() => {
    try {
      f()
      return Effect.void
    } catch (error) {
      if (error instanceof Refusal) return Effect.fail(refuse(error.message))
      throw error
    }
  })

// The record of a typed id, with the refusal words when there is none.
export const found = (
  w: Work,
  id: string,
  expected: ReadonlyArray<string>,
  guard: Guard,
): Found | undefined => {
  const r = Effect.runSync(Effect.result(lookup(w, id, expected)))
  if (Result.isFailure(r)) {
    guard(r.failure.message)
    return undefined
  }
  return r.success
}
