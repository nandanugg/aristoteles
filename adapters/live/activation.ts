import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Effect, Schema } from 'effect'
import type { AuthenticatedActor } from '../../core/actions/project.ts'
import { observeActivation, recordHostUse } from '../../core/actions/project-activation.ts'
import { acknowledgeSession, cancelSession, observeSession, readOpenProject, reserveSession } from '../../core/actions/staff-session.ts'
import {
  ApprovedFiles, HostCredential, LaunchNonce, LaunchVerifier, PaneAddress, Rationale, StaffSessionKey, boundHostSession, hostSession, hostReplacement, staffingAt, refuse,
  type ApprovedFile, type EventNumber, type Of, type Pane, type Project, type Refusal, type Staff, type LiveSession,
} from '../../core/schema/project.ts'
import { projectLock, digest } from '../../core/services/project.ts'
import {
  projectOriginals, readProjectLaunchFile, removeProjectLaunch, retireProjectLaunchSecret, writeProjectLaunchFile,
  type Committed, type Journal,
} from '../../core/services/project.ts'
import { bootstrapPane, observeBootstrap, spawnProjectBootstrap, stopBootstrap } from './bootstrap.ts'
import { codexFallbackNames, contentOf, inventoryOf, manifestOf, markFile, preflight, restoreFile, safeEntry } from './markers.ts'

export const projectDirectoryAt = (directory: string) => pathToFileURL(resolve(directory))

export const activationOwner = (journal: Journal, name: string): Effect.Effect<AuthenticatedActor, Refusal> =>
  Effect.flatMap(readOpenProject(journal), (project) =>
    project.owner.name === name
      ? Effect.succeed({ _tag: 'Human', actor: project.owner } as const)
      : Effect.fail(refuse('WrongActor', Rationale.make('Only the project owner can change activation.'))))

const protectedIO = <A>(operation: () => A): Effect.Effect<A, Refusal> =>
  Effect.try({ try: operation, catch: () => refuse('Unavailable', Rationale.make('The activation operation could not be confirmed.')) })

const projectLaunch = (key: Of<typeof StaffSessionKey>): string => {
  const suffix = key.slice('session:'.length)
  if (!/^[a-f0-9]{32}$/.test(suffix)) throw new Error('Invalid bootstrap launch address')
  return suffix
}
type Observation = 'Running' | 'Ended' | 'Unknown'
export interface ProjectBootstrap {
  readonly observe: (key: Of<typeof StaffSessionKey>) => Effect.Effect<Observation, Refusal>
  readonly pane: (key: Of<typeof StaffSessionKey>) => Effect.Effect<Of<typeof Pane> | null, Refusal>
  readonly spawn: (key: Of<typeof StaffSessionKey>, nonce: Of<typeof LaunchNonce>, staff: Staff) => Effect.Effect<void, Refusal>
  readonly stop: (key: Of<typeof StaffSessionKey>) => Effect.Effect<void, Refusal>
}

export const liveProjectBootstrap = (dir: string, db: string | undefined, project: URL): ProjectBootstrap => ({
  observe: (key) => protectedIO(() => {
    const observed = observeBootstrap(dir, projectLaunch(key))
    return observed === 'live' ? 'Running' : observed === 'ended' ? 'Ended' : 'Unknown'
  }),
  pane: (key) => protectedIO(() => {
    const current = bootstrapPane(dir, projectLaunch(key))
    return current ? { address: PaneAddress.make(current.pane) } : null
  }),
  spawn: (key, nonce, staff) => protectedIO(() => spawnProjectBootstrap(dir, projectLaunch(key), nonce, db, staff, project)),
  stop: (key) => protectedIO(() => stopBootstrap(dir, projectLaunch(key))),
})

const entry = (file: ApprovedFile) => ({ path: file.path, hash: file.hash, premarked: file.before === 'Marked' })
const inventory = (dir: string) => inventoryOf(dir, codexFallbackNames().names)
const original = (dir: string, file: ApprovedFile) => readFileSync(join(dir, file.path)).toString('latin1')
const unavailable = () => refuse('Unavailable', Rationale.make('Confirm the launch and its approved files before continuing.'))
const wrong = () => refuse('WrongMove', Rationale.make('That operation is unavailable in the current activation phase.'))
const retired = () => refuse('RetiredSession', Rationale.make('Use the current bound host and its own credential.'))
const matches = (left: string | null, right: string): boolean =>
  left !== null && timingSafeEqual(Buffer.from(digest(left), 'hex'), Buffer.from(digest(right), 'hex'))

