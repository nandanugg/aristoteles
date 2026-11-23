// Runtime offers and lifecycle records share the journal's serialized write boundary.
import { Effect } from 'effect'
import { gate } from './activation.ts'
import { Refusal } from '../schema/errors.ts'
import { admissionFor, stepDemand } from '../derived/c16/admission.ts'
import { readyRecheck } from '../derived/c16/recheck.ts'
import { checkpointBlocksTurn, foldRechecks, routeSettled } from '../state/rechecks.ts'
import { currentOffer, obligationOf, oldestWorkerStep, workerSerialActors } from '../derived/c16/worker.ts'
import { create, NonBlank, type Author, type Recorded, type RuntimeEvent } from '../schema/index.ts'
import { Dir, Now, sha, Store } from '../services/index.ts'
import { foldWork, type WorkFolded } from '../state/c16/fold.ts'
import { epochOf } from '../state/c16/reads.ts'
import { actorOf, type RefusalName } from '../state/c16/types.ts'
import { foldRuntime, slotAvailable } from '../state/worker-runtime.ts'

export const workerRefusal = (kind: RefusalName, message: string) =>
  new Refusal({ refused: kind, words: message, message, next: 'Read the current worker state.',
    choice: { kind: 'Pick', words: NonBlank.make('Read the current worker state.') } })

const SYSTEM = { _tag: 'System' } as const
const SUPERVISOR = { _tag: 'Supervisor', name: 'worker runtime' } as const
export const writeRuntime = (
  select: (events: ReadonlyArray<Recorded>, folded: WorkFolded) =>
    Effect.Effect<RuntimeEvent | null, Refusal>,
  author: Author,
) => Effect.scoped(Effect.gen(function* () {
  const { cwd } = yield* Dir
  const clock = yield* Now
  const store = yield* (yield* Store).open(cwd, { create: false })
  return yield* store.write((events) => Effect.gen(function* () {
    yield* gate(events)
    const folded = foldWork(events)
    if (folded === null) return yield* workerRefusal('legal', 'No top is open.')
    const entry = yield* select(events, folded)
    if (entry === null) return null
    return { draft: { at: yield* clock.read, author, event: create('Runtime', entry) }, rows: [] }
  }))
}))

export const workerSession = (launch: string): string => `worker-${launch}`
export const workerSecretOf = (secret: string, turn: string): string => sha(JSON.stringify([secret, turn]))
export const memberSecretOf = (secret: string, actor: string, epoch: number): string =>
  sha(JSON.stringify([secret, 'member', actor, epoch]))

export const reserveWorker = (worker: string, launch: string) =>
  writeRuntime((events, folded) => Effect.gen(function* () {
    const runtime = foldRuntime(events)
    const { placements, workers } = runtime
    const placement = placements.find((entry) => entry.worker === worker)
    const previous = workers.get(worker)
    if (!placement || folded.state.top.ended || (previous && !previous.ended)) return null
    if (events.some(({ event }) => event._tag === 'Runtime' && event.create._tag === 'WorkerReserved' &&
      event.create.launch === launch)) return null
    if (!slotAvailable(runtime, placement)) return null
    const parked = [...foldRechecks(events).values()].find((job) => job.queued.worker === worker &&
      job.park?._tag === 'WorkerParkConfirmed' && !job.resumed)
    if (parked && ((!parked.checkpoint && !parked.recovery) || !routeSettled(parked, runtime) || (!parked.report && !parked.cancelled))) {
      return null
    }
    const expectedGeneration = previous?.reservation.generation ?? 0
    return {
      _tag: 'WorkerReserved', worker, generation: expectedGeneration + 1, expectedGeneration,
      launch, purpose: parked && !parked.recovery ? 'resume' : 'work',
      ...(parked ? { job: parked.queued.job } : {}),
      ...(parked?.checkpoint && !parked.recovery ? { checkpoint: parked.checkpoint.checkpoint } : {}),
      placement, members: placement.members, slot: `${placement.account}:${launch}`,
    }
  }), SYSTEM)

