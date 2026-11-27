export type { Committed, Write, Journal, CommandRecord, CommandCapture } from '../../src/services/project.ts'
export { openProjectJournal } from '../../src/store/project.ts'
export {
  projectOriginals, readProjectLaunchFile, removeProjectLaunch, retireProjectLaunchSecret, writeProjectLaunchFile,
} from '../../src/files/activation.ts'
export { readCommandCapture, reserveCommandCapture, saveCommandCapture } from '../../src/files/project-commands.ts'

import { Effect, Schema } from 'effect'
import { Env } from '../../src/services/io.ts'
import { sha } from '../../src/config/core.ts'
import { cliSession } from '../../src/files/worker-runtime.ts'
import { activationLock } from '../../src/files/activation.ts'
import { LaunchVerifier, Rationale, refuse } from '../schema/project.ts'

export { dbPath } from '../../src/store/path.ts'

export const withProjectEnv = (vars: Readonly<Record<string, string | undefined>>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, Env, { vars })

export const projectLock = (directory: string) => Effect.mapError(activationLock(directory), () =>
  refuse('Unavailable', Rationale.make('The project lock could not be acquired.')))

export const digest = (text: string) => LaunchVerifier.make(sha(text))
const ProviderSessionId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu))
  .pipe(Schema.brand('ProviderSessionId'))
export const providerSessionId = (id: string) => ProviderSessionId.make(cliSession(id))
