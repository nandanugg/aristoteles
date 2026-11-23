import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { dos } from '../../core/derived/c16/obligations.ts'
import { obligationOf } from '../../core/derived/c16/worker.ts'
import { basisOf, refused } from '../../core/derived/c16/accept.ts'
import { sessionOf } from '../../core/effects/engine.ts'
import type { TerminalReading } from '../../core/schema/outside.ts'
import { take } from '../../core/state/c16/effect.ts'
import { initState, type WorkState } from '../../core/state/c16/state.ts'
import { type Actor, type Body, keyOf } from '../../core/state/c16/types.ts'
import type { ItemRec, RoleDraft } from '../../core/state/c16/data.ts'
const HUMAN: Actor = { _tag: 'Human' }
const HOST: Actor = { _tag: 'Host' }
const PIPE: Actor = { _tag: 'Pipe' }
const role = (name: string): Actor => ({ _tag: 'Role', name })
const roleActor = (name: string) => keyOf(role(name))
import { Dash } from './contract.ts'
import { type DashInput, dashOf, SILENT_MS, USAGE_LIMIT } from './dash.ts'

const rec = (kind: ItemRec['kind'], parent: string | null, says: string): ItemRec => ({
  kind,
  parent,
  name: says,
  says,
  where: null,
  test: null,
  ref: null,
  form: kind === 'rule' ? 'ref' : 'none',
  examples: [],
})
const card = (role: string): RoleDraft => ({ role, words: `${role} words`, model: `${role}-model` })
const NOW = 1_000_000

const start = (): WorkState =>
  initState(
    { name: 'top', goal: 'g', sections: ['a', 'b'], directions: ['d1'] },
    new Map([
      ['dir:d1', rec('dir', null, 'dir says')],
      ['std:s1', rec('std', 'dir:d1', 'std says')],
      ['rule:r1', rec('rule', 'std:s1', 'rule says')],
    ]),
    new Map([['dev', card('dev')], ['qa', card('qa')]]),
    2,
  )
const go = (s: WorkState, body: Body, who: Actor = HUMAN): WorkState =>
  take(s, { id: 'x', who, ep: 0, body, seen: -1, seenVer: 0, vers: s.ver, old: false })
const send = (s: WorkState, owner = 'dev', sections = ['a', 'b']): WorkState =>
  go(s, {
    _tag: 'Open',
    open: { _tag: 'OpenSend',
      spec: { name: `task ${owner}`, goal: `goal ${owner}`, sections, role: owner } },
  }, HOST)
const assigned = (s: WorkState, task: string): WorkState =>
  go(s, { _tag: 'Open', open: { _tag: 'OpenMake', task } }, role('dev'))
const askId = (s: WorkState, kind: 'Execute' | 'Check' | 'Decide'): string =>
  [...s.asks.values()].find((ask) => ask.kind === kind &&
    (kind !== 'Execute' || ask.to._tag === 'Maker'))!.id
const reported = (s: WorkState, task: string, maker: string): WorkState => {
  const who: Actor = { _tag: 'Maker', id: maker }
  const brief = go(assigned(s, task), { _tag: 'ReadBrief', maker }, who)
  return go(brief, {
    _tag: 'Report', ask: askId(brief, 'Execute'), output: 'o', files: [], caught: new Set(),
  }, who)
}
const reviewed = (s: WorkState, verdict: 'Pass' | 'RaiseNoRule'): WorkState =>
  go(s, { _tag: 'Review', ask: askId(s, 'Check'), verdict, points: [] }, role('dev'))
const raised = (s: WorkState): WorkState => reviewed(reported(send(s), 't1', 'm1'), 'RaiseNoRule')
const evaluate = (s: WorkState, level: 'Standard' | 'Direct'): WorkState =>
  go(s, { _tag: 'Evaluate', fix: 't1', level, parts: [], roleDraft: null, summary: 'why' }, PIPE)
const dir2 = { ...rec('dir', null, 'dir new'), name: 'dir says' }
const ship = (s: WorkState): WorkState =>
  go(s, {
    _tag: 'Ship', fix: 't1', items: new Set(['dir:d1']),
    draft: new Map([['dir:d1', dir2]]), resolvesFight: false,
  }, PIPE)
