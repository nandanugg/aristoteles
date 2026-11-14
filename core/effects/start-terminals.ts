// StartTerminals (C1): the terminal of each Working Sol or Terra of a live run's tree, with no
// terminal yet, or with one that never briefed (a new token). Never an Ended agent: the selector
// reads AssignmentState. Ruling 10.1: the first prompt is an argument of the launch command (its
// {prompt}, else its last argument); nothing is typed.
import { Effect } from 'effect'
import { type Derived, terminalsToStart, type ToStart } from '../derived/index.ts'
import { SessionId } from '../schema/index.ts'
import { Pump, Tokens } from '../services/index.ts'
import { delivered, dropped, logLine, sendStart, step, supervise, tiersNow, to } from './acting.ts'
import { fill } from './lines.ts'
import { tierOf } from './terminals.ts'
import type { WorkEffect } from './types.ts'

// Starts a terminal: the launch command of the tier, with the first prompt as its argument. The
// stored Start send keeps the record of it, never its words (they hold a token).
export const launch = (command: string, sid: SessionId, words: string) =>
  Effect.gen(function* () {
    const pump = yield* Pump
    const send = yield* sendStart({ _tag: 'Start', to: to(sid), via: { _tag: 'LaunchArgument' } })
    const filled = fill(command, { session: sid, prompt: words })
    const started = yield* Effect.result(
      pump.start(sid, { command: filled, env: {}, cols: 160, rows: 48 }),
    )
    if (started._tag === 'Failure') {
      if (send !== null) yield* dropped(send, { _tag: 'TypingFailed' })
      return yield* Effect.fail(started.failure)
    }
    if (send !== null) yield* delivered(send)
  })

// A real agent with no terminal yet: a new session (or its old one), a new token, its terminal.
const startAgent = (d: Derived, x: ToStart) =>
  Effect.gen(function* () {
    const a = d.moment.work.assignments.get(x.assignment)
    const tier = a === undefined ? undefined : tierOf(d.moment.work, a)
    if (tier === undefined) return
    const t = (yield* tiersNow)[tier]
    if (!t?.launch) return yield* logLine(`${x.assignment}: ${tier} has no launch command`)
    const tokens = yield* Tokens
    const sid =
      x.session._tag === 'Again' ? x.session.session : SessionId.make(`s-${yield* tokens.random}`)
    const secret = yield* tokens.random
    yield* supervise<'StartSession'>({
      _tag: 'StartSession',
      target: { assignment: x.assignment },
      content: { session: sid, secret },
    })
    yield* launch(t.launch, sid, fill(t.start, { token: `${x.assignment}.${secret}` }))
    yield* logLine(`${x.assignment}: started in ${sid}`)
  })

export const StartTerminals: WorkEffect<'StartTerminals'> = {
  name: 'StartTerminals',
  select: terminalsToStart,
  react: (list, d) =>
    Effect.forEach(list, (x) => step(x.assignment, startAgent(d, x)), { discard: true }),
}
