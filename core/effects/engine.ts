import { randomUUID } from 'node:crypto'
// The engine supervises one process per recorded worker generation. The C16 harness also
// runs test-command evidence that is owed in the folded record.
import { isInactive } from '../actions/activation.ts'
import { Effect, Ref } from 'effect'
import { settleGenerationChildren } from '../actions/child.ts'
import { bindWorker, reserveWorker, settleWorker, workerSession } from '../actions/worker.ts'
import { foldRuntime } from '../state/worker-runtime.ts'
import { activationLock, readWorkerLaunch, stageWorkerLaunch } from '../services/index.ts'
import { folding } from '../actions/dispatch.ts'
import { dispatchAct } from '../actions/work.ts'
import { dos } from '../derived/c16/obligations.ts'
import { type Author, SessionId } from '../schema/index.ts'
import { Dir, Env, Pump, sha, Store } from '../services/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { type ActorKey } from '../state/c16/types.ts'
import { nowMs } from './acting.ts'
import { fill } from './lines.ts'
import { superviseRechecks, type HelperWords } from './recheck.ts'
import { settlePark } from '../actions/recheck.ts'
import { foldRechecks } from '../state/rechecks.ts'
import { ruleHolds } from './rules.ts'

const ENGINE: Author = { _tag: 'System' }

export interface Words extends HelperWords {
  readonly workerAck?: string
  readonly workerPrompt?: (members: ReadonlyArray<string>) => string
  readonly bootstrap?: (session: string) => { readonly state: 'live' | 'ended' | 'unknown'; readonly stop: () => void } | null
}

// The tmux session of an actor's pane at an epoch (tmux-safe: no ':' and no '.').
export const sessionOf = (actor: ActorKey, ep: number): SessionId =>
  SessionId.make(`${actor.replaceAll(':', '-')}-e${ep}`)
// The session of an actor at an epoch, given the bound host's session of an activated workflow
// (its host at epoch 0 runs in the session its activation launched).
export const sessionAt = (hostSession: string | null, actor: ActorKey, ep: number): SessionId =>
  hostSession !== null && actor === 'host' && ep === 0 ? SessionId.make(hostSession) : sessionOf(actor, ep)

interface Backoff {
  readonly launchedAt: number
  readonly delay: number
  readonly until: number
}
export type Memory = ReadonlyMap<string, Backoff>
export const backoffMemory = Ref.make<Memory>(new Map())
const FIRST_MS = 2000
const MAX_MS = 300_000
const LIVED_MS = 60_000

const HARNESS = { _tag: 'Harness' } as const

