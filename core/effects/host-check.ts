// The host's pane at the start of the page server (terminals.qnt hostWatched): the host's end is
// heard only while the server runs, so a restart between the host's end and its record would
// lose it. At start, a host that is not down and whose recorded pane is gone is recorded as
// exited, by the harness.
import { Effect } from 'effect'
import { dispatchAct } from '../actions/work.ts'
import { Dir, sha, Spawn, Store } from '../services/index.ts'
import { pathOf } from '../services/paths.ts'
import { foldWork } from '../state/work/fold.ts'
import { epOf } from '../state/work/reads.ts'
import { HARNESS, HOST } from '../state/work/types.ts'

// The pane in the person's tmux, asked of its own server (`tmux -S <socket> display`).
export const tmuxPaneExists = (socket: string, pane: string) =>
  Effect.gen(function* () {
    const argv = [pathOf('tmux'), '-S', socket, 'display', '-p', '-t', pane, '#{pane_id}']
    return (yield* (yield* Spawn).run(argv)).code === 0
  })

export const checkHost = <R>(
  exists: (socket: string, pane: string) => Effect.Effect<boolean, never, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { cwd } = yield* Dir
      const events = yield* (yield* (yield* Store).open(cwd, { create: false })).events
      const folded = foldWork(events)
      if (folded === null || folded.hostPane === null) return
      const { state, hostPane } = folded
      if (state.down.has(HOST) || (yield* exists(hostPane.socket, hostPane.pane))) return
      const what = { _tag: 'Exit', who: HOST } as const
      const id = sha(JSON.stringify(['host-check', epOf(state, HOST)]))
      yield* dispatchAct({
        by: { _tag: 'System' },
        act: { id, who: HARNESS, ep: 0, what },
        on: null,
        build: null,
        current: 'cli',
      })
    }),
  )
