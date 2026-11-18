// The pure helpers of the dashboard page: the Minto split of a summary, the classes of a card,
// the lines of a diff.
import { describe, expect, test } from 'bun:test'
import {
  cardLines,
  changeKind,
  changeLines,
  escalationClass,
  minto,
  statusClass,
} from './app/pure.ts'
import type { Dash } from './contract.ts'

type Change = Dash['row'][number]['changes'][number]
const rec = (says: string, test: string | null = null): NonNullable<Change['before']> => ({
  kind: 'rule',
  parent: 'std:s1',
  name: 'once',
  says,
  where: null,
  test,
  ref: null,
  form: 'mech',
  examples: [],
})

describe('minto', () => {
  test('the first line is the conclusion, the rest support it', () => {
    expect(minto('Say it once.\n- the draft repeats\n2. the test fails\n')).toEqual({
      conclusion: 'Say it once.',
      supports: ['the draft repeats', 'the test fails'],
    })
  })
  test('one line has no supports; blank lines are skipped; empty is empty', () => {
    expect(minto('Only this')).toEqual({ conclusion: 'Only this', supports: [] })
    expect(minto('\n a \n\n b')).toEqual({ conclusion: 'a', supports: ['b'] })
    expect(minto('')).toEqual({ conclusion: '', supports: [] })
  })
})

describe('classes', () => {
  test('a status and an escalation each have a class of their own', () => {
    expect(['Working', 'Waiting', 'Inactive'].map((s) => statusClass(s as never))).toEqual([
      'st-working',
      'st-waiting',
      'st-inactive',
    ])
    expect(escalationClass('WAIT_FOR_REVIEW')).toBe('esc-wait-for-review')
    expect(escalationClass('IN_PIPELINE')).toBe('esc-in-pipeline')
  })
})

describe('the lines of a change', () => {
  test('a changed field is a del and an add; an unchanged one is the same', () => {
    const c = { key: 'rule:r1', version: 2, before: rec('old'), after: rec('new', 'true') }
    expect(changeLines(c).map((l) => `${l.kind} ${l.text}`)).toEqual([
      'same name: once',
      'del says: old',
      'add says: new',
      'add test: true',
      'same form: mech',
    ])
    expect(changeKind(c)).toBe('changed')
  })
  test('an added item is all add, a removed one all del', () => {
    const added = { key: 'k', version: 0, before: null, after: rec('x') }
    expect(changeLines(added).every((l) => l.kind === 'add')).toBe(true)
    expect(changeKind(added)).toBe('added')
    const gone = { ...added, before: added.after, after: null }
    expect(changeLines(gone).every((l) => l.kind === 'del')).toBe(true)
    expect(changeKind(gone)).toBe('removed')
  })
  test('a role card shows its words and model', () => {
    const lines = cardLines({ role: 'dev', before: null, after: { words: 'w', model: 'm' } })
    expect(lines.map((l) => l.text)).toEqual(['words: w', 'model: m'])
  })
})
