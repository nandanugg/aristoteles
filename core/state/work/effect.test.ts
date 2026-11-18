import { describe, expect, test } from 'bun:test'
import { effect, loopClimb, take } from './effect.ts'
import { oldFor } from './items.ts'
import { allDone, CLOSED, fx, initState, tk } from './reads.ts'
import type { Form, ItemKind, ItemRec, RoleDraft, What, WorkState } from './types.ts'
import { EDIT, PERSON, roleActor } from './types.ts'

type Mk = (kind: ItemKind, parent: string | null, says: string, form?: Form) => ItemRec
const rec: Mk = (kind, parent, says, form = 'none') => ({
  kind,
  parent,
  name: says,
  says,
  where: null,
  test: null,
  ref: null,
  form,
  examples: [],
})
const dir = rec('dir', null, 'd')
const std = rec('std', 'dir:d1', 's')
const rule = rec('rule', 'std:s1', 'r', 'ref')
const card = (role: string): RoleDraft => ({ role, words: 'w', model: 'm' })

const start = (): WorkState =>
  initState(
    { name: 'top', goal: 'g', sections: ['a', 'b'], directions: ['d1'] },
    new Map([['dir:d1', dir], ['std:s1', std], ['rule:r1', rule]]),
    new Map([['dev', card('dev')], ['qa', card('qa')]]),
    2,
  )

const go = (s: WorkState, what: What): WorkState =>
  take(s, { id: 'x', who: PERSON, ep: 0, what, seen: -1, seenVer: 0, vers: new Map(), old: false })
const send = (s: WorkState, role = 'dev'): WorkState =>
  go(s, { _tag: 'SendTask', spec: { name: 'n', goal: 'g', sections: ['a', 'b'], role } })
const verdict = (s: WorkState, task: string, v: 'Pass' | 'Fail' | 'RaiseNoRule'): WorkState =>
  go(s, { _tag: 'Review', task, v, points: [] })
// A task sent, assigned (maker `m<n>`), brief read, reported.
const reported = (s: WorkState, task: string, maker: string, role = 'dev'): WorkState =>
  [
    { _tag: 'AssignDo', task },
    { _tag: 'ReadBrief', maker },
    { _tag: 'Report', maker, output: 'o', files: [], caught: new Set<string>() },
  ].reduce((acc, w) => go(acc, w as What), send(s, role))
const done = (s: WorkState, task: string, maker: string): WorkState =>
  verdict(reported(s, task, maker), task, 'Pass')
const raised = (s: WorkState, task: string, maker: string, role = 'dev'): WorkState =>
  verdict(reported(s, task, maker, role), task, 'RaiseNoRule')
const evaluate = (s: WorkState, task: string, level: 'Standard' | 'Direct'): WorkState =>
  go(s, { _tag: 'Evaluate', task, level, parts: [], roleDraft: null, summary: 'why' })
const std2 = { ...std, says: 'new std' }
const shipStd = (s: WorkState, fix: string): WorkState =>
  go(s, {
    _tag: 'Ship',
    fix,
    items: new Set(['std:s1']),
    draft: new Map([['std:s1', std2]]),
  })
const dir2 = { ...dir, says: 'new dir' }
const shipDir = (s: WorkState, fix: string): WorkState =>
  go(s, { _tag: 'Ship', fix, items: new Set(['dir:d1']), draft: new Map([['dir:d1', dir2]]) })
// t1 done (maker m1); t2 raised (maker m2), evaluated at standard.
const twoTasks = (): WorkState =>
  evaluate(raised(done(start(), 't1', 'm1'), 't2', 'm2', 'qa'), 't2', 'Standard')

