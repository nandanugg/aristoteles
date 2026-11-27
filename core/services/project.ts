export type { Committed, Write, Journal, CommandRecord, CommandCapture } from '../../src/services/project.ts'
export { openProjectJournal } from '../../src/store/project.ts'
export {
  projectOriginals, readProjectLaunchFile, removeProjectLaunch, retireProjectLaunchSecret, writeProjectLaunchFile,
} from '../../src/files/activation.ts'
export { readCommandCapture, reserveCommandCapture, saveCommandCapture } from '../../src/files/project-commands.ts'

import { createHash } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { Env } from '../../src/services/io.ts'
import { activationLock } from '../../src/files/activation.ts'
import { LaunchVerifier, Rationale, refuse } from '../schema/project.ts'

export { PROJECT_FORMAT } from '../../src/store/schema.ts'
export { dbPath } from '../../src/store/path.ts'

export const withProjectEnv = (vars: Readonly<Record<string, string | undefined>>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, Env, { vars })

export const projectLock = (directory: string) => Effect.mapError(activationLock(directory), () =>
  refuse('Unavailable', Rationale.make('The project lock could not be acquired.')))

export const digest = (text: string) => LaunchVerifier.make(createHash('sha256').update(text).digest('hex'))
const ProviderSessionUuid = Schema.String.check(Schema.isPattern(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu))
  .pipe(Schema.brand('ProviderSessionUuid'))
// Stable provider UUID for a project session, including after recovery.
export const providerSessionUuid = (key: string) => {
  if (Schema.is(ProviderSessionUuid)(key)) return key
  const h = createHash('sha1').update(key).digest('hex')
  const variant = ((Number.parseInt(h[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const tail = `${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
  return ProviderSessionUuid.make(`${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${tail}`)
}
