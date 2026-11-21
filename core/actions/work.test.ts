// The new path of the work model: openTop and dispatchAct over a store that the old CLI started
// (its official directions are the items). An accepted act is one event; a copy of its id is not
// stored; each check of the store's refusal comes back as a typed refusal.
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Exit, Layer, type Scope } from 'effect'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../services/index.ts'
import type { Time } from '../schema/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { actorOf, type Body } from '../state/c16/types.ts'
import { EDIT } from '../state/c16/data.ts'
import { type ActCall, dispatchAct, openTop, recordHostPane } from './work.ts'
import { eventsOf, h, NANDA } from './fixture.test.ts'

// The fixture with the pipeline role, and a direction whose rules give evidence: no-code-proof a
// test, no-ticket-ids a test and a ref, repeatable none.
const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
const EVIDENT = h.DIRECTION.replace(
  'checkedBy: linter }\n      - { id: no-ticket-ids',
  "checkedBy: linter, test: 'grep -n :[0-9] docs/tsd.md' }\n      - { id: no-ticket-ids",
).replace(
  'no-ticket-ids, says: "No ticket ids and no chat-thread citations"',
  "no-ticket-ids, test: 'grep -n TCK- docs/tsd.md', ref: 'docs/tsd.md#design:1-4', " +
    'says: "No ticket ids and no chat-thread citations"',
)

const layer = (dir: string, at: string) => {
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
const run = <A, E>(
  dir: string,
  at: string,
  e: Effect.Effect<A, E, Store | Dir | Now | Tokens | Scope.Scope>,
) => Effect.runPromiseExit(Effect.scoped(e).pipe(Effect.provide(layer(dir, at))))
const failed = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error('it did not fail')
  const r = exit.cause.reasons.find((x) => x._tag === 'Fail')
  return r?._tag === 'Fail' ? (r.error as { message: string }) : undefined
}
const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
  return exit.value
}

let n = 0
const call = (
  who: string,
  body: Body,
  more: { readonly ep?: number; readonly on?: number | null } = {},
  build: string | null = null,
): ActCall => ({
  by: NANDA,
  act: { id: `x${++n}`, who: actorOf(who), ep: more.ep ?? 0, body },
  on: more.on ?? null,
  build,
  current: 'b2',
})
const send = (id: string): Body => ({
  _tag: 'Open', open: { _tag: 'OpenSend',
    spec: { name: id, goal: 'g', sections: ['intro'], role: 'section-lead' } },
})
const make: Body = { _tag: 'Open', open: { _tag: 'OpenMake', task: 't1' } }
const askId = (dir: string, kind: 'Check' | 'Execute') =>
  [...(foldWork(eventsOf(dir))?.state.asks.values() ?? [])].find((ask) =>
    ask.kind === kind && (kind !== 'Execute' || ask.to._tag === 'Maker'))!.id


describe('the items of openTop', () => {
  test('a rule has its form by its evidence, and examples from the flow', async () => {
    const { p } = await h.started({
      'aristoteles.yaml': PIPED,
      'directions/tsd-writing.yaml': EVIDENT,
    })
    value(await run(p.dir, p.now(), openTop({ by: NANDA, name: 'T', goal: 'g', sections: [] })))
    const items = foldWork(eventsOf(p.dir))?.state.items
    const rule = (x: string) => [...(items ?? [])].find(([, r]) => r.name === x)?.[1]
    expect(rule('no-code-proof')).toMatchObject({ form: 'mech', ref: null })
    expect(rule('no-ticket-ids')).toMatchObject({
      form: 'both',
      test: 'grep -n TCK- docs/tsd.md',
      ref: 'docs/tsd.md#design:1-4',
    })
    expect(rule('no-code-proof')?.examples.map((e) => e.fits)).toEqual(['follows', 'breaks'])
    const repeatable = [...(items ?? [])].find(([, r]) => r.name === 'repeatable')?.[1]
    expect(repeatable).toMatchObject({ form: 'none', test: null })
    expect(repeatable?.examples).toEqual([
      { fits: 'follows', sample: '## Introduction' },
      { fits: 'breaks', sample: '## Introduction and design, in one section' },
    ])
    const dir = [...(items ?? [])].find(([, r]) => r.kind === 'dir')?.[1]
    expect(dir?.examples.length).toBe(2)
  }, 90000)

  test('no pipeline role: the top is refused', async () => {
    const { p } = await h.started()
    const top = openTop({ by: NANDA, name: 'T', goal: 'g', sections: [] })
    const exit = await run(p.dir, p.now(), top)
    expect(failed(exit)?.message).toBe('no role is the pipeline')
    expect(foldWork(eventsOf(p.dir))).toBeNull()
  }, 90000)
})

