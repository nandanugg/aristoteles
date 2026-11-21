// The store's check (accept.ts): a case per refusal name and per act's legal guard, on states built
// by hand. The alternation case reads ownToldSteps (obligations.ts, written beside this file).
import { describe, expect, test } from 'bun:test'
import { CLOSED, type Fix, type Maker, type Task, type WorkState } from '../../state/c16/state.ts'
import { initState } from '../../state/c16/state.ts'
import { advance, openAsk } from '../../state/c16/reads.ts'
import type {
  Act,
  Actor,
  AnswerBody,
  AskAbout,
  Body,
  OpenAsk,
  QuestionBody,
} from '../../state/c16/types.ts'
import { keyOf } from '../../state/c16/types.ts'
import type { ItemRec, RoleDraft, TaskSpec } from '../../state/work/types.ts'
import { vsum } from '../../state/c16/reads.ts'
import { accept, basisOf, refusal, refused } from './accept.ts'

const human: Actor = { _tag: 'Human' }
const host: Actor = { _tag: 'Host' }
const pipe: Actor = { _tag: 'Pipe' }
const harness: Actor = { _tag: 'Harness' }
const writer: Actor = { _tag: 'Role', name: 'writer' }
const linter: Actor = { _tag: 'Role', name: 'linter' }
const maker = (id: string): Actor => ({ _tag: 'Maker', id })
const m1 = maker('m1')

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
const base = (): WorkState =>
  initState(
    { name: 't', goal: 'g', sections: ['a', 'b', 'c'], directions: ['d1'] },
    new Map([
      ['dir:d1', rec({})],
      ['std:s1', rec({ kind: 'std', parent: 'dir:d1' })],
      ['rule:r1', rec({ kind: 'rule', parent: 'std:s1', form: 'mech', test: 'x' })],
      ['rule:r2', rec({ kind: 'rule', parent: 'std:s1', form: 'ref', ref: 'f#a:1' })],
    ]),
    new Map([['writer', card], ['linter', { ...card, role: 'linter' }]]),
    3,
  )
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  name: 'n',
  goal: 'g',
  role: 'writer',
  parent: null,
  sections: ['a', 'b'],
  directions: ['d1'],
  generation: 0,
  state: 'Working',
  tries: 0,
  maker: 'm1',
  resultId: 2,
  checked: new Map(),
  pending: new Set(),
  caught: new Set(),
  taken: false,
  floor: 'Standard',
  at: 1,
  ...over,
})
const m1rec: Maker = {
  id: 'm1',
  task: 't1',
  ended: false,
  claimed: true,
  brief: new Map(),
  revisions: 4,
}
const withTask = (over: Partial<Task> = {}, s: WorkState = base()): WorkState => ({
  ...s,
  tasks: new Map([['t1', task(over)]]),
  makers: new Map([['m1', m1rec]]),
})
const withFix = (s: WorkState, id: string, over: Partial<Fix>): WorkState => ({
  ...s,
  fixes: new Map([...s.fixes, [id, { ...CLOSED, ...over }]]),
})
const withAsk = (s: WorkState, ask: OpenAsk): WorkState => ({
  ...s,
  asks: new Map([...s.asks, [ask.id, ask]]),
})
const ask = (id: string, over: Partial<OpenAsk>): OpenAsk => ({
  id,
  kind: 'Execute',
  from: writer,
  to: m1,
  about: { _tag: 'Task', id: 't1' },
  at: 3,
  question: null,
  ...over,
})
const none: AskAbout = { _tag: 'None' }
const single: QuestionBody = { title: 'q', form: { _tag: 'Single' } }
const act = (who: Actor, body: Body, over: Partial<Act> = {}): Act => ({
  id: 'a1',
  who,
  ep: 0,
  seen: -1,
  seenVer: 0,
  vers: new Map(),
  old: false,
  body,
  ...over,
})
const open = (open: Extract<Body, { _tag: 'Open' }>['open']): Body => ({ _tag: 'Open', open })
const ask1 = (to: Actor, question: QuestionBody = single): Body =>
  open({ _tag: 'OpenQuestion', to, question })
const spec = (sections: string[], role = 'writer'): TaskSpec => ({
  name: 'n',
  goal: 'g',
  sections,
  role,
})

// the open Execute to m1 (id 3), and the open Check (id 4) of an in-review task
const working = (): WorkState => withAsk(withTask(), ask('3', {}))
const report: Body = { _tag: 'Report', ask: '3', output: 'o', files: [], caught: new Set() }
const reviewing = (over: Partial<Task> = {}): WorkState =>
  withAsk(
    withTask({ state: 'InReview', ...over }),
    ask('4', { kind: 'Check', from: m1, to: writer }),
  )
const review = (
  verdict: 'Pass' | 'Fail' | 'RaiseTries' | 'RaiseNoRule' = 'Pass',
  ask = '4',
): Body => ({
  _tag: 'Review',
  ask,
  verdict,
  points: [],
})
const atPerson = (id = 't1', over: Partial<Fix> = {}): WorkState =>
  withAsk(
    withFix(withTask({ state: 'Raised' }), id, { stage: 'AtPerson', basisStep: 3, ...over }),
    ask('5', { kind: 'Decide', from: pipe, to: human, about: { _tag: 'Fix', id }, at: 5 }),
  )
