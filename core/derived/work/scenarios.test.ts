// End-to-end runs on the pure core, as core/model/core.qnt's witnesses: initState and take, each
// act checked by `accept` first, every state told a step for each obligation (never stuck).
import { expect, test } from 'bun:test'
import { take } from '../../state/work/effect.ts'
import { vsum } from '../../state/work/items.ts'
import { epOf, fx, initState, tk } from '../../state/work/reads.ts'
import type { Act, Actor, ItemRec, WhatTag, What, WorkState } from '../../state/work/types.ts'
import { HARNESS, HOST, PERSON, PIPE, makerActor, roleActor } from '../../state/work/types.ts'
import { cur, refusal } from './accept.ts'
import type { Ob } from './obligations.ts'
import {
  ageOf,
  dos,
  finalOf,
  obligationsOf,
  ownerOf,
  toldAny,
  waitsOnPerson,
} from './obligations.ts'

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
const rule = (says: string, over: Partial<ItemRec> = {}): ItemRec =>
  rec({ kind: 'rule', parent: 'std:s1', says, form: 'ref', ref: 'f#a:1', ...over })
const start = (sections = ['a', 'b']): WorkState =>
  initState(
    { name: 't', goal: 'g', sections, directions: ['d1'] },
    new Map([
      ['dir:d1', rec({})],
      ['std:s1', rec({ kind: 'std', parent: 'dir:d1' })],
      ['rule:r1', rule('one', { form: 'mech', test: 'x', ref: null })],
    ]),
    new Map([['writer', { role: 'writer', words: 'w', model: 'm' }]]),
    2,
  )

// Acts that nobody is told (the person's or the harness's own, and the agents' questions).
const UNTOLD: ReadonlySet<WhatTag> = new Set(['Ask', 'Exit', 'Reject', 'EditDirection', 'MoveHost'])
let n = 0
const mk = (s: WorkState, who: Actor, what: What, over: Partial<Act> = {}): Act => ({
  id: `a${++n}`,
  who,
  ep: epOf(s, who),
  what,
  seen: cur(s, what),
  seenVer: vsum(s),
  vers: s.ver,
  old: false,
  ...over,
})
const stuck = (s: WorkState): boolean =>
  obligationsOf(s).some((o) => toldAny(s, o).length === 0 && !waitsOnPerson(s, o))

// A run: each act is accepted, told to its actor, and leaves no obligation without a step.
const sim = (s0: WorkState) => {
  let s = s0
  return {
    get s() {
      return s
    },
    go(who: Actor, what: What, over: Partial<Act> = {}): WorkState {
      const a = mk(s, who, what, over)
      expect(refusal(s, a)).toBeNull()
      if (!UNTOLD.has(what._tag)) expect(dos(s, who).map((x) => x.tag)).toContain(what._tag)
      s = take(s, a)
      expect(stuck(s)).toBe(false)
      return s
    },
    no(who: Actor, what: What, over: Partial<Act> = {}) {
      return refusal(s, mk(s, who, what, over))
    },
  }
}
type Run = ReturnType<typeof sim>

const W = roleActor('writer')
const spec = (sections: string[]) => ({ name: 'n', goal: 'g', sections, role: 'writer' })
const send = (r: Run, sections: string[]) => r.go(HOST, { _tag: 'SendTask', spec: spec(sections) })
const make = (r: Run, t: string, m: string) => {
  r.go(W, { _tag: 'AssignDo', task: t })
  r.go(makerActor(m), { _tag: 'ReadBrief', maker: m })
  r.go(makerActor(m), { _tag: 'Report', maker: m, output: '', caught: new Set() })
}
const review = (r: Run, t: string, v: 'Pass' | 'Fail' | 'RaiseTries' | 'RaiseNoRule') =>
  r.go(W, { _tag: 'Review', task: t, v, points: [] })
const raise = (r: Run, t: string, m: string) => {
  make(r, t, m)
  review(r, t, 'RaiseNoRule')
}
const evaluate = (r: Run, t: string, level: 'Standard' | 'Direct', over: Partial<Act> = {}) =>
  r.go(
    PIPE,
    { _tag: 'Evaluate', task: t, level, parts: [], roleDraft: null, summary: 's' },
    over,
  )
const split = (parts: string[][], task = 't1'): What => ({
  _tag: 'Evaluate',
  task,
  level: 'Split',
  parts: parts.map(spec),
  roleDraft: null,
  summary: 's',
})
const advance = (r: Run, t: string) => r.go(PIPE, { _tag: 'Advance', fix: t })
const write = (r: Run, t: string, ref: ItemRec) =>
  r.go(PIPE, { _tag: 'WriteRule', fix: t, rule: 'rule:r9', rec: ref, refOk: true })
