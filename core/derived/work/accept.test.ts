// The store's check (accept.ts): each refusal, on states built by hand.
import { expect, test } from 'bun:test'
import { vsum } from '../../state/work/items.ts'
import { initState } from '../../state/work/reads.ts'
import type {
  Act,
  Fix,
  ItemRec,
  Maker,
  RoleDraft,
  Task,
  What,
  WorkState,
} from '../../state/work/types.ts'
import { HARNESS, HOST, PERSON, PIPE, makerActor, roleActor } from '../../state/work/types.ts'
import { CLOSED } from '../../state/work/reads.ts'
import { accept, recheckCurrent, recheckDue, refusal } from './accept.ts'

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
    new Map([
      ['writer', card],
      ['linter', { ...card, role: 'linter' }],
    ]),
    3,
  )
const task = (over: Partial<Task>): Task => ({
  id: 't1',
  name: 'n',
  goal: 'g',
  role: 'writer',
  parent: null,
  sections: ['a', 'b'],
  directions: ['d1'],
  gen: 0,
  st: 'Working',
  tries: 0,
  maker: 'm1',
  rid: 2,
  checked: new Map(),
  pend: new Set(),
  caught: new Set(),
  taken: false,
  floor: 'Standard',
  at: 1,
  ...over,
})
const maker: Maker = {
  id: 'm1',
  task: 't1',
  ended: false,
  claim: true,
  brief: new Map(),
  revs: 4,
}
const withTask = (over: Partial<Task>, s: WorkState = base()): WorkState => ({
  ...s,
  tasks: new Map([['t1', task(over)]]),
  makers: new Map([['m1', maker]]),
})
const withFix = (s: WorkState, id: string, over: Partial<Fix>): WorkState => ({
  ...s,
  fixes: new Map([...s.fixes, [id, { ...CLOSED, ...over }]]),
})
const act = (who: string, what: What, over: Partial<Act> = {}): Act => ({
  id: 'a1',
  who,
  ep: 0,
  what,
  seen: -1,
  seenVer: 0,
  vers: new Map(),
  old: false,
  ...over,
})
const review = (v: 'Pass' | 'Fail' | 'RaiseTries' | 'RaiseNoRule' = 'Pass'): What => ({
  _tag: 'Review',
  task: 't1',
  v,
  points: [],
})
const inReview = (over: Partial<Task> = {}) => withTask({ st: 'InReview', ...over })
const spec = (sections: string[], role = 'writer') => ({ name: 'n', goal: 'g', sections, role })
const evalSplit = (parts: ReturnType<typeof spec>[]): What => ({
  _tag: 'Evaluate',
  task: 't1',
  level: 'Split',
  parts,
  roleDraft: null,
  summary: '',
})
const atEval = () => withFix(withTask({ st: 'Raised' }), 't1', { stage: 'SEval', step: 3 })

test('authority: the wrong actor is refused, the right one passes', () => {
  const s = inReview()
  expect(refusal(s, act(roleActor('linter'), review(), { seen: 2 }))).toBe('authority')
  expect(refusal(s, act(PERSON, review(), { seen: 2 }))).toBe('authority')
  expect(refusal(s, act(roleActor('writer'), review(), { seen: 2 }))).toBeNull()
  expect(refusal(s, act(PIPE, { _tag: 'Reassign' }))).toBe('authority')
  expect(refusal(s, act(HOST, { _tag: 'Reassign' }))).toBe('legal')
})

test('an unknown task, maker or fix is illegal, not an error', () => {
  const s = base()
  const w: What = { _tag: 'AssignDo', task: 'zz' }
  expect(refusal(s, act(roleActor('writer'), w))).toBe('authority')
  expect(refusal(s, act(PERSON, { _tag: 'Accept', fix: 'zz' }))).toBe('legal')
  expect(refusal(s, act(makerActor('zz'), { _tag: 'ReadBrief', maker: 'zz' }))).toBe('legal')
  expect(refusal(s, act(PIPE, { _tag: 'Advance', fix: 'zz' }))).toBe('legal')
})

test('an old epoch is refused; the person and the harness have none', () => {
  const s = { ...inReview(), ep: new Map([[roleActor('writer'), 2]]) }
  const w = review()
  expect(refusal(s, act(roleActor('writer'), w, { seen: 2, ep: 1 }))).toBe('epoch')
  expect(refusal(s, act(roleActor('writer'), w, { seen: 2, ep: 2 }))).toBeNull()
  const p = { ...s, ep: new Map([[PERSON, 5]]) }
  const rej: What = { _tag: 'Reject', task: 't1', points: [] }
  expect(refusal(p, act(PERSON, rej, { seen: 2 }))).toBeNull()
})