const respond = (
  reply: 'AcceptIt' | 'SendItBack' | 'TakeAsIs' | 'EvaluateAgain',
  ask = '5',
): Body => ({
  _tag: 'Respond',
  ask,
  reply,
  points: [],
})
// a question from `from` to `to` open at id 6, with its body
const asked = (s: WorkState, from: Actor, to: Actor, q: QuestionBody = single): WorkState =>
  withAsk(s, ask('6', { kind: 'Question', from, to, about: none, at: 6, question: q }))
const answer = (a: AnswerBody, id = '6'): Body => ({ _tag: 'AnswerQuestion', ask: id, answer: a })

describe('the order and the names', () => {
  test('terminal: MoveHost from the page is refused before anything', () => {
    const s = base()
    const mv: Body = { _tag: 'MoveHost', fromSession: 0 }
    expect(refusal(s, act(human, mv))).toBeNull()
    expect(refusal(s, act(human, mv, { old: true }), 'page')).toBe('terminal')
    expect(refusal({ ...s, session: 1 }, act(human, mv))).toBe('legal')
  })

  test('build comes before ended, authority and basis', () => {
    const s = { ...reviewing(), top: { ...base().top, ended: true } }
    const a = act(linter, review(), { seen: 1, old: true })
    expect(refusal(s, a)).toBe('build')
    expect(refusal(s, { ...a, old: false })).toBe('ended')
    expect(refusal(reviewing(), { ...a, who: writer, old: false })).toBe('basis')
    expect(accept(reviewing(), act(writer, review(), { seen: 2 }))).toBe(true)
  })

  test('ended: all but the harness are refused', () => {
    const s = { ...base(), top: { ...base().top, ended: true } }
    expect(refusal(s, act(host, { _tag: 'Reassign' }))).toBe('ended')
    expect(refusal(s, act(harness, { _tag: 'Exit', actor: pipe }))).toBeNull()
  })

  test('authority comes before epoch, form, stale and legal', () => {
    const s = { ...reviewing(), ep: new Map([[keyOf(linter), 2]]) }
    expect(refusal(s, act(linter, review(), { seen: 2, ep: 0 }))).toBe('authority')
    expect(refusal(s, act(human, review(), { seen: 2 }))).toBe('authority')
    expect(refusal(s, act(pipe, { ...report }, { seen: 4 }))).toBe('authority')
    expect(refusal(base(), act(human, { _tag: 'Reassign' }))).toBe('authority')
  })

  test('epoch: an old epoch is refused; the person and the harness carry none', () => {
    const s = { ...reviewing(), ep: new Map([[keyOf(writer), 2], [keyOf(human), 9]]) }
    expect(refusal(s, act(writer, review(), { seen: 2, ep: 1 }))).toBe('epoch')
    expect(refusal(s, act(writer, review(), { seen: 2, ep: 2 }))).toBeNull()
    const rej = open({ _tag: 'OpenReject', task: 't1', points: ['p'] })
    expect(refusal(s, act(human, rej, { seen: 2 }))).toBeNull()
  })

  test('form: each form refuses an answer that does not fit', () => {
    const f = (form: QuestionBody['form'], a: AnswerBody) =>
      refusal(asked(base(), host, human, { title: 'q', form }), act(human, answer(a)))
    expect(f({ _tag: 'Single' }, { _tag: 'Single', text: 'x' })).toBeNull()
    expect(f({ _tag: 'Single' }, { _tag: 'Single', text: '' })).toBe('form')
    expect(f({ _tag: 'Single' }, { _tag: 'Choice', picked: [0] })).toBe('form')
    const multi = { _tag: 'Multiple', questions: [{ description: 'd', placeholder: 'p' }] } as const
    expect(f(multi, { _tag: 'Multiple', texts: ['a'] })).toBeNull()
    expect(f(multi, { _tag: 'Multiple', texts: [] })).toBe('form')
    const choice = { _tag: 'Choice', options: ['x', 'y'], multi: false } as const
    expect(f(choice, { _tag: 'Choice', picked: [1] })).toBeNull()
    expect(f(choice, { _tag: 'Choice', picked: [0, 1] })).toBe('form')
    expect(f(choice, { _tag: 'Choice', picked: [2] })).toBe('form')
    const matrix = { _tag: 'Matrix', rows: ['r'], columns: ['a', 'b'] } as const
    expect(f(matrix, { _tag: 'Matrix', cells: [1] })).toBeNull()
    expect(f(matrix, { _tag: 'Matrix', cells: [2] })).toBe('form')
  })

  test('form is looked at before stale; a gone ask is stale whatever the answer', () => {
    const s = asked(base(), host, human)
    expect(refusal(s, act(human, answer({ _tag: 'Single', text: '' })))).toBe('form')
    expect(refusal(s, act(human, answer({ _tag: 'Single', text: 'x' }, '9')))).toBe('stale')
    expect(refusal(s, act(human, answer({ _tag: 'Single', text: '' }, '9')))).toBe('stale')
  })

  test('stale: Report, Review and Respond on a closed ask', () => {
    expect(refusal(working(), act(m1, { ...report, ask: '9' } as Body, { seen: 4 }))).toBe('stale')
    expect(refusal(reviewing(), act(writer, review('Pass', '9'), { seen: 2 }))).toBe('stale')
    expect(refusal(atPerson(), act(human, respond('AcceptIt', '9'), { seen: 3 })))
      .toBe('stale')
  })

  test('heard: Hear of an answer already heard; stale once the asker asked again', () => {
    const hear: Body = { _tag: 'Hear', ask: '6' }
    const heardOnce = { ...base(), seq: 12, heardIds: new Set(['6']) }
    expect(refusal(heardOnce, act(host, hear))).toBe('heard')
    // a never-created id, an id removed with an ended maker: stale, never heard
    expect(refusal(heardOnce, act(host, { _tag: 'Hear', ask: '40' }))).toBe('stale')
    expect(refusal(heardOnce, act(host, { _tag: 'Hear', ask: '5' }))).toBe('stale')
    // an independent pair: a newer question to another recipient does not change heard to stale
    const other = withAsk(
      heardOnce,
      ask('9', { kind: 'Question', from: host, to: writer, about: none, at: 9, question: single }),
    )
    expect(refusal(other, act(host, hear))).toBe('heard')
  })

  test('pair: one open or unheard question per ordered pair', () => {
    const s = asked(base(), host, human)
    expect(refusal(s, act(host, ask1(human)))).toBe('pair')
    expect(refusal(s, act(host, ask1(pipe)))).toBeNull()
    expect(refusal(s, act(pipe, ask1(human)))).toBeNull()
    // answered, not yet heard: still taken
    const a = s.asks.get('6')!
    const unheard = { ...s, asks: new Map(), answered: new Map([['6', {
      ask: a,
      answer: { _tag: 'Single', text: 'x' } as const,
      at: 7,
    }]]) }
    expect(refusal(unheard, act(host, ask1(human)))).toBe('pair')
    expect(refusal({ ...unheard, answered: new Map() }, act(host, ask1(human)))).toBeNull()
  })

  test('cap: a maker over the cap is told AskRaise; another asker is only illegal', () => {
    const over = (s: WorkState, from: Actor, to: Actor): WorkState => ({
      ...s,
      askCount: new Map([[JSON.stringify([keyOf(from), keyOf(to)]), s.askCap]]),
    })
    const s = over(working(), m1, human)
    expect(refusal(s, act(m1, ask1(human)))).toBe('cap')
    expect(refused(s, act(m1, ask1(human)))?.next).toBe('AskRaise')
    expect(refusal(over(working(), writer, human), act(writer, ask1(human)))).toBe('legal')
    expect(refusal(over(working(), host, human), act(host, ask1(human)))).toBe('legal')
    expect(refusal(working(), act(m1, ask1(human)))).toBeNull()
  })

  test('basis comes last: a legal act on an older view', () => {
    expect(refusal(working(), act(m1, report, { seen: 3 }))).toBe('basis')
    expect(refusal(working(), act(m1, report, { seen: 4 }))).toBeNull()
    expect(refused(working(), act(m1, report, { seen: 3 }))?.words).not.toBe('')
  })
})