const atPerson = (): WorkState =>
  go(ship(evaluate(raised(start()), 'Direct')), {
    _tag: 'LoopReview', mode: 'self-review turns', fix: 't1', toPerson: true,
  }, PIPE)

const live = (): Record<string, TerminalReading> =>
  Object.fromEntries(
    [keyOf(PIPE), roleActor('dev'), roleActor('qa')].map((k) => [
      sessionOf(k, 0),
      { _tag: 'Live', lastOutput: NOW } as const,
    ]),
  )
const input = (state: WorkState, over: Partial<DashInput> = {}): DashInput => ({
  dir: 'proj',
  build: 'b1',
  hostSession: null,
  now: NOW,
  state,
  host: { model: '', reading: { alive: true, lastOutput: NOW, tail: '' } },
  pipe: { name: 'pipeline', model: 'pm' },
  terminals: live(),
  tails: {},
  markers: [],
  forwards: [],
  principles: { 'dir:d1': ['clarity'] },
  ...over,
})
const dev = (d: Dash) => d.columns.find((c) => c.role === 'dev')?.card.status

describe('the header and the queue', () => {
  test('the header names the dir, the project, the seq and the build', () => {
    const s = send(start())
    const d = dashOf(input(s))
    expect(d.header).toEqual({ dir: 'proj', project: 'top', seq: s.seq, build: 'b1' })
  })

  test('the queue shows only queued and working tasks', () => {
    let s = send(send(start(), 'dev', ['a']), 'qa', ['b'])
    expect(dashOf(input(s)).queue.map((t) => [t.id, t.state])).toEqual([
      ['t1', 'QUEUED'],
      ['t2', 'QUEUED'],
    ])
    s = assigned(s, 't1')
    expect(dashOf(input(s)).queue[0]).toMatchObject({ state: 'WORKING', description: 'goal dev' })
    s = reviewed(reported(send(start(), 'dev', ['a']), 't1', 'm1'), 'Pass')
    expect(dashOf(input(s)).queue).toEqual([])
    expect(dashOf(input(raised(start()))).queue).toEqual([])
  })
})