export const bindWorker = (worker: string, generation: number, launch: string, session: string, secret: string) =>
  writeRuntime((events, folded) => Effect.gen(function* () {
    const current = foldRuntime(events).workers.get(worker)
    if (!current || current.ended || current.fenced || current.reservation.generation !== generation ||
      current.reservation.launch !== launch) return yield* workerRefusal('epoch', 'Worker reservation has ended.')
    if (current.binding !== null) return null
    if (current.reservation.purpose === 'recheck') return yield* workerRefusal('authority', 'A helper cannot bind worker identities.')
    const hostSession = generation === 1 && current.reservation.members.includes('host') ? folded.hostSession : null
    if (session !== (hostSession ?? workerSession(launch))) {
      return yield* workerRefusal('authority', 'Wrong session for the reserved worker.')
    }
    const keepHost = hostSession !== null ? folded.tokens.get('host')?.at(-1) : undefined
    return {
      _tag: 'WorkerBound', worker, generation, launch, session, waitVerifier: sha(secret),
      members: [...current.reservation.members, ...[...foldRuntime(events).serial.values()]
        .filter((entry) => entry.worker === worker &&
          folded.state.makers.get(entry.actor.slice('maker:'.length))?.ended === false)
        .map((entry) => entry.actor)].map((actor) => {
        const epoch = epochOf(folded.state, actorOf(actor))
        return { actor, epoch, verifier: actor === 'host' && keepHost !== undefined
          ? keepHost.hash : sha(memberSecretOf(secret, actor, epoch)) }
      }),
    }
  }), SUPERVISOR)

export const settleWorker = (worker: string, generation: number, launch: string, observation?: string) =>
  writeRuntime((events) => Effect.gen(function* () {
    const current = foldRuntime(events).workers.get(worker)
    if (!current || current.ended || current.parking || current.reservation.generation !== generation ||
      current.reservation.launch !== launch) return null
    if (observation === undefined && !current.fenced) {
      return { _tag: 'WorkerFenced', worker, generation, launch, reason: 'session lost' }
    }
    if (observation !== undefined && current.fenced) {
      return { _tag: 'WorkerEnded', worker, generation, launch, reason: 'session ended',
        session: current.binding?.session ?? (current.reservation.purpose === 'recheck' ? workerSession(launch) : null), observation }
    }
    return null
  }), SUPERVISOR)

export const offerWorker = (worker: string, generation: number, secret: string, abandon = false) =>
  writeRuntime((events, folded) => Effect.gen(function* () {
    const runtime = foldRuntime(events)
    const current = runtime.workers.get(worker)
    if (!current || current.fenced || current.ended || current.reservation.generation !== generation || !current.binding) {
      return yield* workerRefusal('epoch', 'Worker generation is no longer live.')
    }
    if (current.binding.waitVerifier !== sha(secret)) return yield* workerRefusal('authority', 'Wrong worker credential.')
    if (current.parking) return null
    const jobs = foldRechecks(events)
    if (checkpointBlocksTurn(jobs, runtime, current)) return null
    const s = folded.state
    const eligible = (actor: string, step: import('../state/c16/types.ts').Step) =>
      admissionFor(folded, runtime, actor, stepDemand(step)).kind !== 'waiting' &&
      (step.act !== 'RecheckDone' || readyRecheck(s, runtime, jobs, step.task ?? '') !== undefined)
    if (current.offer) {
      if (abandon || !currentOffer(s, current.offer) || !eligible(current.offer.actor, current.offer.step)) {
        return { _tag: 'TurnClosed', worker, generation, turn: current.offer.turn,
          reason: abandon ? 'abandoned' : 'withdrawn' }
      }
      return null
    }
    if (abandon) return null
    const serial = workerSerialActors(s, runtime, worker)
    const pick = s.top.ended ? undefined : oldestWorkerStep(s, [...current.reservation.members, ...serial],
      eligible)
    if (!pick) return null
    const turn = `turn-${(events.at(-1)?.seq ?? 0) + 1}`
    return {
      _tag: 'TurnOffered', worker, generation, turn, actor: pick.actor,
      epoch: epochOf(s, actorOf(pick.actor)), step: pick.step,
      obligation: obligationOf(s, pick.step), on: s.seq,
      receiptVerifier: sha(workerSecretOf(secret, turn)),
    }
  }), SYSTEM)
