// The wait of work.qnt's channel on a real store: ONE step, the oldest owed; it blocks while
// nothing is owed and returns when an act of another writer makes a step; no seen filter (the
// same step comes back at once until it is done); an old epoch, the end of the project and a new
// build end it.
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer, Ref, type Scope } from 'effect'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../services/index.ts'
import type { Time } from '../schema/index.ts'
import type { What } from '../state/work/types.ts'
import { type ActCall, dispatchAct, openTop } from '../actions/work.ts'
import { h, NANDA } from '../actions/fixture.test.ts'
import { type WaitEnd, type WaitOptions, waitFor } from './wait.ts'

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
const LEAD = 'role:section-lead'

const services = (dir: string, at: string) => {
  let n = 0
  return Layer.mergeAll(
    StoreLive.pipe(
      Layer.provide(
        Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db') } }),
      ),
    ),
    Layer.succeed(Dir, { cwd: dir }),
    Layer.succeed(Now, { read: Effect.succeed(at as Time) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => `k${++n}`) }),
  )
}

let n = 0
const call = (who: string, what: What, ep = 0): ActCall => ({
  by: NANDA,
  act: { id: `x${++n}`, who, ep, what },
  on: null,
  build: null,
  current: 'b1',
})
const send = (name: string, section: string): What => ({
  _tag: 'SendTask',
  spec: { name, goal: 'g', sections: [section], role: 'section-lead' },
})

const setup = async () => {
  const { p } = await h.started({ 'aristoteles.yaml': PIPED })
  const at = p.now()
  type Needs = Store | Dir | Now | Tokens | Scope.Scope
  const run = <A, E>(e: Effect.Effect<A, E, Needs>) =>
    Effect.runPromise(Effect.scoped(e).pipe(Effect.provide(services(p.dir, at))))
  await run(openTop({ by: NANDA, name: 'T', goal: 'g', sections: ['a', 'b'] }))
  const act = (c: ActCall) => run(dispatchAct(c))
  const waited = (o: Partial<WaitOptions> & Pick<WaitOptions, 'actor'>): Promise<WaitEnd> =>
    run(
      Effect.gen(function* () {
        const store = yield* (yield* Store).open(p.dir, { create: false })
        return yield* waitFor(store, {
          ep: 0,
          pollMs: 20,
          blocking: Effect.void,
          build: Effect.succeed('b1'),
          buildMs: 20,
          ...o,
        })
      }),
    )
  return { act, waited }
}
const stepOf = (end: WaitEnd) => (end._tag === 'Step' ? [end.step.tag, end.step.target] : end._tag)

describe('the wait loop', () => {
  test('one step only, the oldest, and the same step again until it is done', async () => {
    const { act, waited } = await setup()
    await act(call('host', send('one', 'a')))
    await act(call('host', send('two', 'b')))
    expect(stepOf(await waited({ actor: LEAD }))).toEqual(['AssignDo', 't1'])
    expect(stepOf(await waited({ actor: LEAD }))).toEqual(['AssignDo', 't1'])
    await act(call(LEAD, { _tag: 'AssignDo', task: 't1' }))
    expect(stepOf(await waited({ actor: LEAD }))).toEqual(['AssignDo', 't2'])
  }, 90000)

  test('it blocks while nothing is owed, and returns when another writer acts', async () => {
    const { act, waited } = await setup()
    const blocked = { value: false }
    const blocking = Effect.sync(() => void (blocked.value = true))
    const waiting = waited({ actor: LEAD, blocking })
    await Bun.sleep(300)
    expect(blocked.value).toBe(true)
    await act(call('host', send('one', 'a')))
    expect(stepOf(await waiting)).toEqual(['AssignDo', 't1'])
  }, 90000)

  test('a token of an old epoch ends it with no step', async () => {
    const { act, waited } = await setup()
    await act(call('host', send('one', 'a')))
    await act(call(LEAD, { _tag: 'AssignDo', task: 't1' }))
    await act(call('person', { _tag: 'MoveHost', fromSession: 0 }))
    expect(await waited({ actor: 'host' })).toEqual({ _tag: 'Old', now: 1 })
    expect(stepOf(await waited({ actor: 'host', ep: 1 }))).not.toBe('Old')
  }, 90000)

  test('a new build of the installed code ends the wait', async () => {
    const { waited } = await setup()
    const build = await Effect.runPromise(Ref.make('b1'))
    const waiting = waited({ actor: LEAD, build: Ref.get(build) })
    await Bun.sleep(200)
    await Effect.runPromise(Ref.set(build, 'b2'))
    expect(await waiting).toEqual({ _tag: 'Updated' })
  }, 90000)
})
