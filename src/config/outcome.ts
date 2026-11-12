// Helper of the config and files tests: runs an effect and gives its value, or the words of its
// refusal.
import { Cause, Effect, Exit, Layer } from 'effect'
import type { OutsideFailed, Refused } from '../domain/errors.ts'
import { FilesLive, SpawnLive } from '../services/outside.ts'

export type Outcome = { readonly ok: unknown } | { readonly refused: string }

// biome-ignore lint/suspicious/noExplicitAny: the test supplies whatever layers the effect needs
export const runNew = async (effect: Effect.Effect<unknown, Refused | OutsideFailed, any>): Promise<Outcome> => {
  const exit = await Effect.runPromiseExit(
    (effect as Effect.Effect<unknown, Refused | OutsideFailed>).pipe(
      Effect.provide(Layer.mergeAll(FilesLive, SpawnLive)),
    ),
  )
  if (Exit.isSuccess(exit)) return { ok: exit.value }
  const failure = exit.cause.reasons.find(Cause.isFailReason)
  if (failure) return { refused: failure.error.message }
  throw new Error(Cause.pretty(exit.cause))
}
