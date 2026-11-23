// Runtime-side observations. Adapters populate these from the dispatcher response, actual
// journal and wait output. Fixture-local numbers name subjects; generation/epoch/basis retain
// their runtime values. A printed receipt is tracked even when the supervisor fenced its offer.
import { type Cmp } from '../../c16/replay/model.ts'
import type {
  AdmissionView, Identity, JobPhase, PermitsView, Phase, Route, Session, TaskPhase, WorkerView,
} from './model.ts'

export interface Turn {
  readonly worker: string
  readonly generation: number
  readonly actor: Identity
  readonly epoch: number
  readonly turn: string
  readonly obligation: string
  readonly on: number
  readonly step: string
}
export interface Owed {
  readonly actor: Identity
  readonly obligation: string
  readonly age: number
  readonly ready: boolean
}
export interface WorkerRead {
  readonly session: Session
  readonly worker: string
  readonly generation: number
  readonly owed: ReadonlyArray<Owed>
  readonly activeTurn: Turn | null
  readonly printed: { readonly scope: Turn; readonly tokenActor: Identity; readonly tokenEpoch: number } | null
}
export interface Intake {
  readonly requested: Turn | null
  readonly credential: { readonly actor: Identity; readonly epoch: number; readonly generation: number } | null
  readonly outcome: 'taken' | 'retry' | 'refused'
  readonly refused?: string
  // Only for a taking call. Read the committed Acted's delivery, not the submitted request.
  readonly committed: Turn | null
  readonly actsAppended: number
}
export interface WorkerObservation {
  readonly read: WorkerRead
  readonly intake?: Intake
}

const require = (truth: unknown, message: string) => {
  if (!truth) throw new Error(message)
}
export const sameTurn = (a: Turn | null, b: Turn | null): boolean => a !== null && b !== null &&
  a.worker === b.worker && a.generation === b.generation && a.actor === b.actor &&
  a.epoch === b.epoch && a.turn === b.turn && a.obligation === b.obligation && a.on === b.on &&
  a.step === b.step
const sorted = <A extends string | number>(xs: Iterable<A>): ReadonlyArray<A> => [...xs].sort()

export const checkIntake = (before: WorkerRead, after: WorkerRead, intake: Intake): void => {
  require(intake.actsAppended === (intake.outcome === 'taken' ? 1 : 0), 'wrong number of C16 acts appended')
  const active = before.activeTurn
  const requested = intake.requested
  const credential = intake.credential
  const currentCredential = active !== null && credential !== null &&
    credential.actor === active.actor && credential.epoch === active.epoch && credential.generation === active.generation
  if (intake.outcome !== 'taken') {
    require(intake.committed === null, 'non-taking intake returned a committed turn')
    // A matching authenticated request can be refused for basis and release the offer.
    // A receipt, identity or subject mismatch must preserve it.
    const matched = active !== null && requested !== null && currentCredential &&
      requested.worker === active.worker && requested.generation === active.generation &&
      requested.turn === active.turn && requested.actor === active.actor && requested.step === active.step
    if (intake.outcome === 'refused' && active && !matched) {
      require(sameTurn(active, after.activeTurn), 'wrong submission cleared the active turn')
    }
    return
  }
  require(sameTurn(intake.requested, before.activeTurn), 'act took without its selected turn')
  require(sameTurn(intake.committed, before.activeTurn), 'accepted act journaled a different turn')
  require(currentCredential, 'accepted act with a credential outside the selected identity, epoch or generation')
  require(intake.requested?.generation === before.generation && before.session === 'Online',
    'accepted act from an offline or old generation')
  require(after.activeTurn === null, 'accepted act left the turn open')
  require(!after.owed.some((item) => item.obligation === intake.requested?.obligation),
    'accepted step left the selected obligation owed')
}

// The finite U1 model has at most one ready obligation per identity. Ineligible real work
// stays visible in Owed, but is outside this instance's ready queue.
export const workerProjector = () => {
  const heard = new Set<Identity>()
  let carried = new Set<string>()
  let previous: WorkerRead | undefined
  let yielded = false
  let refused = false
  let afterPark = false
  return ({ read, intake }: WorkerObservation): WorkerView => {
    const ready = read.owed.filter((item) => item.ready).sort((a, b) =>
      a.age - b.age || a.actor.localeCompare(b.actor))
    const queue = ready.map(({ actor }) => actor)
    require(new Set(queue).size === queue.length, 'U1 instance has several obligations for one actor')
    const online = read.session === 'Online'
    const printed = read.printed
    if (read.activeTurn) {
      require(online && read.activeTurn.generation === read.generation &&
        read.activeTurn.worker === read.worker, 'active turn on a fenced worker')
      if (!sameTurn(previous?.activeTurn ?? null, read.activeTurn)) {
        require(ready[0]?.obligation === read.activeTurn.obligation, 'wait skipped the oldest ready obligation')
        if (previous) require(Bun.deepEquals(previous.owed, read.owed), 'offering a turn consumed or changed an obligation')
      }
    }
    if (previous) {
      if (previous.session !== 'Online' && online) {
        require(read.generation > previous.generation, 'resume reused the previous generation')
      }
      if (previous.session !== 'Parked' && read.session === 'Parked') {
        carried = new Set(read.owed.filter((item) => item.actor !== 'Role').map((item) => item.obligation))
      }
      if (intake) {
        checkIntake(previous, read, intake)
        if (intake.outcome === 'taken' && intake.requested) {
          heard.add(intake.requested.actor)
          yielded ||= queue.length > 0
          afterPark ||= carried.has(intake.requested.obligation)
        }
        refused ||= intake.outcome === 'refused'
      }
    }
    if (printed) require(printed.tokenActor === printed.scope.actor && printed.tokenEpoch === printed.scope.epoch,
      'wait printed a credential for a different identity or epoch')
    previous = read
    return {
      queue, session: read.session, heard: sorted(heard), yielded, refused, afterPark,
      delivery: printed ? {
        actor: printed.scope.actor, tokenActor: printed.tokenActor,
        current: sameTurn(printed.scope, read.activeTurn) &&
          online && read.owed.some(({ obligation }) => obligation === printed.scope.obligation),
      } : null,
    }
  }
}