export const projectActivationFiles = (dir: string): Effect.Effect<Of<typeof ApprovedFiles>, Refusal> =>
  protectedIO(() => {
    const scanned = inventory(dir)
    const manifest = manifestOf(dir, scanned.files)
    if (scanned.incomplete.length || manifest.unread.length) throw new Error('Incomplete marker inventory')
    return Schema.decodeUnknownSync(ApprovedFiles)(manifest.entries.map(({ path, hash, premarked }) => ({
      path, hash, before: premarked ? 'Marked' : 'Unmarked',
    })))
  })

export interface ActivationOperations {
  readonly reserve: (key: Of<typeof StaffSessionKey>) => Effect.Effect<Committed, Refusal>
  readonly mark: Effect.Effect<void, Refusal>
  readonly spawn: Effect.Effect<void, Refusal>
  readonly acknowledge: (key: Of<typeof StaffSessionKey>, nonce: Of<typeof LaunchNonce>) => Effect.Effect<Committed, Refusal>
  readonly rollback: (why: Of<typeof Rationale>) => Effect.Effect<Committed, Refusal>
  readonly restore: Effect.Effect<void, Refusal>
  readonly reconcile: Effect.Effect<Committed | null, Refusal>
  readonly collect: (key: Of<typeof StaffSessionKey>, nonce: Of<typeof LaunchNonce>) => Effect.Effect<Of<typeof HostCredential>, Refusal>
  readonly authenticate: (key: Of<typeof StaffSessionKey>, credential: Of<typeof HostCredential>) => Effect.Effect<Project, Refusal>
}