test('a stale seen is refused (basis)', () => {
  const s = inReview()
  expect(refusal(s, act(roleActor('writer'), review(), { seen: 1 }))).toBe('basis')
  expect(refusal(s, act(roleActor('writer'), review(), { seen: -1 }))).toBe('basis')
  const f = atEval()
  const w: What = { _tag: 'Advance', fix: 't1' }
  expect(refusal(withFix(f, 't1', { stage: 'SPrinciple', step: 3 }), act(PIPE, w, { seen: 2 })))
    .toBe('basis')
})

test('a stale seenVer on Review is refused; Advance does not read the versions', () => {
  const s = { ...inReview(), ver: new Map([['dir:d1', 2]]) }
  const w = act(roleActor('writer'), review(), { seen: 2, seenVer: vsum(s) - 1 })
  expect(refusal(s, w)).toBe('basis')
  expect(refusal(s, { ...w, seenVer: vsum(s) })).toBeNull()
  const f = withFix(s, 't1', { stage: 'SPrinciple', step: 3 })
  expect(refusal(f, act(PIPE, { _tag: 'Advance', fix: 't1' }, { seen: 3, seenVer: 0 }))).toBeNull()
})

test('an act from an old build is refused', () => {
  const s = inReview()
  const w = act(roleActor('writer'), review(), { seen: 2, old: true })
  expect(refusal(s, w)).toBe('build')
  expect(accept(s, { ...w, old: false })).toBe(true)
})

test('an ended project refuses everything but the harness', () => {
  const s = { ...inReview(), top: { ...base().top, ended: true } }
  expect(refusal(s, act(roleActor('writer'), review(), { seen: 2 }))).toBe('ended')
  expect(refusal(s, act(HARNESS, { _tag: 'Exit', who: HOST }))).toBeNull()
})

test('MoveHost: a second copy from the same session is refused', () => {
  const s = base()
  const w: What = { _tag: 'MoveHost', fromSession: 0 }
  expect(refusal(s, act(PERSON, w))).toBeNull()
  expect(refusal({ ...s, session: 1 }, act(PERSON, w))).toBe('legal')
})

test('Pass is refused while the result is caught; Fail and RaiseTries follow maxTries', () => {
  const caught = inReview({ caught: new Set(['rule:r1']) })
  const w = (s: WorkState, v: 'Pass' | 'Fail' | 'RaiseTries') =>
    refusal(s, act(roleActor('writer'), review(v), { seen: 2 }))
  expect(w(caught, 'Pass')).toBe('legal')
  expect(w(caught, 'Fail')).toBeNull()
  expect(w(inReview({ tries: 1 }), 'Fail')).toBeNull()
  expect(w(inReview({ tries: 2 }), 'Fail')).toBe('legal')
  expect(w(inReview({ tries: 2 }), 'RaiseTries')).toBeNull()
  expect(w(inReview({ tries: 0 }), 'RaiseTries')).toBe('legal')
})

test('SendTask: uncovered, nonempty, no duplicates, a known role', () => {
  const s = base()
  const send = (sp: ReturnType<typeof spec>) =>
    refusal(s, act(HOST, { _tag: 'SendTask', spec: sp }))
  expect(send(spec(['a', 'b']))).toBeNull()
  expect(send(spec([]))).toBe('legal')
  expect(send(spec(['a', 'a']))).toBe('legal')
  expect(send(spec(['z']))).toBe('legal')
  expect(send(spec(['a'], 'nobody'))).toBe('legal')
  const owned = withTask({ sections: ['a'] })
  expect(refusal(owned, act(HOST, { _tag: 'SendTask', spec: spec(['a']) }))).toBe('legal')
})

test('Split: parts partition the sections, each a strict part with a known role', () => {
  const s = atEval()
  const split = (parts: ReturnType<typeof spec>[], st = s) =>
    refusal(st, act(PIPE, evalSplit(parts), { seen: 3, seenVer: 0 }))
  const lowFloor = (over: Partial<Task>) =>
    withFix(withTask({ st: 'Raised', floor: 'Fit', ...over }), 't1', { stage: 'SEval', step: 3 })
  expect(split([spec(['a']), spec(['b'])], lowFloor({}))).toBeNull()
  expect(split([spec(['a']), spec(['b'])])).toBe('legal')
  expect(split([spec(['a', 'b'])], lowFloor({}))).toBe('legal')
  expect(split([spec(['a']), spec(['a', 'b'])], lowFloor({}))).toBe('legal')
  expect(split([spec(['a']), spec([])], lowFloor({}))).toBe('legal')
  expect(split([spec(['a']), spec(['b'], 'nobody')], lowFloor({}))).toBe('legal')
  expect(split([spec(['a']), spec(['c'])], lowFloor({}))).toBe('legal')
  expect(split([spec(['a']), spec(['b'])], lowFloor({ sections: ['a'] }))).toBe('legal')
})

