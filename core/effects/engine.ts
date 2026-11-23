import { randomUUID } from 'node:crypto'
// The engine's tick (terminals.qnt, G1; the harness's obligations of protocol.qnt: ReviveOb and
// RuleRunOb, from c16 dos(state, Harness)): what the harness owes, done from the store alone. A
// persistent actor that is up but has no live pane `<actor>.<epoch>` is recorded as exited (the
// evidence: a revive recorded but never launched, or a pane that died); each revive the store
// owes the harness is recorded first (its token), then the pane is started with the first prompt
// as an argument of the launch command; the pump's status is the mark. A pane's silence restarts
// nothing. The host's pane is the person's: never revived here. The tick's words: what it did
// and what it could not.
import { isInactive } from '../actions/activation.ts'
import { Effect, Ref } from 'effect'
import { bindWorker, reserveWorker, settleWorker, workerSession } from '../actions/worker.ts'
import { foldRuntime } from '../state/worker-runtime.ts'
import { activationLock, readWorkerLaunch, stageWorkerLaunch } from '../services/index.ts'
import { folding } from '../actions/dispatch.ts'
import { dispatchAct, type NewToken } from '../actions/work.ts'
import { dos } from '../derived/c16/obligations.ts'
import { type Author, SessionId } from '../schema/index.ts'
import { Dir, Env, Pump, readStaffing, sha, Store } from '../services/index.ts'
import { fold } from '../state/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf } from '../state/c16/reads.ts'
import type { WorkState } from '../state/c16/state.ts'
import { type ActorKey, actorOf, type Body, keyOf } from '../state/c16/types.ts'
import { nowMs } from './acting.ts'
import { fill, quote } from './lines.ts'
import { ruleHolds } from './rules.ts'

const ENGINE: Author = { _tag: 'System' }

// What the adapter writes for a pane: the prompt (who the agent is, its role's words, its token
// and its wait), an argument of the launch command; and the settings text of its stop-at-prompt
// hook (--settings, beside the prompt), which records the actor's exit.
export interface Words {
  readonly prompt: (actor: ActorKey, words: string, token: NewToken) => string
  readonly workerAck?: string
  readonly workerPrompt?: (members: ReadonlyArray<string>) => string
  readonly bootstrap?: (session: string) => { readonly state: 'live' | 'ended' | 'unknown'; readonly stop: () => void } | null
  readonly hook: (actor: ActorKey, token: NewToken) => string
}

// The tmux session of an actor's pane at an epoch (tmux-safe: no ':' and no '.').
export const sessionOf = (actor: ActorKey, ep: number): SessionId =>
  SessionId.make(`${actor.replaceAll(':', '-')}-e${ep}`)
// The session of an actor at an epoch, given the bound host's session of an activated workflow
// (its host at epoch 0 runs in the session its activation launched).
export const sessionAt = (hostSession: string | null, actor: ActorKey, ep: number): SessionId =>
  hostSession !== null && actor === 'host' && ep === 0 ? SessionId.make(hostSession) : sessionOf(actor, ep)

// The engine's memory (never the store): per actor, when its pane was last launched, the delay
// before the next launch (doubles from 2 s to 5 min after a failed or short-lived launch; reset
// after a pane has lived 60 s), until when the actor waits, and whether this wait is counted.
export interface Backoff {
  readonly launchedAt: number
  readonly delay: number
  readonly until: number
  readonly bumped: boolean
}
export type Memory = ReadonlyMap<ActorKey, Backoff>
export const backoffMemory = Ref.make<Memory>(new Map())
const FRESH: Backoff = { launchedAt: -1, delay: 0, until: 0, bumped: false }
const FIRST_MS = 2000
const MAX_MS = 300_000
const LIVED_MS = 60_000

const PIPE = keyOf({ _tag: 'Pipe' })
const HARNESS = { _tag: 'Harness' } as const

const persistent = (s: WorkState): ReadonlyArray<ActorKey> => [
  PIPE,
  ...[...s.cards.keys()].map((name) => keyOf({ _tag: 'Role', name })),
]

