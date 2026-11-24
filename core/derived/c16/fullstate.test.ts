// Full-state cases, no projection: a split whose mapped part finishes while another part is still
// owed work, and occurrence ids and oldest-first order on a state with several asks. Every act goes
// through `refusal` with its basis taken from the state, then `take`.
import { describe, expect, test } from 'bun:test'
import { take } from '../../state/c16/effect.ts'
import { epochOf, vsum } from '../../state/c16/reads.ts'
import { initState, type WorkState } from '../../state/c16/state.ts'
import { type Actor, type Body, keyOf } from '../../state/c16/types.ts'
import type { ItemRec } from '../../state/c16/data.ts'
import { basisOf, refusal } from './accept.ts'
import { dos, owed } from './obligations.ts'

const host: Actor = { _tag: 'Host' }
const human: Actor = { _tag: 'Human' }
const pipe: Actor = { _tag: 'Pipe' }
const dev: Actor = { _tag: 'Role', name: 'dev' }
const maker = (id: string): Actor => ({ _tag: 'Maker', id })

const rec = (over: Partial<ItemRec>): ItemRec => ({
  kind: 'dir',
  parent: null,
  name: 'n',
  says: 's',
  where: null,
  test: null,
  ref: null,
  form: 'none',
  examples: [],
  ...over,
})
const start = (): WorkState =>
  initState(
    { name: 'top', goal: 'g', sections: ['a', 'b'], facts: {}, directions: ['d'] },
    new Map([['dir:d', rec({})], ['std:s', rec({ kind: 'std', parent: 'dir:d' })]]),
    new Map([['dev', { role: 'dev', words: 'w', model: 'm' }]]),
    2,
  )
const spec = (sections: ReadonlyArray<string>) => ({ name: 'n', goal: 'g', sections, facts: {}, role: 'dev' })

// One accepted act: refused or not is part of the case.
const go = (s: WorkState, who: Actor, body: Body): WorkState => {
  const act = {
    id: `a${s.seq}`,
    who,
    ep: epochOf(s, who),
    seen: basisOf(s, body),
    seenVer: vsum(s),
    vers: s.ver,
    old: false,
    body,
  }
  expect([body._tag, refusal(s, act)]).toEqual([body._tag, null])
  return take(s, act)
}
const askId = (s: WorkState, kind: string, about: string | null): string => {
  const a = [...s.asks.values()].find((x) =>
    x.kind === kind && (about === null || (x.about._tag !== 'None' && x.about.id === about))
  )
  if (a === undefined) throw new Error(`no ${kind} ask about ${about}`)
  return a.id
}
// The maker's Execute of a task (the host's is another ask about it).
const makerAsk = (s: WorkState, task: string): string =>
  [...s.asks.values()].find((a) =>
    a.kind === 'Execute' && a.to._tag === 'Maker' && a.about._tag === 'Task' && a.about.id === task
  )!.id
const open = (task: string): Body => ({ _tag: 'Open', open: { _tag: 'OpenMake', task } })

// t1 raised and split into t2 (a) and t3 (b); the host holds one ask per part.
const split = (): WorkState => {
  let s = go(start(), host, { _tag: 'Open', open: { _tag: 'OpenSend', spec: spec(['a', 'b']) } })
  s = go(s, dev, open('t1'))
  s = go(s, maker('m1'), { _tag: 'ReadBrief', maker: 'm1' })
  s = go(s, maker('m1'), {
    _tag: 'Report',
    ask: makerAsk(s, 't1'),
    output: 'o',
    files: [],
    caught: new Set(),
  })
  // the model's tries are 2: a first fail, then the raise
  s = go(s, dev, {
    _tag: 'Review',
    ask: askId(s, 'Check', 't1'),
    verdict: 'RaiseNoRule',
    points: ['p'],
  })
  return go(s, pipe, {
    _tag: 'Evaluate',
    fix: 't1',
    level: 'Split',
    parts: [spec(['a']), spec(['b'])],
    roleDraft: null,
    summary: 'big',
  })
}
// t2 made, read, reported and passed.
const t2Done = (s0: WorkState): WorkState => {
  let s = go(s0, dev, open('t2'))
  s = go(s, maker('m2'), { _tag: 'ReadBrief', maker: 'm2' })
  s = go(s, maker('m2'), {
    _tag: 'Report',
    ask: makerAsk(s, 't2'),
    output: 'o',
    files: [],
    caught: new Set(),
  })
  return go(s, dev, {
    _tag: 'Review',
    ask: askId(s, 'Check', 't2'),
    verdict: 'Pass',
    points: [],
  })
}
const steps = (s: WorkState, who: Actor) => dos(s, who).map((x) => `${x.act}:${x.task ?? x.ask}`)
const topDone = (s: WorkState) =>
  refusal(s, {
    id: 'td',
    who: host,
    ep: 0,
    seen: -1,
    seenVer: vsum(s),
    vers: s.ver,
    old: false,
    body: { _tag: 'TopDone' },
  })

