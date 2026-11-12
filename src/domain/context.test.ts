// The closed Context and the Where filter, from the files' records and back: the key section is
// its own field; the other keys are facts in the file's order, and a where keeps its order for
// the words and the SQL.
import { describe, expect, test } from 'bun:test'
import { applies, contextOf, sectionOf, valueAt, whereOf, whereRecord } from './context.ts'

describe('the context of a task', () => {
  test('section is its own field; the other keys are facts, in the file order', () => {
    const context = contextOf({
      audience: 'merchant',
      section: 'introduction',
      system: 'document harness',
    })
    expect(context).toEqual({
      section: { _tag: 'Section', id: 'introduction' },
      facts: new Map([
        ['audience', 'merchant'],
        ['system', 'document harness'],
      ]),
    })
    expect([...context.facts.keys()]).toEqual(['audience', 'system'])
    expect(sectionOf(context)).toBe('introduction')
    expect(valueAt(context, 'system')).toBe('document harness')
    expect(valueAt(context, 'repo')).toBeUndefined()
  })

  test('a task with no section writes no one heading', () => {
    const context = contextOf({})
    expect(context).toEqual({ section: { _tag: 'NoSection' }, facts: new Map() })
    expect(sectionOf(context)).toBeNull()
  })
})

describe('the where of a standard', () => {
  test('no where, or an empty one, applies everywhere', () => {
    expect(whereOf(undefined)).toEqual({ _tag: 'Everywhere' })
    expect(whereOf({})).toEqual({ _tag: 'Everywhere' })
    expect(whereRecord({ _tag: 'Everywhere' })).toBeNull()
    expect(applies({ _tag: 'Everywhere' }, contextOf({}))).toBe(true)
  })

  test('each condition must match, the section too; the file order comes back', () => {
    const where = whereOf({ section: 'introduction', audience: 'merchant' })
    const json = '{"section":"introduction","audience":"merchant"}'
    expect(JSON.stringify(whereRecord(where))).toBe(json)
    expect(applies(where, contextOf({ audience: 'merchant', section: 'introduction' }))).toBe(true)
    expect(applies(where, contextOf({ section: 'introduction' }))).toBe(false)
    expect(applies(where, contextOf({ audience: 'merchant', section: 'design' }))).toBe(false)
  })
})
