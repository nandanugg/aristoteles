import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Effect, Schema } from 'effect'
import type { AuthenticatedActor } from '../../core/actions/project.ts'
import { observeActivation, recordHostUse } from '../../core/actions/project-activation.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import {
  ApprovedFiles, HostCredential, LaunchNonce, LaunchVerifier, PaneAddress, ProjectId, Rationale, SessionId, refuse,
  type ApprovedFile, type EventNumber, type HostLaunch, type Of, type Pane, type Project, type Refusal, type Staff,
} from '../../core/schema/project.ts'
import { projectLock, digest } from '../../core/services/project.ts'
import {
  openProjectJournal, projectOriginals, readProjectLaunchFile, removeProjectLaunch, retireProjectLaunchSecret, writeProjectLaunchFile,
  type Committed, type Journal,
} from '../../core/services/project.ts'
import { bootstrapPane, observeBootstrap, spawnProjectBootstrap, stopBootstrap } from './bootstrap.ts'
import { codexFallbackNames, contentOf, inventoryOf, manifestOf, markFile, preflight, restoreFile, safeEntry } from './markers.ts'

export const projectIdAt = (directory: string) => ProjectId.make('project:' + digest(resolve(directory)))

export const activationJournal = (directory: string, mode: 'Read' | 'Write') =>
  openProjectJournal(projectIdAt(directory), mode)

export const activationOwner = (journal: Journal, name: string): Effect.Effect<AuthenticatedActor, Refusal> =>
  Effect.flatMap(readOpenProject(journal), (project) =>
    project.owner.name === name
      ? Effect.succeed({ _tag: 'Human', actor: project.owner } as const)
      : Effect.fail(refuse('WrongActor', Rationale.make('Only the project owner can change activation.'))))

const protectedIO = <A>(operation: () => A): Effect.Effect<A, Refusal> =>
  Effect.try({ try: operation, catch: () => refuse('Unavailable', Rationale.make('The activation operation could not be confirmed.')) })

const projectLaunch = (id: Of<typeof SessionId>): string => {
  const suffix = id.slice('session:'.length)
  if (!/^[a-f0-9]{32}$/.test(suffix)) throw new Error('Invalid bootstrap launch address')
  return suffix
}
type Observation = 'Running' | 'Ended' | 'Unknown'
export interface ProjectBootstrap {
  readonly observe: (id: Of<typeof SessionId>) => Effect.Effect<Observation, Refusal>
  readonly pane: (id: Of<typeof SessionId>) => Effect.Effect<Of<typeof Pane> | null, Refusal>
  readonly spawn: (id: Of<typeof SessionId>, nonce: Of<typeof LaunchNonce>, staff: Staff) => Effect.Effect<void, Refusal>
  readonly stop: (id: Of<typeof SessionId>) => Effect.Effect<void, Refusal>
}

