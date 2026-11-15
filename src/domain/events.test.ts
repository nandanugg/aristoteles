// The options of a question (owner, 2026-11-15): none, or two or more, each with words, once.
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { Event } from './events.ts'

const asked = (options: unknown) => ({
  _tag: 'Question',
  create: { _tag: 'Asked', text: 'Which merchant?', to: { _tag: 'Owner' }, options },
})
const decodes = (options: unknown) => Schema.is(Event)(asked(options))

describe('the options of a question', () => {
  test('none, or two or more', () => {
    expect(decodes([])).toBe(true)
    expect(decodes(['m-17', 'm-18'])).toBe(true)
    expect(decodes(['m-17'])).toBe(false)
  })

  test('each option has words, once', () => {
    expect(decodes(['m-17', ' '])).toBe(false)
    expect(decodes(['m-17', 'm-17'])).toBe(false)
  })

  test('a question with no options field is no event', () => {
    const { options: _, ...old } = asked([]).create
    expect(Schema.is(Event)({ _tag: 'Question', create: old })).toBe(false)
  })
})