describe('work acts through the store', () => {
  test('no top is refused; openTop makes items, cards, tokens; a second is refused', async () => {
    const { p } = await h.started({ 'aristoteles.yaml': PIPED })
    const at = p.now()
    const before = eventsOf(p.dir).length
    expect(failed(await run(p.dir, at, dispatchAct(call('host', send('s')))))?.message).toBe(
      'no top is open',
    )
    const top = value(
      await run(p.dir, at, openTop({ by: NANDA, name: 'TSD', goal: 'g', sections: ['intro'] })),
    )
    expect(top.seq).toBe(before + 1)
    expect(top.secrets.map((s) => s.actor)).toEqual(['host', 'pipe', 'role:section-lead'])
    const folded = foldWork(eventsOf(p.dir))
    expect(folded?.state.top.directions.length).toBeGreaterThan(0)
    expect([...(folded?.state.items.keys() ?? [])].map((x) => x.split(':')[0])).toContain('rule')
    expect(folded?.state.maxTries).toBe(3)
    expect([...(folded?.state.cards.keys() ?? [])]).toEqual(['section-lead'])
    expect(folded?.tokens.get('host')?.length).toBe(1)
    const db = new Database(join(p.dir, '.work', 'aristoteles.db'), { readonly: true })
    const rows = db.query('SELECT item, version, seq FROM item_version').all()
    db.close()
    expect(rows.length).toBe(folded?.state.items.size ?? -1)
    expect(rows[0]).toMatchObject({ version: 0, seq: top.seq })
    const again = await run(p.dir, at, openTop({ by: NANDA, name: 'x', goal: 'g', sections: [] }))
    expect(failed(again)?.message).toBe('the top is open already')
  }, 90000)

  test('accepted acts append, a copy appends nothing, each check refuses in words', async () => {
    const { p } = await h.started({ 'aristoteles.yaml': PIPED })
    const at = p.now()
    value(await run(p.dir, at, openTop({ by: NANDA, name: 'TSD', goal: 'g', sections: ['intro'] })))
    const count = () => eventsOf(p.dir).length
    const sendIt = call('host', send('t'))
    const first = value(await run(p.dir, at, dispatchAct(sendIt)))
    expect(first).toMatchObject({ again: false, token: null })
    expect(first.seq).toBe(count())
    expect(first.state.tasks.size).toBe(1)
    const stored = count()
    const copy = value(await run(p.dir, at, dispatchAct(sendIt)))
    expect(copy).toMatchObject({ again: true, seq: first.seq })
    expect(count()).toBe(stored)

    const refused = async (c: ActCall) => failed(await run(p.dir, at, dispatchAct(c)))?.message
    const assign = make
    expect(await refused(call('role:section-lead', assign, {}, 'b1'))).toBe(
      'this page is an old build: reload it',
    )
    expect(await refused(call('host', assign))).toBe('this actor may not send that act')
    expect(count()).toBe(stored)

    const act = dispatchAct(call('role:section-lead', assign, {}, 'b2'))
    const made = value(await run(p.dir, at, act))
    expect(made.token).toMatchObject({ actor: 'maker:m1', ep: 0 })
    const brief = call('maker:m1', { _tag: 'ReadBrief', maker: 'm1' })
    value(await run(p.dir, at, dispatchAct(brief)))
    const report: Body = {
      _tag: 'Report', ask: askId(p.dir, 'Execute'), output: 'o', files: [], caught: new Set(),
    }
    const seqNow = () => foldWork(eventsOf(p.dir))?.state.seq ?? -1
    expect(await refused(call('maker:m1', report))).toBe(
      'The act needs the basis of its current view.',
    )
    expect(await refused(call('maker:m1', report, { on: seqNow() + 1 }))).toBe(
      'The act needs the basis of its current view.',
    )
    expect(await refused(call('maker:m1', report, { on: 0 }))).toBe(
      'the act was built on an older view: look again and send it again',
    )
    expect(foldWork(eventsOf(p.dir))?.tokens.get('maker:m1')?.map((t) => t.ep)).toEqual([0])

    // MoveHost: the host gets epoch 1 and a new token; the old epoch is refused, a copy is illegal.
    const move = call('human', { _tag: 'MoveHost', fromSession: 0 })
    const moved = value(await run(p.dir, at, dispatchAct(move)))
    expect(moved.token).toMatchObject({ actor: 'host', ep: 1 })
    expect(foldWork(eventsOf(p.dir))?.tokens.get('host')?.map((t) => t.ep)).toEqual([0, 1])
    expect(await refused(call('host', { _tag: 'TopDone' }, { ep: 0 }))).toBe(
      'this process was replaced by a newer one',
    )
    expect(await refused(call('human', { _tag: 'MoveHost', fromSession: 0 }))).toBe(
      'the act is not allowed in the state now',
    )
    expect(await refused(call('host', { _tag: 'TopDone' }, { ep: 1 }))).toBe(
      'the act is not allowed in the state now',
    )
  }, 90000)
})