describe('the status of a terminal', () => {
  test('Working only when the role owes a step; a role that waits on its maker is Waiting', () => {
    expect(dev(dashOf(input(start())))).toBe('Waiting')
    const sent = send(start())
    expect(dev(dashOf(input(sent)))).toBe('Working')
    const made = assigned(sent, 't1')
    const d = dashOf(input(made))
    expect(dev(d)).toBe('Waiting')
    expect(d.columns[0]?.card.work).toBe('Waits for its maker on task dev')
    expect(d.columns[0]?.subagents).toEqual([{ model: 'dev-model', role: 'dev', goal: 'goal dev' }])
    expect(d.columns[1]?.subagents).toEqual([])
  })

  test('the host works while it owes tasks; the pipeline works on an escalation', () => {
    const d = dashOf(input(start()))
    expect(d.host).toMatchObject({ card: { status: 'Working' }, subagents: [] })
    expect(dashOf(input(send(start()))).host.card.status).toBe('Waiting')
    expect(dashOf(input(raised(start()))).pipe).toMatchObject({
      role: 'pipeline',
      model: 'pm',
      status: 'Working',
    })
  })

  test('Inactive when the actor is down in the store', () => {
    const s = { ...send(start()), down: new Set([roleActor('dev')]) }
    const d = dashOf(input(s))
    expect(dev(d)).toBe('Inactive')
    expect(d.columns[1]?.card.status).toBe('Waiting')
  })

  test('Inactive when its pump session is not alive', () => {
    const terminals = {
      ...live(),
      [sessionOf(roleActor('dev'), 0)]: { _tag: 'Ended', exit: 0, lastOutput: NOW } as const,
    }
    expect(dev(dashOf(input(send(start()), { terminals })))).toBe('Inactive')
    const gone = { ...live() }
    delete gone[sessionOf(roleActor('dev'), 0)]
    expect(dev(dashOf(input(send(start()), { terminals: gone })))).toBe('Inactive')
  })

  test('Inactive when its output shows the usage-limit message', () => {
    expect(USAGE_LIMIT.test('Claude usage limit reached. Your limit will reset at 3pm')).toBe(true)
    const tails = { [sessionOf(roleActor('dev'), 0)]: 'x\n5-hour limit reached, resets 3pm' }
    expect(dev(dashOf(input(send(start()), { tails })))).toBe('Inactive')
    const fine = { [sessionOf(roleActor('dev'), 0)]: 'fine' }
    expect(dev(dashOf(input(send(start()), { tails: fine })))).toBe('Working')
  })

  test('Inactive after 60 s with no beat and no output; a beat or output keeps it', () => {
    const old = NOW - SILENT_MS
    const quiet = {
      ...live(),
      [sessionOf(roleActor('dev'), 0)]: { _tag: 'Live', lastOutput: old } as const,
    }
    const s = send(start())
    expect(dev(dashOf(input(s, { terminals: quiet })))).toBe('Inactive')
    const marker = { actor: 'role:dev', session: null, waits: true, beat: NOW - 5000 }
    expect(dev(dashOf(input(s, { terminals: quiet, markers: [marker] })))).toBe('Working')
    const other = { ...marker, session: 'role-dev-e9' }
    expect(dev(dashOf(input(s, { terminals: quiet, markers: [other] })))).toBe('Inactive')
    const edge = {
      ...live(),
      [sessionOf(roleActor('dev'), 0)]: { _tag: 'Live', lastOutput: old + 1 } as const,
    }
    expect(dev(dashOf(input(s, { terminals: edge })))).toBe('Working')
  })

  test('the host card reads the host pane', () => {
    const dead = { alive: false, lastOutput: NOW, tail: '' }
    expect(dashOf(input(start(), { host: { model: 'm', reading: dead } })).host.card)
      .toMatchObject({ model: 'm', status: 'Inactive' })
    expect(dashOf(input(start(), { host: { model: '', reading: null } })).host.card.status)
      .toBe('Inactive')
    const limit = { alive: true, lastOutput: NOW, tail: 'Claude usage limit reached' }
    expect(dashOf(input(start(), { host: { model: '', reading: limit } })).host.card.status)
      .toBe('Inactive')
  })

  test('a status never comes from the seq of an old view: only from readings', () => {
    for (const s of [start(), send(start()), assigned(send(start()), 't1')]) {
      for (const d of [dashOf(input(s)), dashOf(input({ ...s, seq: s.seq + 40 }))]) {
        expect(d.columns.every((c) => c.card.status !== 'Inactive')).toBe(true)
      }
    }
  })
})

describe('the columns', () => {
  test('a role column has its card, its oldest open task and its makers', () => {
    const d = dashOf(input(send(start(), 'dev', ['a'])))
    expect(d.columns.map((c) => c.card.model)).toEqual(['dev-model', 'qa-model'])
    expect(d.columns[0]?.task).toMatchObject({ id: 't1', name: 'task dev', state: 'QUEUED' })
    expect(d.columns[1]?.task).toBeNull()
  })
})

