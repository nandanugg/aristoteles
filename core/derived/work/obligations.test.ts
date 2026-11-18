// The told steps and obligations (obligations.ts) on states built by hand.
import { expect, test } from 'bun:test'
import { CLOSED, initState } from '../../state/work/reads.ts'
import type { Fix, ItemRec, Maker, RoleDraft, Task, WorkState } from '../../state/work/types.ts'
import {
  EDIT,
  HARNESS,
  HOST,
  PERSON,
  PIPE,
  makerActor,
  roleActor,
} from '../../state/work/types.ts'
import {
  ageOf,
  discharges,
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
const card: RoleDraft = { role: 'writer', words: 'w', model: 'm' }
const base = (): WorkState => {
  const s = initState(
    { name: 't', goal: 'g', sections: ['a', 'b'], directions: ['d1'] },
    new Map([
      ['dir:d1', rec({})],
      ['std:s1', rec({ kind: 'std', parent: 'dir:d1' })],
      ['rule:r1', rec({ kind: 'rule', parent: 'std:s1', form: 'mech', test: 'x' })],
      ['rule:r2', rec({ kind: 'rule', parent: 'std:s1', form: 'ref', ref: 'f#a:1' })],
    ]),
    new Map([
      ['writer', card],
      ['linter', { ...card, role: 'linter' }],
    ]),
    3,
  )
  return { ...s, top: { ...s.top, hostSession: 0 } }
}
const task = (id: string, over: Partial<Task>): Task => ({
  id,
  name: 'n',
  goal: 'g',
  role: 'writer',
  parent: null,
  sections: [id === 't1' ? 'a' : 'b'],
  directions: ['d1'],
  gen: 0,
  st: 'Sent',
  tries: 0,
  maker: null,
  rid: 0,
  checked: new Map(),
  pend: new Set(),
  caught: new Set(),
  taken: false,
  floor: 'Standard',
  at: 1,
  ...over,
})
const maker = (id: string, tid: string, over: Partial<Maker> = {}): Maker => ({
  id,
  task: tid,
  ended: false,
  claim: false,
  brief: new Map(),
  revs: 0,
  ...over,
})
const covered = (...ts: Task[]): WorkState => ({
  ...base(),
  tasks: new Map(ts.map((t) => [t.id, t])),
})
const withFix = (s: WorkState, id: string, over: Partial<Fix>): WorkState => ({
  ...s,
  fixes: new Map([...s.fixes, [id, { ...CLOSED, ...over }]]),
})
const steps = (s: WorkState, k: string) => dos(s, k).map((x) => `${x.tag}:${x.target}`)
const key = (o: { tag: string; target: string | null }) => `${o.tag}:${o.target}`

// Every obligation is owned by an actor who is told a step that discharges it.
const owned = (s: WorkState) => {
  for (const o of obligationsOf(s)) {
    const k = ownerOf(s, o)
    expect(dos(s, k).some((x) => discharges(o, k, x))).toBe(true)
    expect(toldAny(s, o)).toContain(k)
  }
}

test('SendOb while sections are uncovered, then none', () => {
  const s = base()
  expect(obligationsOf(s).map(key)).toEqual(['SendOb:null'])
  expect(steps(s, HOST)).toEqual(['SendTask:null'])
  owned(s)
  const part = covered(task('t1', {}))
  expect(obligationsOf(part).map(key)).toContain('SendOb:null')
  const all = covered(task('t1', {}), task('t2', {}))
  expect(obligationsOf(all).map(key)).not.toContain('SendOb:null')
})

test('a host that is not found by the wait is told nothing', () => {
  expect(steps({ ...base(), session: 1 }, HOST)).toEqual([])
})

test('every obligation of a mixed state has an owner told a discharging step', () => {
  const t1 = task('t1', { st: 'Working', maker: 'm1' })
  const t2 = task('t2', { st: 'Sent' })
  const s = { ...covered(t1, t2), makers: new Map([['m1', maker('m1', 't1')]]) }
  owned(s)
  expect(obligationsOf(s).map(key).sort()).toEqual(['AssignOb:t2', 'MakeOb:m1'])
  expect(steps(s, makerActor('m1'))).toEqual(['ReadBrief:m1'])
  expect(steps(s, roleActor('writer'))).toEqual(['AssignDo:t2'])
  const claimed = { ...s, makers: new Map([['m1', maker('m1', 't1', { claim: true })]]) }
  expect(steps(claimed, makerActor('m1'))).toEqual(['Report:m1'])
})

test('review, raise stages, done rechecks, rule runs, split and a down maker', () => {
  const pend = new Set(['rule:r1', 'rule:r2'])
  const ts = [
    task('t1', { st: 'InReview', at: 3 }),
    task('t2', { st: 'Raised', at: 4 }),
    task('t3', { st: 'Done', pend, at: 5, sections: ['c'] }),
    task('t4', { st: 'Split', sections: ['d'] }),
    task('t5', { st: 'Working', maker: 'm5', sections: ['e'] }),
  ]
  let s = covered(...ts)
  s = { ...s, top: { ...s.top, sections: ['a', 'b', 'c', 'd', 'e'] } }
  s = withFix(s, 't2', { stage: 'SStdAssess', at: 6 })
  s = withFix(s, EDIT, { stage: 'SLoop', at: 2 })
  s = { ...s, makers: new Map([['m5', maker('m5', 't5')]]), down: new Set([makerActor('m5')]) }
  expect(obligationsOf(s).map(key).sort()).toEqual(
    ['PipeOb:edit', 'PipeOb:t2', 'RecheckOb:t3', 'ResumeOb:m5', 'ReviewOb:t1', 'RuleRunOb:t3']
      .sort(),
  )
  owned(s)
  expect(steps(s, HARNESS)).toEqual(['RunRule:t3'])
  expect(steps(s, PIPE)).toEqual(['LoopReview:edit', 'RecheckDone:t3', 'Advance:t2'])
  expect(steps(s, roleActor('writer'))).toEqual(['Resume:m5', 'Review:t1'])
})

test('dos lists the oldest first', () => {
  const s = covered(
    task('t1', { st: 'InReview', at: 9 }),
    task('t2', { st: 'InReview', at: 3 }),
    task('t3', { st: 'Sent', at: 5, sections: ['c'] }),
  )
  expect(steps(s, roleActor('writer'))).toEqual(['Review:t2', 'AssignDo:t3', 'Review:t1'])
  expect(ageOf(s, { tag: 'ReviewOb', target: 't1' })).toBe(9)
  expect(ageOf(s, { tag: 'SendOb', target: null })).toBe(0)
})

test('a role is told only its own tasks', () => {
  const s = covered(task('t1', { role: 'linter' }), task('t2', {}))
  expect(steps(s, roleActor('linter'))).toEqual(['AssignDo:t1'])
  expect(steps(s, roleActor('writer'))).toEqual(['AssignDo:t2'])
})

test('a draft at the person: final when only the person owes', () => {
  const s0 = covered(task('t1', { st: 'Raised' }), task('t2', { st: 'Done', sections: ['b'] }))
  const s = withFix(s0, 't1', { stage: 'SAtPerson' })
  expect(obligationsOf(s).map(key)).toEqual(['DraftOb:t1'])
  expect(steps(s, PERSON)).toEqual(['Accept:t1', 'SendBack:t1', 'Decide:t1'])
  expect(ownerOf(s, { tag: 'DraftOb', target: 't1' })).toBe(PERSON)
  expect(waitsOnPerson(s, { tag: 'DraftOb', target: 't1' })).toBe(true)
  expect(finalOf(s)).toBe(true)
  owned(s)
  const busy = withFix(s, EDIT, { stage: 'SDraft' })
  expect(finalOf(busy)).toBe(false)
  expect(finalOf({ ...s, top: { ...s.top, ended: true } })).toBe(true)
  expect(obligationsOf({ ...s, top: { ...s.top, ended: true } })).toEqual([])
  expect(steps({ ...s, top: { ...s.top, ended: true } }, PERSON)).toEqual([])
})

test('a host that is down: the person revives it; its steps wait for the person', () => {
  const s = { ...base(), down: new Set([HOST]) }
  expect(obligationsOf(s).map(key).sort()).toEqual(['ReviveOb:host', 'SendOb:null'])
  expect(ownerOf(s, { tag: 'ReviveOb', target: HOST })).toBe(PERSON)
  expect(ownerOf(s, { tag: 'ReviveOb', target: PIPE })).toBe(HARNESS)
  expect(steps(s, PERSON)).toEqual(['Revive:host'])
  expect(finalOf(s)).toBe(true)
  owned(s)
  const pipeDown = { ...base(), down: new Set([PIPE]) }
  expect(steps(pipeDown, HARNESS)).toEqual(['Revive:pipe'])
  expect(finalOf(pipeDown)).toBe(false)
  owned(pipeDown)
})

test('all done: the host owes TopDone, then the person EndProject', () => {
  const s = covered(task('t1', { st: 'Done' }), task('t2', { st: 'Done' }))
  expect(obligationsOf(s).map(key)).toEqual(['TopDoneOb:null'])
  expect(steps(s, HOST)).toEqual(['TopDone:null'])
  owned(s)
  const d = { ...s, top: { ...s.top, done: true } }
  expect(obligationsOf(d).map(key)).toEqual(['EndOb:null'])
  expect(steps(d, PERSON)).toEqual(['EndProject:null'])
  expect(finalOf(d)).toBe(true)
  owned(d)
})

test('an accepted fix owes Reassign to the host', () => {
  const s = withFix(covered(task('t1', { st: 'Raised' }), task('t2', {})), 't1', {
    stage: 'SAccepted',
  })
  expect(obligationsOf(s).map(key)).toContain('ReassignOb:null')
  expect(steps(s, HOST)).toEqual(['Reassign:null'])
  expect(ownerOf(s, { tag: 'ReassignOb', target: null })).toBe(HOST)
})