describe('legal, act by act', () => {
  test('OpenQuestion: live parties, not itself, the Human cannot ask', () => {
    const s = working()
    expect(refusal(s, act(host, ask1(human)))).toBeNull()
    expect(refusal(s, act(host, ask1(host)))).toBe('legal')
    expect(refusal(s, act(host, ask1(linter)))).toBeNull()
    expect(refusal(s, act(host, ask1({ _tag: 'Role', name: 'nobody' })))).toBe('legal')
    expect(refusal(s, act(host, ask1(maker('m9'))))).toBe('legal')
    expect(refusal(s, act(linter, ask1(m1)))).toBeNull()
    expect(refusal({ ...s, down: new Set([keyOf(host)]) }, act(host, ask1(human)))).toBe('legal')
    expect(refusal(s, act(human, ask1(host)))).toBe('authority')
    expect(refusal(s, act(harness, ask1(host)))).toBe('authority')
    const ended = { ...s, makers: new Map([['m1', { ...m1rec, ended: true }]]) }
    expect(refusal(ended, act(m1, ask1(human)))).toBe('legal')
  })

  test('OpenSend: uncovered, nonempty, no duplicates, a known role', () => {
    const send = (sp: TaskSpec, s = base()) =>
      refusal(s, act(host, open({ _tag: 'OpenSend', spec: sp })))
    expect(send(spec(['a', 'b']))).toBeNull()
    expect(send(spec([]))).toBe('legal')
    expect(send(spec(['a', 'a']))).toBe('legal')
    expect(send(spec(['z']))).toBe('legal')
    expect(send(spec(['a'], 'nobody'))).toBe('legal')
    expect(send(spec(['a']), withTask({ sections: ['a'] }))).toBe('legal')
    const bySpec = act(pipe, open({ _tag: 'OpenSend', spec: spec(['a']) }))
    expect(refusal(base(), bySpec)).toBe('authority')
  })

  test('OpenMake: the task is Sent, by the role of the task', () => {
    const mk = open({ _tag: 'OpenMake', task: 't1' })
    const sent = withTask({ state: 'Sent', maker: null })
    expect(refusal(sent, act(writer, mk))).toBeNull()
    expect(refusal(sent, act(linter, mk))).toBe('authority')
    expect(refusal(withTask({ state: 'Working' }), act(writer, mk))).toBe('legal')
    expect(refusal(sent, act(writer, open({ _tag: 'OpenMake', task: 'zz' })))).toBe('authority')
  })

  test('OpenReject: a task with a result in review or done; the result is the basis', () => {
    const rej = open({ _tag: 'OpenReject', task: 't1', points: ['p'] })
    const done = withTask({ state: 'Done', maker: null })
    expect(refusal(done, act(human, rej, { seen: 2 }))).toBeNull()
    expect(refusal(withTask({ state: 'InReview' }), act(human, rej, { seen: 2 }))).toBeNull()
    expect(refusal(done, act(human, rej, { seen: 1 }))).toBe('basis')
    expect(refusal(withTask({ state: 'Raised' }), act(human, rej, { seen: 2 }))).toBe('legal')
    expect(refusal(withTask({ state: 'Done', resultId: -1 }), act(human, rej, { seen: -1 })))
      .toBe('legal')
    expect(refusal(done, act(host, rej, { seen: 2 }))).toBe('authority')
    expect(basisOf(done, rej)).toBe(2)
    expect(basisOf(done, { _tag: 'Reassign' })).toBe(-1)
  })

  test('AskEdit: a closed edit and a direction in the draft', () => {
    const d = (k: string) => ({ _tag: 'AskEdit', draft: new Map([[k, rec({})]]) }) as const
    expect(refusal(base(), act(human, d('dir:d1')))).toBeNull()
    expect(refusal(base(), act(human, d('std:s1')))).toBe('legal')
    expect(refusal(withFix(base(), 'edit', { stage: 'AtDirection' }), act(human, d('dir:d1'))))
      .toBe('legal')
  })

  test('AnswerQuestion: only the ask to; the alternation rule', () => {
    const s = asked(base(), host, human)
    const a: AnswerBody = { _tag: 'Single', text: 'x' }
    expect(refusal(s, act(human, answer(a)))).toBeNull()
    expect(refusal(s, act(pipe, answer(a)))).toBe('authority')
    // an Execute is not a question
    expect(refusal(working(), act(m1, answer(a, '3')))).toBe('legal')
    // the role just answered and still has a step of its own (a task to make a maker for)
    const sent = withTask({ state: 'Sent', maker: null })
    const q = withAsk(sent, ask('6', {
      kind: 'Question',
      from: host,
      to: writer,
      about: none,
      question: single,
    }))
    expect(refusal(q, act(writer, answer(a)))).toBeNull()
    const justAnswered = { ...q, justAnswered: new Set([keyOf(writer)]) }
    expect(refusal(justAnswered, act(writer, answer(a)))).toBe('legal')
    // no step of its own: it may answer again
    const idle = { ...asked(base(), host, writer), justAnswered: new Set([keyOf(writer)]) }
    expect(refusal(idle, act(writer, answer(a)))).toBeNull()
  })

  test('Hear: the asker, an answered question', () => {
    const q = asked(base(), host, human)
    const a = q.asks.get('6')!
    const s = {
      ...q,
      asks: new Map<string, OpenAsk>(),
      answered: new Map([['6', { ask: a, answer: { _tag: 'Single', text: 'x' } as const, at: 7 }]]),
    }
    expect(refusal(s, act(host, { _tag: 'Hear', ask: '6' }))).toBeNull()
    expect(refusal(s, act(human, { _tag: 'Hear', ask: '6' }))).toBe('authority')
    expect(refusal(q, act(host, { _tag: 'Hear', ask: '6' }))).toBe('legal')
  })

  test('AskRaise: a live maker over the cap; no open occurrence needed', () => {
    const raise: Body = { _tag: 'AskRaise', to: human }
    const capped = (s: WorkState): WorkState => ({
      ...s,
      askCount: new Map([[JSON.stringify([keyOf(m1), keyOf(human)]), s.askCap]]),
    })
    expect(refusal(capped(withTask()), act(m1, raise))).toBeNull()
    expect(refusal(withTask(), act(m1, raise))).toBe('legal')
    expect(refusal(capped(withTask({ state: 'InReview' })), act(m1, raise))).toBe('legal')
    expect(refusal(capped(withTask()), act(writer, raise))).toBe('authority')
  })

  test('ReadBrief: only the live maker of a working task', () => {
    const rb: Body = { _tag: 'ReadBrief', maker: 'm1' }
    expect(refusal(withTask(), act(m1, rb))).toBeNull()
    expect(refusal(withTask(), act(maker('m2'), rb))).toBe('authority')
    expect(refusal(withTask({ maker: 'm2' }), act(m1, rb))).toBe('legal')
    expect(refusal({ ...withTask(), down: new Set([keyOf(m1)]) }, act(m1, rb))).toBe('legal')
    expect(refusal(withTask({ state: 'InReview' }), act(m1, rb))).toBe('legal')
  })

  test('Resume: the role of the maker, a maker that is down and not ended', () => {
    const rs: Body = { _tag: 'Resume', maker: 'm1' }
    const down = { ...withTask(), down: new Set([keyOf(m1)]) }
    expect(refusal(down, act(writer, rs))).toBeNull()
    expect(refusal(down, act(linter, rs))).toBe('authority')
    expect(refusal(withTask(), act(writer, rs))).toBe('legal')
    const ended = { ...down, makers: new Map([['m1', { ...m1rec, ended: true }]]) }
    expect(refusal(ended, act(writer, rs))).toBe('legal')
  })

  test('Report: a claim, a fresh brief, a live maker, the ask to it', () => {
    expect(refusal(working(), act(m1, report, { seen: 4 }))).toBeNull()
    expect(refusal(working(), act(maker('m2'), report, { seen: 4 }))).toBe('authority')
    expect(refusal(working(), act(writer, report, { seen: 4 }))).toBe('authority')
    const unclaimed = { ...working(), makers: new Map([['m1', { ...m1rec, claimed: false }]]) }
    expect(refusal(unclaimed, act(m1, report, { seen: 4 }))).toBe('legal')
    const old = { ...working(), ver: new Map([['dir:d1', 1]]) }
    expect(refusal(old, act(m1, report, { seen: 4, seenVer: 1 }))).toBe('legal')
    expect(refusal(withAsk(withTask({ maker: 'm2' }), ask('3', {})), act(m1, report, { seen: 4 })))
      .toBe('legal')
    // a version moved since the sender looked, with a fresh brief
    const moved = { ...working(), ver: new Map([['dir:d9', 2]]) }
    expect(refusal(moved, act(m1, report, { seen: 4, seenVer: vsum(moved) - 1 }))).toBe('basis')
    expect(refusal(moved, act(m1, report, { seen: 4, seenVer: vsum(moved) }))).toBeNull()
  })

  test('Review: the Check to the role; Pass, Fail and RaiseTries follow the tries', () => {
    const w = (s: WorkState, v: 'Pass' | 'Fail' | 'RaiseTries' | 'RaiseNoRule') =>
      refusal(s, act(writer, review(v), { seen: 2 }))
    expect(w(reviewing(), 'Pass')).toBeNull()
    expect(w(reviewing({ caught: new Set(['rule:r1']) }), 'Pass')).toBe('legal')
    expect(w(reviewing({ caught: new Set(['rule:r1']) }), 'Fail')).toBeNull()
    expect(w(reviewing({ tries: 1 }), 'Fail')).toBeNull()
    expect(w(reviewing({ tries: 2 }), 'Fail')).toBe('legal')
    expect(w(reviewing({ tries: 2 }), 'RaiseTries')).toBeNull()
    expect(w(reviewing({ tries: 0 }), 'RaiseTries')).toBe('legal')
    expect(w(reviewing({ tries: 0 }), 'RaiseNoRule')).toBeNull()
    expect(w({ ...reviewing(), tasks: new Map([['t1', task({ state: 'Working' })]]) }, 'Pass'))
      .toBe('legal')
    expect(refusal(reviewing(), act(writer, review(), { seen: 2, seenVer: 5 }))).toBe('basis')
  })

  test('Respond: a Decide to the person on a fix at the person', () => {
    const r = (reply: 'AcceptIt' | 'SendItBack' | 'TakeAsIs' | 'EvaluateAgain', s = atPerson()) =>
      refusal(s, act(human, respond(reply), { seen: 3 }))
    for (const reply of ['AcceptIt', 'SendItBack', 'TakeAsIs', 'EvaluateAgain'] as const)
      expect(r(reply)).toBeNull()
    expect(r('AcceptIt', atPerson('t1', { stage: 'InLoop' }))).toBe('legal')
    // the person's edit has no task: it can be accepted or sent back, not taken
    const edit = atPerson('edit')
    expect(r('AcceptIt', edit)).toBeNull()
    expect(r('TakeAsIs', edit)).toBe('legal')
    expect(r('EvaluateAgain', edit)).toBe('legal')
    expect(refusal(atPerson(), act(human, respond('AcceptIt'), { seen: 2 }))).toBe('basis')
    expect(refusal(atPerson(), act(host, respond('AcceptIt'), { seen: 3 }))).toBe('authority')
  })

  test('Evaluate: the fix is evaluating, not below the floor; Split and Fit need content', () => {
    const at = (over: Partial<Task> = {}) =>
      withFix(withTask({ state: 'Raised', ...over }), 't1', { stage: 'Evaluating', basisStep: 3 })
    const ev = (
      s: WorkState,
      level: 'Fit' | 'Standard' | 'Direct' | 'Split',
      parts: TaskSpec[] = [],
      roleDraft: RoleDraft | null = null,
    ) =>
      refusal(
        s,
        act(pipe, { _tag: 'Evaluate', fix: 't1', level, parts, roleDraft, summary: '' }, {
          seen: 3,
        }),
      )
    expect(ev(at(), 'Standard')).toBeNull()
    expect(ev(at(), 'Direct')).toBeNull()
    expect(ev(at(), 'Fit')).toBe('legal')
    expect(ev(at(), 'Fit', [], card)).toBeNull()
    expect(ev(at(), 'Fit', [], { ...card, role: 'nobody' })).toBe('legal')
    expect(ev(at({ floor: 'Direct' }), 'Standard')).toBe('legal')
    const low = { floor: 'Fit' } as const
    expect(ev(at(low), 'Split', [spec(['a']), spec(['b'])])).toBeNull()
    expect(ev(at(), 'Split', [spec(['a']), spec(['b'])])).toBe('legal')
    expect(ev(at(low), 'Split', [spec(['a', 'b'])])).toBe('legal')
    expect(ev(at(low), 'Split', [spec(['a']), spec(['a', 'b'])])).toBe('legal')
    expect(ev(at(low), 'Split', [spec(['a']), spec([])])).toBe('legal')
    expect(ev(at(low), 'Split', [spec(['a']), spec(['b'], 'nobody')])).toBe('legal')
    expect(ev(at(low), 'Split', [spec(['a']), spec(['c'])])).toBe('legal')
    expect(ev(at({ ...low, sections: ['a'] }), 'Split', [spec(['a']), spec(['b'])])).toBe('legal')
    expect(ev(withTask(), 'Standard')).toBe('legal')
    // Evaluate reads the item versions too
    const s = { ...at(), ver: new Map([['dir:d1', 1]]) }
    const e: Body = {
      _tag: 'Evaluate',
      fix: 't1',
      level: 'Standard',
      parts: [],
      roleDraft: null,
      summary: '',
    }
    expect(refusal(s, act(pipe, e, { seen: 3, seenVer: 0 }))).toBe('basis')
    expect(refusal(s, act(pipe, e, { seen: 3, seenVer: 1 }))).toBeNull()
  })

  test('the pipeline steps follow the stage of the fix and its basisStep', () => {
    const at = (stage: Fix['stage'], over: Partial<Fix> = {}) =>
      withFix(withTask({ state: 'Raised' }), 't1', { stage, basisStep: 3, ...over })
    const go = (s: WorkState, body: Body, seen = 3) => refusal(s, act(pipe, body, { seen }))
    const adv: Body = { _tag: 'Advance', fix: 't1' }
    for (const st of ['AtPrinciple', 'AtDirection', 'AtStandard'] as const)
      expect(go(at(st), adv)).toBeNull()
    expect(go(at('AtRule'), adv)).toBe('legal')
    expect(go(at('AtPrinciple'), adv, 2)).toBe('basis')
    expect(refusal(at('AtPrinciple'), act(host, adv, { seen: 3 }))).toBe('authority')
    expect(go(at('Testing'), { _tag: 'RunTest', fix: 't1', own: true, contra: [] })).toBeNull()
    expect(go(at('AtRule'), { _tag: 'RunTest', fix: 't1', own: true, contra: [] })).toBe('legal')
    const ship: Body = {
      _tag: 'Ship',
      fix: 't1',
      items: new Set(),
      draft: new Map(),
      resolvesFight: false,
    }
    expect(go(at('Drafting'), ship)).toBeNull()
    expect(go(at('InLoop'), ship)).toBe('legal')
    const loop = (toPerson: boolean): Body => ({ _tag: 'LoopReview', fix: 't1', toPerson })
    expect(go(at('InLoop'), loop(true))).toBeNull()
    expect(go(at('InLoop', { needRevise: true }), loop(true))).toBe('legal')
    expect(go(at('InLoop', { needRevise: true }), loop(false))).toBeNull()
    expect(go(at('Drafting'), loop(false))).toBe('legal')
    expect(go(withTask(), adv)).toBe('legal')
  })

  test('WriteRule: the form must match its fields, a reference must be found', () => {
    const s = withFix(withTask({ state: 'Raised' }), 't1', { stage: 'AtRule', basisStep: 3 })
    const wr = (r: ItemRec, refOk = true, rule = 'rule:r9') =>
      refusal(
        s,
        act(pipe, { _tag: 'WriteRule', fix: 't1', rule, rec: r, refOk, fights: [] }, { seen: 3 }),
      )
    const r = (over: Partial<ItemRec>) => rec({ kind: 'rule', parent: 'std:s1', ...over })
    expect(wr(r({ form: 'mech', test: 'x' }))).toBeNull()
    expect(wr(r({ form: 'ref', ref: 'f#a:1' }))).toBeNull()
    expect(wr(r({ form: 'both', test: 'x', ref: 'f#a:1' }))).toBeNull()
    expect(wr(r({ form: 'none' }))).toBe('legal')
    expect(wr(r({ form: 'mech' }))).toBe('legal')
    expect(wr(r({ form: 'ref' }))).toBe('legal')
    expect(wr(r({ form: 'both', test: 'x' }))).toBe('legal')
    expect(wr(r({ form: 'ref', ref: 'f#a:1' }), false)).toBe('legal')
    expect(wr(r({ form: 'mech', test: 'x' }), false)).toBeNull()
    expect(wr(r({ form: 'mech', test: 'x' }), true, 'std:s9')).toBe('legal')
  })

  test('WriteRule: a fights claim only for a rule with no test command', () => {
    const s = withFix(withTask({ state: 'Raised' }), 't1', { stage: 'AtRule', basisStep: 3 })
    const claim = (r: ItemRec) =>
      refusal(s, act(pipe, {
        _tag: 'WriteRule', fix: 't1', rule: 'rule:r9', rec: r, refOk: true, fights: ['rule:r2'],
      }, { seen: 3 }))
    const r = (over: Partial<ItemRec>) => rec({ kind: 'rule', parent: 'std:s1', ...over })
    expect(claim(r({ form: 'ref', ref: 'f#a:1' }))).toBeNull()
    expect(claim(r({ form: 'mech', test: 'x' }))).toBe('legal')
    expect(claim(r({ form: 'both', test: 'x', ref: 'f#a:1' }))).toBe('legal')
  })

  describe('the rules a fight or a contradiction names, and the rule a Ship installs', () => {
    const r = (over: Partial<ItemRec>) => rec({ kind: 'rule', parent: 'std:s1', ...over })
    const ref = r({ form: 'ref', ref: 'f#a:1' })
    const two: WorkState = {
      ...base(),
      items: new Map([
        ...base().items,
        ['dir:d2', rec({})],
        ['std:s2', rec({ kind: 'std', parent: 'dir:d2' })],
        ['rule:r3', rec({ kind: 'rule', parent: 'std:s2', form: 'ref', ref: 'f#a:1' })],
      ]),
    }
    const at = (stage: Fix['stage'], over: Partial<Fix> = {}) =>
      withFix(withTask({ state: 'Raised' }, two), 't1', { stage, basisStep: 3, ...over })
    const write = (fights: ReadonlyArray<string>, rule = 'rule:r9', rc = ref) =>
      refusal(
        at('AtRule'),
        act(pipe, {
          _tag: 'WriteRule', fix: 't1', rule, rec: rc, refOk: true, fights,
        }, { seen: 3 }),
      )
    test('WriteRule: a unique set of known other rules of the same direction', () => {
      expect(write(['rule:r2'])).toBeNull()
      expect(write(['rule:r1', 'rule:r2'])).toBeNull()
      expect(write(['rule:r2', 'rule:r2'])).toBe('legal')
      expect(write(['rule:nope'])).toBe('legal')
      expect(write(['std:s1'])).toBe('legal')
      expect(write(['rule:r9'])).toBe('legal')
      expect(write(['rule:r2'], 'rule:r2')).toBe('legal')
      expect(write(['rule:r3'])).toBe('legal')
      expect(write(['rule:r1'], 'rule:r9', r({ form: 'ref', ref: 'f#a:1', parent: 'std:s2' })))
        .toBe('legal')
    })
    test('WriteRule: the new record is a rule with a valid parent', () => {
      expect(write([], 'rule:r9', { ...ref, kind: 'std' })).toBe('legal')
      expect(write([], 'rule:r9', r({ form: 'ref', ref: 'f#a:1', parent: null }))).toBe('legal')
      expect(write([], 'rule:r9', r({ form: 'ref', ref: 'f#a:1', parent: 'std:s9' })))
        .toBe('legal')
      expect(write([], 'rule:r9', r({ form: 'ref', ref: 'f#a:1', parent: 'rule:r1' })))
        .toBe('legal')
    })
    const test9 = r({ form: 'mech', test: 'x' })
    const run = (contra: ReadonlyArray<string>, draft: ReadonlyArray<[string, ItemRec]> = []) =>
      refusal(
        at('Testing', { draft: new Map([['rule:r9', test9], ...draft]) }),
        act(pipe, { _tag: 'RunTest', fix: 't1', own: true, contra }, { seen: 3 }),
      )
    test('RunTest: the same validation of contra', () => {
      expect(run(['rule:r1', 'rule:r2'])).toBeNull()
      expect(run([])).toBeNull()
      expect(run(['rule:r1', 'rule:r1'])).toBe('legal')
      expect(run(['rule:nope'])).toBe('legal')
      expect(run(['rule:r9'])).toBe('legal')
      expect(run(['rule:r3'])).toBe('legal')
      expect(run(['dir:d1'])).toBe('legal')
    })
    const ship = (draft: ReadonlyArray<[string, ItemRec | null]>, over: Partial<Fix> = {}) =>
      refusal(
        at('Drafting', { draft: new Map([['rule:r9', ref]]), ...over }),
        act(pipe, {
          _tag: 'Ship',
          fix: 't1',
          items: new Set(draft.map(([x]) => x)),
          draft: new Map(draft),
          resolvesFight: false,
        }, { seen: 3 }),
      )
    const dir2 = rec({ says: 'd2' })
    test('Ship: a rule item is the fix\'s written record, else refused', () => {
      expect(ship([['rule:r9', ref], ['dir:d1', dir2]])).toBeNull()
      expect(ship([['dir:d1', dir2]])).toBeNull()
      // a rule with form none, or with other evidence than was written and tested
      expect(ship([['rule:r9', r({ form: 'none' })]])).toBe('legal')
      expect(ship([['rule:r9', { ...ref, ref: 'other#b:2' }]])).toBe('legal')
      expect(ship([['rule:r9', test9]])).toBe('legal')
      // a newly added rule nobody wrote, a rule deleted that nobody deleted
      expect(ship([['rule:r8', ref]])).toBe('legal')
      expect(ship([['rule:r9', null]])).toBe('legal')
      // an existing rule left as the store has it is no change
      expect(ship([['rule:r2', two.items.get('rule:r2')!]])).toBeNull()
      expect(ship([['rule:r2', { ...ref, says: 'changed' }]])).toBe('legal')
    })
    test('Ship: the person\'s edit (the delayed accept path) is bound the same way', () => {
      const edit = (draft: ReadonlyArray<[string, ItemRec | null]>) =>
        refusal(
          withFix(two, 'edit', {
            stage: 'Drafting',
            basisStep: 3,
            draft: new Map([['rule:r9', ref]]),
          }),
          act(pipe, {
            _tag: 'Ship',
            fix: 'edit',
            items: new Set(),
            draft: new Map(draft),
            resolvesFight: false,
          }, { seen: 3 }),
        )
      expect(edit([['rule:r9', ref]])).toBeNull()
      expect(edit([['rule:r9', r({ form: 'none' })]])).toBe('legal')
    })
  })

  test('Reassign, TopDone and EndProject follow the state', () => {
    expect(refusal(base(), act(host, { _tag: 'Reassign' }))).toBe('legal')
    const accepted = withFix(base(), 't1', { stage: 'Accepted' })
    expect(refusal(accepted, act(host, { _tag: 'Reassign' }))).toBeNull()
    const done = withTask({ state: 'Done', maker: null })
    const covered = { ...done, top: { ...done.top, sections: ['a', 'b'] } }
    expect(refusal(covered, act(host, { _tag: 'TopDone' }))).toBeNull()
    expect(refusal(done, act(host, { _tag: 'TopDone' }))).toBe('legal')
    expect(refusal(withTask(), act(host, { _tag: 'TopDone' }))).toBe('legal')
    const finished = { ...covered, top: { ...covered.top, done: true } }
    expect(refusal(finished, act(host, { _tag: 'TopDone' }))).toBe('legal')
    expect(refusal(finished, act(human, { _tag: 'EndProject' }))).toBeNull()
    expect(refusal(covered, act(human, { _tag: 'EndProject' }))).toBe('legal')
    expect(refusal(finished, act(host, { _tag: 'EndProject' }))).toBe('authority')
  })

  test('RecheckDone and RunRule: what is pending, at the versions the recheck saw', () => {
    const ver = new Map([['dir:d1', 1], ['std:s1', 0], ['rule:r1', 0], ['rule:r2', 3]])
    const done = (pending: string[]) =>
      withTask({ state: 'Done', maker: null, pending: new Set(pending) }, { ...base(), ver })
    const s = done(['std:s1', 'rule:r2', 'rule:r1'])
    const rc = (items: string[], vers: [string, number][]) =>
      act(pipe, { _tag: 'RecheckDone', task: 't1', items: new Set(items), holds: true }, {
        vers: new Map(vers),
        seen: 2,
      })
    expect(refusal(s, rc(['std:s1', 'rule:r2'], [['std:s1', 0], ['rule:r2', 3]]))).toBeNull()
    // the mech rule is the harness's: naming it is not what is pending
    expect(refusal(s, rc(['std:s1', 'rule:r2', 'rule:r1'], []))).toBe('legal')
    expect(refusal(s, rc(['std:s1'], [['std:s1', 0]]))).toBe('legal')
    expect(refusal(s, rc(['std:s1', 'rule:r2'], [['std:s1', 0], ['rule:r2', 2]]))).toBe('legal')
    expect(refusal(done(['rule:r1']), rc(['rule:r1'], []))).toBe('legal')
    const items = new Set(['std:s1', 'rule:r2'])
    const stale = act(pipe, { _tag: 'RecheckDone', task: 't1', items, holds: true }, {
      vers: new Map([['std:s1', 0], ['rule:r2', 3]]),
      seen: 1,
    })
    expect(refusal(s, stale)).toBe('basis')
    const run: Body = { _tag: 'RunRule', task: 't1', holds: true }
    expect(refusal(s, act(harness, run))).toBeNull()
    expect(refusal(done(['std:s1']), act(harness, run))).toBe('legal')
    expect(refusal(s, act(pipe, run))).toBe('authority')
  })

  test('Revive and Exit follow the recorded exits', () => {
    const s = { ...withTask(), down: new Set([keyOf(m1), keyOf(host)]) }
    expect(refusal(s, act(human, { _tag: 'Revive', actor: host }))).toBeNull()
    expect(refusal(s, act(harness, { _tag: 'Revive', actor: host }))).toBe('authority')
    expect(refusal(s, act(human, { _tag: 'Revive', actor: pipe }))).toBe('authority')
    expect(refusal(s, act(harness, { _tag: 'Revive', actor: pipe }))).toBe('legal')
    expect(refusal(s, act(harness, { _tag: 'Revive', actor: m1 }))).toBe('legal')
    expect(refusal(s, act(harness, { _tag: 'Exit', actor: host }))).toBe('legal')
    expect(refusal(s, act(harness, { _tag: 'Exit', actor: pipe }))).toBeNull()
    expect(refusal(s, act(harness, { _tag: 'Exit', actor: writer }))).toBeNull()
    expect(refusal(s, act(harness, { _tag: 'Exit', actor: { _tag: 'Role', name: 'ghost' } })))
      .toBe('legal')
    expect(refusal(s, act(harness, { _tag: 'Exit', actor: maker('m99') }))).toBe('legal')
    expect(refusal(s, act(host, { _tag: 'Exit', actor: pipe }))).toBe('authority')
  })
})