const supervise = (say: Words, events: Parameters<typeof foldRuntime>[0], hostSession: string | null, ended: boolean) =>
  Effect.scoped(Effect.gen(function* () {
    const { cwd } = yield* Dir
    const pump = yield* Pump
    const { placements } = foldRuntime(events)
    const env = yield* Effect.serviceOption(Env)
    if (placements.length === 0) return
    yield* activationLock(cwd)
    const store = yield* (yield* Store).open(cwd, { create: false })
    for (const placement of placements) {
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
        if (ended || current.fenced || process === 'ended') {
          yield* settleWorker(worker, generation, launch)
          if (process === 'live') {
            const external = bootstrap === null ? null : say.bootstrap?.(bootstrap)
            if (external) yield* Effect.ignore(Effect.try(external.stop))
            else yield* Effect.ignore(pump.stop(sid))
          }
          if ((yield* observe) === 'ended') {
            yield* settleWorker(worker, generation, launch, 'managed session absent or ended')
            yield* pump.forget(sid)
          }
          continue
        }
        if (process === 'unknown') continue
        if (current.binding === null) {
          const secret = yield* Effect.sync(() => readWorkerLaunch(cwd, launch, 'secret'))
          const ack = yield* Effect.sync(() => readWorkerLaunch(cwd, launch, 'ack'))
          if (secret !== null && (bootstrap !== null || ack === sha(secret))) {
            yield* bindWorker(worker, generation, launch, sid, secret)
          }
        }
        continue
      }
      if (ended) continue
      const launch = randomUUID().replaceAll('-', '')
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
      const command = fill(placement.launch, { session: sid, model: placement.model, prompt })
      yield* Effect.ignore(pump.start(sid, {
        command: `${say.workerAck ?? 'work worker ack'} && ${command}`,
        env: launchEnv, cols: 160, rows: 48,
      }))
    }
  }))

