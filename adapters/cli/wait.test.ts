// work wait <token> by the CLI: one step printed (words, then its command), a refusal with no
// token or with an old token, the words of an old epoch, and the marker that the wait writes
// while it blocks.
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer, type Scope } from 'effect'
import { dispatchAct, openTop } from '../../core/actions/work.ts'
import { h, NANDA } from '../../core/actions/fixture.test.ts'
import type { Time } from '../../core/schema/index.ts'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../../core/services/index.ts'
import { actorOf, type Body } from '../../core/state/c16/types.ts'
import { readMarkers } from '../live/waiting.ts'

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')

const setup = async () => {
  const { p } = await h.initiated({ 'aristoteles.yaml': PIPED })
  const at = p.now()
  let k = 0
  const layer = Layer.mergeAll(
    StoreLive.pipe(
      Layer.provide(
        Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } }),
      ),
    ),
    Layer.succeed(Dir, { cwd: p.dir }),
    Layer.succeed(Now, { read: Effect.succeed(at as Time) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => `k${++k}`) }),
  )
  const run = <A, E>(e: Effect.Effect<A, E, Store | Dir | Now | Tokens | Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(e).pipe(Effect.provide(layer)))
  const opened = await run(openTop({ by: NANDA, name: 'T', goal: 'g', sections: ['a', 'b'] }))
  let n = 0
  const act = (who: string, body: Body, ep = 0) =>
    run(
      dispatchAct({
        by: NANDA,
        act: { id: `w${++n}`, who: actorOf(who), ep, body },
        on: null,
        build: null,
        current: 'b1',
      }),
    )
  const send = (name: string, section: string) =>
    act('host', {
      _tag: 'Open', open: { _tag: 'OpenSend',
        spec: { name, goal: 'g', sections: [section], role: 'section-lead' } },
    })
  const secret = (actor: string) => opened.secrets.find((s) => s.actor === actor)?.secret ?? ''
  return { p, act, send, token: `w.role:section-lead.0.${secret('role:section-lead')}`, secret }
}
const waitingNow = (p: { dir: string }) =>
  readMarkers({ ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') }, p.dir).some(
    (m) => m.waits,
  )

describe('work wait', () => {
  test('prints one step, the oldest, with its command', async () => {
    const { p, send, token } = await setup()
    await send('one', 'a')
    await send('two', 'b')
    const out = (await p.agent(`wait ${token}`)).out.split('\n')
    expect(out.at(-1)).toBe(`work assign ${token} t1`)
    expect(out.join('\n')).not.toContain('t2')
    expect((await p.agent(`wait ${token}`)).out.split('\n').at(-1)).toBe(`work assign ${token} t1`)
  }, 90000)

  test('no token, and an old token of the old store, are refused in words', async () => {
    const { p } = await setup()
    const none = await p.agent('wait')
    expect(none.code).not.toBe(0)
    expect(none.err).toContain('the person has no work wait')
    const old = await p.agent('wait a7.abc123')
    expect(old.code).not.toBe(0)
    expect(old.err).toContain('this store is new')
  }, 90000)

  test('a token of an old epoch: the terminal is told to stop, with no step', async () => {
    const { p, act, secret } = await setup()
    await act('human', { _tag: 'MoveHost', fromSession: 0 })
    const out = (await p.agent(`wait w.host.0.${secret('host')}`)).out
    expect(out).toContain("this terminal's token is old")
    expect(out).toContain('STOP')
  }, 90000)

  test('it blocks with its marker written, and prints the step that appears', async () => {
    const { p, send, token } = await setup()
    const waiting = p.agent(`wait ${token}`)
    await Bun.sleep(1000)
    expect(waitingNow(p)).toBe(true)
    await send('one', 'a')
    expect((await waiting).out.split('\n').at(-1)).toBe(`work assign ${token} t1`)
    expect(waitingNow(p)).toBe(false)
  }, 90000)
})
