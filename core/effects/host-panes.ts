// HostPanes (S1): the pump copies the host's pane of each live run (RunState Talking, Working or
// AwaitingEndAccept, never run.end), and stops copying a pane that no live run names. A window of
// an older host of a run (before a continue moved the run) closes, once.
import { Effect } from 'effect'
import { hostPanesOf } from '../derived/index.ts'
import { SessionId } from '../schema/index.ts'
import { Pump } from '../services/index.ts'
import { logLine, step } from './acting.ts'
import type { WorkEffect } from './types.ts'

export const HostPanes: WorkEffect<'HostPanes'> = {
  name: 'HostPanes',
  select: hostPanesOf,
  react: (panes) =>
    Effect.gen(function* () {
      const pump = yield* Pump
      for (const h of panes) yield* pump.adopt(h.session, h.socket, h.pane)
      const live = new Set<string>(panes.map((h) => h.session))
      const status = yield* pump.status
      for (const sid of Object.keys(status).map((key) => SessionId.make(key))) {
        if (live.has(sid)) continue
        if ((yield* pump.paneOf(sid))._tag === 'PersonPane') yield* pump.release(sid)
      }
      for (const h of panes) {
        for (const old of h.former) {
          if (status[old] === undefined) continue
          if ((yield* pump.paneOf(old))._tag === 'PersonPane') continue
          yield* step(
            h.run,
            Effect.andThen(
              pump.stop(old),
              logLine(
                `${h.run}: its host continues in another terminal, ` +
                  'so the window of its old host closed',
              ),
            ),
          )
        }
      }
    }),
}
