// work wait <token>: an agent or the host runs it when it has nothing to do. It blocks until the
// actor owes a step, then prints that one step (what it is about, then its command) and exits 0;
// the agent does it and runs work wait again. Nothing is typed into a terminal: this command is how
// they hear of work. While it blocks, a marker next to the store says that the actor waits, so
// that the watcher does not take it for a silent terminal (adapters/live/waiting.ts).
import { Effect, Fiber } from 'effect'
import { memberSecretOf, offerWorker, workerSecretOf, workerSession } from '../../../core/actions/worker.ts'
import { foldRuntime } from '../../../core/state/worker-runtime.ts'
import { folding } from '../../../core/actions/dispatch.ts'
import { type WaitEnd, waitFor } from '../../../core/effects/wait.ts'
import { refuse } from '../../../core/schema/index.ts'
import { Dir, Env, readWorkerLaunch, sha, stageWorkerLaunch, Store, Terminal } from '../../../core/services/index.ts'
import { foldWork } from '../../../core/state/c16/fold.ts'
import { type Answered, actorOf } from '../../../core/state/c16/types.ts'
import { BEAT_MS, markReturned, markWaiting, type WaitPlace } from '../../live/waiting.ts'
import { buildOf } from '../../live/build.ts'
import { stepLine, stepWords, workTokenOf } from '../../words/work.ts'
import type { Command, Commands } from '../command.ts'
import { acquireBootstrapWorker, bootstrapRequest, retireHostDelivery } from '../../live/activation.ts'
import { NONCE_ENV } from '../../live/bootstrap.ts'
import { textOf } from '../args.ts'
import { verifyWork } from '../caller.ts'

// Under the 10-minute limit of a command in Claude Code (onboard waits no longer than this).
export const WAIT_SECONDS = 540
const POLL_MS = 500
const BUILD_MS = 5000

const OLD_TOKEN = /^a\d+(\.|$)/

// The typed answer of a Hear step, as words (the question's own choices and rows by name).
const answerWords = (a: Answered): string => {
  const form = a.ask.question?.form
  const b = a.answer
  const text = b._tag === 'Single'
    ? b.text
    : b._tag === 'Multiple'
    ? b.texts.map((t, i) => `${i + 1}. ${t}`).join(' | ')
    : b._tag === 'Choice'
    ? b.picked.map((i) => (form?._tag === 'Choice' ? form.options[i] : undefined) ?? `${i}`)
      .join(', ')
    : b.cells.map((c, i) =>
      form?._tag === 'Matrix' ? `${form.rows[i]}: ${form.columns[c]}` : `${i}: ${c}`
    ).join(' | ')
  return `the answer to ask ${a.ask.id} (${b._tag}): ${text}`
}

// The token of the call: w.<actor>.<epoch>.<secret>, the first word.
const tokenOf = (call: Parameters<Command>[0]): string | null =>
  call.token ?? call.args.positional.find((w) => /^(w|a\d+)\./.test(w)) ?? null

const bootstrapWait: Command = (call) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const { vars } = yield* Env
    const launch = textOf(call.args.one('launch'))!
    const terminal = yield* Terminal
    const seconds = Number(textOf(call.args.one('seconds')) ?? WAIT_SECONDS)
    if (!Number.isFinite(seconds) || seconds <= 0) return yield* refuse('wait needs a positive number of seconds')
    const until = Date.now() + seconds * 1000
    let delivered = false
    let previous = ''
    for (;;) {
      const step = yield* bootstrapRequest(cwd, launch, vars[NONCE_ENV], 'wait')
      if (step.token !== null && !delivered) {
        yield* terminal.out(step.token)
        delivered = true
      }
      if (step.line !== '' && step.line !== previous) {
        yield* terminal.out(step.line)
        previous = step.line
      }
      if (step.top) return []
      if (Date.now() >= until) return ['Run the bootstrap wait again.']
      yield* Effect.sleep(POLL_MS)
    }
  })

