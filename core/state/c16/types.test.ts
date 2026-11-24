// The c16 contract types: the actor keys, the `answers` table, and the schemas of every Body.
import { describe, expect, test } from 'bun:test'
import { Option, Schema } from 'effect'
import {
  ActEnvelopeSchema,
  ActorSchema,
  AnswerBodySchema,
  AskSchema,
  BodySchema,
  QuestionFormSchema,
  RefusalSchema,
} from '../../schema/index.ts'
import {
  actorOf,
  answers,
  type AnswerBody,
  type Actor,
  type Act,
  type Ask,
  type Body,
  hasEpoch,
  isMaker,
  isPersistent,
  keyOf,
  pairKey,
  type QuestionForm,
  type Refusal,
} from './types.ts'

const ACTORS: ReadonlyArray<Actor> = [
  { _tag: 'Human' },
  { _tag: 'Host' },
  { _tag: 'Role', name: 'dev' },
  { _tag: 'Role', name: 'a:b' },
  { _tag: 'Pipe' },
  { _tag: 'Harness' },
  { _tag: 'Maker', id: 'm1' },
  { _tag: 'Maker', id: 'x:y' },
]

describe('F1.1 actor keys', () => {
  test.each(ACTORS.map((a) => [keyOf(a), a] as const))('%s round trips', (k, a) => {
    expect(actorOf(k)).toEqual(a)
    expect(keyOf(actorOf(k))).toBe(k)
  })

  test('the keys', () => {
    expect(ACTORS.map(keyOf)).toEqual([
      'human', 'host', 'role:dev', 'role:a:b', 'pipe', 'harness', 'maker:m1', 'maker:x:y',
    ])
  })

  test.each(['person', '', 'Human', 'roles:x', 'maker'])('actorOf throws on %p', (k) => {
    expect(() => actorOf(k)).toThrow()
  })

  test('the predicates', () => {
    expect(ACTORS.map((a) => [isMaker(a), hasEpoch(a), isPersistent(a)])).toEqual([
      [false, false, false],
      [false, true, true],
      [false, true, true],
      [false, true, true],
      [false, true, true],
      [false, false, false],
      [true, true, false],
      [true, true, false],
    ])
  })

  test('the pair key is an unambiguous tuple', () => {
    const a = pairKey({ _tag: 'Role', name: 'a>b' }, { _tag: 'Maker', id: 'c' })
    const b = pairKey({ _tag: 'Role', name: 'a' }, { _tag: 'Maker', id: 'b>maker:c' })
    expect(a).not.toBe(b)
  })
})

const A = (...text: ReadonlyArray<string>): AnswerBody => ({ _tag: 'Multiple', texts: text })
const C = (...picked: ReadonlyArray<number>): AnswerBody => ({ _tag: 'Choice', picked })
const M = (...cells: ReadonlyArray<number>): AnswerBody => ({ _tag: 'Matrix', cells })
const single: QuestionForm = { _tag: 'Single' }
const multiple: QuestionForm = {
  _tag: 'Multiple',
  questions: [{ description: 'a', placeholder: '' }, { description: 'b', placeholder: '' }],
}
const one: QuestionForm = { _tag: 'Choice', options: ['x', 'y', 'z'], multi: false }
const many: QuestionForm = { _tag: 'Choice', options: ['x', 'y', 'z'], multi: true }
const matrix: QuestionForm = { _tag: 'Matrix', rows: ['r1', 'r2'], columns: ['c1', 'c2', 'c3'] }

