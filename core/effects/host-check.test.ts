// checkHost: the host's recorded pane is gone, so its exit is recorded; a pane that is there is
// left alone. The pane is real, on a private tmux server (personPane: -f /dev/null, no TMUX).
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { eventsOf, h } from '../actions/fixture.test.ts'
import { Dir, Env, Now, SpawnLive, StoreLive, Tokens } from '../services/index.ts'
import type { Time } from '../schema/index.ts'
import { foldWork } from '../state/work/fold.ts'
import { checkHost, tmuxPaneExists } from './host-check.ts'

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')

const started = async (pane: ReturnType<typeof h.personPane>) => {
  const { p } = await h.initiated({
    'aristoteles.yaml': PIPED,
    'directions/tsd-writing.yaml': h.DIRECTION,
  })
  h.ok(await p.nanda('top open --name=TSD --goal=g --sections=introduction'))
  const folded = () => foldWork(eventsOf(p.dir))
  h.ok(await p.run('run continue', { tty: true, env: pane.env }))
  const layer = Layer.mergeAll(
    StoreLive.pipe(
      Layer.provide(
        Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } }),
      ),
    ),
    SpawnLive,
    Layer.succeed(Dir, { cwd: p.dir }),
    Layer.succeed(Now, { read: Effect.succeed(p.now() as Time) }),
    Layer.succeed(Tokens, { random: Effect.succeed('z1') }),
  )
  const check = <R>(exists: Parameters<typeof checkHost<R>>[0]) =>
    Effect.runPromise(checkHost(exists).pipe(Effect.provide(layer) as never))
  return { folded, check }
}

describe('checkHost', () => {
  test('a pane that is gone: Exit(host) once; a pane that is there: nothing', async () => {
    const pane = h.personPane('sleep 60')
    try {
      const { folded, check } = await started(pane)
      expect(folded()?.hostPane?.pane).toBe(pane.pane)
      await check(tmuxPaneExists)
      expect(folded()?.state.down.has('host')).toBe(false)

      await check(() => Effect.succeed(false))
      expect(folded()?.state.down.has('host')).toBe(true)
      const seq = folded()?.state.seq
      await check(() => Effect.succeed(false))
      expect(folded()?.state.seq).toBe(seq)
    } finally {
      pane.kill()
    }
  }, 120000)

  test('the real tmux says the pane is gone once its server ends', async () => {
    const pane = h.personPane('sleep 60')
    const there = await Effect.runPromise(
      tmuxPaneExists(pane.socket, pane.pane).pipe(Effect.provide(SpawnLive)),
    )
    pane.kill()
    const gone = await Effect.runPromise(
      tmuxPaneExists(pane.socket, pane.pane).pipe(Effect.provide(SpawnLive)),
    )
    expect([there, gone]).toEqual([true, false])
  })
})
