// Allowlisted observation of the agreed pass 9 journal. The runtime adapter extracts
// these fields from decoded rows, so evidence never includes raw secrets or verifiers.
import { type Intake, type PermitsRead, type Turn, type WorkerRead, sameTurn } from './project.ts'

type ItemVersions = ReadonlyArray<readonly [item: string, version: number]>
type Launch = { readonly worker: string; readonly generation: number; readonly launch: string }
type Child = { readonly child: string; readonly worker: string; readonly generation: number; readonly launch: string }
export type RuntimeRow =
  | (Launch & { readonly kind: 'WorkerReserved'; readonly slot: string; readonly job?: string })
  | (Launch & { readonly kind: 'WorkerBound' | 'WorkerFenced' | 'WorkerEnded' })
  | (Launch & { readonly kind: 'WorkerParkRequested' | 'WorkerParkConfirmed' | 'WorkerParkCancelled'; readonly job: string })
  | { readonly kind: 'TurnOffered'; readonly scope: Turn }
  | Pick<Turn, 'worker' | 'generation' | 'turn'> & { readonly kind: 'TurnClosed' }
  | (Child & { readonly kind: 'ChildReserved'; readonly subject: number; readonly role: number; readonly job?: string })
  | (Child & { readonly kind: 'ChildBound' })
  | (Child & { readonly kind: 'ChildReleased' })
  | { readonly kind: 'RecheckQueued'; readonly job: string; readonly target: number; readonly on: number; readonly items: ItemVersions }
  | { readonly kind: 'CheckpointSaved' | 'RecheckDeferred' | 'RecheckCancelled'; readonly job: string }
  | { readonly kind: 'RecheckHelperBound'; readonly job: string; readonly allocation: string; readonly route: 'child' | 'fresh' }
  | { readonly kind: 'RecheckReported'; readonly job: string; readonly report: string; readonly on: number; readonly items: ItemVersions }
  | { readonly kind: 'Work.Acted'; readonly delivery: Turn | null; readonly recheck?: { readonly job: string; readonly report: string }; readonly child?: Extract<RuntimeRow, { kind: 'ChildReserved' }> }

export interface JournalRow {
  readonly seq: number
  readonly event: RuntimeRow
}

interface Worker {
  readonly generation: number
  readonly launch: string
  readonly slot: string
  readonly job?: string
  readonly state: 'Reserved' | 'Online' | 'Fenced' | 'Exited' | 'Parked'
  readonly turn: Turn | null
}

interface Job {
  readonly target: number
  readonly on: number
  readonly items: ItemVersions
  readonly checkpoint: boolean
  readonly park: 'none' | 'requested' | 'confirmed'
  readonly deferred: boolean
  readonly allocation: string | null
  readonly helper: 'none' | 'child' | 'fresh'
  readonly report: string | null
}

