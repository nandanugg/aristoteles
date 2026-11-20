// The shared reads of c16: occurrence ids, the ask helpers, innermost order, allDone.
import { describe, expect, test } from 'bun:test'
import {
  advance,
  allDone,
  askCountOf,
  asksAbout,
  closeAsk,
  depthOf,
  findAsk,
  innermost,
  liveMaker,
  openAsk,
  uncovered,
} from './reads.ts'
import { ASK_CAP, initState, type Task, type WorkState } from './state.ts'
import type { Actor } from './types.ts'

const host: Actor = { _tag: 'Host' }
const role: Actor = { _tag: 'Role', name: 'dev' }
const pipe: Actor = { _tag: 'Pipe' }
const human: Actor = { _tag: 'Human' }
const maker = (id: string): Actor => ({ _tag: 'Maker', id })

const base = (): WorkState =>
  initState({ name: 't', goal: 'g', sections: ['a', 'b'], directions: [] }, new Map(), new Map(), 3)

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  name: id,
  goal: '',
  role: 'dev',
  parent: null,
  sections: [],
  directions: [],
  generation: 0,
  state: 'Done',
  tries: 0,
  maker: null,
  resultId: 0,
  checked: new Map(),
  pending: new Set(),
  caught: new Set(),
  taken: false,
  floor: 'Split',
  at: 0,
  ...over,
})
const withTasks = (s: WorkState, ts: ReadonlyArray<Task>): WorkState => ({
  ...s,
  tasks: new Map(ts.map((t) => [t.id, t])),
})

describe('ask ids', () => {
  test('one ask takes the seq; several from one act take .1, .2', () => {
    let s = { ...base(), seq: 7 }
    const t1 = { _tag: 'Task', id: 't1' } as const
    const t2 = { _tag: 'Task', id: 't2' } as const
    const a = openAsk(s, { kind: 'Execute', from: host, to: role, about: t1 })
    const b = openAsk(a.state, { kind: 'Check', from: maker('m1'), to: role, about: t1 })
    const c = openAsk(b.state, { kind: 'Execute', from: host, to: role, about: t2 })
    expect([a.ask.id, b.ask.id, c.ask.id]).toEqual(['7', '7.1', '7.2'])
    s = c.state
    expect(s.asks.size).toBe(3)
    expect(a.ask.at).toBe(7)
  })

  test('ids are never reused across acts or after a close', () => {
    const about = { _tag: 'Task', id: 't1' } as const
    const spec = { kind: 'Execute', from: host, to: role, about } as const
    const first = openAsk(base(), spec)
    const closed = closeAsk(first.state, first.ask.id)
    expect(closed.asks.size).toBe(0)
    const again = openAsk(advance(closed), spec)
    expect(again.ask.id).toBe('1')
    expect(again.ask.id).not.toBe(first.ask.id)
    expect(advance(first.state).created).toBe(0)
  })

  test('closing an unknown id changes nothing', () => {
    const s = base()
    expect(closeAsk(s, 'nope')).toBe(s)
  })
})

describe('innermost', () => {
  const about = { _tag: 'Task', id: 't1' } as const
  test('Decide > Check > Execute > host Execute', () => {
    let s = base()
    const hostEx = openAsk(s, { kind: 'Execute', from: host, to: role, about })
    s = hostEx.state
    const makerEx = openAsk(s, { kind: 'Execute', from: role, to: maker('m1'), about })
    s = makerEx.state
    const check = openAsk(s, { kind: 'Check', from: maker('m1'), to: role, about })
    s = check.state
    const decide = openAsk(s, { kind: 'Decide', from: pipe, to: human, about })
    s = decide.state
    expect([hostEx, makerEx, check, decide].map((x) => depthOf(x.ask))).toEqual([0, 1, 2, 3])
    expect([hostEx, makerEx, check, decide].map((x) => innermost(s, x.ask))).toEqual([
      false,
      false,
      false,
      true,
    ])
    s = closeAsk(s, decide.ask.id)
    expect(innermost(s, check.ask)).toBe(true)
    expect(innermost(s, makerEx.ask)).toBe(false)
    s = closeAsk(s, check.ask.id)
    expect(innermost(s, makerEx.ask)).toBe(true)
    expect(innermost(s, hostEx.ask)).toBe(false)
  })

  test('another subject and questions do not nest', () => {
    let s = base()
    const a = openAsk(s, { kind: 'Execute', from: host, to: role, about })
    s = a.state
    const other = openAsk(s, {
      kind: 'Decide',
      from: pipe,
      to: human,
      about: { _tag: 'Fix', id: 't2' },
    })
    s = other.state
    const q = openAsk(s, { kind: 'Question', from: role, to: human, about: { _tag: 'None' } }, {
      title: 'q',
      form: { _tag: 'Single' },
    })
    s = q.state
    expect(innermost(s, a.ask)).toBe(true)
    expect(asksAbout(s, about).map((x) => x.id)).toEqual([a.ask.id])
    expect(q.ask.question?.title).toBe('q')
    expect(findAsk(s, { kind: 'Execute', from: host, to: role, about })?.id).toBe(a.ask.id)
    expect(findAsk(s, { kind: 'Execute', from: host, to: pipe, about })).toBeUndefined()
  })
})

describe('shared reads', () => {
  test('askCountOf reads the pair key', () => {
    const s = { ...base(), askCount: new Map([[JSON.stringify(['role:dev', 'human']), 2]]) }
    expect(askCountOf(s, role, human)).toBe(2)
    expect(askCountOf(s, human, role)).toBe(0)
    expect(ASK_CAP).toBe(s.askCap)
  })

  test('allDone counts the parts of a split task', () => {
    const owner = (id: string, over: Partial<Task>) => task(id, { sections: ['a', 'b'], ...over })
    const parts = [
      task('p1', { parent: 't1', sections: ['a'] }),
      task('p2', { parent: 't1', sections: ['b'] }),
    ]
    const split = owner('t1', { state: 'Split' })
    expect(allDone(base())).toBe(false)
    expect(allDone(withTasks(base(), [split, ...parts]))).toBe(true)
    const [p1, p2] = parts as [Task, Task]
    expect(allDone(withTasks(base(), [split, p1, { ...p2, state: 'Working' }]))).toBe(false)
    const pending = { ...p2, pending: new Set(['rule:x']) }
    expect(allDone(withTasks(base(), [split, p1, pending]))).toBe(false)
  })

  test('uncovered ignores parts; liveMaker needs a maker that has not ended', () => {
    const s = withTasks(base(), [
      task('t1', { sections: ['a'], maker: 'm1' }),
      task('p1', { parent: 't1', sections: ['b'] }),
    ])
    expect(uncovered(s)).toEqual(['b'])
    const m = { id: 'm1', task: 't1', ended: false, claimed: true, brief: new Map(), revisions: 0 }
    const live = { ...s, makers: new Map([['m1', m]]) }
    expect(liveMaker(live, 't1')).toBe('m1')
    const ended = { ...live, makers: new Map([['m1', { ...m, ended: true }]]) }
    expect(liveMaker(ended, 't1')).toBeNull()
  })
})