describe('a split whose mapped part finishes while another is owed', () => {
  test('the other part, not yet made: the role owes it, TopDone is withheld', () => {
    const s = t2Done(split())
    expect(s.tasks.get('t2')?.state).toBe('Done')
    expect(s.tasks.get('t3')?.state).toBe('Sent')
    expect(steps(s, dev)).toEqual(['Open:t3'])
    expect(steps(s, host)).toEqual([])
    expect(topDone(s)).toBe('legal')
    // the host's ask for the part is still open, and nothing owes the end
    expect(owed(s).some((o) => o.ob._tag === 'TopDoneOb')).toBe(false)
  })

  test('the other part working: its maker owes its step, TopDone is withheld', () => {
    let s = go(t2Done(split()), dev, open('t3'))
    expect(steps(s, maker('m3'))).toEqual(['ReadBrief:t3'])
    expect(topDone(s)).toBe('legal')
    s = go(s, maker('m3'), { _tag: 'ReadBrief', maker: 'm3' })
    expect(steps(s, maker('m3'))).toEqual(['Report:t3'])
    expect(owed(s).map((o) => [o.ob._tag, o.owner])).toContainEqual(['AskOb', keyOf(maker('m3'))])
    expect(steps(s, host)).toEqual([])
  })

  test('both parts done: the host is told TopDone', () => {
    let s = go(t2Done(split()), dev, open('t3'))
    s = go(s, maker('m3'), { _tag: 'ReadBrief', maker: 'm3' })
    s = go(s, maker('m3'), {
      _tag: 'Report',
      ask: makerAsk(s, 't3'),
      output: 'o',
      files: [],
      caught: new Set(),
    })
    s = go(s, dev, { _tag: 'Review', ask: askId(s, 'Check', 't3'), verdict: 'Pass', points: [] })
    expect(steps(s, host)).toEqual(['TopDone:null'])
    expect(topDone(s)).toBeNull()
  })
})

describe('occurrence ids and oldest first', () => {
  test('a split names its asks <seq> and <seq>.1, in the order of the parts', () => {
    const before = split()
    const hostAsks = [...before.asks.values()].filter((a) => a.from._tag === 'Host')
    expect(hostAsks.map((a) => a.id)).toEqual([`${before.seq - 1}`, `${before.seq - 1}.1`])
    expect(hostAsks.map((a) => a.about)).toEqual([
      { _tag: 'Task', id: 't2' },
      { _tag: 'Task', id: 't3' },
    ])
  })

  test('several asks to the person: answers and what is owed come oldest first', () => {
    const question = (to: Actor): Body => ({
      _tag: 'Open',
      open: { _tag: 'OpenQuestion', to, question: { title: 'q', form: { _tag: 'Single' } } },
    })
    let s = start()
    s = go(s, pipe, question(human)) // seq 0
    s = go(s, host, { _tag: 'Open', open: { _tag: 'OpenSend', spec: spec(['a', 'b']) } })
    s = go(s, host, question(human)) // a later one
    s = go(s, dev, question(human))
    const ids = [...s.asks.values()].filter((a) => a.kind === 'Question').map((a) => a.id)
    expect(ids).toEqual(['0', '2', '3'])
    // the person is told the questions oldest first, whatever the order of the map
    expect(dos(s, human).map((x) => x.ask)).toEqual(['0', '2', '3'])
    const owedToHuman = owed(s).filter((o) => o.owner === keyOf(human))
    expect(owedToHuman.map((o) => o.age)).toEqual([0, 2, 3])
    // the oldest first holds for every owner
    const ages = owed(s).map((o) => o.age)
    expect(ages).toEqual([...ages].sort((a, b) => a - b))
  })
})