// Project by keys rather than counting starts minus exits. Repeated and old-generation
// observations must never appear to free the newest generation's resource.
export const readJournal = (rows: ReadonlyArray<JournalRow>) => {
  const workers = new Map<string, Worker>()
  const children = new Map<string, Extract<RuntimeRow, { kind: 'ChildReserved' }> & { readonly bound: boolean }>()
  const jobs = new Map<string, Job>()
  const reserveChild = (event: Extract<RuntimeRow, { kind: 'ChildReserved' }>) => {
    const worker = workers.get(event.worker)
    if (worker?.generation !== event.generation || worker.state !== 'Online') {
      throw new Error('child reserved outside a live parent generation')
    }
    if (children.has(event.child)) throw new Error('child charged twice')
    children.set(event.child, { ...event, bound: false })
  }
  const currentHelper = (allocation: string | null, route: 'none' | 'child' | 'fresh'): string | undefined => {
    if (allocation === null) return undefined
    if (route === 'fresh') {
      const worker = workers.get(allocation)
      return worker?.state === 'Online' ? worker.job : undefined
    }
    const child = children.get(allocation)
    if (!child?.bound) return undefined
    const worker = workers.get(child.worker)
    return worker?.state === 'Online' && worker.generation === child.generation ? child.job : undefined
  }
  let last = -1
  for (const { seq, event } of rows) {
    if (seq <= last) throw new Error('runtime journal positions are not in order')
    last = seq
    if (event.kind === 'WorkerReserved') {
      const prior = workers.get(event.worker)
      if (prior && (prior.generation >= event.generation || !['Exited', 'Parked'].includes(prior.state))) {
        throw new Error('new reservation before previous worker settled')
      }
      workers.set(event.worker, { ...event, state: 'Reserved', turn: null })
    } else if (event.kind === 'TurnOffered') {
      const worker = workers.get(event.scope.worker)
      if (!worker || worker.state !== 'Online' || worker.generation !== event.scope.generation || worker.turn !== null) {
        throw new Error('overlapping offer or offer on an offline generation')
      }
      workers.set(event.scope.worker, { ...worker, turn: event.scope })
    } else if (event.kind === 'TurnClosed' || event.kind === 'Work.Acted') {
      const scope = event.kind === 'TurnClosed' ? event : event.delivery
      if (scope) {
        const worker = workers.get(scope.worker)
        if (!worker || worker.generation !== scope.generation || worker.turn?.turn !== scope.turn) {
          throw new Error('turn was closed outside its generation')
        }
        if (event.kind === 'Work.Acted' && !sameTurn(event.delivery, worker.turn)) {
          throw new Error('accepted act journaled a different turn')
        }
        workers.set(scope.worker, { ...worker, turn: null })
      }
      if (event.kind === 'Work.Acted') {
        if (event.child) reserveChild(event.child)
        if (event.recheck) {
          if (jobs.get(event.recheck.job)?.report !== event.recheck.report) {
            throw new Error('verdict without its current report')
          }
          jobs.delete(event.recheck.job)
        }
      }
    } else if (event.kind === 'ChildReserved') {
      reserveChild(event)
    } else if (event.kind === 'ChildBound' || event.kind === 'ChildReleased') {
      const child = children.get(event.child)
      const matches = child?.worker === event.worker && child.generation === event.generation && child.launch === event.launch
      if (event.kind === 'ChildReleased') {
        if (matches) children.delete(event.child)
      } else {
        const worker = workers.get(event.worker)
        if (!matches || child.bound || worker?.state !== 'Online' || worker.generation !== event.generation) {
          throw new Error('child bound without its live reservation')
        }
        children.set(event.child, { ...child, bound: true })
      }
    } else if (event.kind === 'RecheckQueued') {
      if (jobs.has(event.job)) throw new Error('job queued twice')
      jobs.set(event.job, {
        target: event.target, on: event.on, items: event.items, checkpoint: false, park: 'none',
        deferred: false, allocation: null, helper: 'none', report: null,
      })
    } else if ('launch' in event) {
      const worker = workers.get(event.worker)
      if (worker?.generation !== event.generation || worker.launch !== event.launch) {
        throw new Error('journal applied a stale worker observation')
      }
      const state = event.kind === 'WorkerBound' ? 'Online'
        : event.kind === 'WorkerEnded' ? 'Exited'
        : event.kind === 'WorkerFenced' ? 'Fenced'
        : event.kind === 'WorkerParkConfirmed' ? 'Parked' : worker.state
      workers.set(event.worker, { ...worker, state, turn: null })
      if ('job' in event) {
        const job = jobs.get(event.job)
        if (!job) throw new Error('park event without job')
        if (event.kind === 'WorkerParkRequested' ? !job.checkpoint : job.park !== 'requested') {
          throw new Error('park lifecycle is missing its checkpoint or request')
        }
        const park = event.kind === 'WorkerParkConfirmed' ? 'confirmed'
          : event.kind === 'WorkerParkRequested' ? 'requested' : 'none'
        jobs.set(event.job, { ...job, park })
      }
    } else {
      const job = jobs.get(event.job)
      if (!job) throw new Error('recheck event without job')
      if (event.kind === 'RecheckCancelled') jobs.delete(event.job)
      else if (event.kind === 'CheckpointSaved') jobs.set(event.job, { ...job, checkpoint: true })
      else if (event.kind === 'RecheckDeferred') jobs.set(event.job, { ...job, deferred: true })
      else if (event.kind === 'RecheckReported') {
        const expected = new Map(job.items)
        const observed = new Map(event.items)
        if (currentHelper(job.allocation, job.helper) !== event.job || job.report !== null || event.on !== job.on ||
          event.items.length !== job.items.length || observed.size !== expected.size ||
          [...observed].some(([item, version]) => expected.get(item) !== version)) {
          throw new Error('report changed its original basis or exact items, or lacked an allocation')
        }
        jobs.set(event.job, { ...job, report: event.report })
      } else if (event.kind === 'RecheckHelperBound') {
        if (currentHelper(event.allocation, event.route) !== event.job || job.allocation !== null) {
          throw new Error('helper did not use a bound fresh allocation for its job')
        }
        jobs.set(event.job, { ...job, helper: event.route, allocation: event.allocation })
      }
    }
  }
  const held = (w: Worker) => w.state !== 'Exited' && w.state !== 'Parked'
  return {
    worker: (id: string, read: Pick<WorkerRead, 'owed' | 'printed'>): WorkerRead => {
      const w = workers.get(id)
      if (!w) throw new Error(`no journal worker ${id}`)
      return {
        worker: id, generation: w.generation, activeTurn: w.turn, ...read,
        session: w.state === 'Online' ? 'Online' : w.state === 'Parked' ? 'Parked' : 'Exited',
      }
    },
    slots: [...workers.values()].filter(held).map(({ slot }) => slot),
    children: [...children.values()],
    job: (id: string): PermitsRead['job'] => {
      const job = jobs.get(id)
      if (!job) return null
      const allocation = job.allocation
      const fresh = allocation === null ? undefined : workers.get(allocation)
      return { ...job, reported: job.report !== null, helperLive: allocation !== null &&
        (job.helper === 'child' ? children.has(allocation) : fresh !== undefined && held(fresh)) }
    },
  }
}

export const intakeOf = (
  rows: ReadonlyArray<JournalRow>, since: number,
  answer: Pick<Intake, 'requested' | 'credential' | 'outcome' | 'refused'>,
): Intake => {
  const acts = rows.flatMap(({ event, seq }) =>
    event.kind === 'Work.Acted' && seq > since ? [event] : [])
  return { ...answer, committed: acts[0]?.delivery ?? null, actsAppended: acts.length }
}
