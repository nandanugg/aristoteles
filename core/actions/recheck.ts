import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { dos } from '../derived/c16/obligations.ts'
import { currentRecheck, recheckInput } from '../derived/c16/recheck.ts'
import type { RecheckFinding } from '../schema/index.ts'
import { cliSession, Dir, readWorkerLaunch, sha, stageWorkerLaunch } from '../services/index.ts'
import { activeRecheck, foldRechecks, routeSettled, type RecheckJob } from '../state/rechecks.ts'
import { childLoad, foldRuntime, slotAvailable, type Runtime, type WorkerGeneration } from '../state/worker-runtime.ts'
import { workerRefusal, writeRuntime } from './worker.ts'

const SYSTEM = { _tag: 'System' } as const
const SUPERVISOR = { _tag: 'Supervisor', name: 'worker runtime' } as const
const launchId = () => randomUUID().replaceAll('-', '')
const pipe = { _tag: 'Pipe' } as const
const bad = (words: string) => Effect.fail(workerRefusal('stale', words))
const dispatchable = (runtime: Runtime, job: RecheckJob) =>
  !job.cancelled && !job.taken && job.report === null && routeSettled(job, runtime) &&
  job.park?._tag !== 'WorkerParkRequested'

export const queueRecheck = () =>
  writeRuntime((events, folded) => {
    const runtime = foldRuntime(events)
    const placement = runtime.placements.find(({ members }) => members.includes('pipe'))
    if (!placement || activeRecheck(foldRechecks(events), runtime)) return Effect.succeed(null)
    const step = dos(folded.state, pipe).find((entry) => entry.act === 'RecheckDone')
    const input = step?.task ? recheckInput(folded.state, step.task, events) : null
    if (!input) return Effect.succeed(null)
    const job = `recheck-${(events.at(-1)?.seq ?? 0) + 1}`
    return Effect.succeed({ _tag: 'RecheckQueued', job, pipe: 'pipe', attempt: job,
      worker: placement.worker, ...input, briefDigest: sha(JSON.stringify(input.brief)) })
  }, SYSTEM)

export const cancelStaleRecheck = (id: string) =>
  writeRuntime((events, folded) => {
    const job = foldRechecks(events).get(id)
    return Effect.succeed(job && !job.cancelled && !job.taken && !currentRecheck(folded.state, job)
      ? { _tag: 'RecheckCancelled', job: id, reason: 'The exact result or item/version set is no longer owed.' }
      : null)
  }, SYSTEM)

export const reserveRecheckChild = (id: string) =>
  writeRuntime((events, folded) => {
    const job = foldRechecks(events).get(id)
    const runtime = foldRuntime(events)
    if (!job || !dispatchable(runtime, job) || job.park?._tag === 'WorkerParkConfirmed' ||
      !currentRecheck(folded.state, job)) return Effect.succeed(null)
    const parent = runtime.workers.get(job.queued.worker)
    const member = parent?.binding?.members.find(({ actor }) => actor === 'pipe')
    const limits = folded.policy.get('pipe')
    if (!parent || !member || parent.ended || parent.fenced || parent.parking || !limits?.backgroundChildren ||
      childLoad(runtime, 'pipe') >= limits.subagentAllowance) return Effect.succeed(null)
    const child = `child-${(events.at(-1)?.seq ?? 0) + 1}`
    return Effect.succeed({
      _tag: 'ChildReserved', child, worker: parent.reservation.worker, generation: parent.reservation.generation,
      launch: launchId(), parentActor: 'pipe', parentEpoch: member.epoch,
      attempt: job.queued.attempt, subject: job.queued.task, on: job.queued.on, job: id,
      purpose: 'recheck', execution: 'background', actor: `helper:${child}`, epoch: 0,
    })
  }, SYSTEM)

export const reserveRecheckSession = (id: string, launch: string) =>
  writeRuntime((events, folded) => {
    const job = foldRechecks(events).get(id)
    const runtime = foldRuntime(events)
    if (!job || !dispatchable(runtime, job) || !currentRecheck(folded.state, job)) return Effect.succeed(null)
    if (!/^[a-f0-9]{32}$/.test(launch) || events.some(({ event }) =>
      event._tag === 'Runtime' && event.create._tag === 'WorkerReserved' && event.create.launch === launch)) {
      return Effect.succeed(null)
    }
    const base = runtime.placements.find((entry) => entry.worker === job.queued.worker)
    if (!base || !slotAvailable(runtime, base)) return Effect.succeed(null)
    const worker = `helper:${id}`
    const old = runtime.workers.get(worker)
    if (old && !old.ended) return Effect.succeed(null)
    const expectedGeneration = old?.reservation.generation ?? 0
    return Effect.succeed({ _tag: 'WorkerReserved', worker, launch, expectedGeneration,
      generation: expectedGeneration + 1, purpose: 'recheck', job: id, members: [],
      placement: { ...base, worker, members: [] }, slot: `${base.account}:${launch}` })
  }, SYSTEM)

