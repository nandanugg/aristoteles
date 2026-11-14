// work wait (BUILD.md 10.1): an agent or a host runs it when it has nothing to do. It blocks until
// the actor has ready work, or its next steps change, or the time passes; then it prints the next
// lines and exits 0. Nothing is typed into a terminal: this command is how they hear of work.
//   work wait <token> [--seconds=<n>]       an agent (a host after its top task opened too)
//   work wait --by=<run> [--seconds=<n>]    a host before its top task opens, in its own pane
// While it blocks, a marker next to the store says that the actor waits, so that the watcher does
// not take it for a silent terminal (adapters/live/waiting.ts).
import { Effect, Fiber } from 'effect'
import type { Derived } from '../../../core/derived/index.ts'
import { type Steps, type WaitEnd, type Waiter, waitFor } from '../../../core/effects/wait.ts'
import {
  type AssignmentId,
  refuse,
  type Run,
  type RunId,
  type SessionId,
} from '../../../core/schema/index.ts'
import { Dir, Env, Now, Store, Tokens } from '../../../core/services/index.ts'
import { workCacheLayer } from '../../../core/state/index.ts'
import {
  BEAT_MS,
  markReturned,
  markWaiting,
  seenOf,
  type WaitPlace,
} from '../../live/waiting.ts'
import { nextLines } from '../../words/index.ts'
import { textOf } from '../args.ts'
import { agentCallerOf, tierOfAssignment, tokenOfCall } from '../caller.ts'
import type { Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { act, peekWork } from '../runtime.ts'

// Under the 10-minute limit of a command in Claude Code, so that the wait ends by itself.
export const WAIT_SECONDS = 540
const POLL_MS = 500
const DERIVE_MS = 15000
const SETTLE_MS = 1000

// Only the host's own pane waits as its run: there the wait gives the token of its Sol.
const checkPane = (run: Run) =>
  Effect.gen(function* () {
    const { vars } = yield* Env
    const here =
      run.terminal._tag === 'Pane'
        ? (vars.TMUX ?? '').split(',')[0] === run.terminal.socket &&
          vars.TMUX_PANE === run.terminal.pane
        : vars.ARISTOTELES_SESSION === run.session
    if (here) return
    const where = run.terminal._tag === 'Pane' ? `pane ${run.terminal.pane}` : run.session
    return yield* refuse(
      `work wait --by=${run.id} runs only in the terminal of its host (${where})`,
      `run it in that terminal, or pass the token of your assignment: work wait <token>`,
    )
  })

const secondsOf = (value: string | true | undefined) =>
  Effect.gen(function* () {
    if (value === undefined) return WAIT_SECONDS
    const n = Number(value)
    if (typeof value === 'string' && Number.isFinite(n) && n > 0) return n
    return yield* refuse('--seconds is a number of seconds above 0, such as --seconds=540')
  })

const linesOf = (d: Derived, steps: Steps, token: string): ReadonlyArray<string> =>
  nextLines(d, steps.next, token)

// The host's top task opened: its Sol takes the run's terminal with a new token. The host writes
// it as a model run, as `run continue` does (the store lets a ModelRun take a Sol's terminal).
const opened = (end: Extract<WaitEnd, { _tag: 'Opened' }>) =>
  Effect.gen(function* () {
    const secret = yield* (yield* Tokens).random
    const at = yield* (yield* Now).read
    yield* act(
      { _tag: 'ModelRun', name: 'host', at },
      {
        _tag: 'StartSession',
        target: { assignment: end.sol },
        content: { session: end.session, secret },
      },
    )
    const w = end.d.moment.work
    const task = w.assignments.get(end.sol)?.task
    const name = task === undefined ? '' : (w.tasks.get(task)?.name ?? '')
    const token = `${end.sol}.${secret}`
    return [
      `${end.run}: its top task ${task ?? ''} ${name} is open, and you are its Sol (${end.sol}); ` +
        `an older token stops working. Your command: work brief ${token}`,
      `When you have nothing to do, run work wait ${token}.`,
    ]
  })

const wait: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const seconds = yield* secondsOf(args.one('seconds'))
    const by = textOf(args.one('by'))
    const { work } = yield* peekWork
    const token = tokenOfCall(call)
    let waiter: Waiter
    let session: SessionId | null
    let again: string
    if (token !== null || by === undefined) {
      const caller = yield* agentCallerOf(work, token)
      if (tierOfAssignment(work, caller.assignment) === 'low') {
        return [`a low role has one unit: work brief ${caller.token} shows it.`]
      }
      waiter = { _tag: 'Agent', assignment: caller.assignment }
      session = work.sessions.get(caller.assignment)?.session ?? null
      again = caller.token
    } else {
      const { run } = yield* lookupKind('Run', ['h'], work, by)
      yield* checkPane(run)
      waiter = { _tag: 'Host', run: run.id }
      session = run.session
      again = `--by=${run.id}`
    }
    const actor: AssignmentId | RunId = waiter._tag === 'Agent' ? waiter.assignment : waiter.run
    const { cwd } = yield* Dir
    const { vars } = yield* Env
    const place: WaitPlace = { env: vars, cwd, actor }
    const seen = yield* seenOf(place)

    // The last seq of the dir: one open store, read each poll.
    const store = yield* (yield* Store).open(cwd, { create: false })
    const lastSeq = Effect.map(
      store.query('SELECT MAX(seq) AS seq FROM event WHERE project = ?', store.dir),
      (rows) => Number(rows[0]?.seq ?? 0),
    )
    // The marker is renewed while the wait blocks; it is never renewed after the return.
    let beat: Fiber.Fiber<never> | undefined
    const blocking = Effect.gen(function* () {
      yield* markWaiting(place, session, seen)
      const renew = Effect.andThen(Effect.sleep(BEAT_MS), markWaiting(place, session, seen))
      beat = yield* Effect.forkDetach(Effect.forever(renew))
    })
    const end = yield* waitFor(waiter, {
      seen,
      ms: seconds * 1000,
      pollMs: POLL_MS,
      deriveMs: DERIVE_MS,
      settleMs: SETTLE_MS,
      lastSeq,
      blocking,
    }).pipe(
      Effect.provide(workCacheLayer(cwd)),
      // A wait that blocked waits no more, also when it fails.
      Effect.ensuring(
        Effect.suspend(() =>
          beat === undefined
            ? Effect.void
            : Effect.andThen(Fiber.interrupt(beat), markReturned(place, session, seen ?? '')),
        ),
      ),
    )

    // The marker says that the actor waits no more, and keeps the key of the steps it printed.
    const done = (key: string | null, lines: ReadonlyArray<string>) =>
      Effect.as(markReturned(place, session, key ?? seen ?? ''), lines)
    switch (end._tag) {
      case 'NoStore':
        return yield* Effect.die(`no work store in ${cwd}, and the store opened`)
      case 'Ended':
        return yield* done(null, [
          waiter._tag === 'Agent'
            ? `${actor} is finished; there is nothing more for it.`
            : `${actor} has ended; there is nothing more for its host.`,
        ])
      case 'Opened':
        return yield* done(null, yield* opened(end))
      case 'Ready':
      case 'Changed': {
        const lines = linesOf(end.d, end.steps, again)
        const head = end._tag === 'Changed' ? ['your next steps changed.'] : []
        const none = lines.length === 0 ? ['nothing is ready now.'] : []
        return yield* done(end.steps.key, [
          ...head,
          ...lines,
          ...none,
          `When you have nothing to do, run work wait ${again} again.`,
        ])
      }
      case 'Quiet':
        return yield* done(end.steps.key, [
          `nothing changed; run work wait ${again} again.`,
          ...linesOf(end.d, end.steps, again),
        ])
    }
  })

export const commands: Commands = { wait }