export const projectActivationOperations = (
  dir: string, journal: Journal, provider: ProjectBootstrap,
): ActivationOperations => {
  const locked = <A>(use: (project: Project) => Effect.Effect<A, Refusal>) =>
    Effect.scoped(Effect.gen(function* () {
      yield* Effect.mapError(projectLock(dir), unavailable)
      return yield* Effect.flatMap(readOpenProject(journal), use)
    }))
  const candidate = (project: Project) => {
    const phase = project.activation
    const session = hostSession(project)
    return session?._tag === 'Starting' &&
      (phase._tag === 'Activating' || phase._tag === 'Active' && phase.work._tag === 'NotStarted') ? session : null
  }
  const currentPane = (key: Of<typeof StaffSessionKey>) => Effect.gen(function* () {
    if ((yield* provider.observe(key)) !== 'Running') return yield* Effect.fail(retired())
    const pane = yield* provider.pane(key)
    return pane ?? (yield* Effect.fail(retired()))
  })
  const confirmBoundPane = (binding: LiveSession) =>
    Effect.flatMap(currentPane(binding.key), (pane) =>
      pane.address === binding.pane.address ? Effect.void : Effect.fail(retired()))
  const checkFiles = (files: readonly ApprovedFile[], marked: 'Required' | 'Optional') => protectedIO(() => {
    if (preflight(dir, files.map(entry), inventory(dir)).length) throw new Error('The approved files have changed')
    if (marked === 'Required' && files.some((file) =>
      safeEntry(dir, entry(file)) !== null || contentOf(original(dir, file), entry(file)) !== 'Marked'))
      throw new Error('Marks are incomplete')
  })
  const proof = (generation: Of<typeof EventNumber>, key: Of<typeof StaffSessionKey>, kind: 'nonce' | 'secret' | 'verifier') =>
    readProjectLaunchFile(dir, journal.directory, generation, projectLaunch(key), kind)
  const stop = (key: Of<typeof StaffSessionKey>) => Effect.gen(function* () {
    if ((yield* provider.observe(key)) !== 'Ended') yield* provider.stop(key)
    if ((yield* provider.observe(key)) !== 'Ended') return yield* Effect.fail(unavailable())
  })
  const restore = (project: Project) => Effect.gen(function* () {
    const phase = project.activation
    if (phase._tag !== 'RollingBack') return yield* Effect.fail(wrong())
    yield* protectedIO(() => {
      for (const file of phase.files) {
        const outcome = restoreFile(dir, projectOriginals(journal.directory, phase.at), entry(file))
        if (outcome._tag === 'Unsafe' || outcome._tag === 'NoOriginal') throw new Error('Cannot restore the approved image')
      }
    })
  })
  return {
    reserve: (key) => locked((project) => Effect.gen(function* () {
      yield* protectedIO(() => { projectLaunch(key) })
      const phase = project.activation
      if (phase._tag !== 'Activating' && phase._tag !== 'Active') return yield* Effect.fail(wrong())
      if (phase._tag === 'Active' && phase.work._tag !== 'NotStarted') return yield* Effect.fail(wrong())
      const previous = hostSession(project)
      let state = project
      if (previous && previous._tag !== 'Ended') {
        if (previous.key === key || previous._tag === 'Paused') return yield* Effect.fail(wrong())
        if (previous._tag === 'Live' && phase._tag === 'Active' && (yield* provider.observe(previous.key)) !== 'Ended')
          return yield* Effect.fail(wrong())
        yield* stop(previous.key)
        yield* protectedIO(() => removeProjectLaunch(dir, journal.directory, phase.at, projectLaunch(previous.key)))
        const retired = previous._tag === 'Starting'
          ? yield* cancelSession(journal, project, previous.key)
          : yield* observeSession(journal, project, previous.key, 'Ended')
        state = retired.state
      }
      return yield* reserveSession(journal, state, key, phase.staff, staffingAt(state))
    })),
    mark: locked((project) => Effect.gen(function* () {
      const phase = project.activation
      if (phase._tag !== 'Activating') return yield* Effect.fail(wrong())
      yield* checkFiles(phase.files, 'Optional')
      yield* protectedIO(() => {
        for (const file of phase.files) {
          const outcome = markFile(dir, projectOriginals(journal.directory, phase.at), entry(file))
          if (outcome._tag !== 'Written' && outcome._tag !== 'Done') throw new Error('Marking was interrupted')
        }
      })
    })),
    spawn: locked((project) => Effect.gen(function* () {
      const phase = project.activation
      const launch = candidate(project)
      if (!launch || (phase._tag !== 'Activating' && phase._tag !== 'Active')) return yield* Effect.fail(wrong())
      const observed = yield* provider.observe(launch.key)
      if (observed === 'Running') return
      if (observed !== 'Ended') return yield* Effect.fail(unavailable())
      const nonce = yield* protectedIO(() => {
        const key = projectLaunch(launch.key)
        if (proof(phase.at, launch.key, 'nonce') !== null) throw new Error('An ended launch requires a fresh reservation')
        const privateNonce = LaunchNonce.make(randomBytes(32).toString('hex'))
        const secret = HostCredential.make('host.' + randomBytes(32).toString('hex'))
        writeProjectLaunchFile(dir, journal.directory, phase.at, key, 'nonce', privateNonce)
        writeProjectLaunchFile(dir, journal.directory, phase.at, key, 'secret', secret)
        writeProjectLaunchFile(dir, journal.directory, phase.at, key, 'verifier', LaunchVerifier.make(digest(secret)))
        return privateNonce
      })
      yield* provider.spawn(launch.key, nonce, phase.staff)
    })),
    acknowledge: (key, nonce) => locked((project) => Effect.gen(function* () {
      const phase = project.activation
      const launch = candidate(project)
      if ((phase._tag !== 'Activating' && phase._tag !== 'Active') || launch?.key !== key)
        return yield* Effect.fail(retired())
      if (!(yield* protectedIO(() => matches(proof(phase.at, key, 'nonce'), nonce)))) return yield* Effect.fail(retired())
      const pane = yield* currentPane(key)
      yield* checkFiles(phase.files, 'Required')
      return yield* acknowledgeSession(journal, project, key, pane)
    })),
    rollback: (why) => locked((project) => observeActivation(journal, project, { line: 'Activation', from: 'Activating', move: 'back', input: { why } })),
    restore: locked(restore),
    reconcile: locked((project) => Effect.gen(function* () {
      const phase = project.activation
      if (phase._tag === 'RollingBack') {
        yield* restore(project)
        const launch = hostSession(project)
        let state = project
        if (launch?._tag === 'Starting') {
          yield* stop(launch.key)
          yield* protectedIO(() => removeProjectLaunch(dir, journal.directory, phase.at, projectLaunch(launch.key)))
          state = (yield* cancelSession(journal, project, launch.key)).state
        }
        return yield* observeActivation(journal, state, { line: 'Activation', from: 'RollingBack', move: 'back', input: {} })
      }
      if (phase._tag !== 'Active') return null
      const launch = hostReplacement(project)
      if (launch._tag === 'Starting') {
        if (phase.work._tag === 'NotStarted' && (yield* provider.observe(launch.key)) !== 'Ended') return null
        yield* stop(launch.key)
        yield* protectedIO(() => removeProjectLaunch(dir, journal.directory, phase.at, projectLaunch(launch.key)))
        return yield* cancelSession(journal, project, launch.key)
      }
      yield* protectedIO(() => {
        for (const previous of project.sessions.values()) {
          if (previous._tag === 'Ended' && previous.staff.key === phase.staff.key && previous.startedAt > phase.at)
            removeProjectLaunch(dir, journal.directory, phase.at, projectLaunch(previous.key))
        }
      })
      return null
    })),
    collect: (key, nonce) => locked((project) => Effect.gen(function* () {
      const phase = project.activation
      const binding = boundHostSession(project)
      if (phase._tag !== 'Active' || !binding || binding.key !== key || phase.work._tag === 'Used') return yield* Effect.fail(retired())
      yield* confirmBoundPane(binding)
      return yield* Effect.flatMap(protectedIO(() => matches(proof(phase.at, key, 'nonce'), nonce)
        ? proof(phase.at, key, 'secret') : null),
      (value) => Schema.is(HostCredential)(value) ? Effect.succeed(value) : Effect.fail(retired()))
    })),
    authenticate: (key, credential) => locked((project) => Effect.gen(function* () {
      const phase = project.activation
      const binding = boundHostSession(project)
      if (phase._tag !== 'Active' || !binding || binding.key !== key || phase.work._tag === 'NotStarted') return yield* Effect.fail(retired())
      yield* confirmBoundPane(binding)
      if (!(yield* protectedIO(() => matches(proof(phase.at, key, 'verifier'), digest(credential)))))
        return yield* Effect.fail(retired())
      const active = phase.work._tag === 'Started' ? (yield* recordHostUse(journal, project, key)).state : project
      yield* protectedIO(() => retireProjectLaunchSecret(dir, journal.directory, phase.at, projectLaunch(key)))
      return active
    })),
  }
}