export const deferRecheck = (id: string, reason: string) =>
  writeRuntime((events, folded) => {
    const job = foldRechecks(events).get(id)
    const runtime = foldRuntime(events)
    if (!job || !dispatchable(runtime, job) || !currentRecheck(folded.state, job)) return Effect.succeed(null)
    const worker = job.queued.worker
    const generation = runtime.workers.get(worker)?.reservation.generation ?? 0
    if (job.deferred?.reason === reason && job.deferred.generation === generation) return Effect.succeed(null)
    return Effect.succeed({ _tag: 'RecheckDeferred', job: id, worker, generation, reason,
      ...(job.checkpoint ? { checkpoint: job.checkpoint.checkpoint } : {}) })
  }, SYSTEM)

export const canCheckpoint = (worker: WorkerGeneration) =>
  worker.reservation.placement.canPark === true && Boolean(worker.reservation.placement.resume)

export const checkpointWorker = (id: string, credential: string, handle: string) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    return yield* writeRuntime((events, folded) => Effect.gen(function* () {
      const job = foldRechecks(events).get(id)
      const runtime = foldRuntime(events)
      if (!job || !currentRecheck(folded.state, job)) return yield* bad('This job is no longer waiting for a checkpoint.')
      const parent = runtime.workers.get(job.queued.worker)
      const match = /^g\.([a-f0-9]{32})\.([1-9][0-9]*)\.([a-f0-9]{32})$/.exec(credential)
      if (!parent?.binding || parent.fenced || parent.ended ||
        match?.[1] !== parent.reservation.launch || Number(match[2]) !== parent.reservation.generation ||
        sha(match[3]!) !== parent.binding.waitVerifier) {
        return yield* workerRefusal('authority', 'The current worker credential is required to checkpoint.')
      }
      if (job.checkpoint?.generation === parent.reservation.generation && job.checkpoint.digest === sha(handle) &&
        job.park?._tag !== 'WorkerParkCancelled') return null
      if (!dispatchable(runtime, job) || parent.parking || job.park?._tag === 'WorkerParkConfirmed') {
        return yield* bad('This job is no longer waiting for a checkpoint.')
      }
      if (!canCheckpoint(parent)) {
        return yield* workerRefusal('legal', 'This CLI has no configured checkpoint and resume route.')
      }
      if (parent.offer || [...runtime.children.values()].some(({ reservation, released }) =>
        reservation.worker === job.queued.worker && released === null)) {
        return yield* workerRefusal('legal', 'Checkpoint at a worker boundary after its turn and children settle.')
      }
      const session = parent.binding.session
      const expected = parent.reservation.checkpoint
        ? readWorkerLaunch(cwd, parent.reservation.checkpoint, 'checkpoint')
        : cliSession(session.startsWith('boot-') ? session.slice('boot-'.length) : session)
      if (handle !== expected) return yield* workerRefusal('authority', 'The checkpoint is not for this native CLI session.')
      const checkpoint = launchId()
      yield* Effect.try({ try: () => stageWorkerLaunch(cwd, checkpoint, 'checkpoint', handle),
        catch: () => workerRefusal('legal', 'The private checkpoint could not be saved.') })
      return { _tag: 'CheckpointSaved', job: id, worker: job.queued.worker,
        generation: parent.reservation.generation, attempt: job.queued.attempt, checkpoint, digest: sha(handle) }
    }), SYSTEM)
  })

