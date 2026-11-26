import { randomUUID } from 'node:crypto'
import { bindWorker, reserveWorker } from '../../core/actions/worker.ts'
import { foldRuntime } from '../../core/state/worker-runtime.ts'
import { stageWorkerLaunch } from '../../core/services/index.ts'
import { dispatch } from '../../core/actions/index.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'
import {
  activationOf, appendActivated, appendHostRebound, deleteInactive,
  type ActivationState,
} from '../../core/actions/activation.ts'
import { type Author, type Refused, refuse } from '../../core/schema/index.ts'
import {
  type ActivationRecord, type OnboardingFiles, activationId, activationIO, activationLock, applyStartupFiles,
  readConfigText, Env, finishOnboardingStart, keptOriginals, prepareStart, readActivationRecord, readLaunchFile,
  removeActivationGeneration, removeActivationRecord, removeLaunch, retireSecret, sha, staffingConfirmed, Store, writeActivationRecord,
  writeLaunchFile,
} from '../../core/services/index.ts'
import { foldWork } from '../../core/state/c16/fold.ts'
import { bootstrapAlive, bootstrapTemplate, spawnBootstrap, stopBootstrap } from './bootstrap.ts'
import { configProblems } from './config-problems.ts'
import { codexFallbackNames, contentOf, inventoryOf, manifestOf, markFile, preflight, restoreFile } from './markers.ts'

export const activationEvents = (dir: string) => Effect.scoped(Effect.gen(function* () {
  const opened = yield* (yield* Store).open(dir, { create: false })
  return yield* opened.events
}).pipe(Effect.catchTag('Refused', (error) => error.message.startsWith('no work store in ')
  ? Effect.succeed([]) : Effect.fail(error))))

const readState = (dir: string) => Effect.map(activationEvents(dir), activationOf)
const locked = <A, E, R>(dir: string, effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.andThen(activationLock(dir), effect))
const recordAt = (dir: string) => activationIO(() => readActivationRecord(dir))
const save = (dir: string, record: ActivationRecord) =>
  activationIO(() => writeActivationRecord(dir, record))
const scan = (dir: string) => inventoryOf(dir, codexFallbackNames().names)
const no = (words: string) => Effect.fail(refuse(words))
type Person = Extract<Author, { _tag: 'Person' }>

export const markerApproval = (dir: string) => activationIO(() => {
  const inventory = scan(dir)
  const manifest = manifestOf(dir, inventory.files)
  const problems = [...inventory.incomplete, ...manifest.unread]
  if (problems.length > 0) throw refuse(problems.join('\n'))
  return { entries: manifest.entries, reported: inventory.reported }
})

export const prepareActivation = (
  dir: string, by: Person, manifest: ActivationRecord['manifest'],
  blocked: (files: OnboardingFiles) => Refused | undefined,
  requireStaffingConfirmation = false,
) => locked(dir, Effect.gen(function* () {
  if ((yield* recordAt(dir)) !== null) return yield* no('an activation already exists; use work activation resume')
  if ((yield* activationEvents(dir)).length !== 0) return yield* no('the workflow already exists')
  const env = (yield* Env).vars
  const start = yield* prepareStart(dir, by.name, env, blocked, false)
  if (requireStaffingConfirmation && !(yield* staffingConfirmed(dir, by.name))) {
    return yield* no('Confirm the current staffing before starting activation.')
  }
  const problems = yield* activationIO(() => preflight(dir, manifest, scan(dir)))
  if (problems.length > 0) return yield* no(problems.join('\n'))
  const config = yield* readConfigText(dir, start.files[0]!.after)
  const invalid = yield* configProblems(config.config)
  if (invalid.length > 0) return yield* no(invalid.join('\n'))
  const record: ActivationRecord = {
    generation: Date.now(), owner: by.name, phase: 'activating', manifest,
    marked: [], files: start.files, directions: start.directions,
    pending: null, committed: null, retired: false,
  }
  yield* save(dir, record)
}))

// Always reconcile the journal before discarding anything in a pending record.
const reconcile = (dir: string, record: ActivationRecord, state: ActivationState) =>
  Effect.gen(function* () {
    const pending = record.pending
    if (!pending) return record
    if (state?.generation === record.generation && state.binding?.launch === pending.launch) {
      const old = record.committed
      const next: ActivationRecord = {
        ...record, phase: 'active', pending: null, retired: false,
        committed: { launch: pending.launch, nonceVerifier: pending.nonceVerifier },
      }
      if (old !== null && old.launch !== pending.launch) {
        // Retrying cleanup is safe while the pending record still identifies this commit.
        yield* activationIO(() => removeLaunch(dir, record.generation, old.launch))
      }
      yield* save(dir, next)
      return next
    }
    if (state?.topOpened || !bootstrapAlive(dir, pending.launch)) {
      yield* activationIO(() => {
        stopBootstrap(dir, pending.launch)
        removeLaunch(dir, record.generation, pending.launch)
      })
      const next = { ...record, pending: null }
      yield* save(dir, next)
      return next
    }
    return record
  })