export const engineTick = (say: Words, memory: Ref.Ref<Memory>) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const pump = yield* Pump
    const lines: Array<string> = []
    const read = Effect.gen(function* () {
      const store = yield* (yield* Store).open(cwd, { create: false })
      const events = yield* store.events
      return { events, folded: yield* folding(() => foldWork(events)) }
    }).pipe(Effect.scoped)
    // An act of the harness; its refusal is a line, not a failure of the tick.
    const act = (s: WorkState, body: Body) =>
      dispatchAct({
        by: ENGINE,
        act: { id: sha(JSON.stringify(['engine', s.seq, body])), who: HARNESS, ep: 0, body },
        on: null,
        build: null,
        current: 'engine',
        ...(body._tag === 'RunRule' ? { evidence: s.ver } : {}),
        ...(body._tag === 'Exit' ? { actorEpoch: epochOf(s, body.actor) } : {}),
      }).pipe(
        Effect.scoped,
        Effect.catch((e) =>
          Effect.as(Effect.sync(() => lines.push(`${body._tag}: ${e.message}`)), null)
        ),
      )
    const t = yield* nowMs
    const recall = (k: ActorKey) => Effect.map(Ref.get(memory), (m) => m.get(k) ?? FRESH)
    const remember = (k: ActorKey, f: (e: Backoff) => Backoff) =>
      Ref.update(memory, (m) => new Map(m).set(k, f(m.get(k) ?? FRESH)))
    // A failed or short-lived launch: the next one waits, twice as long as the last wait.
    const back = (k: ActorKey) =>
      Effect.gen(function* () {
        const delay = Math.min(MAX_MS, Math.max(FIRST_MS, (yield* recall(k)).delay * 2))
        yield* remember(k, (e) => ({ ...e, delay, until: t + delay, bumped: true }))
        lines.push(`${k}: its pane failed or died at once; the next launch waits ${delay / 1000} s`)
      })
    const alive = (sid: SessionId) =>
      Effect.map(pump.status, (status) => status[sid]?._tag === 'Live')

    const first = yield* read
    // An inactive workflow (onboarding's activation, contract 6c): the engine writes nothing.
    if (isInactive(first.events)) return lines
    if (first.folded === null) return lines
    let { state } = first.folded
    const { hostSession } = first.folded
    const managed = new Set(foldRuntime(first.events).placements.flatMap((placement) => placement.members))
    yield* supervise(say, first.events, hostSession, state.top.ended)
    if (state.top.ended) {
      for (const k of persistent(state).filter((actor) => !managed.has(actor))) {
        const sid = sessionAt(hostSession, k, epochOf(state, actorOf(k)))
        if (yield* alive(sid)) yield* Effect.ignore(pump.stop(sid))
      }
      return lines
    }
    // The evidence: an actor that is up and has no live pane exited.
    let exited = false
    for (const k of persistent(state).filter((actor) => !managed.has(actor))) {
      if (state.down.has(k)) continue
      const sid = sessionAt(hostSession, k, epochOf(state, actorOf(k)))
      const e = yield* recall(k)
      if (yield* alive(sid)) {
        if (e.delay > 0 && t - e.launchedAt >= LIVED_MS) yield* remember(k, () => FRESH)
        continue
      }
      if (t < e.until) continue
      if (!e.bumped && e.launchedAt >= 0) {
        if (t - e.launchedAt < LIVED_MS) yield* back(k)
        else yield* remember(k, () => FRESH)
      }
      if ((yield* act(state, { _tag: 'Exit', actor: actorOf(k) })) !== null) {
        yield* pump.forget(sid)
        lines.push(`${k}: no live pane ${sid}; its exit is recorded`)
        exited = true
      }
    }
    const now = exited ? yield* read : first
    if (now.folded === null) return lines
    state = now.folded.state

    const launchOf = (k: ActorKey) =>
      Effect.gen(function* () {
        const card = state.cards.get(k.slice('role:'.length))
        const pipe = k === PIPE
          ? Object.entries(fold(now.events).config.roles).find(
            ([, role]) => role.kind === 'agent' && role.pipeline === true,
          )
          : undefined
        const role = card ??
          (pipe?.[1].kind === 'agent'
            ? { role: pipe[0], words: pipe[1].intro, model: pipe[1].model }
            : null)
        if (role === null) return null
        const staffing = yield* readStaffing(cwd)
        const binding = staffing !== null && Object.hasOwn(staffing.roles, role.role)
          ? staffing.roles[role.role]
          : undefined
        return binding === undefined || !binding.persistent
          ? null
          : { words: role.words, model: binding.model, template: binding.launch }
      })
    for (const step of dos(state, HARNESS)) {
      if (step.act === 'RunRule') {
        const target = step.task ?? ''
        const holds = yield* Effect.result(ruleHolds(state, now.events, target))
        if (holds._tag === 'Failure') {
          lines.push(`RunRule ${target}: ${holds.failure.message}`)
          continue
        }
        yield* act(state, { _tag: 'RunRule', task: target, holds: holds.success })
      } else if (step.act === 'Revive') {
        const target = step.actor ?? ''
        if (managed.has(target) || t < (yield* recall(target)).until) continue
        const how = yield* Effect.result(launchOf(target))
        if (how._tag === 'Failure' || how.success === null) {
          lines.push(`${target}: no launch command for its model; it stays down`)
          continue
        }
        const acted = yield* act(state, { _tag: 'Revive', actor: actorOf(target) })
        // A copy of a recorded revive has no token: its first run launches.
        if (acted?.token == null) continue
        const { words, model, template } = how.success
        const sid = sessionOf(target, acted.token.ep)
        // The prompt goes last (fill appends it when the template has no {prompt}).
        const command = fill(`${template} --settings ${quote(say.hook(target, acted.token))}`, {
          session: sid,
          model,
          prompt: say.prompt(target, words, acted.token),
        })
        const started = yield* Effect.result(
          pump.start(sid, { command, env: {}, cols: 160, rows: 48 }),
        )
        if (started._tag === 'Success') {
          yield* remember(target, (e) => ({ ...e, launchedAt: t, bumped: false }))
        } else {
          yield* remember(target, (e) => ({ ...e, launchedAt: t }))
          yield* back(target)
        }
        lines.push(
          started._tag === 'Success'
            ? `${target}: revived in ${sid}`
            : `${target}: its pane did not start: ${started.failure.message}`,
        )
      }
    }
    return lines
  })