const waitWorker = (
  store: Effect.Success<ReturnType<Effect.Success<typeof Store>['open']>>,
  worker: string,
  generation: number,
  secret: string,
  seconds: number,
  abandon: boolean,
  hostToken?: string,
  privateSpelling = false,
) => Effect.gen(function* () {
  const until = Date.now() + seconds * 1000
  if (abandon) {
    yield* offerWorker(worker, generation, secret, true)
    return ['The outstanding turn was abandoned.']
  }
  for (;;) {
    yield* offerWorker(worker, generation, secret)
    const events = yield* store.events
    const folded = foldWork(events)
    const current = foldRuntime(events).workers.get(worker)
    if (current?.reservation.generation !== generation || current.fenced) {
      return yield* refuse('This worker generation is no longer live.')
    }
    if (folded?.state.top.ended) return ['The project has ended.']
    const offer = current.offer
    if (offer && folded) {
      const token = offer.actor === 'host' && hostToken !== undefined ? hostToken :
        workTokenOf(offer.actor, offer.epoch, memberSecretOf(secret, offer.actor, offer.epoch))
      const shown = stepLine(folded.state, offer.step, offer.on).replaceAll('<token>', token)
      const command = !privateSpelling && offer.step.act === 'Open' && offer.actor === 'host'
        ? shown.replace(/--sections=\S+/, () => `--sections=${JSON.stringify(offer.step.task)}`)
        : shown
      const on = command.includes('--on=') ? '' : ` --on=${offer.on}`
      const heard = offer.step.act === 'Hear' ? folded.state.answered.get(offer.step.ask ?? '') : undefined
      return [
        ...stepWords(folded.state, offer.step, events),
        ...(heard === undefined ? [] : [answerWords(heard)]),
        privateSpelling ? command : `${command}${on} --turn=${workerSecretOf(secret, offer.turn)}`,
      ]
    }
    if (Date.now() >= until) return ['Run the worker wait again.']
    yield* Effect.sleep(POLL_MS)
  }
})

const worker: Command = (call) => Effect.gen(function* () {
  const { cwd } = yield* Dir
  const { vars } = yield* Env
  const [action, raw] = call.args.positional
  const match = /^g\.([a-f0-9]{32})\.([1-9][0-9]*)\.([a-f0-9]{32})$/.exec(raw ?? vars.ARISTOTELES_WORKER_CREDENTIAL ?? '')
  if (!match) return yield* refuse('Supply the current worker credential.')
  const [, launch, epoch, secret] = match as unknown as [string, string, string, string]
  const generation = Number(epoch)
  const store = yield* (yield* Store).open(cwd, { create: false })
  const current = [...foldRuntime(yield* store.events).workers.values()].find(
    (entry) => entry.reservation.launch === launch && entry.reservation.generation === generation &&
      !entry.fenced && !entry.ended)
  if (!current) return yield* refuse('This worker generation is no longer live.')
  if (action === 'ack') {
    if (vars.ARISTOTELES_SESSION !== workerSession(launch)) {
      return yield* refuse('This acknowledgement must come from the reserved session.')
    }
    if (readWorkerLaunch(cwd, launch, 'secret') !== secret) return yield* refuse('Wrong worker credential.')
    yield* Effect.sync(() => stageWorkerLaunch(cwd, launch, 'ack', sha(secret)))
    return []
  }
  if (action !== 'wait') return yield* refuse('Use work worker wait.')
  const seconds = Number(textOf(call.args.one('seconds')) ?? WAIT_SECONDS)
  if (!Number.isFinite(seconds) || seconds <= 0) return yield* refuse('wait needs a positive number of seconds')
  const until = Date.now() + seconds * 1000
  if (readWorkerLaunch(cwd, launch, 'secret') !== secret) return yield* refuse('Wrong worker credential.')
  for (;;) {
    const latest = foldRuntime(yield* store.events).workers.get(current.reservation.worker)
    if (latest?.reservation.launch !== launch || latest.fenced || latest.ended) {
      return yield* refuse('This worker generation is no longer live.')
    }
    if (latest.binding) break
    if (Date.now() >= until) return ['Run the worker wait again.']
    yield* Effect.sleep(POLL_MS)
  }
  const hostToken = current.reservation.members.includes('host') && generation === 1
    ? readWorkerLaunch(cwd, launch, 'host') ?? undefined : undefined
  return yield* waitWorker(store, current.reservation.worker, generation, secret,
    Math.max(0, (until - Date.now()) / 1000), call.args.one('abandon') !== undefined, hostToken)
})

