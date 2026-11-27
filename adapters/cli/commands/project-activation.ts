import { Effect, Schema } from 'effect'
import { HostCredential, LaunchNonce, Rationale, SessionId, refuse as refuseProject,
  type Of, type Refusal as ProjectRefusal } from '../../../core/schema/project.ts'
import type { ActivationOperations } from '../../live/activation.ts'

const rejected = () => refuseProject('RetiredSession', Rationale.make('Use the current host’s private launch authority.'))
export const acknowledgeProjectHost = (
  operations: ActivationOperations, launch: unknown, nonce: unknown,
): Effect.Effect<void, ProjectRefusal> => Effect.gen(function* () {
  if (!Schema.is(SessionId)(launch) || !Schema.is(LaunchNonce)(nonce)) return yield* Effect.fail(rejected())
  yield* operations.acknowledge(launch, nonce)
  yield* operations.commit
  yield* operations.reconcile
})

export const collectProjectHost = (
  operations: ActivationOperations, launch: unknown, nonce: unknown,
): Effect.Effect<Of<typeof HostCredential>, ProjectRefusal> =>
  Schema.is(SessionId)(launch) && Schema.is(LaunchNonce)(nonce) ? operations.collect(launch, nonce) : Effect.fail(rejected())