const runTest = (r: Run, t: string, own: boolean, contra: string[] = []) =>
  r.go(PIPE, { _tag: 'RunTest', fix: t, own, contra })
const ship = (r: Run, t: string, draft: Map<string, ItemRec | null>) =>
  r.go(PIPE, { _tag: 'Ship', fix: t, items: new Set(draft.keys()), draft })
const loop = (r: Run, t: string) => r.go(PIPE, { _tag: 'LoopReview', fix: t, toPerson: true })
const dirDraft = (says: string, ref: ItemRec) =>
  new Map([['dir:d1', rec({ says })], ['rule:r9', ref]])
// The rest of a direction fix from SDirAssess: down the ladder, a rule, the draft, the person.
const draftDir = (r: Run, t: string, says = 'new') => {
  advance(r, t)
  advance(r, t)
  write(r, t, rule('v3'))
  ship(r, t, dirDraft(says, rule('v3')))
  loop(r, t)
}
const toPerson = (r: Run, t: string, m: string) => {
  raise(r, t, m)
  evaluate(r, t, 'Direct')
  draftDir(r, t)
}
const pass = (r: Run, t: string) => review(r, t, 'Pass')
const recheck = (r: Run, t: string, x = 'rule:r9') =>
  r.go(PIPE, { _tag: 'RecheckDone', task: t, items: new Set([x]), holds: true })

test('1 the happy path: two tasks cover the top, every step told, the person ends', () => {
  const r = sim(start())
  expect(dos(r.s, HOST).map((x) => x.tag)).toEqual(['SendTask'])
  send(r, ['a'])
  send(r, ['b'])
  expect(dos(r.s, HOST)).toEqual([])
  make(r, 't1', 'm1')
  expect(obligationsOf(r.s)).toContainEqual({ tag: 'ReviewOb', target: 't1' })
  pass(r, 't1')
  expect(finalOf(r.s)).toBe(false)
  make(r, 't2', 'm2')
  pass(r, 't2')
  expect(obligationsOf(r.s)).toEqual([{ tag: 'TopDoneOb', target: null }])
  expect(finalOf(r.s)).toBe(false)
  r.go(HOST, { _tag: 'TopDone' })
  expect(obligationsOf(r.s)).toEqual([{ tag: 'EndOb', target: null }])
  expect(finalOf(r.s)).toBe(true)
  r.go(PERSON, { _tag: 'EndProject' })
  expect(finalOf(r.s)).toBe(true)
  expect(obligationsOf(r.s)).toEqual([])
})

test('2 a raise by tries: standard fix in effect, the other done task is rechecked', () => {
  const r = sim(start())
  send(r, ['a'])
  send(r, ['b'])
  make(r, 't2', 'm1')
  pass(r, 't2')
  make(r, 't1', 'm2')
  review(r, 't1', 'Fail')
  r.go(makerActor('m2'), { _tag: 'Report', maker: 'm2', output: '', caught: new Set() })
  review(r, 't1', 'RaiseTries')
  expect(obligationsOf(r.s)).toContainEqual({ tag: 'PipeOb', target: 't1' })
  evaluate(r, 't1', 'Standard')
  advance(r, 't1')
  expect(fx(r.s, 't1').stage).toBe('SRuleAssess')
  write(r, 't1', rule('v1'))
  expect(fx(r.s, 't1').stage).toBe('SDraft')
  ship(r, 't1', new Map([['rule:r9', rule('v1')]]))
  expect(r.s.ver.get('rule:r9')).toBe(1)
  expect(tk(r.s, 't1').st).toBe('Sent')
  expect([...tk(r.s, 't2').pend]).toEqual(['rule:r9'])
  expect(obligationsOf(r.s)).toContainEqual({ tag: 'RecheckOb', target: 't2' })
  recheck(r, 't2')
  expect(tk(r.s, 't2').pend.size).toBe(0)
  make(r, 't1', 'm3')
  pass(r, 't1')
  expect(obligationsOf(r.s)).toEqual([{ tag: 'TopDoneOb', target: null }])
})

