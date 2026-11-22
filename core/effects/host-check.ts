// The host's pane at the start of the page server (terminals.qnt hostWatched): the host's end is
// heard only while the server runs, so a restart between the host's end and its record would
// lose it. At start, a host that is not down and whose recorded pane is gone is recorded as
// exited, by the harness.
import { Effect } from 'effect'
import { dispatchAct } from '../actions/work.ts'
import { Dir, sha, Spawn, Store } from '../services/index.ts'
import { pathOf } from '../services/paths.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf } from '../state/c16/reads.ts'
const HOST = { _tag: 'Host' } as const

// The pane in the person's tmux, asked of its own server (`tmux -S <socket> display`).
export const tmuxPaneExists = (socket: string, pane: string) =>
  Effect.gen(function* () {
    const argv = [pathOf('tmux'), '-S', socket, 'display', '-p', '-t', pane, '#{pane_id}']
    return (yield* (yield* Spawn).run(argv)).code === 0
  })

export const checkHost = <R>(
  exists: (socket: string, pane: string) => Effect.Effect<boolean, never, R>,
  managedExists?: (session: string) => Effect.Effect<boolean>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { cwd } = yield* Dir
      const events = yield* (yield* (yield* Store).open(cwd, { create: false })).events
      const folded = foldWork(events)
      if (folded === null) return
      const { state, hostPane, hostSession } = folded
      const ep = epochOf(state, HOST)
      if (state.down.has('host') || state.top.ended) return
      const alive = hostPane !== null ? exists(hostPane.socket, hostPane.pane)
        : hostSession !== null && ep === 0 ? managedExists?.(hostSession) : undefined
      if (alive === undefined || (yield* alive)) return
      const body = { _tag: 'Exit', actor: HOST } as const
      const id = sha(JSON.stringify(['host-check', ep]))
      yield* dispatchAct({
        by: { _tag: 'System' },
        act: { id, who: { _tag: 'Harness' }, ep: 0, body },
        on: null,
        build: null,
        current: 'cli',
        actorEpoch: ep,
      })
    }),
  )
