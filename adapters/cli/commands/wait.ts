// work wait <token>: an agent or the host runs it when it has nothing to do. It blocks until the
// actor owes a step, then prints that one step (what it is about, then its command) and exits 0;
// the agent does it and runs work wait again. Nothing is typed into a terminal: this command is how
// they hear of work. While it blocks, a marker next to the store says that the actor waits, so
// that the watcher does not take it for a silent terminal (adapters/live/waiting.ts).
import { Effect, Fiber } from 'effect'
import { folding } from '../../../core/actions/dispatch.ts'
import { type WaitEnd, waitFor } from '../../../core/effects/wait.ts'
import { refuse } from '../../../core/schema/index.ts'
import { Dir, Env, Store, Terminal } from '../../../core/services/index.ts'
import { foldWork } from '../../../core/state/c16/fold.ts'
import { type Answered, actorOf } from '../../../core/state/c16/types.ts'
import { BEAT_MS, markReturned, markWaiting, type WaitPlace } from '../../live/waiting.ts'
import { buildOf } from '../../live/build.ts'
import { stepLine, stepWords } from '../../words/work.ts'
import type { Command, Commands } from '../command.ts'
import { bootstrapRequest, retireHostDelivery } from '../../live/activation.ts'
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

export const commands: Commands = { wait }