describe('a retry against a replacement occurrence', () => {
  test('the answer and the hear of the first occurrence are stale once it is asked again', () => {
    // first occurrence '2': asked, answered, heard; asked again as '8'
    let s: WorkState = { ...base(), seq: 2 }
    s = openAsk(s, { kind: 'Question', from: host, to: human, about: none }, single).state
    s = advance(s)
    const first = [...s.asks.values()][0]!
    expect(first.id).toBe('2')
    const ans = answer({ _tag: 'Single', text: 'x' }, first.id)
    expect(refusal(s, act(human, ans))).toBeNull()
    // answered, not yet heard
    const answered = { ...s, asks: new Map(), answered: new Map([[first.id, {
      ask: first,
      answer: { _tag: 'Single', text: 'x' } as const,
      at: 3,
    }]]), seq: 4 }
    expect(refusal(answered, act(host, { _tag: 'Hear', ask: '2' }))).toBeNull()
    // heard, and asked again: the replacement is '8'
    const heard = { ...answered, answered: new Map(), heardIds: new Set(['2']), seq: 8 }
    const again = openAsk(heard, { kind: 'Question', from: host, to: human, about: none }, single)
      .state
    expect([...again.asks.keys()]).toEqual(['8'])
    const next = advance(again)
    // a retry of the first occurrence's answer or hear is stale; the new one is fine
    expect(refusal(next, act(human, ans))).toBe('stale')
    expect(refusal(next, act(host, { _tag: 'Hear', ask: '2' }))).toBe('heard')
    expect(refusal(next, act(human, answer({ _tag: 'Single', text: 'y' }, '8')))).toBeNull()
    // before it is asked again, a retried Hear is heard, not stale
    expect(refusal({ ...heard, seq: 9 }, act(host, { _tag: 'Hear', ask: '2' }))).toBe('heard')
  })
})