export const liveProjectBootstrap = (dir: string, db: string | undefined, project: Of<typeof ProjectId>): ProjectBootstrap => ({
  observe: (id) => protectedIO(() => {
    const observed = observeBootstrap(dir, projectLaunch(id))
    return observed === 'live' ? 'Running' : observed === 'ended' ? 'Ended' : 'Unknown'
  }),
  pane: (id) => protectedIO(() => {
    const current = bootstrapPane(dir, projectLaunch(id))
    return current ? { address: PaneAddress.make(current.pane) } : null
  }),
  spawn: (id, nonce, staff) => protectedIO(() => spawnProjectBootstrap(dir, projectLaunch(id), nonce, db, staff, project)),
  stop: (id) => protectedIO(() => stopBootstrap(dir, projectLaunch(id))),
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
  readonly reserve: (id: Of<typeof SessionId>) => Effect.Effect<Committed, Refusal>
  readonly mark: Effect.Effect<void, Refusal>
  readonly spawn: Effect.Effect<void, Refusal>
  readonly acknowledge: (id: Of<typeof SessionId>, nonce: Of<typeof LaunchNonce>) => Effect.Effect<Committed, Refusal>
  readonly commit: Effect.Effect<Committed, Refusal>
  readonly rollback: (why: Of<typeof Rationale>) => Effect.Effect<Committed, Refusal>
  readonly restore: Effect.Effect<void, Refusal>
  readonly reconcile: Effect.Effect<Committed | null, Refusal>
  readonly collect: (id: Of<typeof SessionId>, nonce: Of<typeof LaunchNonce>) => Effect.Effect<Of<typeof HostCredential>, Refusal>
  readonly authenticate: (id: Of<typeof SessionId>, credential: Of<typeof HostCredential>) => Effect.Effect<Project, Refusal>
}

export const projectActivationOperations = (
  dir: string, journal: Journal, provider: ProjectBootstrap,
): ActivationOperations => {
  const locked = <A>(use: (project: Project) => Effect.Effect<A, Refusal>) =>
    Effect.scoped(Effect.gen(function* () {
      yield* Effect.mapError(projectLock(dir), unavailable)
      return yield* Effect.flatMap(readOpenProject(journal), use)
    }))
  const line = { _tag: 'Activation', id: journal.id } as const
  const launchLine = (id: Of<typeof SessionId>) => ({ _tag: 'HostLaunch', id } as const)
  const candidate = (project: Project) => {
    const { activation } = project
    const launch = activation._tag === 'Activating' ? activation.launches.at(-1)
      : activation._tag === 'Active' && activation.work._tag === 'NotStarted' ? activation.replacement : null
    return launch?._tag === 'Reserved' || launch?._tag === 'Acknowledged' ? launch : null
  }
  const cancel = (project: Project, launch: Extract<HostLaunch, { _tag: 'Reserved' | 'Acknowledged' }>) =>
    observeActivation(journal, project, { line: launchLine(launch.id), from: launch._tag, move: 'cancel', input: {} })
  const currentPane = (id: Of<typeof SessionId>) => Effect.gen(function* () {
    if ((yield* provider.observe(id)) !== 'Running') return yield* Effect.fail(retired())
    const pane = yield* provider.pane(id)
    return pane ?? (yield* Effect.fail(retired()))
  })
  const confirmBoundPane = (binding: { readonly id: Of<typeof SessionId>; readonly pane: Of<typeof Pane> }) =>
    Effect.flatMap(currentPane(binding.id), (pane) =>
      pane.address === binding.pane.address ? Effect.void : Effect.fail(retired()))
  const checkFiles = (files: readonly ApprovedFile[], marked: 'Required' | 'Optional') => protectedIO(() => {
    if (preflight(dir, files.map(entry), inventory(dir)).length) throw new Error('The approved files have changed')
    if (marked === 'Required' && files.some((file) =>
      safeEntry(dir, entry(file)) !== null || contentOf(original(dir, file), entry(file)) !== 'Marked'))
      throw new Error('Marks are incomplete')
  })
  const proof = (generation: Of<typeof EventNumber>, id: Of<typeof SessionId>, key: 'nonce' | 'secret' | 'verifier') =>
    readProjectLaunchFile(dir, journal.id, generation, projectLaunch(id), key)
  const stop = (id: Of<typeof SessionId>) => Effect.gen(function* () {
    if ((yield* provider.observe(id)) !== 'Ended') yield* provider.stop(id)
    if ((yield* provider.observe(id)) !== 'Ended') return yield* Effect.fail(unavailable())
  })
  const restore = (project: Project) => Effect.gen(function* () {
    const phase = project.activation
    if (phase._tag !== 'RollingBack') return yield* Effect.fail(wrong())
    yield* protectedIO(() => {
      for (const file of phase.files) {
        const outcome = restoreFile(dir, projectOriginals(journal.id, phase.at), entry(file))
        if (outcome._tag === 'Unsafe' || outcome._tag === 'NoOriginal') throw new Error('Cannot restore the approved image')
      }
    })
  })
  return {
    reserve: (id) => locked((project) => Effect.gen(function* () {
      yield* protectedIO(() => { projectLaunch(id) })
      const phase = project.activation
      if (phase._tag !== 'Activating' && phase._tag !== 'Active') return yield* Effect.fail(wrong())
      if (phase._tag === 'Active' && (yield* provider.observe(phase.binding.id)) !== 'Ended')
        return yield* Effect.fail(wrong())
      const previous = phase._tag === 'Activating' ? phase.launches.at(-1) : null
      let state = project
      if (previous?._tag === 'Reserved' || previous?._tag === 'Acknowledged') {
        if (previous.id === id || (yield* provider.observe(previous.id)) !== 'Ended') return yield* Effect.fail(wrong())
        yield* protectedIO(() => removeProjectLaunch(dir, journal.id, phase.at, projectLaunch(previous.id)))
        state = (yield* cancel(project, previous)).state
      }
      return yield* observeActivation(journal, state, { line: launchLine(id), from: null, move: 'reserve', input: {} })
    })),
    mark: locked((project) => Effect.gen(function* () {
      const phase = project.activation
      if (phase._tag !== 'Activating') return yield* Effect.fail(wrong())
      yield* checkFiles(phase.files, 'Optional')
      yield* protectedIO(() => {
        for (const file of phase.files) {
          const outcome = markFile(dir, projectOriginals(journal.id, phase.at), entry(file))
          if (outcome._tag !== 'Written' && outcome._tag !== 'Done') throw new Error('Marking was interrupted')
        }
      })
    })),
    spawn: locked((project) => Effect.gen(function* () {
      const phase = project.activation
      const launch = candidate(project)
      if (!launch || (phase._tag !== 'Activating' && phase._tag !== 'Active')) return yield* Effect.fail(wrong())
      const observed = yield* provider.observe(launch.id)
      if (observed === 'Running') return
      if (observed !== 'Ended' || launch._tag !== 'Reserved') return yield* Effect.fail(unavailable())
      const nonce = yield* protectedIO(() => {
        const id = projectLaunch(launch.id)
        if (proof(phase.at, launch.id, 'nonce') !== null) throw new Error('An ended launch requires a fresh reservation')
        const privateNonce = LaunchNonce.make(randomBytes(32).toString('hex'))
        const secret = HostCredential.make('host.' + randomBytes(32).toString('hex'))
        writeProjectLaunchFile(dir, journal.id, phase.at, id, 'nonce', privateNonce)
        writeProjectLaunchFile(dir, journal.id, phase.at, id, 'secret', secret)
        writeProjectLaunchFile(dir, journal.id, phase.at, id, 'verifier', LaunchVerifier.make(digest(secret)))
        return privateNonce
      })
      yield* provider.spawn(launch.id, nonce, phase.staff)
    })),
    acknowledge: (id, nonce) => locked((project) => Effect.gen(function* () {
      const phase = project.activation
      const launch = candidate(project)
      if ((phase._tag !== 'Activating' && phase._tag !== 'Active') || launch?._tag !== 'Reserved' || launch.id !== id)
        return yield* Effect.fail(retired())
      if (!(yield* protectedIO(() => matches(proof(phase.at, id, 'nonce'), nonce)))) return yield* Effect.fail(retired())
      const pane = yield* currentPane(id)
      return yield* observeActivation(journal, project, { line: launchLine(id), from: 'Reserved', move: 'acknowledge', input: { pane } })
    })),
    commit: locked((project) => Effect.gen(function* () {
      const phase = project.activation
      const launch = candidate(project)
      if (launch?._tag !== 'Acknowledged' || (phase._tag !== 'Activating' && phase._tag !== 'Active'))
        return yield* Effect.fail(retired())
      const pane = yield* currentPane(launch.id)
      yield* checkFiles(phase.files, 'Required')
      return yield* observeActivation(journal, project, {
        line: launchLine(launch.id), from: 'Acknowledged', move: 'bind', input: { pane },
      })
    })),
    rollback: (why) => locked((project) => observeActivation(journal, project, { line, from: 'Activating', move: 'back', input: { why } })),
    restore: locked(restore),
    reconcile: locked((project) => Effect.gen(function* () {
      const phase = project.activation
      if (phase._tag === 'RollingBack') {
        yield* restore(project)
        const launch = phase.launches.at(-1)
        let state = project
        if (launch?._tag === 'Reserved' || launch?._tag === 'Acknowledged') {
          const { id } = launch
          yield* stop(id)
          yield* protectedIO(() => removeProjectLaunch(dir, journal.id, phase.at, projectLaunch(id)))
          state = (yield* cancel(project, launch)).state
        }
        return yield* observeActivation(journal, state, { line, from: 'RollingBack', move: 'back', input: {} })
      }
      if (phase._tag !== 'Active' || !phase.replacement) return null
      const launch = phase.replacement
      const { id } = launch
      if (launch._tag === 'Reserved' || launch._tag === 'Acknowledged') {
        if (phase.work._tag === 'NotStarted' && (yield* provider.observe(id)) !== 'Ended') return null
        yield* stop(id)
        yield* protectedIO(() => removeProjectLaunch(dir, journal.id, phase.at, projectLaunch(id)))
        return yield* cancel(project, launch)
      }
      if (launch._tag !== 'Bound') return null
      yield* protectedIO(() => {
        for (const previous of phase.launches) {
          if (previous.id !== id) removeProjectLaunch(dir, journal.id, phase.at, projectLaunch(previous.id))
        }
      })
      return yield* observeActivation(journal, project, { line, from: 'Active', move: 'clearReplacement', input: { id } })
    })),
    collect: (id, nonce) => locked((project) => Effect.gen(function* () {
      const phase = project.activation
      if (phase._tag !== 'Active' || phase.binding.id !== id || phase.work._tag === 'Used') return yield* Effect.fail(retired())
      yield* confirmBoundPane(phase.binding)
      return yield* Effect.flatMap(protectedIO(() => matches(proof(phase.at, id, 'nonce'), nonce)
        ? proof(phase.at, id, 'secret') : null),
      (value) => Schema.is(HostCredential)(value) ? Effect.succeed(value) : Effect.fail(retired()))
    })),
    authenticate: (id, credential) => locked((project) => Effect.gen(function* () {
      const phase = project.activation
      if (phase._tag !== 'Active' || phase.binding.id !== id || phase.work._tag === 'NotStarted') return yield* Effect.fail(retired())
      yield* confirmBoundPane(phase.binding)
      if (!(yield* protectedIO(() => matches(proof(phase.at, id, 'verifier'), digest(credential)))))
        return yield* Effect.fail(retired())
      const active = phase.work._tag === 'Started' ? (yield* recordHostUse(journal, project, id)).state : project
      yield* protectedIO(() => retireProjectLaunchSecret(dir, journal.id, phase.at, projectLaunch(id)))
      return active
    })),
  }
}

export const newProjectLaunch = (): Of<typeof SessionId> => SessionId.make('session:' + randomBytes(16).toString('hex'))

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
  if (action === 'relaunch' || (phase._tag === 'Activating' && (!phase.launches.length || phase.launches.at(-1)?._tag === 'Cancelled')))
    yield* operations.reserve(newProjectLaunch())
  else if (phase._tag === 'Active' && (!phase.replacement || phase.work._tag !== 'NotStarted' || phase.replacement.id === phase.binding.id)) {
    yield* operations.reconcile
    return
  }
  const current = (yield* readOpenProject(journal)).activation
  const launch = current._tag === 'Activating' ? current.launches.at(-1) : current._tag === 'Active' ? current.replacement : null
  if (launch?._tag === 'Acknowledged') {
    yield* operations.commit
    yield* operations.reconcile
  } else {
    yield* operations.spawn
  }
})

export const boundHostAuthority = (
  operations: ActivationOperations, launch: Of<typeof SessionId>, credential: Of<typeof HostCredential>,
): Effect.Effect<Extract<AuthenticatedActor, { _tag: 'Host' }>, Refusal> =>
  Effect.flatMap(operations.authenticate(launch, credential), (project) =>
    project.activation._tag === 'Active'
      ? Effect.succeed({ _tag: 'Host', id: launch, staff: project.activation.staff } as const)
      : Effect.fail(retired()))
