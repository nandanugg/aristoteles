// Whom a new act wakes: a forwarded act wakes as the person's act of its own kind.
import { describe, expect, test } from 'bun:test'
import type { Event } from '../domain/events.ts'
import type { Work } from '../domain/work.ts'
import { wakesOf } from './watcher.ts'

const reject = {
  _tag: 'Review',
  create: {
    _tag: 'Reject',
    of: { _tag: 'Result', id: 'r1', points: [{ text: 'the facts name a ticket', breaks: null }] },
  },
} as unknown as Event
const accept = {
  _tag: 'Review',
  create: {
    _tag: 'Accept',
    of: { _tag: 'Result', id: 'r1', evidence: [{ rule: null, where: 'r1', what: 'it holds' }] },
    reason: null,
  },
} as unknown as Event
const forwarded = (inner: Event) =>
  ({
    _tag: 'Forward',
    create: { _tag: 'Forwarded', person: 'Nanda', quote: 'yes', channel: 'chat', inner },
  }) as Event

describe('whom an act wakes', () => {
  const work = {
    forwards: new Map([['e5', { event: 'e5', _tag: 'Confirmable', inner: accept }]]),
  } as unknown as Work

  test('only an accept wakes the tasks that need the result', () => {
    expect(wakesOf(work, accept)).toContain('Needers')
    expect(wakesOf(work, reject)).not.toContain('Needers')
  })

  test("a forwarded act that counts at once wakes as the person's reject", () => {
    expect(wakesOf(work, forwarded(reject))).toEqual(wakesOf(work, reject))
  })

  test('a forward that waits wakes as an act of the top agent; its confirm as the act', () => {
    expect(wakesOf(work, forwarded(accept))).toEqual(['Parent'])
    const confirm = { _tag: 'Forward', id: 'e5', move: { _tag: 'Confirmed' } } as Event
    expect(wakesOf(work, confirm)).toEqual(wakesOf(work, accept))
  })
})