describe('the pipeline row', () => {
  test('a row shows every open escalation with one status; shown only at the person', () => {
    const queued = dashOf(input(raised(start())))
    expect(queued.row).toMatchObject([{ id: 't1', status: 'QUEUED', task: 'task dev' }])
    expect(queued.rowShown).toBe(false)
    const flowing = dashOf(input(evaluate(raised(start()), 'Direct')))
    expect(flowing.row.map((e) => e.status)).toEqual(['IN_PIPELINE'])
    expect(flowing.rowShown).toBe(false)
    const waiting = dashOf(input(atPerson()))
    expect(waiting.row.map((e) => e.status)).toEqual(['WAIT_FOR_REVIEW'])
    expect(waiting.rowShown).toBe(true)
    expect(waiting.row[0]?.reviewMode).toBe('self-review turns')
    expect(dashOf(input(start())).row).toEqual([])
  })

  test('the loop stage is IN_PIPELINE and the draft is a diff of its items', () => {
    const s = ship(evaluate(raised(start()), 'Direct'))
    const [e] = dashOf(input(s)).row
    expect(e?.status).toBe('IN_PIPELINE')
    expect(e?.changes).toMatchObject([
      { key: 'dir:d1', version: 0, before: { says: 'dir says' }, after: { says: 'dir new' } },
    ])
    expect(e?.card).toBeNull()
    expect(e?.summary).toBe('why')
  })

  test('the person edit is an escalation of its own; a removed item has no after', () => {
    const s = go(start(), { _tag: 'AskEdit', draft: new Map([['rule:r1', null]]) })
    const [e] = dashOf(input(s)).row
    expect(e).toMatchObject({ id: 'edit', task: 'your direction edit' })
    expect(e?.changes).toMatchObject([
      { key: 'rule:r1', before: { says: 'rule says' }, after: null },
    ])
  })

  test('the person owes one decision and its row exposes allowed replies', () => {
    const d = dashOf(input(atPerson()))
    expect(d.person.owed).toEqual([{
      _tag: 'Decide', ask: d.row[0]!.ask!, fix: 't1', age: expect.any(Number),
    }])
    expect(d.row[0]?.reply).toEqual(['AcceptIt', 'SendItBack', 'TakeAsIs', 'EvaluateAgain'])
  })

  test('F2.3 and F2.5 distinguish stale basis from a withdrawn occurrence', () => {
    const prior = ship(evaluate(raised(start()), 'Direct'))
    const person = go(prior, { _tag: 'LoopReview', mode: 'self-review turns', fix: 't1', toPerson: true }, PIPE)
    const ask = askId(person, 'Decide')
    const body = { _tag: 'Respond', ask, reply: 'AcceptIt', points: [] } as const
    const response = {
      id: 'response', who: HUMAN, ep: 0, body, seen: basisOf(prior, body),
      seenVer: 0, vers: prior.ver, old: false,
    }
    expect(refused(person, response, 'page')?.refused).toBe('basis')
    const sentBack = go(person, { _tag: 'Respond', ask, reply: 'SendItBack', points: ['revise'] })
    expect(refused(sentBack, response, 'page')?.refused).toBe('stale')
    const page = dashOf(input(sentBack))
    expect(page.row[0]?.ask).toBeNull()
    expect(page.row[0]?.reviewMode).toBeUndefined()
    expect(page.row[0]?.reply).toEqual([])
    expect(page.person.owed.some((entry) => entry._tag === 'Decide')).toBe(false)
  })

  test('F2.1 owed entries encode and decode with their occurrence and form', () => {
    const waiting = go(atPerson(), {
      _tag: 'Open', open: { _tag: 'OpenQuestion', to: HUMAN,
        question: {
          title: 'Which one?', form: { _tag: 'Choice', options: ['A', 'B'], multi: false },
        } },
    }, HOST)
    const down = go(waiting, { _tag: 'Exit', actor: HOST }, { _tag: 'Harness' })
    const ready = go(reviewed(reported(send(start()), 't1', 'm1'), 'Pass'), {
      _tag: 'TopDone',
    }, HOST)
    const views = [dashOf(input(down)), dashOf(input(ready))]
    expect(views.flatMap((dash) => dash.person.owed.map((ob) => ob._tag)).sort()).toEqual(
      ['Decide', 'EndProject', 'Question', 'ReviveHost'],
    )
    for (const dash of views) expect(Schema.decodeUnknownSync(Dash)(
      Schema.encodeSync(Dash)(dash),
    )).toEqual(dash)
  })
})

describe('the sidebar', () => {
  test('each direction, standard and rule has its own version', () => {
    const s = { ...start(), ver: new Map([['dir:d1', 2], ['std:s1', 3], ['rule:r1', 4]]) }
    const [dir] = dashOf(input(s)).directions
    expect(dir).toMatchObject({
      key: 'dir:d1',
      version: 2,
      principles: ['clarity'],
      summary: 'dir says',
      first: ['std says'],
    })
    expect(dir?.standards).toMatchObject([
      {
        version: 3,
        summary: 'std says',
        rules: [{ key: 'rule:r1', version: 4, says: 'rule says', form: 'ref' }],
      },
    ])
  })

  test('a card names the first 3 standards only', () => {
    const items = new Map(start().items)
    for (const n of [2, 3, 4]) items.set(`std:s${n}`, rec('std', 'dir:d1', `std ${n}`))
    const [dir] = dashOf(input({ ...start(), items })).directions
    expect(dir?.first).toHaveLength(3)
    expect(dir?.standards).toHaveLength(4)
  })
})