describe('the task cycle', () => {
  test('send, assign, brief, report, pass', () => {
    let s = send(start())
    expect(tk(s, 't1')).toMatchObject({ st: 'Sent', parent: null, floor: 'Split', rid: -1 })
    s = go(s, { _tag: 'AssignDo', task: 't1' })
    expect(tk(s, 't1')).toMatchObject({ st: 'Working', maker: 'm1' })
    s = go(s, { _tag: 'ReadBrief', maker: 'm1' })
    expect(s.makers.get('m1')?.claim).toBe(true)
    s = go(s, { _tag: 'Report', maker: 'm1', output: 'o', files: [], caught: new Set(['rule:r1']) })
    expect(tk(s, 't1')).toMatchObject({ st: 'InReview', rid: 0, taken: false })
    expect(tk(s, 't1').caught.has('rule:r1')).toBe(true)
    s = verdict(s, 't1', 'Pass')
    expect(tk(s, 't1')).toMatchObject({ st: 'Done', maker: null })
    expect(tk(s, 't1').caught.size).toBe(0)
    expect(s.makers.get('m1')).toMatchObject({ ended: true, claim: false })
    expect(s.seq).toBe(5)
  })

  test('fail goes to the same maker', () => {
    const s = verdict(reported(start(), 't1', 'm1'), 't1', 'Fail')
    expect(tk(s, 't1')).toMatchObject({ st: 'Working', maker: 'm1', tries: 1 })
    expect(s.makers.get('m1')?.revs).toBe(1)
  })

  test('a raise keeps pend and ends the maker', () => {
    const s0 = reported(start(), 't1', 'm1')
    const t = { ...tk(s0, 't1'), pend: new Set(['std:s1']) }
    const s1 = { ...s0, tasks: new Map(s0.tasks).set('t1', t) }
    const s = verdict(s1, 't1', 'RaiseNoRule')
    expect(tk(s, 't1')).toMatchObject({ st: 'Raised', maker: null })
    expect(tk(s, 't1').pend.has('std:s1')).toBe(true)
    expect(fx(s, 't1').stage).toBe('SEval')
    expect(s.makers.get('m1')?.ended).toBe(true)
  })

  test('a split makes parts and the parent is done when they are', () => {
    const s0 = raised(start(), 't1', 'm1')
    const parts = ['a', 'b'].map((x) => ({ name: x, goal: 'g', sections: [x], role: 'qa' }))
    const s1 = go(s0, {
      _tag: 'Evaluate',
      task: 't1',
      level: 'Split',
      parts,
      roleDraft: null,
      summary: '',
    })
    expect(tk(s1, 't1')).toMatchObject({ st: 'Split', maker: null })
    expect(tk(s1, 't2')).toMatchObject({ st: 'Sent', parent: 't1', floor: 'Standard', role: 'qa' })
    expect(fx(s1, 't1').stage).toBe('SClosed')
    expect(allDone(s1)).toBe(false)
    const finish = (st: WorkState, id: string): WorkState =>
      ({ ...st, tasks: new Map(st.tasks).set(id, { ...tk(st, id), st: 'Done' }) })
    expect(allDone(finish(s1, 't2'))).toBe(false)
    expect(allDone(finish(finish(s1, 't2'), 't3'))).toBe(true)
  })
})

