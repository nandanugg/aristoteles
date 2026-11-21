// The host's way in: `work run continue` (revive, or move), the pane it records, and the CLI's
// stop hook (`work hook stopped <token>`, the exit of an actor that stopped at its prompt).
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { dispatchAct } from '../../core/actions/work.ts'
import { eventsOf, h, NANDA } from '../../core/actions/fixture.test.ts'
import type { Time } from '../../core/schema/index.ts'
import { Dir, Env, Now, StoreLive, Tokens } from '../../core/services/index.ts'
import { actorOf } from '../../core/state/c16/types.ts'
import { foldWork } from '../../core/state/c16/fold.ts'
import { stopHookSettings } from '../live/stop-hook.ts'

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
const PANE = { env: { TMUX: '/tmp/ar-host.sock,1,0', TMUX_PANE: '%3' } }

const opened = async () => {
  const { p } = await h.initiated({
    'aristoteles.yaml': PIPED,
    'directions/tsd-writing.yaml': h.DIRECTION,
  })
  h.ok(await p.nanda('top open --name=TSD --goal="Write the TSD" --sections=introduction'))
  let n = 0
  const layer = Layer.mergeAll(
    StoreLive.pipe(
      Layer.provide(
        Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } }),
      ),
    ),
    Layer.succeed(Dir, { cwd: p.dir }),
    Layer.succeed(Now, { read: Effect.succeed(p.now() as Time) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => `z${++n}`) }),
  )
  const act = (id: string, who: string, body: Parameters<typeof dispatchAct>[0]['act']['body']) =>
    Effect.runPromise(
      Effect.scoped(
        dispatchAct({
          by: NANDA,
          act: { id, who: actorOf(who), ep: 0, body },
          on: null,
          build: null,
          current: 'b',
        }),
      ).pipe(Effect.provide(layer)),
    )
  const folded = () => foldWork(eventsOf(p.dir))
  const exits = () =>
    eventsOf(p.dir).filter((r) =>
      r.event._tag === 'Work' && r.event.create._tag === 'Acted' &&
      r.event.create.act.body._tag === 'Exit'
    ).length
  // A project opens with its actors down (or up, before that change): the host is down here.
  const downHost = async () => {
    if (folded()?.state.down.has('host')) return
    await act('down', 'harness', { _tag: 'Exit', actor: { _tag: 'Host' } })
  }
  return { p, act, folded, exits, downHost }
}
const tokenOf = (out: string): string => out.match(/^ {2}host: (w\.\S+)$/m)?.[1] ?? ''

describe('work run continue, and the stop hook', () => {
  test('the host down: revive, with its pane; then a move; a stale move is refused', async () => {
    const { p, act, folded, downHost } = await opened()
    await downHost()
    expect(folded()?.state.down.has('host')).toBe(true)

    const first = h.ok(await p.run('run continue', { tty: true, ...PANE }))
    expect(first.out).toContain('Revive taken')
    expect(tokenOf(first.out)).toMatch(/^w\.host\.1\./)
    expect(first.out).toContain(`work wait ${tokenOf(first.out)}`)
    expect(first.out).toContain('sections of the top')
    expect(folded()?.state.down.has('host')).toBe(false)
    expect(folded()?.hostPane).toEqual({ socket: '/tmp/ar-host.sock', pane: '%3' })

    const second = h.ok(await p.run('run continue', { tty: true, ...PANE }))
    expect(second.out).toContain('MoveHost taken')
    expect(tokenOf(second.out)).toMatch(/^w\.host\.2\./)
    expect(folded()?.state.session).toBe(1)

    // A second copy of the move, built on the session that moved on: refused.
    await expect(act('copy', 'human', { _tag: 'MoveHost', fromSession: 0 })).rejects.toThrow()
    expect(folded()?.state.session).toBe(1)
  }, 120000)

  test('no tmux pane: run continue is refused and records nothing', async () => {
    const { p, folded } = await opened()
    const r = await p.run('run continue', { tty: true })
    expect(r.code).toBe(1)
    expect(r.err).toContain('inside tmux')
    expect(folded()?.hostPane).toBeNull()
  }, 120000)

  test('hook stopped: the exit once; a second call and an old token do nothing', async () => {
    const { p, folded, exits, downHost } = await opened()
    await downHost()
    const old = tokenOf(h.ok(await p.run('run continue', { tty: true, ...PANE })).out)
    const now = tokenOf(h.ok(await p.run('run continue', { tty: true, ...PANE })).out)
    const before = exits()

    const stale = await p.agent(`hook stopped ${old}`)
    expect([stale.code, stale.out.trim(), exits()]).toEqual([0, '', before])
    const first = await p.agent(`hook stopped ${now}`)
    expect([first.code, first.out.trim(), exits()]).toEqual([0, '', before + 1])
    expect(folded()?.state.down.has('host')).toBe(true)
    const again = await p.agent(`hook stopped ${now}`)
    expect([again.code, again.out.trim(), exits()]).toEqual([0, '', before + 1])
  }, 120000)

  test('the settings of the launch carry a Stop hook with the token', () => {
    const settings = JSON.parse(stopHookSettings('w.host.2.abc'))
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({
      type: 'command',
      command: 'work hook stopped w.host.2.abc',
    })
  })
})
