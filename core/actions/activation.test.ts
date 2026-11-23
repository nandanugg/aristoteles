// Onboarding's activation, the store side (contract 6c v6; core/model/activation.qnt): an inactive
// store refuses every work act `inactive` before anything else is read; Activated and HostRebound
// are checked inside their own write; `work top open` binds the activated host's verifier and
// makes no new host secret; roll back removes only an inactive store of its generation.
// The F6 fixtures of the store side: F6.0, F6.1, F6.2, F6.9, F6.16 (F6.10: src/store/sqlite.test.ts).
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Exit, Layer, type Scope } from 'effect'
import { Dir, Env, FilesLive, Now, sha, Store, StoreLive, Tokens } from '../services/index.ts'
import type { Time } from '../schema/index.ts'
import { actorOf } from '../state/c16/types.ts'
import {
  activationOf,
  appendActivated,
  appendHostRebound,
  deleteInactive,
  isInactive,
} from './activation.ts'
import { dispatchIn, eventsOf, h, NANDA } from './fixture.test.ts'
import { dispatchAct, openTop, recordForward, recordHostPane } from './work.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf } from '../state/c16/reads.ts'
import { dos } from '../derived/c16/obligations.ts'
import { sessionAt } from '../effects/engine.ts'

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
const layer = (dir: string, at: string) => {
  let n = 0
  return Layer.mergeAll(
    StoreLive.pipe(
      Layer.provide(
        Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db') } }),
      ),
    ),
    FilesLive,
    Layer.succeed(Dir, { cwd: dir }),
    Layer.succeed(Now, { read: Effect.succeed(at as Time) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => `k${++n}`) }),
  )
}
const run = <A, E>(
  dir: string,
  at: string,
  e: Effect.Effect<A, E, Store | Dir | Now | Tokens | Scope.Scope>,
) => Effect.runPromiseExit(Effect.scoped(e).pipe(Effect.provide(layer(dir, at))))
const refusedOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error('it did not fail')
  const r = exit.cause.reasons.find((x) => x._tag === 'Fail')
  return r?._tag === 'Fail' ? (r.error as { refused?: string; message: string }) : undefined
}
const ok = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
  return exit.value
}

// An inactive store of generation 1, made as onboarding's activation step 2 makes it.
const inactive = () => {
  const p = h.project({ 'aristoteles.yaml': PIPED })
  const input = {
    _tag: 'DefineWorkflow',
    target: {},
    content: { directions: [], activation: { generation: 1 } },
  } as const
  const made = dispatchIn(p.dir, NANDA, input as never, p.now() as Time)
  if (!Exit.isSuccess(made)) throw new Error(String(made.cause))
  return p
}
const S = 'the-host-secret'
const activate = (p: { dir: string; now: () => string }, generation = 1) =>
  run(p.dir, p.now(), appendActivated(NANDA, { generation, launch: 'L1', hostVerifier: sha(S) }))
const open = (p: { dir: string; now: () => string }, hostSession?: string) =>
  run(p.dir, p.now(), openTop({
    by: NANDA,
    name: 'T',
    goal: 'g',
    sections: ['intro'],
    ...(hostSession === undefined ? {} : { hostSession }),
  }))

describe('an inactive store', () => {
  test('is read as inactive at its generation, with no binding', () => {
    const p = inactive()
    expect(activationOf(eventsOf(p.dir))).toEqual({
      generation: 1,
      active: false,
      binding: null,
      topOpened: false,
    })
    expect(isInactive(eventsOf(p.dir))).toBe(true)
  }, 60000)

  test('F6.1: work top open, a C16 act and a workflow action are refused `inactive`', async () => {
    const p = inactive()
    const before = eventsOf(p.dir).length
    expect(refusedOf(await open(p))?.refused).toBe('inactive')
    const act = dispatchAct({
      by: NANDA,
      act: { id: 'a1', who: actorOf('host'), ep: 0, body: { _tag: 'TopDone' } },
      on: null,
      build: null,
      current: 'cli',
    })
    expect(refusedOf(await run(p.dir, p.now(), act))?.refused).toBe('inactive')
    const read = { _tag: 'ReadSource', target: { name: 'page' }, content: { revision: 'r1' } }
    const source = dispatchIn(p.dir, { _tag: 'System' }, read as never, p.now() as Time)
    expect(refusedOf(source)?.refused).toBe('inactive')
    expect(eventsOf(p.dir).length).toBe(before)
  }, 60000)

  test('F6.1: the page forward and the host pane bookkeeping are refused `inactive`', async () => {
    const p = inactive()
    const fwd = recordForward(NANDA, { act: { _tag: 'EndProject' } as never, on: null, quote: 'q' })
    expect(refusedOf(await run(p.dir, p.now(), fwd))?.refused).toBe('inactive')
    const pane = recordHostPane(NANDA, { socket: '/tmp/s', pane: '%1' })
    expect(refusedOf(await run(p.dir, p.now(), pane))?.refused).toBe('inactive')
  }, 60000)

  test('F6.0: an act also stale and of an old epoch is refused `inactive` (no top is read)', async () => {
    const p = inactive()
    const act = dispatchAct({
      by: NANDA,
      act: { id: 'a2', who: actorOf('host'), ep: -1, body: { _tag: 'TopDone' } },
      on: 999,
      build: 'old',
      current: 'cli',
    })
    expect(refusedOf(await run(p.dir, p.now(), act))?.refused).toBe('inactive')
  }, 60000)

  test('F6.16: a repeat DefineWorkflow does not touch the inactive generation', () => {
    const p = inactive()
    const again = {
      _tag: 'DefineWorkflow',
      target: {},
      content: { directions: [], activation: { generation: 2 } },
    } as const
    const exit = dispatchIn(p.dir, NANDA, again as never, p.now() as Time)
    expect(Exit.isSuccess(exit)).toBe(false)
    expect(eventsOf(p.dir).length).toBe(1)
    expect(activationOf(eventsOf(p.dir))?.generation).toBe(1)
  }, 60000)
})