describe('changes in effect', () => {
  test('a standard ship takes effect at once', () => {
    const s0 = twoTasks()
    expect(fx(s0, 't2')).toMatchObject({ stage: 'SStdAssess', level: 'Standard', summary: 'why' })
    const s = shipStd(s0, 't2')
    expect(s.ver.get('std:s1')).toBe(1)
    expect(s.items.get('std:s1')?.says).toBe('new std')
    expect(tk(s, 't1').pend.has('std:s1')).toBe(true)
    expect(tk(s, 't2')).toMatchObject({ st: 'Sent', floor: 'Direct' })
    expect(fx(s, 't2').stage).toBe('SClosed')
    expect(s.fixDepth.get('std:s1')).toBe(1)
  })

  test('a direction ship goes to the loop, accept, then reassign', () => {
    const s0 = evaluate(twoTasks(), 't2', 'Direct')
    const s1 = go(shipDir(s0, 't2'), { _tag: 'LoopReview', fix: 't2', toPerson: true })
    expect(s1.ver.get('dir:d1')).toBe(0)
    expect(fx(s1, 't2').stage).toBe('SAtPerson')
    const s2 = go(s1, { _tag: 'Accept', fix: 't2' })
    expect(s2.ver.get('dir:d1')).toBe(1)
    expect(fx(s2, 't2').stage).toBe('SAccepted')
    expect(tk(s2, 't1').pend.has('dir:d1')).toBe(true)
    const s3 = go(send(s2), { _tag: 'AssignDo', task: 't3' })
    const s4 = go(s3, { _tag: 'Reassign' })
    expect(tk(s4, 't2')).toMatchObject({ st: 'Sent', floor: 'Principle' })
    expect(fx(s4, 't2').stage).toBe('SClosed')
    expect(tk(s4, 't3')).toMatchObject({ st: 'Sent', maker: null })
    expect(s4.makers.get('m3')?.ended).toBe(true)
  })

  test('another open draft is rebased by a direction change', () => {
    let s = raised(twoTasks(), 't3', 'm3')
    s = go(evaluate(s, 't3', 'Standard'), { _tag: 'Advance', fix: 't3' })
    expect(fx(s, 't3').stage).toBe('SRuleAssess')
    s = go(go(evaluate(s, 't2', 'Direct'), { _tag: 'Ship', fix: 't2', items: new Set(['dir:d1']),
      draft: new Map([['dir:d1', dir2]]) }), { _tag: 'Accept', fix: 't2' })
    expect(fx(s, 't3')).toMatchObject({ stage: 'SStdAssess', rev: 1 })
    expect(fx(s, 't3').base.get('dir:d1')).toBe(1)
  })

  test('a draft built on old versions is redone, not put in effect', () => {
    const s0 = twoTasks()
    const s1 = shipStd(raised(s0, 't3', 'm3'), 't3')
    const s = go(s1, { _tag: 'Ship', fix: 't2', items: new Set(['std:s1']),
      draft: new Map([['std:s1', { ...std2, says: 'other' }]]) })
    expect(s.ver.get('std:s1')).toBe(1)
    expect(s.items.get('std:s1')?.says).toBe('new std')
    expect(fx(s, 't2')).toMatchObject({ stage: 'SStdAssess', rev: 1 })
  })

  test('an edit takes effect only with exactly what the person wrote', () => {
    const s0 = go(start(), { _tag: 'EditDirection', draft: new Map([['dir:d1', dir2]]) })
    expect(fx(s0, EDIT)).toMatchObject({ stage: 'SDirAssess', level: 'Direct' })
    expect(fx(s0, EDIT).wrote.has('dir:d1')).toBe(true)
    const same = shipDir(s0, EDIT)
    expect(same.ver.get('dir:d1')).toBe(1)
    expect(fx(same, EDIT).stage).toBe('SAccepted')
    const more = go(s0, { _tag: 'Ship', fix: EDIT, items: new Set(['dir:d1', 'std:s1']),
      draft: new Map([['dir:d1', dir2], ['std:s1', std2]]) })
    expect(more.ver.get('dir:d1')).toBe(0)
    expect(fx(more, EDIT).stage).toBe('SLoop')
  })

  test('a role draft in effect changes the card', () => {
    const rd = { role: 'dev', words: 'new', model: 'm' }
    const s0 = go(raised(start(), 't1', 'm1'), { _tag: 'Evaluate', task: 't1', level: 'Fit',
      parts: [], roleDraft: rd, summary: '' })
    expect(fx(s0, 't1')).toMatchObject({ kind: 'DRole', stage: 'SLoop', roleOnly: true })
    const s = go(s0, { _tag: 'Accept', fix: 't1' })
    expect(s.cards.get('dev')?.words).toBe('new')
    expect(s.card.get('dev')).toBe(1)
    expect(tk(s, 't1').st).toBe('Sent')
  })
})