const TABLE: ReadonlyArray<readonly [string, QuestionForm, AnswerBody, boolean]> = [
  ['single text', single, { _tag: 'Single', text: 'a\nb' }, true],
  ['single empty', single, { _tag: 'Single', text: '' }, false],
  ['single, a multiple answer', single, A('x'), false],
  ['multiple texts', multiple, A('x', 'y'), true],
  ['multiple, empty allowed', multiple, A('', ''), true],
  ['multiple, too few', multiple, A('x'), false],
  ['multiple, too many', multiple, A('x', 'y', 'z'), false],
  ['multiple, a single answer', multiple, { _tag: 'Single', text: 'x' }, false],
  ['choice one', one, C(2), true],
  ['choice one, first', one, C(0), true],
  ['choice one, two picked', one, C(0, 1), false],
  ['choice one, none', one, C(), false],
  ['choice one, out of range', one, C(3), false],
  ['choice one, negative', one, C(-1), false],
  ['choice one, fraction', one, C(0.5), false],
  ['choice many', many, C(0, 2), true],
  ['choice many, all', many, C(0, 1, 2), true],
  ['choice many, one', many, C(1), true],
  ['choice many, none', many, C(), false],
  ['choice many, repeat', many, C(1, 1), false],
  ['choice many, descending', many, C(2, 0), false],
  ['choice many, out of range', many, C(0, 3), false],
  ['choice, a matrix answer', many, M(0), false],
  ['matrix', matrix, M(0, 2), true],
  ['matrix, too few rows', matrix, M(0), false],
  ['matrix, too many rows', matrix, M(0, 1, 2), false],
  ['matrix, column out of range', matrix, M(0, 3), false],
  ['matrix, negative', matrix, M(-1, 0), false],
  ['matrix, fraction', matrix, M(0, 1.5), false],
  ['matrix, a choice answer', matrix, C(0, 1), false],
]

describe('F1.4 the answers table', () => {
  test.each(TABLE)('%s', (_name, form, answer, ok) => {
    expect(answers(form, answer)).toBe(ok)
  })
})

const spec = { name: 'n', goal: 'g', sections: ['a'], facts: {}, role: 'dev' }
const rec = {
  kind: 'rule' as const,
  parent: 'std:s1',
  name: 'r',
  says: 's',
  where: null,
  test: null,
  ref: null,
  form: 'none' as const,
  examples: [],
}
const draft = new Map([['rule:r1', rec], ['rule:r2', null]])
const keys = new Set(['rule:r1', 'dir:d1'])
const dev: Actor = { _tag: 'Role', name: 'dev' }
const question = { title: 't\nu', form: multiple }

const SAMPLES: { readonly [T in Body['_tag']]: Extract<Body, { _tag: T }> } = {
  Open: { _tag: 'Open', open: { _tag: 'OpenQuestion', to: { _tag: 'Human' }, question } },
  AskEdit: { _tag: 'AskEdit', draft },
  AnswerQuestion: { _tag: 'AnswerQuestion', ask: '7', answer: A('l1\nl2', '') },
  Hear: { _tag: 'Hear', ask: '7.1' },
  AskRaise: { _tag: 'AskRaise', to: dev },
  ReadBrief: { _tag: 'ReadBrief', maker: 'm1' },
  Resume: { _tag: 'Resume', maker: 'm1' },
  Report: { _tag: 'Report', ask: '3', output: 'o\n', files: ['a.md'], caught: keys },
  Review: { _tag: 'Review', ask: '4', verdict: 'RaiseMisses', points: ['p'] },
  Evaluate: {
    _tag: 'Evaluate',
    fix: 't1',
    level: 'Split',
    parts: [spec, spec],
    roleDraft: { role: 'dev', words: 'w', model: 'm' },
    summary: 's',
  },
  Advance: { _tag: 'Advance', fix: 't1' },
  WriteRule: { _tag: 'WriteRule', fix: 't1', rule: 'rule:r9', rec, refOk: true, fights: [] },
  RunTest: { _tag: 'RunTest', fix: 't1', own: false, contra: ['rule:r1'] },
  Ship: { _tag: 'Ship', fix: 't1', items: keys, draft, resolvesFight: false },
  LoopReview: { _tag: 'LoopReview', mode: 'self-review turns', fix: 't1', toPerson: true },
  Respond: { _tag: 'Respond', ask: '9', reply: 'SendItBack', points: ['p'] },
  Reassign: { _tag: 'Reassign' },
  TopDone: { _tag: 'TopDone' },
  RecheckDone: { _tag: 'RecheckDone', task: 't1', items: keys, holds: true },
  RunRule: { _tag: 'RunRule', task: 't1', holds: false },
  Revive: { _tag: 'Revive', actor: { _tag: 'Maker', id: 'm1' } },
  Exit: { _tag: 'Exit', actor: { _tag: 'Host' } },
  EndProject: { _tag: 'EndProject' },
  MoveHost: { _tag: 'MoveHost', fromSession: 2 },
}

