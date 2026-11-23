// The wait of protocol.qnt's channel on a real store: ONE step, the first c16 dos gives (the
// oldest first, an answerer that just answered gets its own steps first); it blocks while nothing
// is owed and returns when an act of another writer makes a step; printing consumes nothing (the
// same step comes back at once until it is done); a Hear step carries the typed answer; an old
// epoch, the end of the project and a new build end it.
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer, Ref, type Scope } from 'effect'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../services/index.ts'
import type { Time } from '../schema/index.ts'
import type { Actor, Body } from '../state/c16/types.ts'
import { type ActCall, dispatchAct, writeTop } from '../actions/work.ts'
import { h, NANDA } from '../actions/fixture.test.ts'
import { type WaitEnd, type WaitOptions, waitFor } from './wait.ts'

const openTop = (call: Parameters<typeof writeTop>[0]) => writeTop(call, false)

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
const HOST: Actor = { _tag: 'Host' }
const HUMAN: Actor = { _tag: 'Human' }
const PIPE: Actor = { _tag: 'Pipe' }
const LEAD: Actor = { _tag: 'Role', name: 'section-lead' }

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
const call = (who: Actor, body: Body, ep = 0): ActCall => ({
  by: NANDA,
  act: { id: `x${++n}`, who, ep, body },
  on: null,
  build: null,
  current: 'b1',
})
const send = (name: string, section: string): Body => ({
  _tag: 'Open',
  open: {
    _tag: 'OpenSend',
    spec: { name, goal: 'g', sections: [section], role: 'section-lead' },
  },
})
const make = (task: string): Body => ({ _tag: 'Open', open: { _tag: 'OpenMake', task } })
const ask = (to: Actor, title: string): Body => ({
  _tag: 'Open',
  open: { _tag: 'OpenQuestion', to, question: { title, form: { _tag: 'Single' } } },
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
const stepOf = (end: WaitEnd) =>
  end._tag === 'Step' ? [end.step.act, end.step.task ?? end.step.ask] : end._tag

describe('the wait loop', () => {
  test('one step only, the oldest, and the same step again until it is done', async () => {
    const { act, waited } = await setup()
    await act(call(HOST, send('one', 'a')))
    await act(call(HOST, send('two', 'b')))
    expect(stepOf(await waited({ actor: LEAD }))).toEqual(['Open', 't1'])
    expect(stepOf(await waited({ actor: LEAD }))).toEqual(['Open', 't1'])
    await act(call(LEAD, make('t1')))
    expect(stepOf(await waited({ actor: LEAD }))).toEqual(['Open', 't2'])
  }, 90000)

  test('it blocks while nothing is owed, marks it once, and returns when another writer acts',
    async () => {
      const { act, waited } = await setup()
      const marks = { value: 0 }
      const blocking = Effect.sync(() => void (marks.value += 1))
      const waiting = waited({ actor: LEAD, blocking })
      await Bun.sleep(300)
      expect(marks.value).toBe(1)
      await act(call(HOST, send('one', 'a')))
      expect(stepOf(await waiting)).toEqual(['Open', 't1'])
      expect(marks.value).toBe(1)
      // a step owed at once: nothing blocks, no mark
      await waited({ actor: LEAD, blocking })
      expect(marks.value).toBe(1)
    }, 90000)

  test('an answered question is a Hear step with its typed answer and occurrence id', async () => {
    const { act, waited } = await setup()
    await act(call(HUMAN, { _tag: 'Revive', actor: HOST }))
    await act(call(HOST, { _tag: 'Open', open: { _tag: 'OpenSend',
      spec: { name: 'all', goal: 'g', sections: ['a', 'b'], role: 'section-lead' } } }, 1))
    await act(call(LEAD, make('t1')))
    await act(call(HOST, ask(LEAD, 'which section first?'), 1))
    const owedToLead = await waited({ actor: LEAD })
    expect(stepOf(owedToLead)).toEqual(['AnswerQuestion', expect.any(String)])
    const id = owedToLead._tag === 'Step' ? owedToLead.step.ask ?? '' : ''
    await act(call(LEAD, {
      _tag: 'AnswerQuestion', ask: id, answer: { _tag: 'Single', text: 'section a' },
    }))
    const heard = await waited({ actor: HOST, ep: 1 })
    expect(stepOf(heard)).toEqual(['Hear', id])
    expect(heard._tag === 'Step' ? heard.heard?.ask.id : null).toBe(id)
    expect(heard._tag === 'Step' ? heard.heard?.answer : null).toEqual({
      _tag: 'Single', text: 'section a',
    })
    // printing consumes nothing
    expect(stepOf(await waited({ actor: HOST, ep: 1 }))).toEqual(['Hear', id])
    await act(call(HOST, { _tag: 'Hear', ask: id }, 1))
    await act(call({ _tag: 'Harness' }, { _tag: 'Revive', actor: PIPE }))
    await act(call(PIPE, ask(HOST, 'confirm receipt?'), 1))
    expect(stepOf(await waited({ actor: HOST, ep: 1, buildMs: 20 })))
      .not.toEqual(['Hear', id])
  }, 90000)

  test('an answerer that just answered gets its own step first', async () => {
    const { act, waited } = await setup()
    await act(call(HOST, send('one', 'a')))
    await act(call(HUMAN, { _tag: 'Revive', actor: HOST }))
    await act(call({ _tag: 'Harness' }, { _tag: 'Revive', actor: PIPE }))
    await act(call(HOST, ask(LEAD, 'q1'), 1))
    await act(call(PIPE, ask(LEAD, 'q2'), 1))
    const first = await waited({ actor: LEAD })
    // the oldest first: the send, then the two questions
    expect(stepOf(first)).toEqual(['Open', 't1'])
    await act(call(LEAD, make('t1')))
    const q = await waited({ actor: LEAD })
    expect(q._tag === 'Step' ? q.step.act : q._tag).toBe('AnswerQuestion')
    const id = q._tag === 'Step' ? q.step.ask ?? '' : ''
    await act(call(LEAD, {
      _tag: 'AnswerQuestion', ask: id, answer: { _tag: 'Single', text: 'ok' },
    }))
    await act(call(HOST, send('two', 'b'), 1))
    // A new assignment is its own step and comes before the second question.
    const own = await waited({ actor: LEAD })
    expect(own._tag === 'Step' ? own.step.act : own._tag).not.toBe('AnswerQuestion')
  }, 90000)

  test('a token of an old epoch ends it with no step', async () => {
    const { act, waited } = await setup()
    await act(call(HUMAN, { _tag: 'MoveHost', fromSession: 0 }))
    expect(await waited({ actor: HOST })).toEqual({ _tag: 'Old', now: 1 })
    expect(stepOf(await waited({ actor: HOST, ep: 1, buildMs: 20 })))
      .not.toBe('Old')
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