const supervise = (say: Words, events: Parameters<typeof foldRuntime>[0], hostSession: string | null, ended: boolean, memory: Ref.Ref<Memory>, lines: string[]) =>
  Effect.scoped(Effect.gen(function* () {
    const { cwd } = yield* Dir
    const pump = yield* Pump
    const { placements } = foldRuntime(events)
    const env = yield* Effect.serviceOption(Env)
    if (placements.length === 0) return
    yield* activationLock(cwd)
    const store = yield* (yield* Store).open(cwd, { create: false })
    let recheckAccount = yield* superviseRechecks(say)
    const now = yield* nowMs
    const parked = [...foldRechecks(yield* store.events).values()].filter((job) =>
      job.park?._tag === 'WorkerParkConfirmed' && !job.resumed).map((job) => job.queued.worker)
    for (const placement of [...placements].sort((a, b) => Number(parked.includes(b.worker)) - Number(parked.includes(a.worker)))) {
      const backoff = (yield* Ref.get(memory)).get(placement.worker)
      const current = foldRuntime(yield* store.events).workers.get(placement.worker)
      if (current && !current.ended) {
        const { worker, launch, generation, members } = current.reservation
        const bootstrap = generation === 1 && members.includes('host') ? hostSession : null
        const sid = SessionId.make(current.binding?.session ?? bootstrap ?? workerSession(launch))
        const observe = Effect.gen(function* () {
          const external = bootstrap === null ? null : say.bootstrap?.(bootstrap)
          if (external) return external.state
          if (pump.observe) return yield* pump.observe(sid)
          return (yield* pump.status)[sid]?._tag === 'Live' ? 'live' : 'ended'
        })
        const process = yield* observe
        if (current.parking) {
          const job = current.parking.job
          if (process === 'ended') {
            yield* settlePark(job, launch, 'ended')
            yield* pump.forget(sid)
            recheckAccount = placement.account
            continue
          }
          if (process === 'live') {
            const external = bootstrap === null ? null : say.bootstrap?.(bootstrap)
            const stopped = external ? yield* Effect.result(Effect.try(external.stop)) : yield* Effect.result(pump.stop(sid))
            const observed = yield* observe
            if (observed === 'ended') {
              yield* settlePark(job, launch, 'ended')
              yield* pump.forget(sid)
              recheckAccount = placement.account
              continue
            }
            if (stopped._tag === 'Failure' && observed === 'live') yield* settlePark(job, launch, 'stop failed')
          }
          continue
        }
        if (ended || current.fenced || process === 'ended') {
          yield* settleWorker(worker, generation, launch)
          if (process === 'live') {
            const external = bootstrap === null ? null : say.bootstrap?.(bootstrap)
            if (external) yield* Effect.ignore(Effect.try(external.stop))
            else yield* Effect.ignore(pump.stop(sid))
          }
          if ((yield* observe) === 'ended') {
            yield* settleWorker(worker, generation, launch, 'managed session absent or ended')
            yield* settleGenerationChildren(worker, generation)
            if (!ended && !current.fenced && backoff && now - backoff.launchedAt < LIVED_MS) {
              const delay = Math.min(MAX_MS, Math.max(FIRST_MS, backoff.delay * 2))
              yield* Ref.update(memory, (all) => new Map(all).set(worker,
                { launchedAt: backoff.launchedAt, until: now + delay, delay }))
              lines.push(`${worker}: its next launch waits ${delay / 1000} s`)
            }
            yield* pump.forget(sid)
          }
          continue
        }
        if (process === 'unknown') continue
        if (backoff && now - backoff.launchedAt >= LIVED_MS) {
          yield* Ref.update(memory, (all) => {
            const next = new Map(all)
            next.delete(worker)
            return next
          })
        }
        if (current.binding === null) {
          const secret = yield* Effect.sync(() => readWorkerLaunch(cwd, launch, 'secret'))
          const ack = yield* Effect.sync(() => readWorkerLaunch(cwd, launch, 'ack'))
          if (secret !== null && (bootstrap !== null || ack === sha(secret))) {
            yield* bindWorker(worker, generation, launch, sid, secret)
          }
        }
        continue
      }
      if (current?.ended) yield* settleGenerationChildren(placement.worker, current.reservation.generation)
      if (ended || recheckAccount === placement.account || (backoff !== undefined && now < backoff.until)) continue
      const launch = randomUUID().replaceAll('-', '')
      const before = yield* store.events
      const pendingResume = [...foldRechecks(before).values()].find((job) =>
        job.queued.worker === placement.worker && job.park?._tag === 'WorkerParkConfirmed' && !job.resumed)
      const checkpoint = pendingResume?.checkpoint
      const handle = checkpoint ? readWorkerLaunch(cwd, checkpoint.checkpoint, 'checkpoint') : null
      if (checkpoint && (!handle || sha(handle) !== checkpoint.digest || !placement.resume)) continue
      const reserved = yield* reserveWorker(placement.worker, launch)
      if (reserved === null) continue
      const generation = (current?.reservation.generation ?? 0) + 1
      const secret = randomUUID().replaceAll('-', '')
      yield* Effect.sync(() => stageWorkerLaunch(cwd, launch, 'secret', secret))
      if (generation === 1 && placement.members.includes('host') && hostSession !== null) {
        const bootstrap = say.bootstrap?.(hostSession)
        const live = bootstrap ? bootstrap.state === 'live' : (yield* pump.status)[hostSession]?._tag === 'Live'
        if (live) {
          yield* bindWorker(placement.worker, generation, launch, hostSession, secret)
        }
        continue
      }
      const sid = SessionId.make(workerSession(launch))
      const db = env._tag === 'Some' ? env.value.vars.ARISTOTELES_DB : undefined
      const launchEnv = { ...(db === undefined ? {} : { ARISTOTELES_DB: db }), ARISTOTELES_WORKER_CREDENTIAL: `g.${launch}.${generation}.${secret}` }
      const prompt = (say.workerPrompt?.(placement.members) ?? '') + ' Run work worker wait "$ARISTOTELES_WORKER_CREDENTIAL" and do the step it prints. Repeat the wait after each step.'
      const command = fill(handle && placement.resume ? placement.resume : placement.launch,
        { session: handle ?? sid, model: placement.model, prompt })
      yield* Ref.update(memory, (all) => new Map(all).set(placement.worker,
        { launchedAt: now, delay: backoff?.delay ?? 0, until: 0 }))
      const started = yield* Effect.result(pump.start(sid, {
        command: `${say.workerAck ?? 'work worker ack'} && ${command}`,
        env: launchEnv, cols: 160, rows: 48,
      }))
      if (started._tag === 'Failure') lines.push(`${placement.worker}: its launch failed.`)
    }
  }))

export const engineTick = (say: Words, memory: Ref.Ref<Memory>) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const lines: string[] = []
    const read = Effect.gen(function* () {
      const store = yield* (yield* Store).open(cwd, { create: false })
      const events = yield* store.events
      return { events, folded: yield* folding(() => foldWork(events)) }
    }).pipe(Effect.scoped)
    const first = yield* read
    if (isInactive(first.events) || first.folded === null) return lines
    yield* supervise(say, first.events, first.folded.hostSession, first.folded.state.top.ended, memory, lines)
    const current = yield* read
    if (current.folded === null || current.folded.state.top.ended) return lines
    const { state } = current.folded
    for (const step of dos(state, HARNESS)) {
      if (step.act !== 'RunRule' || step.task === null) continue
      const verdict = yield* Effect.result(ruleHolds(state, current.events, step.task))
      if (verdict._tag === 'Failure') {
        lines.push(`RunRule ${step.task}: ${verdict.failure.message}`)
        continue
      }
      const body = { _tag: 'RunRule', task: step.task, holds: verdict.success } as const
      const result = yield* Effect.result(Effect.scoped(dispatchAct({
        by: ENGINE,
        act: { id: sha(JSON.stringify(['engine', state.seq, body])), who: HARNESS, ep: 0, body },
        on: null, build: null, current: 'engine', evidence: state.ver,
      })))
      if (result._tag === 'Failure') lines.push(`RunRule: ${result.failure.message}`)
    }
    return lines
  })