describe('the forwards', () => {
  test('a forwarded act shows with its quote and the words of its step', () => {
    const s = atPerson()
    const forward = { id: 'f1', body: {
      _tag: 'Respond', ask: askId(s, 'Decide'), reply: 'AcceptIt', points: [],
    } as const, quote: 'ok' }
    const d = dashOf(input(s, { forwards: [forward] }))
    expect(d.forwards).toHaveLength(1)
    expect(d.forwards[0]).toMatchObject({ id: 'f1', quote: 'ok' })
    expect(d.forwards[0]?.words.length).toBeGreaterThan(0)
    expect(dashOf(input(s)).forwards).toEqual([])
  })
})

describe('the wire', () => {
  test('a Dash encodes and decodes to the same value', () => {
    for (const s of [start(), atPerson()]) {
      const d = dashOf(input(s))
      const wire = JSON.parse(JSON.stringify(Schema.encodeSync(Dash)(d)))
      expect(Schema.decodeUnknownSync(Dash)(wire)).toEqual(d)
    }
  })
})

describe('managed workers', () => {
  const shared = {
    worker: 'group:delivery', members: ['host', 'role:dev', 'pipe'],
    account: 'fixture', cli: 'cli', model: 'model', launch: 'SECRET_COMMAND', sessionLimit: 1,
  } as const
  const other = { ...shared, worker: 'private:role:qa', members: ['role:qa'] } as const
  const launch = 'b'.repeat(32)
  const session = `worker-${launch}`
  const key = { worker: shared.worker, generation: 1, launch }
  const reservation = {
    _tag: 'WorkerReserved', ...key, expectedGeneration: 0, purpose: 'work',
    members: shared.members, placement: shared, slot: 'slot',
  } as const
  const binding = {
    _tag: 'WorkerBound', ...key, session, members: [{ actor: 'host', epoch: 0, verifier: 'MEMBER_VERIFIER' }],
    waitVerifier: 'WAIT_VERIFIER',
  } as const

  test('three identities link to one observed session and one selected turn', () => {
    const state = start()
    const offer = {
      ...key, turn: 'turn-7', actor: 'host', epoch: 0, on: state.seq, receiptVerifier: 'TURN_VERIFIER',
      obligation: JSON.stringify(['Open', 'a', null, null, null, null, 0]),
      step: { act: 'Open', task: 'a', fix: null, ask: null, maker: null, actor: null },
    } as const
    const runtime = {
      placements: [shared, other], children: new Map(), serial: new Map(),
      workers: new Map([[shared.worker, { reservation, binding, offer, fenced: false, ended: false }]]),
    }
    const dash = dashOf(input(state, { runtime, localAttach: () => 'tmux attach' }))
    const [worker, waiting] = dash.workers
    expect(worker).toMatchObject({
      id: shared.worker, identities: [{ actor: 'host', label: 'Host' }, { actor: 'role:dev', label: 'dev' },
        { actor: 'pipe', label: 'Pipeline' }],
      status: 'foreground occupied',
      turn: { id: 'turn-7', actor: 'host', step: 'Starting work on a', basis: 0 },
      session: { id: session, attach: 'tmux attach' },
      permits: { provider: { charged: true, used: 1, limit: 1 }, attempts: null, children: null,
        fixes: null, rechecks: null },
    })
    expect([dash.host.card, dash.pipe, dash.columns[0]?.card].map((card) => [card?.worker, card?.session]))
      .toEqual([[shared.worker, session], [shared.worker, session], [shared.worker, session]])
    expect(waiting).toMatchObject({
      status: 'waiting for capacity', session: null, turn: null,
      waits: [{ reason: 'The provider account has no free session slot.', actor: null, step: null }],
      permits: { provider: { charged: false, used: 1, limit: 1 } },
    })
    expect(JSON.stringify(Schema.encodeSync(Dash)(dash))).not.toMatch(/SECRET_COMMAND|MEMBER_VERIFIER|WAIT_VERIFIER|TURN_VERIFIER/)
    const withdrawn = dashOf(input(send(state), { runtime }))
    expect(withdrawn.workers[0]).toMatchObject({ status: 'idle', turn: null })
  })

  test('a fenced generation holds its slot until confirmed end and has no attach action', () => {
    const state = { ...start(), down: new Set(['host']) }
    const page = (ended: boolean) => dashOf(input(state, {
      runtime: {
        placements: [shared, other], children: new Map(), serial: new Map(),
        workers: new Map([[shared.worker, { reservation, binding, offer: null, fenced: true, ended }]]),
      },
      localAttach: () => 'tmux attach',
    }))
    expect(page(false).workers[0]).toMatchObject({
      status: 'stopping', session: { attach: null }, permits: { provider: { charged: true, used: 1 } },
    })
    expect(page(false).person.owed.some((entry) => entry._tag === 'ReviveHost')).toBe(false)
    expect(page(true).workers[0]).toMatchObject({
      status: 'stopped', session: null, permits: { provider: { charged: false, used: 0 } },
    })
    expect(page(true).workers[1]).toMatchObject({ status: 'starting', waits: null })
  })
})