export interface AdmissionRead {
  readonly tasks: ReadonlyArray<{ readonly id: number; readonly phase: TaskPhase; readonly owner: number }>
  readonly jobs: ReadonlyArray<{ readonly id: number; readonly phase: JobPhase }>
  readonly attempts: ReadonlyArray<{ readonly subject: number; readonly owner: number }>
  readonly children: ReadonlyArray<{ readonly subject: number; readonly owner: number }>
  readonly fixes: ReadonlyArray<number>
  readonly rechecks: ReadonlyArray<number>
  readonly event?: { readonly kind: 'pipeDenied' | 'serialReviewed' }
}
export const admissionProjector = (pipeCap: number) => {
  let deniedPipe = false
  let serialReviewed = false
  let recheckBesideFix = false
  return (read: AdmissionRead): AdmissionView => {
    for (const [name, values] of [
      ['attempt', read.attempts.map(({ subject }) => subject)],
      ['child', read.children.map(({ subject }) => subject)],
      ['fix', read.fixes], ['recheck', read.rechecks],
    ] as const) require(new Set(values).size === values.length, `duplicate ${name} allocation`)
    require(read.fixes.length <= pipeCap, 'Pipe fix cap exceeded')
    require(read.rechecks.every((job) => !read.fixes.includes(job)), 'recheck charged as a fix')
    for (const allocation of [...read.attempts, ...read.children]) {
      require(read.tasks.find((task) => task.id === allocation.subject)?.owner === allocation.owner,
        'allocation charged to a different role')
    }
    deniedPipe ||= read.event?.kind === 'pipeDenied'
    serialReviewed ||= read.event?.kind === 'serialReviewed'
    recheckBesideFix ||= read.rechecks.length > 0 && read.fixes.length === pipeCap
    return {
      tasks: Object.fromEntries(read.tasks.map(({ id, phase }) => [id, phase])),
      owners: Object.fromEntries(read.tasks.map(({ id, owner }) => [id, owner])),
      jobs: Object.fromEntries(read.jobs.map(({ id, phase }) => [id, phase])),
      children: sorted(read.children.map(({ subject }) => subject)),
      role: sorted(read.attempts.map(({ subject }) => subject)),
      pipe: sorted(read.fixes), lane: sorted(read.rechecks), deniedPipe, recheckBesideFix, serialReviewed,
    }
  }
}

// The replay port exposes observable resources and durable job facts rather than asking the
// runtime to assign itself a Quint phase. The caller supplies a C16 projection from the same read.
export interface PermitsRead {
  readonly protocol: Cmp
  readonly attempts: ReadonlyArray<number>
  readonly makerChildren: ReadonlyArray<number>
  readonly parkSupported: boolean
  readonly worker: { readonly online: boolean; readonly foreground: boolean }
  readonly slots: ReadonlyArray<string>
  readonly job: {
    readonly target: number
    readonly checkpoint: boolean
    readonly park: 'none' | 'requested' | 'confirmed'
    readonly deferred: boolean
    readonly helper: 'none' | 'child' | 'fresh'
    readonly helperLive: boolean
    readonly reported: boolean
  } | null
}

export const permitsProject = (read: PermitsRead): PermitsView => {
  const job = read.job
  const route: Route = !job || job.helper === 'none' ? 'NoContext' :
    job.helper === 'child' ? 'ChildContext' : 'FreshContext'
  let phase: Phase = 'NoHelper'
  if (job) {
    if (job.reported) phase = read.worker.online ? 'ReportReady' : 'ResumeParent'
    else if (job.helper === 'child') phase = 'RecheckChild'
    else if (job.helper === 'fresh') phase = 'FreshSession'
    else if (job.park === 'confirmed' || job.deferred && !read.worker.online) phase = 'Parked'
    else if (job.park === 'requested') phase = 'ParkRequested'
    else if (job.deferred) phase = 'Deferred'
    // The finite model routes an unsupported CLI through the same planning phase.
    // The runtime has not saved a durable checkpoint in that case.
    else if (job.checkpoint || !read.parkSupported) phase = 'Checkpointed'
    else throw new Error('job observation has no modeled scheduler phase')
  }
  require(new Set(read.slots).size === read.slots.length, 'slot counted twice')
  return {
    protocol: read.protocol, phase, route, target: job?.target ?? -1,
    providerSlots: read.slots.length, roleAttempts: sorted(read.attempts),
    roleChildren: sorted(read.makerChildren), pipeChildren: job?.helper === 'child' && job.helperLive ? 1 : 0,
    workerFree: read.worker.online && !read.worker.foreground,
  }
}