export const requestPark = (id: string) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    return yield* writeRuntime((events, folded) => Effect.gen(function* () {
      const job = foldRechecks(events).get(id)
      const runtime = foldRuntime(events)
      if (!job?.checkpoint || !dispatchable(runtime, job) || !currentRecheck(folded.state, job) ||
        job.park?._tag === 'WorkerParkConfirmed' || job.park?.checkpoint === job.checkpoint.checkpoint) return null
      const worker = runtime.workers.get(job.queued.worker)
      if (!worker?.binding || worker.fenced || worker.ended || worker.offer || !canCheckpoint(worker) ||
        slotAvailable(runtime, worker.reservation.placement) ||
        worker.reservation.generation !== job.checkpoint.generation ||
        [...runtime.children.values()].some(({ reservation, released }) =>
          reservation.worker === job.queued.worker && released === null)) return null
      const handle = readWorkerLaunch(cwd, job.checkpoint.checkpoint, 'checkpoint')
      if (!handle || sha(handle) !== job.checkpoint.digest) return null
      return { _tag: 'WorkerParkRequested', job: id, worker: worker.reservation.worker,
        generation: worker.reservation.generation, launch: worker.reservation.launch,
        checkpoint: job.checkpoint.checkpoint }
    }), SYSTEM)
  })

export const settlePark = (id: string, launch: string, observation: 'ended' | 'stop failed') =>
  writeRuntime((events) => {
    const job = foldRechecks(events).get(id)
    const park = job?.park
    if (park?._tag !== 'WorkerParkRequested' || park.launch !== launch) return Effect.succeed(null)
    const worker = foldRuntime(events).workers.get(park.worker)
    if (!worker?.binding || worker.parking?.launch !== launch || worker.ended ||
      worker.reservation.generation !== park.generation) return Effect.succeed(null)
    const { _tag: _, ...same } = park
    return Effect.succeed(observation === 'ended'
      ? { ...same, _tag: 'WorkerParkConfirmed', session: worker.binding.session, observation: 'Managed session confirmed ended.' }
      : { ...same, _tag: 'WorkerParkCancelled', reason: 'Stop failed while the exact session remained live.',
        observation: 'Stop failed and the current session was observed live.' })
  }, SUPERVISOR)

export const helperCredential = (launch: string, secret: string) => `h.${launch}.${secret}`
export const helperProof = (token: string) => /^h\.([a-f0-9]{32})\.([a-f0-9]{32})$/.exec(token)

const routeLive = (runtime: Runtime, job: RecheckJob): boolean => {
  const route = job.route
  if (!route) return false
  if (route.kind === 'child') {
    const child = runtime.children.get(route.allocation)
    const parent = child && runtime.workers.get(child.reservation.worker)
    return child?.reservation.launch === route.launch && child.binding !== null && !child.released &&
      parent?.binding != null && !parent.fenced && !parent.ended && !parent.parking &&
      parent.reservation.generation === child.reservation.generation
  }
  const worker = runtime.workers.get(route.allocation)
  return worker?.reservation.launch === route.launch && !worker.fenced && !worker.ended
}

export const bindRecheckHelper = (id: string, launch: string, secret: string) =>
  writeRuntime((events, folded) => {
    const runtime = foldRuntime(events)
    const job = foldRechecks(events).get(id)
    const route = job?.route
    if (!job || !route || job.cancelled || job.taken || job.report || route.launch !== launch ||
      !routeLive(runtime, job) || !currentRecheck(folded.state, job)) return bad('The recheck allocation is no longer current.')
    const hash = sha(secret)
    if (route.kind === 'child' && runtime.children.get(route.allocation)?.binding?.verifier !== hash) {
      return Effect.fail(workerRefusal('authority', 'This child has no authority for the recheck.'))
    }
    if (job.helper?.launch === launch) return Effect.succeed(null)
    return Effect.succeed({ _tag: 'RecheckHelperBound', job: id, helper: `helper-${launch}`, route: route.kind,
      allocation: route.allocation, launch, verifier: hash })
  }, SUPERVISOR)

export const acknowledgeRecheckChild = (token: string) =>
  Effect.gen(function* () {
    const match = helperProof(token)
    if (!match) return yield* workerRefusal('authority', 'Supply a recheck helper credential.')
    const launch = match[1]!
    const secret = match[2]!
    let jobId: string | undefined
    yield* writeRuntime((events, folded) => {
      const runtime = foldRuntime(events)
      const job = [...foldRechecks(events).values()].find((j) => j.route?.launch === launch && j.route.kind === 'child')
      if (!job || job.cancelled || job.taken || job.report || !currentRecheck(folded.state, job) ||
        job.route?.kind !== 'child') return bad('This recheck child is no longer owed.')
      const child = runtime.children.get(job.route.allocation)
      const reservation = child?.reservation
      const parent = reservation && runtime.workers.get(reservation.worker)
      if (!child?.started || child.released || child.started.verifier !== sha(secret) ||
        !parent?.binding || parent.fenced || parent.ended || parent.parking ||
        parent.reservation.generation !== reservation?.generation) {
        return Effect.fail(workerRefusal('authority', 'The recheck child launch is not authorized.'))
      }
      jobId = job.queued.job
      return Effect.succeed(child.binding ? null : {
        _tag: 'ChildBound', child: reservation.child, worker: reservation.worker,
        generation: reservation.generation, launch, handle: launch, verifier: child.started.verifier,
      })
    }, SUPERVISOR)
    if (!jobId) return yield* Effect.die('Bound child has no recheck job.')
    yield* bindRecheckHelper(jobId, launch, secret)
  })