const reserve = (
  dir: string, record: ActivationRecord, kind: 'activate' | 'rebind', expected: string | null,
) => Effect.gen(function* () {
  const env = (yield* Env).vars
  const config = yield* readConfigText(dir, record.files[0]!.after)
  const host = Object.entries(config.config.roles).find(([, role]) =>
    role.kind === 'agent' && role.persistence.persistent && role.acts.includes('split'))
  if (!host) return yield* no('there is no persistent host role')
  const template = yield* bootstrapTemplate(dir, host[0])
  const launch = activationId()
  const nonce = activationId() + activationId()
  const pending = { kind, launch, nonceVerifier: sha(nonce), expected, acknowledged: false }
  yield* save(dir, { ...record, pending })
  yield* activationIO(() => {
    writeLaunchFile(dir, record.generation, launch, 'nonce', nonce)
    spawnBootstrap(dir, launch, nonce, env.ARISTOTELES_DB, template)
  })
  return 'Bootstrap host started. Run work activation resume after it acknowledges.'
})

const checkedMarkers = (dir: string, record: ActivationRecord) =>
  activationIO(() => {
    const problems = preflight(dir, record.manifest, scan(dir))
    if (problems.length > 0) throw refuse(problems.join('\n'))
  })

const append = (dir: string, by: Person, record: ActivationRecord) =>
  Effect.gen(function* () {
    const pending = record.pending!
    if (pending.kind === 'activate') {
      yield* checkedMarkers(dir, record)
      yield* activationIO(() => {
        for (const entry of record.manifest) {
          if (contentOf(readFileSync(join(dir, entry.path)).toString('latin1'), entry) !== 'Marked') {
            throw refuse(`${entry.path} is not marked; resume must mark the approved manifest`)
          }
        }
      })
    }
    if (!bootstrapAlive(dir, pending.launch)) return yield* no('the bootstrap host exited; resume to replace it')
    const secret = activationId() + activationId()
    yield* activationIO(() => writeLaunchFile(dir, record.generation, pending.launch, 'secret', secret))
    const input = { generation: record.generation, launch: pending.launch, hostVerifier: sha(secret) }
    if (pending.kind === 'activate') yield* appendActivated(by, input)
    else yield* appendHostRebound(by, { ...input, expected: pending.expected! })
    yield* reconcile(dir, record, yield* readState(dir))
    if (pending.kind === 'activate') yield* finishOnboardingStart(dir)
    return pending.kind === 'activate' ? 'Project activated.' : 'Bootstrap host rebound.'
  })

export const runActivation = (dir: string, by: Person, action: 'resume' | 'relaunch' | 'rollback') =>
  locked(dir, Effect.gen(function* () {
    const original = yield* recordAt(dir)
    if (!original || original.owner !== by.name) return yield* no('no activation for this person')
    const state = yield* readState(dir)
    if (state !== null && state.generation !== original.generation) return yield* no('another generation owns the store')
    let record = yield* reconcile(dir, original, state)
    if (action === 'rollback') {
      if (state?.active) return yield* no('an active workflow cannot be rolled back')
      record = { ...record, phase: 'rolling back' }
      yield* save(dir, record)
      if (record.pending) yield* activationIO(() => {
        stopBootstrap(dir, record.pending!.launch)
        removeLaunch(dir, record.generation, record.pending!.launch)
      })
      for (const entry of record.manifest) {
        const outcome = yield* activationIO(() => restoreFile(dir, keptOriginals(record.generation), entry))
        if (outcome._tag === 'Unsafe' || outcome._tag === 'NoOriginal') {
          return yield* no(`cannot restore ${entry.path}: ${outcome._tag}`)
        }
      }
      if (state !== null) yield* deleteInactive(record.generation)
      yield* activationIO(() => {
        applyStartupFiles(dir, record, true)
        removeActivationGeneration(dir, record.generation)
        removeActivationRecord(dir)
      })
      return 'Activation rolled back.'
    }
    if (record.phase === 'rolling back') return yield* no('resume the rollback before starting again')
    if (record.pending) {
      return record.pending.acknowledged
        ? yield* append(dir, by, record)
        : 'Waiting for the bootstrap host to acknowledge.'
    }
    if (state?.active) {
      if (action !== 'relaunch') {
        yield* finishOnboardingStart(dir)
        return 'Project activated.'
      }
      const launch = state.binding?.launch
      if (state.topOpened || !launch || bootstrapAlive(dir, launch)) {
        return yield* no('the pre-top host is not eligible for relaunch')
      }
      return yield* reserve(dir, record, 'rebind', launch)
    }
    if (action === 'relaunch') return yield* no('resume initial activation first')
    yield* checkedMarkers(dir, record)
    if (state === null) {
      yield* activationIO(() => applyStartupFiles(dir, record, false))
      yield* dispatch({
        by,
        input: { _tag: 'DefineWorkflow', target: {},
          content: { directions: record.directions, activation: { generation: record.generation } } },
      })
    }
    for (const entry of record.manifest) {
      const outcome = yield* activationIO(() => markFile(dir, keptOriginals(record.generation), entry))
      if (outcome._tag !== 'Done' && outcome._tag !== 'Written') {
        return yield* no(`cannot mark ${entry.path}: ${outcome._tag}`)
      }
      if (!record.marked.includes(entry.path)) {
        record = { ...record, marked: [...record.marked, entry.path] }
        yield* save(dir, record)
      }
    }
    return yield* reserve(dir, record, 'activate', null)
  }))

