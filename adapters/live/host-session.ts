import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import {
  HostCredential, LaunchNonce, LaunchVerifier, Rationale, activeWork, boundHostSession, liveSession, refuse,
  type Of, type StaffSessionKey,
} from '../../core/schema/project.ts'
import {
  digest, projectLock, readProjectSessionFile, retireProjectSessionSecret, writeProjectSessionFile, type Journal,
} from '../../core/services/project.ts'
import type { ProjectBootstrap } from './activation.ts'

const retired = () => refuse('RetiredSession', Rationale.make('Use the current host session and its own credential.'))
const privateIO = <A>(operation: () => A) => Effect.try({
  try: operation,
  catch: () => refuse('Unavailable', Rationale.make('Could not confirm the host session credential.')),
})
const matches = (left: string | null, right: string) =>
  left !== null && timingSafeEqual(Buffer.from(digest(left), 'hex'), Buffer.from(digest(right), 'hex'))

export const openHostSession = (dir: string, journal: Journal, key: Of<typeof StaffSessionKey>) =>
  privateIO(() => {
    if (readProjectSessionFile(dir, journal.directory, key, 'nonce') !== null)
      throw new Error('An ended launch requires a fresh reservation')
    const nonce = LaunchNonce.make(randomBytes(32).toString('hex'))
    const secret = HostCredential.make('host.' + randomBytes(32).toString('hex'))
    writeProjectSessionFile(dir, journal.directory, key, 'nonce', nonce)
    writeProjectSessionFile(dir, journal.directory, key, 'secret', secret)
    writeProjectSessionFile(dir, journal.directory, key, 'verifier', LaunchVerifier.make(digest(secret)))
    return nonce
  })

export const proveHostSession = (dir: string, journal: Journal, key: Of<typeof StaffSessionKey>, nonce: Of<typeof LaunchNonce>) =>
  Effect.flatMap(privateIO(() => matches(readProjectSessionFile(dir, journal.directory, key, 'nonce'), nonce)),
    (valid) => valid ? Effect.void : Effect.fail(retired()))

export const hostSessionCredentials = (dir: string, journal: Journal, provider: Pick<ProjectBootstrap, 'observe' | 'pane'>) => {
  const live = (key: Of<typeof StaffSessionKey>) => Effect.gen(function* () {
    yield* projectLock(dir)
    const project = yield* readOpenProject(journal)
    const session = liveSession(project, key)
    if (!session || (yield* provider.observe(key)) !== 'Running') return yield* Effect.fail(retired())
    const pane = yield* provider.pane(key)
    if (pane?.address !== session.pane.address) return yield* Effect.fail(retired())
    return { project, session }
  })
  return {
    collect: (key: Of<typeof StaffSessionKey>, nonce: Of<typeof LaunchNonce>) => Effect.scoped(Effect.gen(function* () {
      yield* live(key)
      yield* proveHostSession(dir, journal, key, nonce)
      const secret = yield* privateIO(() => readProjectSessionFile(dir, journal.directory, key, 'secret'))
      return Schema.is(HostCredential)(secret) ? secret : yield* Effect.fail(retired())
    })),
    authenticate: (key: Of<typeof StaffSessionKey>, credential: Of<typeof HostCredential>) => Effect.scoped(Effect.gen(function* () {
      const { project, session } = yield* live(key)
      if (!activeWork(project) || boundHostSession(project)?.key !== key) return yield* Effect.fail(retired())
      const valid = yield* privateIO(() =>
        matches(readProjectSessionFile(dir, journal.directory, key, 'verifier'), digest(credential)))
      if (!valid) return yield* Effect.fail(retired())
      yield* privateIO(() => retireProjectSessionSecret(dir, journal.directory, key))
      return { _tag: 'Host', session } as const
    })),
  }
}
