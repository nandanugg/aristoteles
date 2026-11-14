// Two rules of the catalog on a hand-made Moment: who answers a question or an escalation now, and
// when an outside source was last read. Until the switch (2026-11-14) the domain had its own
// copies of these rules, with these cases.
import { describe, expect, test } from 'bun:test'
import { type AssignmentId, human, type Time, type Work } from '../schema/index.ts'
import type { Moment } from '../state/index.ts'
import { answererNow, sourceStatesOf } from './catalog.ts'
import type { AssignmentState } from './types.ts'

const at = (minute: number) => `2026-11-12T09:${String(minute).padStart(2, '0')}:00.000Z` as Time
const nanda = human('Nanda')
const momentOf = (work: object, now: Time, outsideSourceHours = 72): Moment =>
  ({ work, at: now, outside: { settings: { outsideSourceHours } } }) as unknown as Moment

describe('who answers a question or an escalation now', () => {
  const a1 = 'a1' as AssignmentId
  const a2 = 'a2' as AssignmentId
  const assignment = (id: AssignmentId, parent: AssignmentId | null) => ({
    id,
    task: 't1',
    parent: parent ? { _tag: 'Parent', id: parent } : { _tag: 'GivenByPerson' },
  })
  const work = {
    assignments: new Map([
      [a1, assignment(a1, null)],
      [a2, assignment(a2, a1)],
    ]),
    tasks: new Map([['t1', { owner: nanda }]]),
  }
  const states = (ended1: boolean, ended2: boolean) =>
    new Map([
      [a1, { _tag: ended1 ? 'Ended' : 'Working' }],
      [a2, { _tag: ended2 ? 'Ended' : 'Working' }],
    ]) as unknown as ReadonlyMap<AssignmentId, AssignmentState>
  const answerer = (ended1: boolean, ended2: boolean, first: AssignmentId | typeof nanda) =>
    answererNow(momentOf(work, at(9)), first, states(ended1, ended2))

  test('the first one while it is open, else its nearest open parent, else the owner', () => {
    expect<unknown>(answerer(false, false, a2)).toBe(a2)
    expect<unknown>(answerer(false, true, a2)).toBe(a1)
    expect<unknown>(answerer(true, true, a2)).toEqual(nanda)
    expect<unknown>(answerer(true, true, nanda)).toEqual(nanda)
  })
})

// An outside source holds for the limit from the last read (a move, or a check of the same
// revision): the time is the log's, so no record keeps it (the owner's ruling, 2026-11-12).
describe('an outside source', () => {
  const logged = (seq: number, event: object) => ({
    recorded: { seq, at: at(seq), author: { _tag: 'Agent', assignment: 'a1' }, event },
    created: [],
  })
  const moved = (name: string, revision: string) => ({
    _tag: 'Source',
    create: { _tag: 'Moved', source: { _tag: 'Outside', name, revision } },
  })
  const work = {
    sources: new Map([
      ['page', { _tag: 'Outside', name: 'page', revision: 'v4' }],
      ['npm', { _tag: 'Outside', name: 'npm', revision: '1.2' }],
    ]),
    events: [
      logged(1, moved('page', 'v4')),
      logged(2, moved('npm', '1.2')),
      logged(5, { _tag: 'Source', id: 'page', move: { _tag: 'Checked' } }),
    ],
  } as unknown as Work
  const hour = 60 * 60 * 1000
  const later = (minute: number, hours: number) =>
    new Date(Date.parse(at(minute)) + hours * hour).toISOString() as Time
  const stateOf = (name: string, now: Time, hours: number) =>
    sourceStatesOf(momentOf(work, now, hours)).find((s) => s.name === name)?.state

  test('is fresh within the limit from its last read, then expired', () => {
    expect(stateOf('page', later(5, 72), 72)).toEqual({ _tag: 'Fresh', seenAt: at(5) })
    expect(stateOf('page', later(6, 72), 72)).toEqual({ _tag: 'Expired', seenAt: at(5) })
    expect(stateOf('npm', later(2, 24), 12)).toEqual({ _tag: 'Expired', seenAt: at(2) })
  })

  test('that no agent read has no state', () => {
    expect(stateOf('figma', at(9), 72)).toBeUndefined()
  })
})