describe('Activated', () => {
  test('makes the store active, bound to the launch and its verifier', async () => {
    const p = inactive()
    ok(await activate(p))
    expect(activationOf(eventsOf(p.dir))).toEqual({
      generation: 1,
      active: true,
      binding: { launch: 'L1', verifier: sha(S) },
      topOpened: false,
    })
  }, 60000)

  test('F6.9: a second Activated, or one of another generation, is refused `legal`', async () => {
    const p = inactive()
    expect(refusedOf(await activate(p, 2))?.refused).toBe('legal')
    ok(await activate(p))
    expect(refusedOf(await activate(p))?.refused).toBe('legal')
  }, 60000)

  test('is refused on a store work init made (active at once)', async () => {
    const { p } = await h.started({ 'aristoteles.yaml': PIPED })
    expect(refusedOf(await activate(p))?.refused).toBe('legal')
  }, 60000)
})

describe('work top open after activation', () => {
  test('F6.2: the top binds the activated verifier and makes no host secret', async () => {
    const p = inactive()
    ok(await activate(p))
    // the bound host's session is required: without it the top would start with no host
    expect(refusedOf(await open(p))?.refused).toBe('legal')
    const opened = ok(await open(p, 'aristoteles-launch-L1'))
    expect(opened.hostBound).toBe(true)
    expect(opened.secrets.map((t) => t.actor)).not.toContain('host')
    const event = eventsOf(p.dir).find(
      (r) => r.event._tag === 'Work' && 'create' in r.event && r.event.create._tag === 'Opened',
    )?.event
    const tokens = event?._tag === 'Work' && 'create' in event && event.create._tag === 'Opened'
      ? event.create.tokens
      : []
    expect(tokens.find(([actor]) => actor === 'host')?.[1]).toBe(sha(S))
    // the bound host is UP at epoch 0 in its launch's session, and is told a real step
    const folded = foldWork(eventsOf(p.dir))
    expect(folded?.hostSession).toBe('aristoteles-launch-L1')
    expect(folded?.state.down.has('host')).toBe(false)
    expect(epochOf(folded!.state, actorOf('host'))).toBe(0)
    expect(dos(folded!.state, actorOf('host')).length).toBeGreaterThan(0)
    expect(String(sessionAt(folded!.hostSession, 'host', 0))).toBe('aristoteles-launch-L1')
    expect(String(sessionAt(folded!.hostSession, 'host', 1))).toBe('host-e1')
  }, 60000)

  test('a store work init made opens with workers and supplies no launch secrets', async () => {
    const { p } = await h.started({ 'aristoteles.yaml': PIPED })
    const opened = ok(await open(p))
    expect(opened.hostBound).toBe(false)
    expect(opened.secrets).toEqual([])
    const event = eventsOf(p.dir).at(-1)?.event
    expect(event).toMatchObject({ _tag: 'Work', create: { _tag: 'Opened', placements: expect.any(Array) } })
  }, 60000)
})

describe('HostRebound', () => {
  const rebind = (p: { dir: string; now: () => string }, expected: string) =>
    run(p.dir, p.now(), appendHostRebound(NANDA, {
      generation: 1,
      launch: 'L2',
      expected,
      hostVerifier: sha('S2'),
    }))

  test('moves the binding before the top, from the launch it expected', async () => {
    const p = inactive()
    expect(refusedOf(await rebind(p, 'L1'))?.refused).toBe('legal') // not active yet
    ok(await activate(p))
    expect(refusedOf(await rebind(p, 'L0'))?.refused).toBe('legal') // the binding moved
    ok(await rebind(p, 'L1'))
    expect(activationOf(eventsOf(p.dir))?.binding).toEqual({ launch: 'L2', verifier: sha('S2') })
    const opened = ok(await open(p, 'aristoteles-launch-L2'))
    const event = eventsOf(p.dir).at(-1)?.event
    expect(opened.hostBound).toBe(true)
    expect(event?._tag === 'Work' && 'create' in event && event.create._tag === 'Opened'
      ? event.create.tokens.find(([a]) => a === 'host')?.[1]
      : null).toBe(sha('S2'))
  }, 60000)

  test('is refused once the top is open', async () => {
    const p = inactive()
    ok(await activate(p))
    ok(await open(p, 'aristoteles-launch-L1'))
    expect(refusedOf(await rebind(p, 'L1'))?.refused).toBe('legal')
  }, 60000)
})

describe('roll back (deleteInactive)', () => {
  test('removes an inactive store of its generation; refuses another generation', async () => {
    const p = inactive()
    expect(refusedOf(await run(p.dir, p.now(), deleteInactive(2)))?.refused).toBe('legal')
    expect(eventsOf(p.dir).length).toBe(1)
    ok(await run(p.dir, p.now(), deleteInactive(1)))
    // the dir has no store any more: reading it is refused, as for a dir never started
    expect(() => eventsOf(p.dir)).toThrow('no work store')
  }, 60000)

  test('never removes an active store', async () => {
    const p = inactive()
    ok(await activate(p))
    expect(refusedOf(await run(p.dir, p.now(), deleteInactive(1)))?.refused).toBe('legal')
    expect(eventsOf(p.dir).length).toBe(2)
  }, 60000)
})