test('3 a repeated standard fix climbs; a direction draft goes to the person', () => {
  const r = sim(start())
  send(r, ['a'])
  send(r, ['b'])
  raise(r, 't1', 'm1')
  raise(r, 't2', 'm2')
  for (const t of ['t1', 't2']) {
    evaluate(r, t, 'Standard')
    advance(r, t)
    write(r, t, rule(t))
  }
  ship(r, 't1', new Map([['rule:r9', rule('t1')]]))
  expect(tk(r.s, 't1').floor).toBe('Direct')
  ship(r, 't2', new Map([['rule:r9', rule('t2')]]))
  expect(fx(r.s, 't2').stage).toBe('SStdAssess')
  advance(r, 't2')
  write(r, 't2', rule('t2'))
  ship(r, 't2', new Map([['rule:r9', rule('t2')]]))
  expect(fx(r.s, 't2')).toMatchObject({ stage: 'SDirAssess', level: 'Direct' })
  draftDir(r, 't2')
  expect(fx(r.s, 't2').stage).toBe('SAtPerson')
  expect(dos(r.s, PERSON).map((x) => x.tag)).toEqual(['Accept', 'SendBack', 'Decide'])
  r.go(PERSON, { _tag: 'Accept', fix: 't2' })
  expect(fx(r.s, 't2').stage).toBe('SAccepted')
  expect(tk(r.s, 't2').floor).toBe('Principle')
  expect(obligationsOf(r.s)).toContainEqual({ tag: 'ReassignOb', target: null })
  r.go(HOST, { _tag: 'Reassign' })
  expect(tk(r.s, 't2').st).toBe('Sent')
  expect(fx(r.s, 't2').stage).toBe('SClosed')
})

test('4 a split keeps a strict scope; a task of one section is not split', () => {
  const r = sim(start())
  send(r, ['a', 'b'])
  raise(r, 't1', 'm1')
  expect(r.no(PIPE, split([['a', 'b'], ['a']]))).toBe('legal')
  expect(r.no(PIPE, split([['a'], ['a']]))).toBe('legal')
  expect(r.no(PIPE, split([['a'], ['b']]))).toBeNull()
  r.go(PIPE, split([['a'], ['b']]))
  expect(tk(r.s, 't1').st).toBe('Split')
  expect(tk(r.s, 't2')).toMatchObject({ parent: 't1', sections: ['a'], floor: 'Standard' })
  expect(obligationsOf(r.s)).toContainEqual({ tag: 'AssignOb', target: 't3' })
  raise(r, 't2', 'm2')
  expect(r.no(PIPE, split([['a'], ['a']], 't2'))).toBe('legal')
})

test('5 the rule ladder: a rule failing its examples climbs; a contradiction goes up', () => {
  const r = sim(start())
  send(r, ['a', 'b'])
  raise(r, 't1', 'm1')
  evaluate(r, 't1', 'Standard')
  advance(r, 't1')
  const mech = rule('m', { form: 'mech', test: 'y', ref: null })
  write(r, 't1', mech)
  expect(fx(r.s, 't1').stage).toBe('STest')
  runTest(r, 't1', false)
  expect(fx(r.s, 't1')).toMatchObject({ stage: 'SRuleAssess', ruleTries: 1 })
  write(r, 't1', mech)
  runTest(r, 't1', false)
  expect(fx(r.s, 't1')).toMatchObject({ stage: 'SStdAssess', climb: 'SStdAssess', ruleTries: 0 })
  advance(r, 't1')
  write(r, 't1', mech)
  runTest(r, 't1', true, ['rule:r1'])
  expect(fx(r.s, 't1')).toMatchObject({ stage: 'SDirAssess', contradicted: true, level: 'Direct' })
  expect([...fx(r.s, 't1').fights]).toEqual(['rule:r1'])
})

