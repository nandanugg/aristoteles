// StartTerminals (C1, ruling 7): the one terminal of each persistent agent on an assignment, with
// no terminal yet, or with one that the pump lost before it ever ran (ranOnce). Never an Ended
// agent: the selector reads AgentState. Ruling 10.1: the first prompt is an argument of the
// launch command (its {prompt}, else its last argument); nothing is typed. The first prompt
// names no token (P9): each assignment reaches the agent through its own work wait (ruling 9).
import { Effect } from 'effect'
import { type Derived, terminalsToStart, type ToStart } from '../derived/index.ts'
import { SessionId, type Settings, type TerminalTier } from '../schema/index.ts'
import { Pump, Tokens } from '../services/index.ts'
import { delivered, dropped, logLine, sendStart, step, supervise, tiersNow, to } from './acting.ts'
import { fill } from './lines.ts'
import { conversationOf, tierOf } from './terminals.ts'
import type { WorkEffect } from './types.ts'

type TierSettings = NonNullable<Settings['tiers'][TerminalTier]>

// Starts a terminal: the launch command of the tier, with the first prompt as its argument. The
// stored Start send keeps the record of it, never its words.
const launch = (t: TierSettings, sid: SessionId, session: string, words: string) =>
  Effect.gen(function* () {
    const pump = yield* Pump
    const send = yield* sendStart({ _tag: 'Start', to: to(sid), via: { _tag: 'LaunchArgument' } })
    const command = fill(t.launch ?? '', { session, model: t.model, prompt: words })
    const started = yield* Effect.result(
      pump.start(sid, { command, env: {}, cols: 160, rows: 48 }),
    )
    if (started._tag === 'Failure') {
      if (send !== null) yield* dropped(send, { _tag: 'TypingFailed' })
      return yield* Effect.fail(started.failure)
    }
    if (send !== null) yield* delivered(send)
  })

// An agent with no terminal: a new session that StartAgent stores (or its old one), its terminal.
const startAgent = (d: Derived, x: ToStart) =>
  Effect.gen(function* () {
    const agent = d.moment.work.agents.get(x.agent)
    if (agent === undefined) return
    const tier = tierOf(agent)
    const t = (yield* tiersNow)[tier]
    if (!t?.launch) return yield* logLine(`${x.agent}: ${tier} has no launch command`)
    let sid: SessionId
    if (x.session._tag === 'Again') {
      sid = x.session.session
    } else {
      sid = SessionId.make(`s-${yield* (yield* Tokens).random}`)
      yield* supervise<'StartAgent'>({
        _tag: 'StartAgent',
        target: { agent: x.agent },
        content: { session: sid },
      })
    }
    const session = conversationOf(d.moment.work, sid, true)
    yield* launch(t, sid, session, fill(t.start, { agent: x.agent }))
    yield* logLine(`${x.agent}: started in ${sid}`)
  })

export const StartTerminals: WorkEffect<'StartTerminals'> = {
  name: 'StartTerminals',
  select: terminalsToStart,
  react: (list, d) =>
    Effect.forEach(list, (x) => step(x.agent, startAgent(d, x)), { discard: true }),
}