test('the dashboard keeps the fix age order and a selected recheck outside the fix cap', () => {
  const topology = reviewed(reported(send(start()), 't1', 'm1'), 'Pass')
  const finished = topology.tasks.get('t1')!
  const fixtureFix = raised(start()).fixes.get('t1')!
  const state = {
    ...topology,
    tasks: new Map(topology.tasks).set('t1', { ...finished, pending: new Set(['rule:r1']) }),
    fixes: new Map([
      ['t2', { ...fixtureFix, at: 6 }],
      ['t3', { ...fixtureFix, at: 5 }],
      ['edit', { ...fixtureFix, at: 3 }],
    ]),
  }
  const step = dos(state, PIPE).find(({ act }) => act === 'RecheckDone')!
  const placement = { worker: 'role:architect', members: ['pipe'], account: 'fixture',
    cli: 'fixture', model: 'test', launch: 'test', sessionLimit: null } as const
  const key = { worker: placement.worker, generation: 1, launch: 'launch' }
  const runtime = {
    placements: [placement], children: new Map(), serial: new Map(),
    workers: new Map([[placement.worker, {
      reservation: { ...key, _tag: 'WorkerReserved' as const, placement, members: placement.members,
        expectedGeneration: 0, purpose: 'work' as const, slot: 'slot' },
      binding: { ...key, _tag: 'WorkerBound' as const, session: 'session', members: [], waitVerifier: 'verifier' },
      fenced: false, ended: false,
      offer: { ...key, turn: 'turn', actor: 'pipe', epoch: 0, on: state.seq, receiptVerifier: 'receipt',
        step, obligation: obligationOf(state, step) },
    }]]),
  }
  const permit = { actor: 'pipe', concurrency: 1, subagentAllowance: 0, backgroundChildren: true }
  const page = (fixes: Set<string>) => dashOf(input(state, { runtime,
    admission: { policy: new Map([['pipe', permit]]), permits: { roles: new Map(), fixes } },
  })).workers[0]!
  const held = page(new Set(['edit']))
  expect(held.permits.fixes).toMatchObject({
    used: 1, limit: 1, entries: [{ id: 'edit', state: 'held' }, { id: 't3', state: 'waiting' }, { id: 't2', state: 'waiting' }],
  })
  expect(held.permits.rechecks).toMatchObject({ used: 1, limit: null, entries: [{ id: 't1', state: 'selected' }] })
  expect(held.turn?.actor).toBe('pipe')
  expect(held.waits).toEqual([
    { actor: 'pipe', step: 'Evaluating top', reason: 'Fix t3 is waiting for a Pipe attempt permit (limit 1).' },
    { actor: 'pipe', step: 'Evaluating top', reason: 'Fix t2 is waiting for a Pipe attempt permit (limit 1).' },
  ])
  expect(page(new Set()).permits.fixes?.entries.map(({ state }) => state)).toEqual(['ready', 'waiting', 'waiting'])
})