describe('the basis of an act', () => {
  test('a host pane event is no act: --on the current seq is accepted', async () => {
    const { p } = await h.started({ 'aristoteles.yaml': PIPED })
    const at = p.now()
    value(await run(p.dir, at, openTop({ by: NANDA, name: 'TSD', goal: 'g', sections: ['intro'] })))
    value(await run(p.dir, at, recordHostPane(NANDA, { socket: 's', pane: '%1' })))
    const step = async (c: ActCall) => value(await run(p.dir, at, dispatchAct(c)))
    await step(call('host', send('t')))
    await step(call('role:section-lead', make, {}, 'b2'))
    await step(call('maker:m1', { _tag: 'ReadBrief', maker: 'm1' }))
    const seqNow = () => foldWork(eventsOf(p.dir))?.state.seq ?? -1
    const report: Body = {
      _tag: 'Report', ask: askId(p.dir, 'Execute'), output: 'o', files: [], caught: new Set(),
    }
    await step(call('maker:m1', report, { on: seqNow() }))
    const review: Body = { _tag: 'Review', ask: askId(p.dir, 'Check'), verdict: 'Pass', points: [] }
    await step(call('role:section-lead', review, { on: seqNow() }, 'b2'))
    expect(foldWork(eventsOf(p.dir))?.state.tasks.get('t1')?.state).toBe('Done')
  }, 90000)

  test('AskEdit uses the versions at its supplied basis', async () => {
    const { p } = await h.started({ 'aristoteles.yaml': PIPED })
    const at = p.now()
    value(await run(p.dir, at, openTop({ by: NANDA, name: 'TSD', goal: 'g', sections: ['intro'] })))
    const items = foldWork(eventsOf(p.dir))?.state.items ?? new Map()
    const [key, rec] = [...items].find(([x]) => x.startsWith('dir:')) ?? ['', undefined]
    if (rec === undefined) throw new Error('no direction item')
    const draft = new Map([[key, { ...rec, says: 'edited' }]])
    value(await run(p.dir, at, dispatchAct(call('human', { _tag: 'AskEdit', draft }, { on: 0 }))))
    const state = foldWork(eventsOf(p.dir))?.state
    expect(state?.ver.size).toBeGreaterThan(0)
    expect(state?.fixes.get(EDIT)?.base).toEqual(state?.ver)
  }, 90000)
})