export const recheckHelperMatches = (job: RecheckJob, token: string): boolean => {
  const match = helperProof(token)
  return match !== null && job.helper?.launch === match[1] && job.helper?.verifier === sha(match[2]!)
}

export const helperMayRead = (job: RecheckJob, runtime: Runtime, token: string): boolean =>
  !job.cancelled && !job.taken && routeLive(runtime, job) && recheckHelperMatches(job, token)

export interface HelperReport {
  readonly on: number
  readonly findings: ReadonlyArray<RecheckFinding>
}

export const reportRecheck = (id: string, token: string, report: HelperReport) =>
  Effect.gen(function* () {
    let answer: string | undefined
    yield* writeRuntime((events, folded) => {
      const job = foldRechecks(events).get(id)
      if (!job || !recheckHelperMatches(job, token)) {
        return Effect.fail(workerRefusal('authority', 'This credential does not belong to the recheck helper.'))
      }
      const supplied = [...report.findings].sort((a, b) => a.item < b.item ? -1 : a.item > b.item ? 1 : 0)
      if (job.report) {
        if (job.report.on === report.on && JSON.stringify(job.report.findings) === JSON.stringify(supplied)) {
          answer = job.report.report
          return Effect.succeed(null)
        }
        return Effect.fail(workerRefusal('legal', 'This helper already submitted a different report.'))
      }
      if (job.cancelled || job.taken || !routeLive(foldRuntime(events), job) ||
        !currentRecheck(folded.state, job)) return bad('The result or rules changed before this report.')
      if (report.on !== job.queued.on) return Effect.fail(workerRefusal('basis', 'Use the original recheck basis.'))
      const versions = new Map(supplied.map(({ item, version }) => [item, version]))
      if (supplied.length !== job.queued.items.length || versions.size !== supplied.length ||
        !job.queued.items.every(([item, version]) => versions.get(item) === version) ||
        supplied.some(({ evidence }) => !evidence.trim() || /\b(?:h|g|w)\.[a-z0-9:.]+\.[a-z0-9]{16,}\b/i.test(evidence))) {
        return Effect.fail(workerRefusal('form', 'Report evidence for every exact item and version, once.'))
      }
      answer = `report-${(events.at(-1)?.seq ?? 0) + 1}`
      return Effect.succeed({ _tag: 'RecheckReported', job: id, helper: job.helper!.helper,
        report: answer, on: report.on, items: job.queued.items, findings: supplied })
    }, SYSTEM)
    return answer!
  })

export const settleRecheckChild = (id: string) =>
  writeRuntime((events) => {
    const job = foldRechecks(events).get(id)
    if (job?.route?.kind !== 'child') return Effect.succeed(null)
    const child = foldRuntime(events).children.get(job.route.allocation)
    if (!child || child.released || child.started || !job.cancelled) {
      return Effect.succeed(null)
    }
    const { child: childId, worker, generation, launch } = child.reservation
    return Effect.succeed({ _tag: 'ChildReleased', child: childId, worker, generation, launch,
      reason: 'never launched', observation: 'The cancelled child never received a launch.' })
  }, SUPERVISOR)


// Recovery retires the old report and restores the logical worker in a fresh context.
// Keep both the parked generation and its helper allocation settled before recording it.
export const recoverParkedWorker = (id: string, reason: string) =>
  writeRuntime((events) => {
    const runtime = foldRuntime(events)
    const job = foldRechecks(events).get(id)
    const park = job?.park
    if (!job || park?._tag !== 'WorkerParkConfirmed' || job.resumed || job.recovery ||
      !routeSettled(job, runtime) || (!job.cancelled && !job.report)) return Effect.succeed(null)
    const worker = runtime.workers.get(park.worker)
    if (!worker?.ended || worker.reservation.generation < park.generation) return Effect.succeed(null)
    return Effect.succeed({
      _tag: 'WorkerRecoveryRequested', job: id, worker: park.worker,
      generation: park.generation, checkpoint: park.checkpoint, reason,
    })
  }, SYSTEM)
