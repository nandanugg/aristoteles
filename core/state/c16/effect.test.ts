// The effect of each act (protocol.qnt) on small states, the shared store changes, the sweep of the
// asks and the split (D5).
import { describe, expect, test } from 'bun:test'
import type { Form, ItemKind, ItemRec, RoleDraft } from './data.ts'
import { effect, take } from './effect.ts'
import { allDone, askCountOf, findAsk, fixOf, taskOf } from './reads.ts'
import { initState, type WorkState } from './state.ts'
import type { AskSpec } from './reads.ts'
import type { Act, Actor, AskKind, Body, OpenAsk } from './types.ts'

const human: Actor = { _tag: 'Human' }
const host: Actor = { _tag: 'Host' }
const pipe: Actor = { _tag: 'Pipe' }
const harness: Actor = { _tag: 'Harness' }
const dev: Actor = { _tag: 'Role', name: 'dev' }
const maker = (id: string): Actor => ({ _tag: 'Maker', id })

const rec = (
  kind: ItemKind,
  parent: string | null,
  says: string,
  form: Form = 'none',
): ItemRec => ({
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

const go = (s: WorkState, who: Actor, body: Body, over: Partial<Act> = {}): WorkState =>
  take(s, { id: 'x', who, ep: 0, seen: -1, seenVer: 0, vers: new Map(), old: false, body, ...over })
const asks = (s: WorkState, kind: AskKind): ReadonlyArray<OpenAsk> =>
  [...s.asks.values()].filter((a) => a.kind === kind)
const one = (s: WorkState, kind: AskKind): OpenAsk => {
  const a = asks(s, kind)
  expect(a.length).toBe(1)
  return a[0]!
}
const spec = (sections: ReadonlyArray<string>, name = 'n') =>
  ({ name, goal: 'g', sections, role: 'dev' })

const send = (s: WorkState): WorkState =>
  go(s, host, { _tag: 'Open', open: { _tag: 'OpenSend', spec: spec(['a', 'b']) } })
const made = (s: WorkState): WorkState =>
  go(send(s), dev, { _tag: 'Open', open: { _tag: 'OpenMake', task: 't1' } })
const reported = (s: WorkState): WorkState => {
  const s1 = go(made(s), maker('m1'), { _tag: 'ReadBrief', maker: 'm1' })
  return go(s1, maker('m1'), {
    _tag: 'Report',
    ask: makerAsk(s1).id,
    output: 'o',
    files: [],
    caught: new Set(['rule:r1']),
  })
}
// The Execute to a maker (its task).
const makerAsk = (s: WorkState): OpenAsk =>
  [...s.asks.values()].find((a) => a.kind === 'Execute' && a.to._tag === 'Maker')!
const verdict = (s: WorkState, v: 'Pass' | 'Fail' | 'RaiseTries' | 'RaiseNoRule'): WorkState =>
  go(s, dev, { _tag: 'Review', ask: one(s, 'Check').id, verdict: v, points: [] })
const done = (s: WorkState): WorkState => verdict(reported(s), 'Pass')
const rejected = (s: WorkState): WorkState =>
  go(done(s), human, { _tag: 'Open', open: { _tag: 'OpenReject', task: 't1', points: ['p'] } })
const evaluated = (s: WorkState, level: 'Standard' | 'Direct'): WorkState =>
  go(rejected(s), pipe, {
    _tag: 'Evaluate',
    fix: 't1',
    level,
    parts: [],
    roleDraft: null,
    summary: 'why',
  })
const std2 = { ...std, says: 'new std' }
const dir2 = { ...dir, says: 'new dir' }
const ship = (s: WorkState, fix: string, item: string, r: ItemRec): WorkState =>
  go(s, pipe, {
    _tag: 'Ship',
    fix,
    items: new Set([item]),
    draft: new Map([[item, r]]),
    resolvesFight: false,
  })
const loop = (s: WorkState, fix: string, toPerson: boolean): WorkState =>
  go(s, pipe, { _tag: 'LoopReview', fix, toPerson })

describe('the task cycle and its asks', () => {
  test('send, make, brief, report: the host, maker and check asks', () => {
    let s = send(start())
    expect(taskOf(s, 't1')).toMatchObject({
      state: 'Sent',
      parent: null,
      floor: 'Split',
      resultId: -1,
    })
    expect(one(s, 'Execute')).toMatchObject({ id: '0', from: host, to: dev })
    s = go(s, dev, { _tag: 'Open', open: { _tag: 'OpenMake', task: 't1' } })
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Working', maker: 'm1' })
    const makes = { kind: 'Execute', from: dev, to: maker('m1'), about: { _tag: 'Task', id: 't1' } }
    expect(findAsk(s, makes as AskSpec)?.id)
      .toBe('1')
    expect(s.ep.get('maker:m1')).toBe(0)
    s = go(s, maker('m1'), { _tag: 'ReadBrief', maker: 'm1' })
    expect(s.makers.get('m1')?.claimed).toBe(true)
    s = reported(start())
    expect(taskOf(s, 't1')).toMatchObject({ state: 'InReview', resultId: 0, taken: false })
    expect(taskOf(s, 't1').caught.has('rule:r1')).toBe(true)
    // the report closed the maker's Execute and made the Check in the same event
    expect(asks(s, 'Execute').length).toBe(1)
    expect(one(s, 'Check')).toMatchObject({ from: maker('m1'), to: dev, id: '3' })
  })

  test('pass: done, the maker ends, the host ask closes, caught clears', () => {
    const s = done(start())
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Done', maker: null })
    expect(taskOf(s, 't1').caught.size).toBe(0)
    expect(s.makers.get('m1')?.ended).toBe(true)
    expect(s.asks.size).toBe(0)
    expect(allDone({ ...s, top: { ...s.top, sections: ['a', 'b'] } })).toBe(true)
  })

  test('fail goes to the same maker; a fail with no live maker goes to Sent', () => {
    const s = verdict(reported(start()), 'Fail')
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Working', tries: 1 })
    expect(s.makers.get('m1')?.revisions).toBe(1)
    expect(makerAsk(s)).toMatchObject({ from: dev, to: maker('m1') })
    expect(asks(s, 'Check').length).toBe(0)
  })

  test('fail of a task whose maker is gone: Sent', () => {
    const s0 = reported(start())
    const gone = effect(
      go(s0, harness, { _tag: 'Exit', actor: dev }),
      { id: 'x', who: harness, ep: 0, seen: -1, seenVer: 0, vers: new Map(), old: false,
        body: { _tag: 'Revive', actor: dev } },
    )
    const s = verdict(gone, 'Fail')
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Sent', tries: 1 })
  })

  test('raise on tries: the maker ends, the fix is evaluating, the pipe ask is open', () => {
    const s = verdict(reported(start()), 'RaiseTries')
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Raised', tries: 1, maker: null })
    expect(fixOf(s, 't1')).toMatchObject({ stage: 'Evaluating', basisStep: 1 })
    expect(asks(s, 'Execute').map((a) => a.to)).toEqual([dev, pipe])
    expect(findAsk(s, { kind: 'Execute', from: dev, to: pipe, about: { _tag: 'Fix', id: 't1' } }))
      .toBeDefined()
  })

  test('reject of a done task: the top opens, the host ask is back, the person raises', () => {
    const s = rejected(start())
    expect(s.top.done).toBe(false)
    expect(taskOf(s, 't1').state).toBe('Raised')
    expect(findAsk(s, { kind: 'Execute', from: host, to: dev, about: { _tag: 'Task', id: 't1' } }))
      .toBeDefined()
    expect(findAsk(s, { kind: 'Execute', from: human, to: pipe, about: { _tag: 'Fix', id: 't1' } }))
      .toBeDefined()
  })
})

describe('questions', () => {
  const qbody = { title: 'q', form: { _tag: 'Single' } } as const
  const asked = (): WorkState =>
    go(made(start()), maker('m1'), {
      _tag: 'Open',
      open: { _tag: 'OpenQuestion', to: human, question: qbody },
    })

  test('open counts the pair; answer moves it; hear clears; justAnswered alternates', () => {
    let s = asked()
    const q = [...s.asks.values()].find((a) => a.kind === 'Question')!
    expect(q).toMatchObject({ from: maker('m1'), to: human, about: { _tag: 'None' } })
    expect(askCountOf(s, maker('m1'), human)).toBe(1)
    s = go(s, human, { _tag: 'AnswerQuestion', ask: q.id, answer: { _tag: 'Single', text: 'x' } })
    expect(s.asks.has(q.id)).toBe(false)
    expect(s.answered.get(q.id)?.answer).toEqual({ _tag: 'Single', text: 'x' })
    expect(s.justAnswered.has('human')).toBe(true)
    s = go(s, maker('m1'), { _tag: 'Hear', ask: q.id })
    expect(s.answered.size).toBe(0)
    expect(askCountOf(s, maker('m1'), human)).toBe(1)
    // another act of the answerer clears justAnswered
    const s2 = go(asked(), human, { _tag: 'MoveHost', fromSession: 0 })
    expect(s2.justAnswered.has('human')).toBe(false)
  })

  test('a maker that ends loses its questions, answers and counts', () => {
    let s = asked()
    const q = [...s.asks.values()].find((a) => a.kind === 'Question')!
    s = go(s, human, { _tag: 'AnswerQuestion', ask: q.id, answer: { _tag: 'Single', text: 'x' } })
    s = go(s, maker('m1'), {
      _tag: 'Open',
      open: { _tag: 'OpenQuestion', to: pipe, question: qbody },
    })
    s = go(s, maker('m1'), {
      _tag: 'Report',
      ask: makerAsk(s).id,
      output: '',
      files: [],
      caught: new Set(),
    })
    s = verdict(s, 'Pass')
    expect(s.answered.size).toBe(0)
    expect([...s.asks.values()].some((a) => a.kind === 'Question')).toBe(false)
    expect(askCountOf(s, maker('m1'), human)).toBe(0)
  })

  test('AskRaise: the maker past the cap raises its task by the role', () => {
    const s = go(asked(), maker('m1'), { _tag: 'AskRaise', to: human })
    expect(taskOf(s, 't1').state).toBe('Raised')
    expect(findAsk(s, { kind: 'Execute', from: dev, to: pipe, about: { _tag: 'Fix', id: 't1' } }))
      .toBeDefined()
    expect([...s.asks.values()].some((a) => a.kind === 'Question')).toBe(false)
  })
})

describe('the fix: a standard change', () => {
  test('evaluate, advance, write a rule, ship: in effect, back to the role', () => {
    let s = evaluated(start(), 'Standard')
    expect(fixOf(s, 't1')).toMatchObject({ stage: 'AtStandard', entry: 'AtStandard', basisStep: 2 })
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' })
    expect(fixOf(s, 't1').stage).toBe('AtRule')
    s = go(s, pipe, {
      _tag: 'WriteRule',
      fix: 't1',
      rule: 'rule:r1',
      rec: { ...rule, says: 'r2' },
      refOk: true, fights: [],
    })
    expect(fixOf(s, 't1')).toMatchObject({ stage: 'Drafting', form: 'Ref' })
    s = ship(s, 't1', 'std:s1', std2)
    expect(s.ver.get('std:s1')).toBe(1)
    expect(s.items.get('std:s1')?.says).toBe('new std')
    expect(s.fixDepth.get('std:s1')).toBe(1)
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Sent', tries: 0, floor: 'Direct' })
    expect(fixOf(s, 't1').stage).toBe('Closed')
    // the pipe ask is gone with the fix
    expect(asks(s, 'Execute').every((a) => a.to._tag !== 'Pipe')).toBe(true)
  })

  test('a rule with a test command goes to Testing; the test failing twice climbs', () => {
    let s = evaluated(start(), 'Standard')
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' })
    s = go(s, pipe, {
      _tag: 'WriteRule', fix: 't1', rule: 'rule:r1', rec: { ...rule, form: 'mech' },
      refOk: true,
      fights: [],
    })
    expect(fixOf(s, 't1').stage).toBe('Testing')
    s = go(s, pipe, { _tag: 'RunTest', fix: 't1', own: false, contra: [] })
    expect(fixOf(s, 't1')).toMatchObject({ stage: 'AtRule', ruleTries: 1 })
    s = go(s, pipe, {
      _tag: 'WriteRule', fix: 't1', rule: 'rule:r1', rec: { ...rule, form: 'mech' },
      refOk: true,
      fights: [],
    })
    s = go(s, pipe, { _tag: 'RunTest', fix: 't1', own: false, contra: [] })
    expect(fixOf(s, 't1')).toMatchObject({
      stage: 'AtStandard',
      climbedTo: 'AtStandard',
      ruleTries: 0,
    })
  })

  test('a contradiction at standard entry goes to direction assessment', () => {
    let s = evaluated(start(), 'Standard')
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' })
    s = go(s, pipe, {
      _tag: 'WriteRule', fix: 't1', rule: 'rule:r1', rec: { ...rule, form: 'mech' },
      refOk: true,
      fights: [],
    })
    s = go(s, pipe, { _tag: 'RunTest', fix: 't1', own: true, contra: ['rule:r2'] })
    expect(fixOf(s, 't1')).toMatchObject({
      stage: 'AtDirection', entry: 'AtDirection', contradicted: true, level: 'Direct',
    })
    expect(fixOf(s, 't1').fights.has('rule:r2')).toBe(true)
  })

  test('a conflict redoes the draft instead of putting it in effect', () => {
    let s = evaluated(start(), 'Standard')
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' })
    s = go(s, pipe, {
      _tag: 'WriteRule', fix: 't1', rule: 'rule:r1', rec: { ...rule, says: 'r2' },
      refOk: true,
      fights: [],
    })
    // the item moved since the draft's base
    const moved = { ...s, ver: new Map(s.ver).set('std:s1', 3) }
    const t = ship(moved, 't1', 'std:s1', std2)
    expect(fixOf(t, 't1')).toMatchObject({ stage: 'AtStandard', revision: 1 })
    expect(t.ver.get('std:s1')).toBe(3)
  })
})

describe('the fix: a direction change reaches the person', () => {
  const atPerson = (): WorkState => {
    let s = evaluated(start(), 'Direct')
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' }) // AtStandard
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' }) // AtRule
    s = go(s, pipe, {
      _tag: 'WriteRule', fix: 't1', rule: 'rule:r1', rec: rule,
      refOk: true,
      fights: [],
    })
    s = ship(s, 't1', 'dir:d1', dir2)
    expect(fixOf(s, 't1').stage).toBe('InLoop')
    return loop(s, 't1', true)
  }
  const respond = (s: WorkState, reply: 'AcceptIt' | 'SendItBack' | 'TakeAsIs' | 'EvaluateAgain') =>
    go(s, human, { _tag: 'Respond', ask: one(s, 'Decide').id, reply, points: [] })

  test('to the person: the sweep opens a Decide, once; accept puts it in effect', () => {
    let s = atPerson()
    expect(one(s, 'Decide')).toMatchObject({
      from: pipe,
      to: human,
      about: { _tag: 'Fix', id: 't1' },
    })
    s = respond(s, 'AcceptIt')
    expect(s.ver.get('dir:d1')).toBe(1)
    expect(fixOf(s, 't1').stage).toBe('Accepted')
    expect(taskOf(s, 't1').floor).toBe('Principle')
    expect(asks(s, 'Decide').length).toBe(0)
    // the host reassigns: the accepted raise goes back to the role
    s = go(s, host, { _tag: 'Reassign' })
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Sent', tries: 0 })
    expect(fixOf(s, 't1').stage).toBe('Closed')
  })

  test('send back: in the loop, needs a revision, the Decide is withdrawn', () => {
    const s = respond(atPerson(), 'SendItBack')
    expect(fixOf(s, 't1')).toMatchObject({ stage: 'InLoop', needRevise: true, sendBacks: 1 })
    expect(fixOf(s, 't1').sentBack.has(0)).toBe(true)
    expect(asks(s, 'Decide').length).toBe(0)
  })

  test('take as is: done and taken, rechecked, the host ask closed', () => {
    const s = respond(atPerson(), 'TakeAsIs')
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Done', taken: true })
    expect(fixOf(s, 't1').stage).toBe('Closed')
    expect(asks(s, 'Execute').length).toBe(0)
    expect(asks(s, 'Decide').length).toBe(0)
  })

  test('evaluate again: back to evaluation, the pipe ask stays', () => {
    const s = respond(atPerson(), 'EvaluateAgain')
    expect(fixOf(s, 't1').stage).toBe('Evaluating')
    expect(findAsk(s, { kind: 'Execute', from: human, to: pipe, about: { _tag: 'Fix', id: 't1' } }))
      .toBeDefined()
  })

  test('an accepted change of a direction rebases an open draft built before it', () => {
    let s = atPerson()
    const other = { ...fixOf(s, 't1'), stage: 'Drafting' as const, entry: 'AtDirection' as const }
    s = { ...s, fixes: new Map(s.fixes).set('edit', other) }
    s = respond(s, 'AcceptIt')
    expect(fixOf(s, 'edit')).toMatchObject({ stage: 'AtDirection', revision: 1 })
  })

  test('loop rounds alternate, then the draft climbs one level', () => {
    let s = evaluated(start(), 'Standard')
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' })
    s = go(s, pipe, {
      _tag: 'WriteRule', fix: 't1', rule: 'rule:r1', rec: rule,
      refOk: true,
      fights: [],
    })
    s = { ...s, fixes: new Map(s.fixes).set('t1', { ...fixOf(s, 't1'), stage: 'InLoop' }) }
    s = loop(s, 't1', false)
    expect(fixOf(s, 't1')).toMatchObject({ stage: 'InLoop', loopRounds: 1, revision: 1 })
    s = loop(s, 't1', false)
    expect(fixOf(s, 't1')).toMatchObject({
      stage: 'AtDirection',
      entry: 'AtDirection',
      loopRounds: 0,
    })
  })

  test('a role draft: Fit goes to the loop; accepted with only the card, back to the role', () => {
    let s = go(rejected(start()), pipe, {
      _tag: 'Evaluate',
      fix: 't1',
      level: 'Fit',
      parts: [],
      roleDraft: { role: 'dev', words: 'new words', model: 'm' },
      summary: 'why',
    })
    expect(fixOf(s, 't1')).toMatchObject({ kind: 'RoleDraft', stage: 'InLoop', roleOnly: true })
    s = loop(s, 't1', true)
    s = respond(s, 'AcceptIt')
    expect(s.card.get('dev')).toBe(1)
    expect(s.cards.get('dev')?.words).toBe('new words')
    expect(taskOf(s, 't1').state).toBe('Sent')
  })
})

describe('the person edit', () => {
  const edit = (s: WorkState): WorkState =>
    go(s, human, { _tag: 'AskEdit', draft: new Map([['dir:d1', dir2]]) })

  test('enters at direction assessment with an Execute to the pipeline role', () => {
    const s = edit(start())
    expect(fixOf(s, 'edit')).toMatchObject({
      stage: 'AtDirection',
      kind: 'DirectionDraft',
      basisStep: 1,
    })
    expect(fixOf(s, 'edit').wrote.has('dir:d1')).toBe(true)
    expect(one(s, 'Execute')).toMatchObject({
      from: human,
      to: pipe,
      about: { _tag: 'Fix', id: 'edit' },
    })
  })

  test('shipped as written: in effect at once, Accepted for the host to reassign', () => {
    let s = edit(start())
    s = go(s, pipe, { _tag: 'Advance', fix: 'edit' })
    s = go(s, pipe, { _tag: 'Advance', fix: 'edit' })
    s = go(s, pipe, {
      _tag: 'WriteRule', fix: 'edit', rule: 'rule:r1', rec: rule,
      refOk: true,
      fights: [],
    })
    s = ship(s, 'edit', 'dir:d1', dir2)
    expect(s.ver.get('dir:d1')).toBe(1)
    expect(fixOf(s, 'edit').stage).toBe('Accepted')
    s = go(s, host, { _tag: 'Reassign' })
    expect(fixOf(s, 'edit').stage).toBe('Closed')
  })

  test('shipped with an item the person did not write: back to the person', () => {
    let s = edit(start())
    s = go(s, pipe, { _tag: 'Advance', fix: 'edit' })
    s = go(s, pipe, { _tag: 'Advance', fix: 'edit' })
    s = go(s, pipe, {
      _tag: 'WriteRule', fix: 'edit', rule: 'rule:r1', rec: rule,
      refOk: true,
      fights: [],
    })
    s = go(s, pipe, {
      _tag: 'Ship',
      fix: 'edit',
      items: new Set(['dir:d1', 'std:s1']),
      draft: new Map([['dir:d1', dir2], ['std:s1', std2]]),
      resolvesFight: true,
    })
    expect(fixOf(s, 'edit').stage).toBe('InLoop')
    expect(fixOf(s, 'edit').resolvesFight).toBe(true)
    expect(s.ver.get('dir:d1')).toBe(0)
  })
})

describe('the sweep and the split', () => {
  test('the Decide follows the stage: a change that sends a draft back withdraws it', () => {
    let s = evaluated(start(), 'Standard')
    s = { ...s, fixes: new Map(s.fixes).set('t1', { ...fixOf(s, 't1'), stage: 'InLoop' }) }
    s = loop(s, 't1', true)
    const first = one(s, 'Decide').id
    // an act that leaves the draft at the person keeps the same occurrence
    s = go(s, host, { _tag: 'TopDone' })
    expect(one(s, 'Decide').id).toBe(first)
    s = go(s, human, { _tag: 'Respond', ask: first, reply: 'SendItBack', points: ['x'] })
    expect(asks(s, 'Decide').length).toBe(0)
    s = loop(s, 't1', true)
    expect(one(s, 'Decide').id).not.toBe(first)
  })

  test('a split: the parent is Split; the host ask is replaced by one per part, at once', () => {
    const base = rejected(start())
    const s = go(base, pipe, {
      _tag: 'Evaluate',
      fix: 't1',
      level: 'Split',
      parts: [spec(['a'], 'p1'), spec(['b'], 'p2')],
      roleDraft: null,
      summary: 'big',
    })
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Split', maker: null })
    expect(taskOf(s, 't2')).toMatchObject({
      state: 'Sent',
      parent: 't1',
      floor: 'Standard',
      sections: ['a'],
    })
    expect(taskOf(s, 't3')).toMatchObject({ state: 'Sent', parent: 't1', sections: ['b'] })
    expect(fixOf(s, 't1').stage).toBe('Closed')
    const hostAsks = asks(s, 'Execute')
    expect(hostAsks.length).toBe(2)
    expect(hostAsks.every((a) => a.from._tag === 'Host')).toBe(true)
    const seq = base.seq
    expect(hostAsks.map((a) => [a.id, a.about])).toEqual([
      [`${seq}`, { _tag: 'Task', id: 't2' }],
      [`${seq}.1`, { _tag: 'Task', id: 't3' }],
    ])
    expect(findAsk(s, { kind: 'Execute', from: host, to: dev, about: { _tag: 'Task', id: 't1' } }))
      .toBeUndefined()
  })
})

describe('two sibling parts of a split', () => {
  test('a change made through one part\'s raise leaves the other, done, pending a recheck', () => {
    const split = go(rejected(start()), pipe, {
      _tag: 'Evaluate',
      fix: 't1',
      level: 'Split',
      parts: [spec(['a'], 'p1'), spec(['b'], 'p2')],
      roleDraft: null,
      summary: 'big',
    })
    // t2 is done; t3 is raised and its draft is shipped as a standard change
    const set = (st: WorkState, id: string, over: object): WorkState => ({
      ...st,
      tasks: new Map(st.tasks).set(id, { ...taskOf(st, id), ...over }),
    })
    let s = set(set(split, 't2', { state: 'Done', resultId: 0 }), 't3', {
      state: 'Raised',
      resultId: 0,
    })
    s = {
      ...s,
      fixes: new Map(s.fixes).set('t3', {
        ...fixOf(s, 't3'),
        stage: 'Drafting',
        kind: 'DirectionDraft',
        entry: 'AtStandard',
      }),
    }
    s = ship(s, 't3', 'std:s1', std2)
    expect([...taskOf(s, 't2').pending]).toEqual(['std:s1'])
    expect(taskOf(s, 't3')).toMatchObject({ state: 'Sent' })
  })
})

describe('WriteRule fights', () => {
  const atRule = (contradicted: boolean): WorkState => {
    let s = evaluated(start(), 'Standard')
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' })
    return { ...s, fixes: new Map(s.fixes).set('t1', { ...fixOf(s, 't1'), contradicted }) }
  }
  const write = (s: WorkState, fights: ReadonlyArray<string>): WorkState =>
    go(s, pipe, { _tag: 'WriteRule', fix: 't1', rule: 'rule:r1', rec: rule, refOk: true, fights })
  test('a reference rule: the claim is the fights; a rewrite that still fights stays', () => {
    const s = write(atRule(true), ['rule:r2'])
    expect([...fixOf(s, 't1').fights]).toEqual(['rule:r2'])
    expect(fixOf(s, 't1').contradicted).toBe(true)
    expect(fixOf(write(atRule(true), []), 't1')).toMatchObject({ contradicted: false })
    expect(fixOf(write(atRule(false), ['rule:r2']), 't1').contradicted).toBe(false)
  })
})

describe('Ship records resolvesFight', () => {
  // The draft held at the person, contradicted; `moved`: an item version moved since the Ship.
  const held = (
    over: Partial<ReturnType<typeof fixOf>>,
    moved = false,
  ): WorkState => {
    let s = evaluated(start(), 'Standard')
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' })
    const resolvedOn = new Map(s.ver)
    s = {
      ...s,
      ver: moved ? new Map(s.ver).set('rule:r1', 5) : s.ver,
      fixes: new Map(s.fixes).set('t1', {
        ...fixOf(s, 't1'),
        stage: 'AtPerson',
        contradicted: true,
        fights: new Set(['rule:r2']),
        resolvedOn,
        ...over,
      }),
    }
    return s
  }
  const accept = (s: WorkState): WorkState => {
    const s1 = go(s, host, { _tag: 'TopDone' }) // the sweep opens the Decide
    const ask = one(s1, 'Decide').id
    return go(s1, human, { _tag: 'Respond', ask, reply: 'AcceptIt', points: [] })
  }
  const fights = (over: Partial<ReturnType<typeof fixOf>>, moved = false) =>
    [...fixOf(accept(held(over, moved)), 't1').fights]

  test('a reference-only rule: the claim is carried with the draft', () => {
    expect(fights({ form: 'Ref', resolvesFight: true })).toEqual([])
    expect(fights({ form: 'Ref', resolvesFight: false })).toEqual(['rule:r2'])
    // not a harness value: versions moving do not void a claim
    expect(fights({ form: 'Ref', resolvesFight: true }, true)).toEqual([])
  })
  test('a test-command rule: harness evidence on the versions it was computed on', () => {
    for (const form of ['Mech', 'Both'] as const) {
      expect(fights({ form, resolvesFight: true })).toEqual([])
      expect(fights({ form, resolvesFight: false })).toEqual(['rule:r2'])
      // the versions moved since the cross test: the value is void, the fight stays
      expect(fights({ form, resolvesFight: true }, true)).toEqual(['rule:r2'])
      expect(fights({ form, resolvesFight: true, resolvedOn: null })).toEqual(['rule:r2'])
    }
  })
  test('the Ship records the versions it was computed on', () => {
    let s = evaluated(start(), 'Direct')
    s = go(s, pipe, { _tag: 'Advance', fix: 't1' })
    s = go(s, pipe, {
      _tag: 'Ship',
      fix: 't1',
      items: new Set(['std:s1']),
      draft: new Map([['std:s1', std2]]),
      resolvesFight: true,
    })
    expect(fixOf(s, 't1')).toMatchObject({ resolvesFight: true })
    expect(fixOf(s, 't1').resolvedOn).toEqual(s.ver)
  })
  test('a redo drops the claim: send back, then a new Ship', () => {
    let s = held({ form: 'Ref', resolvesFight: true })
    s = go(s, host, { _tag: 'TopDone' })
    const ask = one(s, 'Decide').id
    s = go(s, human, { _tag: 'Respond', ask, reply: 'SendItBack', points: [] })
    expect(fixOf(s, 't1')).toMatchObject({ resolvesFight: false, resolvedOn: null })
  })
  test('a rebase drops the claim', () => {
    // t2's draft sits at the person; another fix changes a direction: t2 is rebased
    let s = held({ form: 'Ref', resolvesFight: true })
    const t2 = { ...fixOf(s, 't1'), entry: 'AtStandard', stage: 'Drafting' } as const
    s = { ...s, fixes: new Map(s.fixes).set('t2', t2) }
    s = go(s, human, { _tag: 'AskEdit', draft: new Map([['dir:d1', dir2]]) })
    s = go(s, pipe, {
      _tag: 'Ship',
      fix: 'edit',
      items: new Set(['dir:d1']),
      draft: new Map([['dir:d1', dir2]]),
      resolvesFight: false,
    })
    expect(fixOf(s, 'edit').stage).toBe('Accepted')
    expect(fixOf(s, 't2'))
      .toMatchObject({ stage: 'AtStandard', resolvesFight: false, resolvedOn: null })
  })
})

describe('rechecks and the engine', () => {
  const withRecheck = (): WorkState => {
    let s = done(start())
    // a standard change reaches the done task: it owes a recheck
    s = go(s, human, { _tag: 'AskEdit', draft: new Map([['std:s1', std2]]) })
    s = go(s, pipe, {
      _tag: 'Ship',
      fix: 'edit',
      items: new Set(['std:s1']),
      draft: new Map([['std:s1', std2]]),
      resolvesFight: false,
    })
    return s
  }

  test('a standard change leaves a done task to recheck; holds clears it', () => {
    let s = withRecheck()
    expect(taskOf(s, 't1').pending.has('std:s1')).toBe(true)
    s = go(s, pipe, { _tag: 'RecheckDone', task: 't1', items: new Set(['std:s1']), holds: true })
    expect(taskOf(s, 't1').pending.size).toBe(0)
    expect(taskOf(s, 't1').checked.get('std:s1')).toBe(1)
  })

  test('a failed recheck: back to the role, the top and the host ask open again', () => {
    let s = go(done(start()), host, { _tag: 'TopDone' })
    const pending = { ...taskOf(s, 't1'), pending: new Set(['std:s1']) }
    s = { ...s, tasks: new Map(s.tasks).set('t1', pending) }
    s = go(s, pipe, { _tag: 'RecheckDone', task: 't1', items: new Set(['std:s1']), holds: false })
    expect(s.top.done).toBe(false)
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Sent', tries: 0, maker: null })
    expect(findAsk(s, { kind: 'Execute', from: host, to: dev, about: { _tag: 'Task', id: 't1' } }))
      .toBeDefined()
  })

  test('RunRule: the harness clears the test-command rules, or sends the task back', () => {
    const mech = { ...rule, form: 'mech' as const }
    const base = done(start())
    const ready = {
      ...base,
      items: new Map(base.items).set('rule:r1', mech),
      tasks: new Map(base.tasks).set('t1', {
        ...taskOf(base, 't1'),
        pending: new Set(['rule:r1']),
      }),
    }
    const held = go(ready, harness, { _tag: 'RunRule', task: 't1', holds: true })
    expect(taskOf(held, 't1').pending.size).toBe(0)
    const broke = go(ready, harness, { _tag: 'RunRule', task: 't1', holds: false })
    expect(taskOf(broke, 't1').state).toBe('Sent')
    expect(broke.top.done).toBe(false)
  })

  test('exit of the role takes its makers down; revive: new epoch, makers end, task Sent', () => {
    let s = go(made(start()), harness, { _tag: 'Exit', actor: dev })
    expect(s.down.has('role:dev')).toBe(true)
    expect(s.down.has('maker:m1')).toBe(true)
    s = go(s, harness, { _tag: 'Revive', actor: dev })
    expect(s.down.size).toBe(1)
    expect(s.ep.get('role:dev')).toBe(1)
    expect(s.makers.get('m1')?.ended).toBe(true)
    expect(taskOf(s, 't1')).toMatchObject({ state: 'Sent', maker: null })
    expect(asks(s, 'Execute').every((a) => a.to._tag !== 'Maker')).toBe(true)
  })

  test('revive keeps a Check of a task in review (D6): same ask, from the ended maker', () => {
    let s = reported(start())
    const check = one(s, 'Check')
    s = go(s, harness, { _tag: 'Exit', actor: dev })
    s = go(s, harness, { _tag: 'Revive', actor: dev })
    expect(s.makers.get('m1')?.ended).toBe(true)
    expect(taskOf(s, 't1').state).toBe('InReview')
    expect(one(s, 'Check').id).toBe(check.id)
    // the role judges it itself
    s = go(s, dev, { _tag: 'Review', ask: check.id, verdict: 'Pass', points: [] })
    expect(taskOf(s, 't1').state).toBe('Done')
  })

  test('resume ends a maker down: epoch up', () => {
    let s = go(made(start()), harness, { _tag: 'Exit', actor: maker('m1') })
    s = go(s, dev, { _tag: 'Resume', maker: 'm1' })
    expect(s.down.has('maker:m1')).toBe(false)
    expect(s.ep.get('maker:m1')).toBe(1)
  })

  test('move host, top done, end project', () => {
    let s = go(start(), human, { _tag: 'MoveHost', fromSession: 0 })
    expect(s).toMatchObject({ session: 1, top: { hostSession: 1 } })
    expect(s.ep.get('host')).toBe(1)
    s = go(s, host, { _tag: 'TopDone' })
    expect(s.top.done).toBe(true)
    s = go(s, human, { _tag: 'EndProject' })
    expect(s.top.ended).toBe(true)
  })

  test('seq moves with every taken act; effect alone does not move it', () => {
    const s = start()
    const act: Act = {
      id: 'x', who: host, ep: 0, seen: -1, seenVer: 0, vers: new Map(), old: false,
      body: { _tag: 'TopDone' },
    }
    expect(effect(s, act).seq).toBe(0)
    expect(take(s, act).seq).toBe(1)
  })
})