describe('the rule test and the ladder', () => {
  const mech = { ...rule, form: 'mech' as const }
  const write = (s: WorkState): WorkState =>
    go(s, { _tag: 'WriteRule', fix: 't1', rule: 'rule:r1', rec: mech, refOk: true })
  const written = (s: WorkState): WorkState =>
    write(go(evaluate(s, 't1', 'Standard'), { _tag: 'Advance', fix: 't1' }))
  const runTest = (s: WorkState, own: boolean, contra: string[] = []): WorkState =>
    go(s, { _tag: 'RunTest', fix: 't1', own, contra })

  test('a second own failure climbs', () => {
    const s0 = written(raised(start(), 't1', 'm1'))
    expect(fx(s0, 't1').stage).toBe('STest')
    const s1 = runTest(s0, false)
    expect(fx(s1, 't1')).toMatchObject({ stage: 'SRuleAssess', ruleTries: 1 })
    const s2 = runTest(write(s1), false)
    expect(fx(s2, 't1')).toMatchObject({ stage: 'SStdAssess', ruleTries: 0, climb: 'SStdAssess' })
  })

  test('a contradiction goes to direction assessment', () => {
    const s = runTest(written(raised(start(), 't1', 'm1')), true, ['rule:r2'])
    expect(fx(s, 't1')).toMatchObject({ stage: 'SDirAssess', kind: 'DDir', contradicted: true })
    expect(fx(s, 't1').fights.has('rule:r2')).toBe(true)
  })

  test('the loop climbs one level, a role draft goes to the person', () => {
    const z = { ...CLOSED, entry: 'SStdAssess' as const, loops: 1 }
    expect(loopClimb(z)).toMatchObject({ stage: 'SDirAssess', entry: 'SDirAssess', rev: 1 })
    expect(loopClimb({ ...z, entry: 'SPrinciple' })).toMatchObject({ stage: 'SAtPerson' })
    expect(loopClimb({ ...z, kind: 'DRole' }).stage).toBe('SAtPerson')
    const s0 = shipDir(evaluate(twoTasks(), 't2', 'Direct'), 't2')
    const toLoop = (s: WorkState): WorkState =>
      go(s, { _tag: 'LoopReview', fix: 't2', toPerson: false })
    const s1 = toLoop(s0)
    expect(fx(s1, 't2')).toMatchObject({ stage: 'SLoop', loops: 1, rev: 1 })
    expect(fx(toLoop(s1), 't2')).toMatchObject({ stage: 'SPrinciple', entry: 'SPrinciple' })
  })
})

describe('the person and the host', () => {
  test('decide take keeps what is owed', () => {
    const s0 = shipStd(twoTasks(), 't2')
    const s1 = go(s0, { _tag: 'TopDone' })
    const s2 = go(s1, { _tag: 'Reject', task: 't1', points: [] })
    expect(s2.top.done).toBe(false)
    expect(tk(s2, 't1').st).toBe('Raised')
    const s = go(s2, { _tag: 'Decide', task: 't1', take: true })
    expect(tk(s, 't1')).toMatchObject({ st: 'Done', taken: true })
    expect([...tk(s, 't1').pend]).toEqual(['std:s1'])
    expect(oldFor(s, tk(s, 't1'))).toEqual(['std:s1'])
    expect(fx(s, 't1').stage).toBe('SClosed')
  })

  test('recheck done passes or fails', () => {
    const s0 = shipStd(twoTasks(), 't2')
    const items = new Set(['std:s1'])
    const pass = go(s0, { _tag: 'RecheckDone', task: 't1', items, holds: true })
    expect(tk(pass, 't1').pend.size).toBe(0)
    expect(tk(pass, 't1').checked.get('std:s1')).toBe(1)
    const open = go(s0, { _tag: 'TopDone' })
    const fail = go(open, { _tag: 'RecheckDone', task: 't1', items, holds: false })
    expect(tk(fail, 't1')).toMatchObject({ st: 'Sent', tries: 0, maker: null })
    expect(tk(fail, 't1').pend.size).toBe(0)
    expect(fail.top.done).toBe(false)
  })

  test('reviving a role ends its makers', () => {
    const s0 = go(send(start()), { _tag: 'AssignDo', task: 't1' })
    const s1 = go(s0, { _tag: 'ReadBrief', maker: 'm1' })
    const down = go(s1, { _tag: 'Exit', who: roleActor('dev') })
    expect(down.down.has('role:dev')).toBe(true)
    expect(down.down.has('maker:m1')).toBe(true)
    expect(down.makers.get('m1')?.claim).toBe(false)
    const s = go(down, { _tag: 'Revive', who: roleActor('dev') })
    expect(s.down.has('role:dev')).toBe(false)
    expect(s.ep.get('role:dev')).toBe(1)
    expect(s.makers.get('m1')?.ended).toBe(true)
    expect(tk(s, 't1')).toMatchObject({ st: 'Sent', maker: null })
  })

  test('move host binds the session', () => {
    const s = go(start(), { _tag: 'MoveHost', fromSession: 0 })
    expect(s).toMatchObject({ session: 1, top: { hostSession: 1 } })
    expect(s.ep.get('host')).toBe(1)
  })

  test('effect does not count the act', () => {
    const a = { id: 'x', who: PERSON, ep: 0, what: { _tag: 'TopDone' } as const, seen: -1,
      seenVer: 0, vers: new Map(), old: false }
    expect(effect(start(), a).seq).toBe(0)
  })
})