const wait: Command = (call) =>
  Effect.gen(function* () {
    if (textOf(call.args.one('launch')) !== undefined) {
      if (call.token !== null) return yield* refuse('bootstrap wait takes a launch ID only')
      return yield* bootstrapWait(call)
    }
    const token = tokenOf(call)
    if (token === null) {
      return yield* refuse(
        'work wait needs your token (w.<actor>.<epoch>.<secret>); the person has no work wait',
        'the page shows the person what is theirs to do',
      )
    }
    if (OLD_TOKEN.test(token) || call.args.one('by') !== undefined) {
      return yield* refuse(
        'this store is new: the old tokens and work wait --by do not work in it',
        'restart this terminal, so that it gets the token of the new store',
      )
    }
    const { cwd } = yield* Dir
    const { vars } = yield* Env
    const store = yield* (yield* Store).open(cwd, { create: false })
    const events = yield* store.events
    const folded = yield* folding(() => foldWork(events))
    if (folded === null) return yield* refuse(`no top is open in ${cwd}`, 'the person opens it')
    const { who, ep } = yield* verifyWork(folded, token)
    const placement = foldRuntime(events).placements.find((entry) => entry.members.includes(who))
    if (placement) {
      if (ep !== (folded.state.ep.get(who) ?? 0)) {
        return [`this terminal's token is old: ${who} is at a newer epoch. STOP: do nothing more in this terminal.`]
      }
      if (who === 'host' && ep === 0 && folded.hostSession?.startsWith('boot-')) {
        yield* acquireBootstrapWorker(cwd, placement.worker, folded.hostSession)
      }
      const current = foldRuntime(yield* store.events).workers.get(placement.worker)
      if (current?.fenced) return ["this terminal's token is old. STOP: do nothing more in this terminal."]
      if (!current?.binding) return ['The worker is starting. Run the wait again.']
      if (!placement.worker.startsWith('private:') &&
        !(who === 'host' && current.reservation.generation === 1 && current.binding.session === folded.hostSession)) {
        return yield* refuse('Use work worker wait with the worker credential.')
      }
      const secret = readWorkerLaunch(cwd, current.reservation.launch, 'secret')
      if (!secret) return yield* refuse('The worker launch credential is unavailable.')
      if (!placement.worker.startsWith('private:')) {
        yield* Effect.sync(() => stageWorkerLaunch(cwd, current.reservation.launch, 'host', token))
        yield* retireHostDelivery(cwd, token)
        return [`Run work worker wait g.${current.reservation.launch}.${current.reservation.generation}.${secret}`]
      }
      const seconds = Number(textOf(call.args.one('seconds')) ?? WAIT_SECONDS)
      if (!Number.isFinite(seconds) || seconds <= 0) return yield* refuse('wait needs a positive number of seconds')
      if (who === 'host') yield* retireHostDelivery(cwd, token)
      return yield* waitWorker(store, placement.worker, current.reservation.generation, secret, seconds,
        false, who === 'host' ? token : undefined, placement.worker.startsWith('private:'))
    }
    if (who === 'host') yield* retireHostDelivery(cwd, token)
    const actor = actorOf(who)
    if (actor._tag === 'Harness' || actor._tag === 'Human') {
      return yield* refuse(`${who} does not wait`, 'work wait is for the agents and the host')
    }
    const place: WaitPlace = { env: vars, cwd, actor: who }
    // The marker is renewed while the wait blocks; it is never renewed after the return.
    let beat: Fiber.Fiber<never> | undefined
    const blocking = Effect.gen(function* () {
      yield* markWaiting(place, null)
      beat = yield* Effect.forkDetach(
        Effect.forever(Effect.andThen(Effect.sleep(BEAT_MS), markWaiting(place, null))),
      )
    })
    const end: WaitEnd = yield* waitFor(store, {
      actor,
      ep,
      pollMs: POLL_MS,
      blocking,
      build: Effect.sync(() => buildOf(vars)),
      buildMs: BUILD_MS,
    }).pipe(
      // A wait that blocked waits no more, also when it fails.
      Effect.ensuring(
        Effect.suspend(() =>
          beat === undefined
            ? Effect.void
            : Effect.andThen(Fiber.interrupt(beat), markReturned(place, null)),
        ),
      ),
    )
    switch (end._tag) {
      case 'Step':
        return [
          ...stepWords(end.folded.state, end.step, end.events),
          ...(end.heard === null ? [] : [answerWords(end.heard)]),
          stepLine(end.folded.state, end.step, end.folded.state.seq).replaceAll('<token>', token),
        ]
      case 'Old':
        return [
          `this terminal's token is old: ${who} is at epoch ${end.now} and your token is of ` +
            `epoch ${ep}. STOP: do nothing more in this terminal.`,
        ]
      case 'Ended':
        return ['the project has ended; there is nothing more for you.']
      case 'Updated':
        return [`aristoteles was updated; run work wait ${token} again.`]
      case 'NoTop':
        return yield* refuse(`no top is open in ${cwd}`, 'the person opens it')
    }
  })

export const commands: Commands = { wait, worker }
