// The moves of the records with a lifecycle: each one leaves only the state that it may leave.
// A move back does not compile (the @ts-expect-error lines fail the typecheck if it ever does);
// the fold's table (core/state) finds the record, narrows it, and calls the move.
import { describe, expect, test } from 'bun:test'
import type { ConfigFile } from './files.ts'
import type { EventRef, SessionId, Time } from './ids.ts'
import { deliverSend, dropSend, MOVES, sendText } from './moves.ts'

const at = (minute: number) => `2026-11-12T09:${String(minute).padStart(2, '0')}:00.000Z` as Time

describe('the words of roles', () => {
  test('change their words only, and every move kind has its function, or none', () => {
    const role = { kind: 'agent', model: 'haiku', description: 'old', intro: 'i', acts: [] }
    const config = { roles: { writer: role } } as unknown as ConfigFile
    const changed = MOVES['Workflow.RoleWordsChanged'](config, { writer: { description: 'new' } })
    expect<unknown>(changed.roles.writer).toEqual({ ...role, description: 'new' })
    expect(MOVES['Source.Checked']).toBeNull()
  })
})

describe('a send', () => {
  const to = { _tag: 'Terminal', session: 'p-1' as SessionId, via: { _tag: 'Tmux' } } as const
  const pending = sendText({
    id: 'e5' as EventRef,
    from: { _tag: 'Person', to },
    keys: { _tag: 'Enter' },
    at: at(1),
  })

  test('is delivered or dropped once, from pending', () => {
    expect(deliverSend(pending, at(2)).state).toEqual({ _tag: 'Delivered', at: at(2) })
    const why = { _tag: 'TypingFailed' } as const
    expect(dropSend(pending, at(2), why).state).toEqual({ _tag: 'Dropped', at: at(2), why })
    // @ts-expect-error a delivered send is not delivered again
    deliverSend(deliverSend(pending, at(2)), at(3))
    // @ts-expect-error a dropped send is not dropped again
    dropSend(dropSend(pending, at(2), why), at(3), why)
  })
})
