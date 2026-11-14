// CloseEnded (C1, S1): the end of work closes its terminal (Nanda, 2026-11-11): an agent's when
// its AssignmentState is Ended (a finish, or the end of its task: no cascade event), and every
// terminal of a run that is Done or Closed. Each closes once, when it is quiet, so a terminal
// that the person resumes stays open; a stopped one stays the person's.
import { Effect } from 'effect'
import { terminalsToClose, type ToClose } from '../derived/index.ts'
import { Pump } from '../services/index.ts'
import { logLine, nowMs, stateIn, step, supervise, terminalsOf } from './acting.ts'
import { Supervision, type WorkEffect } from './types.ts'

const idOf = (x: ToClose): string =>
  x.owner._tag === 'Agent' ? x.owner.assignment : x.owner.run

export const CloseEnded: WorkEffect<'CloseEnded'> = {
  name: 'CloseEnded',
  select: terminalsToClose,
  react: (list, d) =>
    Effect.gen(function* () {
      const pump = yield* Pump
      const { timing } = yield* Supervision
      const terminals = yield* terminalsOf(d.moment.work)
      const status = yield* pump.status
      const now = yield* nowMs
      for (const x of list) {
        const reading = status[x.session]
        if (reading === undefined || stateIn(terminals, x.session)?._tag === 'Stopped') continue
        if (now - reading.lastOutput < timing.outputWindow) continue
        const close = Effect.gen(function* () {
          yield* pump.stop(x.session)
          yield* logLine(`${idOf(x)}: its work ended, so its terminal closed`)
          yield* supervise<'ReportTerminal'>({
            _tag: 'ReportTerminal',
            target: { session: x.session },
            content: { move: { _tag: 'Closed' } },
          })
        })
        yield* step(idOf(x), close)
      }
    }),
}
