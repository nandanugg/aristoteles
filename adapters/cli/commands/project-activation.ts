import { Effect, Schema } from 'effect'
import { HostCredential, LaunchNonce, Rationale, StaffSessionKey, refuse as refuseProject,
  type Of, type Refusal as ProjectRefusal } from '../../../core/schema/project.ts'
import type { Committed } from '../../../core/services/project.ts'
import type { hostSessionCredentials } from '../../live/host-session.ts'
import type { ActivationOperations } from '../../live/activation.ts'

const rejected = () => refuseProject('RetiredSession', Rationale.make('Use the current host’s private launch authority.'))
export const acknowledgeProjectHost = (
  operations: ActivationOperations, launch: string | undefined, nonce: string | undefined,
): Effect.Effect<Committed, ProjectRefusal> => Effect.gen(function* () {
  if (!Schema.is(StaffSessionKey)(launch) || !Schema.is(LaunchNonce)(nonce)) return yield* Effect.fail(rejected())
  const committed = yield* operations.acknowledge(launch, nonce)
  yield* operations.reconcile
  return committed
})

export const collectProjectHost = (
  credentials: ReturnType<typeof hostSessionCredentials>, launch: string | undefined, nonce: string | undefined,
): Effect.Effect<Of<typeof HostCredential>, ProjectRefusal> =>
  Schema.is(StaffSessionKey)(launch) && Schema.is(LaunchNonce)(nonce) ? credentials.collect(launch, nonce) : Effect.fail(rejected())
