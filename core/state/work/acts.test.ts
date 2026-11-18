// The stored schemas of src/domain/work-acts.ts and the types of types.ts agree: a sample of
// every What and of an Act encodes to JSON and decodes to the same value, and the compiler checks
// each direction of the types (a total table: a new What fails here until it has a sample).
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { ActSchema, ItemRecSchema, WhatSchema } from '../../schema/index.ts'
import type { Act, ItemRec, What, WhatTag } from './types.ts'

const rec: ItemRec = {
  kind: 'rule',
  parent: 'std:s1',
  name: 'r',
  says: 'says',
  where: ['a'],
  test: 'true',
  ref: 'f#x:1',
  form: 'both',
  examples: [{ fits: 'breaks', sample: 'x' }],
}
const spec = { name: 'n', goal: 'g', sections: ['a', 'b'], role: 'dev' }
const draft = new Map<string, ItemRec | null>([['rule:r1', rec], ['rule:r2', null]])
const keys = new Set(['rule:r1', 'dir:d1'])

const SAMPLES: { readonly [T in WhatTag]: Extract<What, { _tag: T }> } = {
  EndProject: { _tag: 'EndProject' },
  MoveHost: { _tag: 'MoveHost', fromSession: 2 },
  EditDirection: { _tag: 'EditDirection', draft },
  Reject: { _tag: 'Reject', task: 't1', points: ['p'] },
  Accept: { _tag: 'Accept', fix: 't1' },
  SendBack: { _tag: 'SendBack', fix: 'edit', points: ['p', 'q'] },
  Decide: { _tag: 'Decide', task: 't1', take: true },
  SendTask: { _tag: 'SendTask', spec },
  Reassign: { _tag: 'Reassign' },
  TopDone: { _tag: 'TopDone' },
  AssignDo: { _tag: 'AssignDo', task: 't1' },
  Review: { _tag: 'Review', task: 't1', v: 'RaiseNoRule', points: [] },
  Resume: { _tag: 'Resume', maker: 'm1' },
  ReadBrief: { _tag: 'ReadBrief', maker: 'm1' },
  Report: { _tag: 'Report', maker: 'm1', output: 'o', caught: keys },
  Evaluate: {
    _tag: 'Evaluate',
    task: 't1',
    level: 'Split',
    parts: [spec, spec],
    roleDraft: { role: 'dev', words: 'w', model: 'm' },
    summary: 's',
  },
  Advance: { _tag: 'Advance', fix: 't1' },
  WriteRule: { _tag: 'WriteRule', fix: 't1', rule: 'rule:r9', rec, refOk: true },
  RunTest: { _tag: 'RunTest', fix: 't1', own: false, contra: ['rule:r1'] },
  Ship: { _tag: 'Ship', fix: 't1', items: keys, draft },
  LoopReview: { _tag: 'LoopReview', fix: 't1', toPerson: false },
  RecheckDone: { _tag: 'RecheckDone', task: 't1', items: keys, holds: true },
  RunRule: { _tag: 'RunRule', task: 't1', holds: false },
  Revive: { _tag: 'Revive', who: 'role:dev' },
  Exit: { _tag: 'Exit', who: 'maker:m1' },
}

// The wire: JSON text, as the store keeps it.
const wire = <T, E>(s: Schema.Codec<T, E>, v: T): T =>
  Schema.decodeUnknownSync(s)(JSON.parse(JSON.stringify(Schema.encodeSync(s)(v))))

describe('the stored acts', () => {
  test.each(Object.entries(SAMPLES))('%s encodes and decodes to itself', (_tag, what) => {
    const back: What = wire(WhatSchema, what)
    expect(back).toEqual(what)
  })

  test('an Act, with its versions, encodes with arrays and decodes to the Map', () => {
    const act: Act = {
      id: 'x1',
      who: 'role:dev',
      ep: 3,
      what: SAMPLES.Ship,
      seen: 4,
      seenVer: 9,
      vers: new Map([['rule:r1', 2]]),
      old: true,
    }
    expect(Schema.encodeSync(ActSchema)(act).vers).toEqual([['rule:r1', 2]])
    const back: Act = wire(ActSchema, act)
    expect(back).toEqual(act)
  })

  test('an item record', () => {
    const back: ItemRec = wire(ItemRecSchema, rec)
    expect(back).toEqual(rec)
  })

  test('a What that types.ts does not know does not decode', () => {
    expect(() => Schema.decodeUnknownSync(WhatSchema)({ _tag: 'Nope' })).toThrow()
  })
})