test('6 G3 refusals at the store check', () => {
  const r = sim(start())
  send(r, ['a', 'b'])
  make(r, 't1', 'm1')
  review(r, 't1', 'Fail')
  r.go(makerActor('m1'), { _tag: 'Report', maker: 'm1', output: '', caught: new Set() })
  const pass1: What = { _tag: 'Review', task: 't1', v: 'Pass', points: [] }
  expect(r.no(W, pass1, { seen: 0 })).toBe('basis')
  expect(r.no(W, pass1)).toBeNull()
  // a duplicate MoveHost
  const mv: What = { _tag: 'MoveHost', fromSession: 0 }
  r.go(PERSON, mv)
  expect(r.no(PERSON, mv)).toBe('legal')
  expect(r.no(HOST, { _tag: 'TopDone' }, { ep: 0 })).toBe('epoch')
  // an old-epoch maker after the revive of its role
  const report: What = { _tag: 'Report', maker: 'm1', output: '', caught: new Set() }
  r.go(HARNESS, { _tag: 'Exit', who: W })
  r.go(HARNESS, { _tag: 'Revive', who: W })
  expect(r.no(makerActor('m1'), report)).toBe('legal')
  expect(r.no(W, pass1, { ep: 0 })).toBe('epoch')
  expect(r.no(W, pass1)).toBeNull()
  // an old-build Accept
  const p = sim(start())
  send(p, ['a', 'b'])
  toPerson(p, 't1', 'm1')
  const acc: What = { _tag: 'Accept', fix: 't1' }
  expect(p.no(PERSON, acc, { old: true })).toBe('build')
  expect(p.no(PERSON, acc, { seen: 0 })).toBe('basis')
  expect(p.no(PERSON, acc)).toBeNull()
  // a RecheckDone whose judged versions moved
  const c = sim(start())
  send(c, ['a'])
  send(c, ['b'])
  make(c, 't1', 'm1')
  pass(c, 't1')
  raise(c, 't2', 'm2')
  evaluate(c, 't2', 'Standard')
  advance(c, 't2')
  write(c, 't2', rule('v1'))
  ship(c, 't2', new Map([['rule:r9', rule('v1')]]))
  const re: What = { _tag: 'RecheckDone', task: 't1', items: new Set(['rule:r9']), holds: true }
  expect(c.no(PIPE, re, { vers: new Map([['rule:r9', 0]]) })).toBe('legal')
  expect(c.no(PIPE, re)).toBeNull()
})

test('7 take as is: a change landed meanwhile is rechecked first', () => {
  const r = sim(start())
  send(r, ['a'])
  send(r, ['b'])
  toPerson(r, 't1', 'm1')
  raise(r, 't2', 'm2')
  evaluate(r, 't2', 'Standard')
  advance(r, 't2')
  write(r, 't2', rule('v1'))
  ship(r, 't2', new Map([['rule:r8', rule('v1')]]))
  expect(fx(r.s, 't1').stage).toBe('SAtPerson')
  r.go(PERSON, { _tag: 'Decide', task: 't1', take: true })
  expect(tk(r.s, 't1')).toMatchObject({ st: 'Done', taken: true })
  expect([...tk(r.s, 't1').pend]).toEqual(['rule:r8'])
  expect(dos(r.s, PIPE).map((x) => x.tag)).toContain('RecheckDone')
  expect(finalOf(r.s)).toBe(false)
  recheck(r, 't1', 'rule:r8')
  expect(tk(r.s, 't1').pend.size).toBe(0)
})

test('8 Ask then Answer: the question is the person\'s to answer', () => {
  const r = sim(start())
  send(r, ['a', 'b'])
  r.go(W, { _tag: 'AssignDo', task: 't1' })
  const m = makerActor('m1')
  const ask: What = { _tag: 'Ask', asker: m, question: 'which?' }
  expect(r.no(HOST, { _tag: 'Ask', asker: HOST, question: 'q' })).toBe('legal')
  expect(r.no(PERSON, ask)).toBe('authority')
  r.go(m, ask)
  const ob: Ob = { tag: 'AnswerOb', target: m }
  expect(obligationsOf(r.s)).toContainEqual(ob)
  expect(ownerOf(r.s, ob)).toBe(PERSON)
  expect(ageOf(r.s, ob)).toBe(r.s.asks.get(m) ?? -1)
  expect(dos(r.s, PERSON)).toEqual([{ tag: 'Answer', target: m }])
  expect(finalOf(r.s)).toBe(false)
  expect(r.no(m, ask)).toBe('legal')
  const ans: What = { _tag: 'Answer', asker: m, answer: 'this' }
  expect(r.no(W, ans)).toBe('authority')
  r.go(PERSON, ans)
  expect(r.s.asks.size).toBe(0)
  expect(r.no(PERSON, ans)).toBe('legal')
  // an ended maker's question goes with it
  r.go(m, ask)
  r.go(HARNESS, { _tag: 'Exit', who: W })
  expect(r.no(m, { ...ask, question: 'again' })).toBe('legal')
  r.go(HARNESS, { _tag: 'Revive', who: W })
  expect(r.s.asks.size).toBe(0)
  // a state owing only an Answer is Final
  const q = sim(start([]))
  expect(obligationsOf(q.s)).toEqual([])
  q.go(PIPE, { _tag: 'Ask', asker: PIPE, question: 'q' })
  expect(obligationsOf(q.s)).toEqual([{ tag: 'AnswerOb', target: PIPE }])
  expect(finalOf(q.s)).toBe(true)
  q.go(PERSON, { _tag: 'Answer', asker: PIPE, answer: 'a' })
  expect(finalOf(q.s)).toBe(false)
})