test('Evaluate: not below the floor; Fit needs a draft of a known role', () => {
  const s = atEval()
  const ev = (level: 'Fit' | 'Standard' | 'Direct', roleDraft: RoleDraft | null = null) =>
    refusal(
      s,
      act(PIPE, { _tag: 'Evaluate', task: 't1', level, parts: [], roleDraft, summary: '' }, {
        seen: 3,
      }),
    )
  expect(ev('Standard')).toBeNull()
  expect(ev('Direct')).toBeNull()
  expect(ev('Fit')).toBe('legal')
  expect(ev('Fit', card)).toBeNull()
  expect(ev('Fit', { ...card, role: 'nobody' })).toBe('legal')
})

test('recheckDue and recheckCurrent', () => {
  const ver = new Map([['dir:d1', 1], ['std:s1', 0], ['rule:r1', 0], ['rule:r2', 3]])
  const s0 = { ...base(), ver }
  const s = withTask({ st: 'Done', pend: new Set(['std:s1', 'rule:r2', 'rule:r1']) }, s0)
  expect(recheckDue(s, 't1')).toBe(true)
  const w = (items: string[], vers: [string, number][]) =>
    act(PIPE, { _tag: 'RecheckDone', task: 't1', items: new Set(items), holds: true }, {
      vers: new Map(vers),
      seen: 2,
    })
  const good = w(['std:s1', 'rule:r2'], [['std:s1', 0], ['rule:r2', 3]])
  expect(recheckCurrent(s, 't1', good)).toBe(true)
  expect(refusal(s, good)).toBeNull()
  // the mech rule r1 is the harness's: naming it is not what is pending
  expect(recheckCurrent(s, 't1', w(['std:s1', 'rule:r2', 'rule:r1'], []))).toBe(false)
  expect(recheckCurrent(s, 't1', w(['std:s1'], [['std:s1', 0]]))).toBe(false)
  expect(recheckCurrent(s, 't1', w(['std:s1', 'rule:r2'], [['std:s1', 0], ['rule:r2', 2]])))
    .toBe(false)
  expect(refusal(s, w(['std:s1'], [['std:s1', 0]]))).toBe('legal')
  expect(recheckDue(withTask({ st: 'Done', pend: new Set(['rule:r1']) }, s0), 't1')).toBe(false)
})

test('WriteRule: the form must match its fields, a reference must be found', () => {
  const s = withFix(withTask({ st: 'Raised' }), 't1', { stage: 'SRuleAssess', step: 3 })
  const wr = (r: ItemRec, refOk = true, rule = 'rule:r9') =>
    refusal(
      s,
      act(PIPE, { _tag: 'WriteRule', fix: 't1', rule, rec: r, refOk }, { seen: 3 }),
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

test('Resume, Revive and Exit follow the recorded exits', () => {
  const s = { ...withTask({}), down: new Set([makerActor('m1'), HOST]) }
  const resume = act(roleActor('writer'), { _tag: 'Resume', maker: 'm1' })
  expect(refusal(s, resume)).toBeNull()
  expect(refusal({ ...s, down: new Set() }, resume)).toBe('legal')
  expect(refusal(s, act(PERSON, { _tag: 'Revive', who: HOST }))).toBeNull()
  expect(refusal(s, act(HARNESS, { _tag: 'Revive', who: HOST }))).toBe('authority')
  expect(refusal(s, act(HARNESS, { _tag: 'Revive', who: PIPE }))).toBe('legal')
  expect(refusal(s, act(HARNESS, { _tag: 'Exit', who: HOST }))).toBe('legal')
  expect(refusal(s, act(HARNESS, { _tag: 'Exit', who: PIPE }))).toBeNull()
})

test('Report needs a claim and a fresh brief; ReadBrief only a live maker', () => {
  const rep: What = { _tag: 'Report', maker: 'm1', output: 'o', files: [], caught: new Set() }
  const who = makerActor('m1')
  expect(refusal(withTask({}), act(who, rep, { seen: 4, seenVer: 0 }))).toBeNull()
  const old = { ...withTask({}), ver: new Map([['dir:d1', 1]]) }
  expect(refusal(old, act(who, rep, { seen: 4, seenVer: 1 }))).toBe('legal')
  expect(refusal(old, act(who, { _tag: 'ReadBrief', maker: 'm1' }))).toBeNull()
  expect(refusal(withTask({ maker: 'm2' }), act(who, rep, { seen: 4 }))).toBe('legal')
})
