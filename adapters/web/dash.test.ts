import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { sessionOf } from '../../core/effects/engine.ts'
import type { TerminalReading } from '../../core/schema/outside.ts'
import { take } from '../../core/state/work/effect.ts'
import { initState } from '../../core/state/work/reads.ts'
import type { ItemRec, RoleDraft, What, WorkState } from '../../core/state/work/types.ts'
import { PERSON, PIPE, roleActor } from '../../core/state/work/types.ts'
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
const go = (s: WorkState, what: What): WorkState =>
  take(s, { id: 'x', who: PERSON, ep: 0, what, seen: -1, seenVer: 0, vers: new Map(), old: false })
const send = (s: WorkState, role = 'dev', sections = ['a', 'b']): WorkState =>
  go(s, { _tag: 'SendTask', spec: { name: `task ${role}`, goal: `goal ${role}`, sections, role } })
const assigned = (s: WorkState, task: string): WorkState => go(s, { _tag: 'AssignDo', task })
const reported = (s: WorkState, task: string, maker: string): WorkState =>
  [
    { _tag: 'ReadBrief', maker },
    { _tag: 'Report', maker, output: 'o', files: [], caught: new Set<string>() },
  ].reduce((acc, w) => go(acc, w as What), assigned(s, task))
const raised = (s: WorkState): WorkState =>
  go(reported(send(s), 't1', 'm1'), { _tag: 'Review', task: 't1', v: 'RaiseNoRule', points: [] })
const evaluate = (s: WorkState, level: 'Standard' | 'Direct'): WorkState =>
  go(s, { _tag: 'Evaluate', task: 't1', level, parts: [], roleDraft: null, summary: 'why' })
const dir2 = { ...rec('dir', null, 'dir new'), name: 'dir says' }
const atPerson = (): WorkState =>
  [
    { _tag: 'Ship', fix: 't1', items: new Set(['dir:d1']), draft: new Map([['dir:d1', dir2]]) },
    { _tag: 'LoopReview', fix: 't1', toPerson: true },
  ].reduce((acc, w) => go(acc, w as What), evaluate(raised(start()), 'Direct'))

const live = (): Record<string, TerminalReading> =>
  Object.fromEntries(
    [PIPE, roleActor('dev'), roleActor('qa')].map((k) => [
      sessionOf(k, 0),
      { _tag: 'Live', lastOutput: NOW } as const,
    ]),
  )
const input = (state: WorkState, over: Partial<DashInput> = {}): DashInput => ({
  dir: 'proj',
  build: 'b1',
  now: NOW,
  state,
  events: [],
  host: { model: '', reading: { alive: true, lastOutput: NOW, tail: '' } },
  pipe: { name: 'pipeline', model: 'pm' },
  terminals: live(),
  tails: {},
  markers: [],
  principles: { 'dir:d1': ['clarity'] },
  ...over,
})
const dev = (d: Dash) => d.columns.find((c) => c.role === 'dev')?.card.status

describe('the header and the queue', () => {
  test('the header names the dir, the project, the seq and the build', () => {
    const d = dashOf(input(send(start())))
    expect(d.header).toEqual({ dir: 'proj', project: 'top', seq: 1, build: 'b1' })
  })

  test('the queue shows only queued and working tasks', () => {
    let s = send(send(start(), 'dev', ['a']), 'qa', ['b'])
    expect(dashOf(input(s)).queue.map((t) => [t.id, t.state])).toEqual([
      ['t1', 'QUEUED'],
      ['t2', 'QUEUED'],
    ])
    s = assigned(s, 't1')
    expect(dashOf(input(s)).queue[0]).toMatchObject({ state: 'WORKING', description: 'goal dev' })
    s = go(reported(send(start(), 'dev', ['a']), 't1', 'm1'), {
      _tag: 'Review',
      task: 't1',
      v: 'Pass',
      points: [],
    })
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
    expect(dashOf(input(start())).row).toEqual([])
  })

  test('the loop stage is IN_PIPELINE and the draft is a diff of its items', () => {
    const s = go(evaluate(raised(start()), 'Direct'), {
      _tag: 'Ship',
      fix: 't1',
      items: new Set(['dir:d1']),
      draft: new Map([['dir:d1', dir2]]),
    })
    const [e] = dashOf(input(s)).row
    expect(e?.status).toBe('IN_PIPELINE')
    expect(e?.changes).toMatchObject([
      { key: 'dir:d1', version: 0, before: { says: 'dir says' }, after: { says: 'dir new' } },
    ])
    expect(e?.card).toBeNull()
    expect(e?.summary).toBe('why')
  })

  test('the person edit is an escalation of its own; a removed item has no after', () => {
    const s = go(start(), { _tag: 'EditDirection', draft: new Map([['rule:r1', null]]) })
    const [e] = dashOf(input(s)).row
    expect(e).toMatchObject({ id: 'edit', task: 'your direction edit' })
    expect(e?.changes).toMatchObject([
      { key: 'rule:r1', before: { says: 'rule says' }, after: null },
    ])
  })

  test('the person owes the accept and the send-back of the escalation at them', () => {
    const d = dashOf(input(atPerson()))
    expect(d.person.map((a) => [a.tag, a.target])).toEqual([
      ['Accept', 't1'],
      ['SendBack', 't1'],
      ['Decide', 't1'],
    ])
    expect(d.person[0]?.words[0]).toBe('Fix t1 waits for you.')
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

describe('the wire', () => {
  test('a Dash encodes and decodes to the same value', () => {
    for (const s of [start(), atPerson()]) {
      const d = dashOf(input(s))
      const wire = JSON.parse(JSON.stringify(Schema.encodeSync(Dash)(d)))
      expect(Schema.decodeUnknownSync(Dash)(wire)).toEqual(d)
    }
  })
})
