import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import {
  bindRecheckHelper, cancelStaleRecheck, canCheckpoint, deferRecheck, helperCredential, queueRecheck,
  requestPark, reserveRecheckChild, reserveRecheckSession, settleRecheckChild,
} from '../actions/recheck.ts'
import { settleWorker, workerSession } from '../actions/worker.ts'
import { SessionId } from '../schema/index.ts'
import { Dir, Env, Pump, readWorkerLaunch, sha, stageWorkerLaunch, Store } from '../services/index.ts'
import { activeRecheck, foldRechecks, routeSettled } from '../state/rechecks.ts'
import { foldRuntime } from '../state/worker-runtime.ts'
import { fill } from './lines.ts'

export interface HelperWords {
  readonly helperAck?: string
  readonly helperPrompt?: (job: string) => string
}

export const superviseRechecks = (say: HelperWords) =>
  Effect.scoped(Effect.gen(function* () {
    const { cwd } = yield* Dir
    const env = yield* Effect.serviceOption(Env)
    const pump = yield* Pump
    const store = yield* (yield* Store).open(cwd, { create: false })
    yield* queueRecheck()
    let events = yield* store.events
    let runtime = foldRuntime(events)
    let job = activeRecheck(foldRechecks(events), runtime)
    if (!job) return
    const id = job.queued.job
    if ((yield* cancelStaleRecheck(id)) !== null) {
      events = yield* store.events
      job = foldRechecks(events).get(id)!
      runtime = foldRuntime(events)
    }
    const route = job.route
    if (route && !routeSettled(job, runtime)) {
      if (route.kind === 'child') {
        yield* settleRecheckChild(id)
        return
      }
      const current = runtime.workers.get(route.allocation)
      if (!current || current.reservation.launch !== route.launch) return
      const sid = SessionId.make(workerSession(route.launch))
      const observe = pump.observe?.(sid) ??
        Effect.map(pump.status, (status) => status[sid]?._tag === 'Live' ? 'live' : 'ended')
      const state = yield* observe
      const { worker, generation, launch } = current.reservation
      if (job.report || job.cancelled || current.fenced || state === 'ended') {
        yield* settleWorker(worker, generation, launch)
        if (state === 'live') yield* Effect.ignore(pump.stop(sid))
        if ((yield* observe) === 'ended') {
          yield* settleWorker(worker, generation, launch, 'Recheck helper session confirmed ended.')
          yield* pump.forget(sid)
          // Keep the freed opportunity for the retry before ordinary workers can take it.
          return !job.report && !job.cancelled ? current.reservation.placement.account : undefined
        }
      } else if (state === 'live' && !job.helper) {
        const secret = readWorkerLaunch(cwd, launch, 'secret')
        if (secret && readWorkerLaunch(cwd, launch, 'ack') === sha(secret)) {
          yield* bindRecheckHelper(id, launch, secret)
        }
      }
      return
    }
    if (job.cancelled || job.taken || job.report || job.park?._tag === 'WorkerParkRequested') return
    if ((yield* reserveRecheckChild(id)) !== null) return
    const launch = randomUUID().replaceAll('-', '')
    if ((yield* reserveRecheckSession(id, launch)) !== null) {
      const held = foldRuntime(yield* store.events).workers.get(`helper:${id}`)?.reservation
      if (!held || held.launch !== launch) return
      const secret = randomUUID().replaceAll('-', '')
      yield* Effect.sync(() => stageWorkerLaunch(cwd, launch, 'secret', secret))
      const sid = SessionId.make(workerSession(launch))
      const db = env._tag === 'Some' ? env.value.vars.ARISTOTELES_DB : undefined
      const prompt = say.helperPrompt?.(id) ?? `Run work recheck-brief ${id} using the helper credential in your environment.`
      const command = fill(held.placement.launch, { session: sid, model: held.placement.model, prompt })
      yield* Effect.ignore(pump.start(sid, {
        command: `${say.helperAck ?? 'work recheck-helper ack'} && ${command}`,
        env: { ...(db === undefined ? {} : { ARISTOTELES_DB: db }), ARISTOTELES_RECHECK_CREDENTIAL: helperCredential(launch, secret) },
        cols: 160, rows: 48,
      }))
      return
    }
    const parent = runtime.workers.get(job.queued.worker)
    const boundParent = parent?.binding && !parent.fenced && !parent.ended ? parent : undefined
    if (boundParent && canCheckpoint(boundParent) && job.park?._tag !== 'WorkerParkConfirmed') {
      if ((yield* requestPark(id)) !== null) return
      yield* deferRecheck(id, job.park?._tag === 'WorkerParkCancelled'
        ? 'The worker stop failed. Waiting for a spare session or a new checkpoint.'
        : 'Waiting for a worker checkpoint or a spare session.')
    } else {
      yield* deferRecheck(id, boundParent && !canCheckpoint(boundParent)
        ? 'Waiting for a compatible child or session slot. Parking needs a checkpoint-capable CLI and a resume profile.'
        : 'Waiting for a compatible child or session slot.')
    }
  }))