test('question, replay, page-only and ended refusals are typed through the dispatcher', async () => {
  const { p } = await h.started({ 'aristoteles.yaml': PIPED })
  const at = p.now()
  value(await run(p.dir, at, openTop({ by: NANDA, name: 'T', goal: 'g', sections: ['intro'] })))
  const step = (c: ActCall) => run(p.dir, at, dispatchAct(c)).then((result) => {
    if (result._tag === 'Failure') throw new Error(`${c.act.body._tag}: ${result.cause}`)
    return value(result)
  })
  const state = () => foldWork(eventsOf(p.dir))!.state
  const checks = new Set<string>()
  const fails = async (c: ActCall, reason: string) => {
    const before = eventsOf(p.dir).length
    expect(failed(await run(p.dir, at, dispatchAct(c)))).toMatchObject({
      refused: reason, words: expect.any(String),
    })
    expect(eventsOf(p.dir)).toHaveLength(before)
    checks.add(reason)
  }
  await step(call('host', send('t')))
  await fails(call('host', make), 'authority')
  await fails(call('role:section-lead', make, {}, 'b1'), 'build')
  await fails(call('host', { _tag: 'TopDone' }), 'legal')
  await step(call('role:section-lead', make))
  const q: Body = { _tag: 'Open', open: {
    _tag: 'OpenQuestion', to: { _tag: 'Human' },
    question: { title: 'Which?', form: { _tag: 'Single' } },
  } }
  await step(call('maker:m1', q))
  const first = [...state().asks.values()].find((a) => a.kind === 'Question')!.id
  await fails(call('maker:m1', q), 'pair')
  const answer = (ask: string, text: string): Body => ({
    _tag: 'AnswerQuestion', ask, answer: { _tag: 'Single', text },
  })
  await fails(call('human', answer(first, '')), 'form')
  await step(call('human', answer(first, 'Beta')))
  await fails(call('human', answer(first, 'different')), 'stale')
  await step(call('maker:m1', { _tag: 'Hear', ask: first }))
  await fails(call('maker:m1', { _tag: 'Hear', ask: first }), 'heard')
  expect(state().heardIds.get(first)).toBe('maker:m1')
  expect(failed(await run(p.dir, at, dispatchAct(call('host', { _tag: 'Hear', ask: first })))))
    .toMatchObject({ refused: 'heard', words: 'that answer was already heard by maker:m1' })
  await step(call('maker:m1', q))
  const second = [...state().asks.values()].find((a) => a.kind === 'Question')!.id
  await step(call('human', { _tag: 'Revive', actor: { _tag: 'Host' } }))
  await step(call('human', answer(second, 'Alpha')))
  await step(call('maker:m1', { _tag: 'Hear', ask: second }))
  await fails(call('maker:m1', q), 'cap')
  const move = call('human', { _tag: 'MoveHost', fromSession: 0 })
  await fails({ ...move, by: { _tag: 'Person', name: 'Nanda', channel: 'ui' } }, 'terminal')
  await step(move)
  await fails(call('host', { _tag: 'TopDone' }), 'epoch')
  await step(call('maker:m1', { _tag: 'ReadBrief', maker: 'm1' }))
  const report: Body = {
    _tag: 'Report', ask: askId(p.dir, 'Execute'), output: 'o', files: [], caught: new Set(),
  }
  await fails(call('maker:m1', report, { on: 0 }), 'basis')
  await step(call('maker:m1', report, { on: state().seq }))
  const review: Body = { _tag: 'Review', ask: askId(p.dir, 'Check'), verdict: 'Pass', points: [] }
  await step(call('role:section-lead', review, { on: state().seq }))
  await step(call('host', { _tag: 'TopDone' }, { ep: state().ep.get('host')! }))
  await step(call('human', { _tag: 'EndProject' }))
  await fails(call('human', { _tag: 'EndProject' }), 'ended')
  expect(checks.size).toBe(12)
}, 90000)
