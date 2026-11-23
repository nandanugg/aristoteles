// Recovery projects pending jobs and their single allocation from the journal.
import type { Recorded, RuntimeEvent } from '../schema/index.ts'
import { slotAvailable, type Runtime, type WorkerGeneration } from './worker-runtime.ts'

type Event<Tag extends RuntimeEvent['_tag']> = Extract<RuntimeEvent, { _tag: Tag }>
export type RecheckQueued = Event<'RecheckQueued'>
export type ParkRecord = Event<'WorkerParkRequested' | 'WorkerParkConfirmed' | 'WorkerParkCancelled'>
export interface RecheckRoute {
  readonly kind: 'child' | 'session'
  readonly allocation: string
  readonly launch: string
}
export interface RecheckJob {
  readonly queued: RecheckQueued
  readonly checkpoint: Event<'CheckpointSaved'> | null
  readonly park: ParkRecord | null
  readonly deferred: Event<'RecheckDeferred'> | null
  readonly route: RecheckRoute | null
  readonly helper: Event<'RecheckHelperBound'> | null
  readonly report: Event<'RecheckReported'> | null
  readonly cancelled: boolean
  readonly taken: boolean
  readonly resumed: boolean
}

export const foldRechecks = (events: ReadonlyArray<Recorded>) => {
  const jobs = new Map<string, RecheckJob>()
  const resuming = new Map<string, string>()
  const change = (id: string, patch: Partial<RecheckJob>) => {
    const job = jobs.get(id)
    if (job) jobs.set(id, { ...job, ...patch })
  }
  for (const { event } of events) {
    if (event._tag === 'Work' && event.create._tag === 'Acted' && event.create.recheck) {
      change(event.create.recheck.job, { taken: true })
    }
    if (event._tag !== 'Runtime') continue
    const e = event.create
    switch (e._tag) {
      case 'RecheckQueued':
        jobs.set(e.job, { queued: e, checkpoint: null, park: null, deferred: null, route: null,
          helper: null, report: null, cancelled: false, taken: false, resumed: false })
        break
      case 'CheckpointSaved': change(e.job, { checkpoint: e }); break
      case 'WorkerParkRequested':
      case 'WorkerParkConfirmed':
      case 'WorkerParkCancelled': change(e.job, { park: e }); break
      case 'RecheckDeferred': change(e.job, { deferred: e }); break
      case 'ChildReserved':
        if (e.purpose === 'recheck' && e.job) {
          change(e.job, { route: { kind: 'child', allocation: e.child, launch: e.launch }, helper: null, deferred: null })
        }
        break
      case 'WorkerReserved':
        if (e.purpose === 'recheck' && e.job) {
          change(e.job, { route: { kind: 'session', allocation: e.worker, launch: e.launch }, helper: null, deferred: null })
        } else if (e.purpose === 'resume' && e.job) {
          resuming.set(e.launch, e.job)
        }
        break
      case 'WorkerBound': {
        const id = resuming.get(e.launch)
        if (id) change(id, { resumed: true })
        break
      }
      case 'RecheckHelperBound': change(e.job, { helper: e }); break
      case 'RecheckReported': change(e.job, { report: e }); break
      case 'RecheckCancelled': change(e.job, { cancelled: true }); break
    }
  }
  return jobs
}

export const routeSettled = (job: RecheckJob, runtime: Runtime): boolean => {
  const route = job.route
  if (!route) return true
  if (route.kind === 'child') return runtime.children.get(route.allocation)?.released != null
  const allocation = runtime.workers.get(route.allocation)
  return allocation?.reservation.launch === route.launch && allocation.ended
}

export const activeRecheck = (jobs: ReadonlyMap<string, RecheckJob>, runtime: Runtime) =>
  [...jobs.values()].find((job) =>
    (!job.cancelled && !job.taken) || !routeSettled(job, runtime) ||
    (job.park?._tag === 'WorkerParkConfirmed' && !job.resumed))


export const checkpointBlocksTurn = (
  jobs: ReadonlyMap<string, RecheckJob>, runtime: Runtime, worker: WorkerGeneration,
): boolean => [...jobs.values()].some((job) => job.queued.worker === worker.reservation.worker &&
  !job.cancelled && !job.taken && !job.report && routeSettled(job, runtime) &&
  job.checkpoint?.generation === worker.reservation.generation &&
  job.park?.checkpoint !== job.checkpoint.checkpoint && !slotAvailable(runtime, worker.reservation.placement))