const prove = (nonce: string | undefined, hash: string | undefined) =>
  nonce !== undefined && hash !== undefined && sha(nonce) === hash

// Transfer the existing live bootstrap session into the runtime exactly once.
export const acquireBootstrapWorker = (dir: string, worker: string, session: string) =>
  locked(dir, Effect.gen(function* () {
    const events = yield* activationEvents(dir)
    const state = activationOf(events)
    if (!state?.topOpened || state.binding === null || session !== `boot-${state.binding.launch}`) return
    if (foldRuntime(events).workers.has(worker)) return
    const launch = randomUUID().replaceAll('-', '')
    if ((yield* reserveWorker(worker, launch)) === null) return
    const secret = randomUUID().replaceAll('-', '')
    yield* Effect.sync(() => stageWorkerLaunch(dir, launch, 'secret', secret))
    if (bootstrapAlive(dir, state.binding.launch)) {
      yield* bindWorker(worker, 1, launch, session, secret)
    }
  }))

export const bootstrapRequest = (
  dir: string, launch: string, nonce: string | undefined, action: 'ack' | 'wait',
) => locked(dir, Effect.gen(function* () {
  const original = yield* recordAt(dir)
  if (!original) return yield* no('replaced; exit')
  const verifier = original.pending?.launch === launch ? original.pending.nonceVerifier
    : original.committed?.launch === launch ? original.committed.nonceVerifier : undefined
  if (!prove(nonce, verifier)) return yield* no('replaced; exit')
  const events = yield* activationEvents(dir)
  const state = activationOf(events)
  const record = yield* reconcile(dir, original, state)
  if (action === 'ack') {
    if (record.pending?.launch !== launch || !bootstrapAlive(dir, launch)) return yield* no('replaced; exit')
    yield* save(dir, { ...record, pending: { ...record.pending, acknowledged: true } })
    return { line: 'Bootstrap host acknowledged.', token: null, top: false }
  }
  if (state?.binding?.launch !== launch || record.committed?.launch !== launch) {
    if (record.pending?.launch !== launch) return yield* no('replaced; exit')
    return { line: 'Waiting for activation.', token: null, top: false }
  }
  const host = [...foldRuntime(events).workers.values()].find(({ reservation }) => reservation.members.includes('host'))
  if (state.topOpened && (host?.fenced || (host?.reservation.generation ?? 0) > 1 ||
    (foldWork(events)?.state.ep.get('host') ?? 0) !== 0))
    return yield* no('replaced; exit')
  if (record.retired) return { line: 'Bound to the top: work wait <your token>.', token: null, top: true }
  const secret = yield* activationIO(() => readLaunchFile(dir, record.generation, launch, 'secret'))
  if (secret === null || sha(secret) !== state.binding.verifier) return yield* no('the bound launch credential is unavailable')
  return { line: '', token: `w.host.0.${secret}`, top: state.topOpened }
}))

export const retireHostDelivery = (dir: string, token: string) =>
  Effect.gen(function* () {
    if (!token.startsWith('w.host.0.') || (yield* recordAt(dir)) === null) return
    yield* locked(dir, Effect.gen(function* () {
      const events = yield* activationEvents(dir)
      const state = activationOf(events)
      const record = yield* recordAt(dir)
      const folded = foldWork(events)
      const verifier = sha(token.slice('w.host.0.'.length))
      if (!state?.topOpened || state.binding?.verifier !== verifier ||
        (folded?.state.ep.get('host') ?? 0) !== 0 || !record) return
      const current = yield* reconcile(dir, record, state)
      if (current.committed?.launch !== state.binding.launch) return
      if (!current.retired) yield* save(dir, { ...current, retired: true })
      yield* activationIO(() => retireSecret(dir, current.generation, state.binding!.launch))
    }))
  })

export { liveProjectBootstrap, newProjectLaunch, projectActivationFiles, projectActivationOperations } from './project-activation.ts'
