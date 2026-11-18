// The new path of the work model: openTop and dispatchAct over a store that the old CLI started
// (its official directions are the items). An accepted act is one event; a copy of its id is not
// stored; each check of the store's refusal comes back as a typed refusal.
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Exit, Layer, type Scope } from 'effect'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../services/index.ts'
import type { Time } from '../schema/index.ts'
import { foldWork } from '../state/work/fold.ts'
import type { Act, What } from '../state/work/types.ts'
import { type ActCall, dispatchAct, openTop } from './work.ts'
import { eventsOf, h, NANDA } from './fixture.test.ts'

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
  what: What,
  more: Partial<Act> = {},
  build: string | null = null,
): ActCall => ({
  by: NANDA,
  act: { id: `x${++n}`, who, ep: 0, what, seen: -1, seenVer: 0, vers: new Map(), ...more },
  build,
  current: 'b2',
})
const send = (id: string): What => ({
  _tag: 'SendTask',
  spec: { name: id, goal: 'g', sections: ['intro'], role: 'architect' },
})

describe('work acts through the store', () => {
  test('no top is refused; openTop makes items, cards, tokens; a second one is refused', async () => {
    const { p } = await h.started()
    const at = p.now()
    const before = eventsOf(p.dir).length
    expect(failed(await run(p.dir, at, dispatchAct(call('host', send('s')))))?.message).toBe(
      'no top is open',
    )
    const top = value(
      await run(p.dir, at, openTop({ by: NANDA, name: 'TSD', goal: 'g', sections: ['intro'] })),
    )
    expect(top.seq).toBe(before + 1)
    expect(top.secrets.map((s) => s.actor)).toEqual([
      'host',
      'pipe',
      'role:architect',
      'role:section-lead',
    ])
    const folded = foldWork(eventsOf(p.dir))
    expect(folded?.state.top.directions.length).toBeGreaterThan(0)
    expect([...(folded?.state.items.keys() ?? [])].map((x) => x.split(':')[0])).toContain('rule')
    expect(folded?.state.maxTries).toBe(3)
    expect([...(folded?.state.cards.keys() ?? [])]).toEqual(['architect', 'section-lead'])
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
    const { p } = await h.started()
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
    const assign: What = { _tag: 'AssignDo', task: 't1' }
    expect(await refused(call('role:architect', assign, {}, 'b1'))).toBe(
      'the act comes from an old build of the page',
    )
    expect(await refused(call('host', assign))).toBe('host does not act AssignDo')
    expect(count()).toBe(stored)

    const made = value(await run(p.dir, at, dispatchAct(call('role:architect', assign, {}, 'b2'))))
    expect(made.token).toMatchObject({ actor: 'maker:m1', ep: 0 })
    const brief = call('maker:m1', { _tag: 'ReadBrief', maker: 'm1' })
    value(await run(p.dir, at, dispatchAct(brief)))
    const report: What = { _tag: 'Report', maker: 'm1', output: 'o', caught: new Set() }
    expect(await refused(call('maker:m1', report, { seen: 7 }))).toBe(
      'Report was built on a state that moved',
    )
    expect(foldWork(eventsOf(p.dir))?.tokens.get('maker:m1')?.map((t) => t.ep)).toEqual([0])

    // MoveHost: the host gets epoch 1 and a new token; the old epoch is refused, a copy is illegal.
    const move = call('person', { _tag: 'MoveHost', fromSession: 0 })
    const moved = value(await run(p.dir, at, dispatchAct(move)))
    expect(moved.token).toMatchObject({ actor: 'host', ep: 1 })
    expect(foldWork(eventsOf(p.dir))?.tokens.get('host')?.map((t) => t.ep)).toEqual([0, 1])
    expect(await refused(call('host', { _tag: 'TopDone' }, { ep: 0 }))).toBe(
      'the token of host is of an old epoch',
    )
    expect(await refused(call('person', { _tag: 'MoveHost', fromSession: 0 }))).toBe(
      'MoveHost is not legal in this state',
    )
    expect(await refused(call('host', { _tag: 'TopDone' }, { ep: 1 }))).toBe(
      'TopDone is not legal in this state',
    )
  }, 90000)
})