export const newProjectLaunch = (): Of<typeof StaffSessionKey> => StaffSessionKey.make('session:' + randomBytes(16).toString('hex'))

export const resumeProjectActivation = (
  journal: Journal, operations: ActivationOperations, action: 'resume' | 'relaunch' | 'rollback',
): Effect.Effect<void, Refusal> => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  const phase = project.activation
  if (action === 'rollback') {
    if (phase._tag !== 'RollingBack') yield* operations.rollback(Rationale.make('The owner canceled activation.'))
    yield* operations.reconcile
    return
  }
  if (phase._tag === 'RollingBack') { yield* operations.reconcile; return }
  if (phase._tag === 'Onboarding') return yield* Effect.fail(wrong())
  if (phase._tag === 'Activating') yield* operations.mark
  const session = hostSession(project)
  if (action === 'relaunch' || (phase._tag === 'Activating' && session?._tag !== 'Starting'))
    yield* operations.reserve(newProjectLaunch())
  else if (phase._tag === 'Active') {
    yield* operations.reconcile
    return
  }
  yield* operations.spawn
})

export const boundHostAuthority = (
  operations: ActivationOperations, launch: Of<typeof StaffSessionKey>, credential: Of<typeof HostCredential>,
): Effect.Effect<Extract<AuthenticatedActor, { _tag: 'Host' }>, Refusal> =>
  Effect.flatMap(operations.authenticate(launch, credential), (project) => {
    const session = boundHostSession(project)
    return session ? Effect.succeed({ _tag: 'Host', session } as const) : Effect.fail(retired())
  })