// The wire: JSON text, as the store keeps it.
const wire = <T, E>(s: Schema.Codec<T, E>, v: T): T =>
  Schema.decodeUnknownSync(s)(JSON.parse(JSON.stringify(Schema.encodeSync(s)(v))))

describe('the schemas', () => {
  test.each(Object.entries(SAMPLES))('Body %s round trips', (_tag, body) => {
    const back: Body = wire(BodySchema, body)
    expect(back).toEqual(body)
  })

  test('an actor is its key on the wire', () => {
    const wired = Schema.encodeSync(BodySchema)(SAMPLES.AskRaise)
    expect(wired).toEqual({ _tag: 'AskRaise', to: 'role:dev' })
    expect(wire(ActorSchema, dev)).toEqual(dev)
  })

  test('an ask round trips', () => {
    const ask: Ask = {
      id: '5.1',
      kind: 'Decide',
      from: { _tag: 'Pipe' },
      to: { _tag: 'Human' },
      about: { _tag: 'Fix', id: 'edit' },
    }
    expect(wire(AskSchema, ask)).toEqual(ask)
  })

  test('a multiline answer is unchanged', () => {
    const a: AnswerBody = { _tag: 'Single', text: '  a\n\nb\r\n\tc \n' }
    expect(wire(AnswerBodySchema, a)).toEqual(a)
  })

  test.each([
    ['Multiple with no prompt', { _tag: 'Multiple', questions: [] }],
    ['Choice with one option', { _tag: 'Choice', options: ['x'], multi: false }],
    ['Matrix with no row', { _tag: 'Matrix', rows: [], columns: ['a', 'b'] }],
    ['Matrix with one column', { _tag: 'Matrix', rows: ['r'], columns: ['a'] }],
  ])('a form is refused: %s', (_name, form) => {
    expect(() => Schema.decodeUnknownSync(QuestionFormSchema)(form)).toThrow()
    expect(() => Schema.encodeSync(QuestionFormSchema)(form as QuestionForm)).toThrow()
  })

  test.each(['person', '', 'Human', 'roles:x', 'maker'])('malformed key %p fails', (k) => {
    expect(Option.isNone(Schema.decodeUnknownOption(ActorSchema)(k))).toBe(true)
    const nested = { _tag: 'AskRaise', to: k }
    expect(Option.isNone(Schema.decodeUnknownOption(BodySchema)(nested))).toBe(true)
  })

  test('an envelope and a refusal round trip', () => {
    const act: Act = {
      id: 'a1',
      who: { _tag: 'Maker', id: 'm1' },
      ep: 1,
      seen: 4,
      seenVer: 9,
      vers: new Map([['rule:r1', 2]]),
      old: false,
      body: SAMPLES.Report,
    }
    expect(wire(ActEnvelopeSchema, act)).toEqual(act)
    const refusals: ReadonlyArray<Refusal> = [
      { refused: 'cap', words: 'w', next: 'n' },
      { refused: 'stale', words: 'w' },
    ]
    for (const r of refusals) expect(wire(RefusalSchema, r)).toEqual(r)
  })

  test('a Body that types.ts does not know does not decode', () => {
    expect(() => Schema.decodeUnknownSync(BodySchema)({ _tag: 'Nope' })).toThrow()
  })
})
