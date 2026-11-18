import { describe, expect, test } from 'bun:test'
import type { Recorded } from '../../schema/index.ts'
import { take } from './effect.ts'
import { foldWork } from './fold.ts'
import { initState } from './reads.ts'
import type { Act, ItemRec, RoleDraft, What } from './types.ts'

const rule: ItemRec = {
  kind: 'rule',
  parent: null,
  name: 'r',
  says: 's',
  where: null,
  test: null,
  ref: null,
  form: 'ref',
  examples: [],
}
const card: RoleDraft = { role: 'dev', words: 'w', model: 'm' }
const top = { name: 'top', goal: 'g', sections: ['a'], directions: [] }

const start = () => initState(top, new Map([['rule:r1', rule]]), new Map([['dev', card]]), 2)
const record = (seq: number, create: unknown): Recorded =>
  ({
    seq,
    at: '2026-11-18T09:00:00.000Z',
    author: { _tag: 'Person', name: 'N', channel: 'terminal' },
    event: { _tag: 'Work', create },
  }) as never
const opened = record(1, {
  _tag: 'Opened',
  top,
  items: [['rule:r1', rule]],
  cards: [['dev', card]],
  maxTries: 2,
  tokens: [['host', 'h0'], ['pipe', 'p0']],
})
const act = (id: string, who: string, what: What): Act => ({
  id, who, ep: 0, what, seen: -1, seenVer: 0, vers: new Map(), old: false,
})
const send = act('x1', 'host', {
  _tag: 'SendTask',
  spec: { name: 'n', goal: 'g', sections: ['a'], role: 'dev' },
})
const assign = act('x2', 'role:dev', { _tag: 'AssignDo', task: 't1' })
const move = act('x3', 'person', { _tag: 'MoveHost', fromSession: 0 })

describe('foldWork', () => {
  test('no Work.Opened: null', () => {
    expect(foldWork([])).toBeNull()
  })

  test('Opened is the start state with the tokens at epoch 0', () => {
    const f = foldWork([opened])
    expect(f?.state).toEqual(start())
    expect(f?.tokens).toEqual(
      new Map([
        ['host', [{ ep: 0, hash: 'h0' }]],
        ['pipe', [{ ep: 0, hash: 'p0' }]],
      ]),
    )
    expect(f?.ids.size).toBe(0)
  })

  test('Acted folds to the state of take, with the ids and the tokens at the epoch after', () => {
    const f = foldWork([
      opened,
      record(2, { _tag: 'Acted', act: send, token: null }),
      record(3, { _tag: 'Acted', act: assign, token: ['maker:m1', 'm1h'] }),
      record(4, { _tag: 'Acted', act: move, token: ['host', 'h1'] }),
    ])
    expect(f?.state).toEqual([send, assign, move].reduce(take, start()))
    expect(f?.ids).toEqual(new Map([['x1', 2], ['x2', 3], ['x3', 4]]))
    expect(f?.tokens.get('maker:m1')).toEqual([{ ep: 0, hash: 'm1h' }])
    expect(f?.tokens.get('host')).toEqual([{ ep: 0, hash: 'h0' }, { ep: 1, hash: 'h1' }])
  })

  test('an act before the top, and a second top, are a damaged store', () => {
    expect(() => foldWork([record(1, { _tag: 'Acted', act: send, token: null })])).toThrow()
    expect(() => foldWork([opened, { ...opened, seq: 2 }])).toThrow()
  })
})
