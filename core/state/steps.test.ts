// The steps of the fold on a hand-made Work: a step finds the record, narrows it, and calls its
// move (src/domain/moves.ts); a move of a record in a state that it may not leave is a damaged
// store. (These cases were the old fold's, in src/domain/moves.test.ts, until the switch of
// 2026-11-14. The old fold also refused a resolve of no escalation, a second resolve, an
// evaluation of a stop that is no reject of the person, and a maker of a role that makes no
// result; the new fold trusts the store there, and canAct refuses those acts before a write.)
import { describe, expect, test } from 'bun:test'
import {
  type AssignmentId,
  human,
  type ProblemId,
  type Question,
  type QuestionId,
  type Recorded,
  StoreDamaged,
  type TaskId,
  type Time,
  type Work,
} from '../schema/index.ts'
import { foldStep } from './index.ts'

const at = (minute: number) => `2026-11-12T09:${String(minute).padStart(2, '0')}:00.000Z` as Time
const nanda = human('Nanda')
const q1 = 'q1' as QuestionId
const open: Question = {
  _tag: 'Question',
  id: q1,
  text: 'which merchant?',
  stops: 't1' as TaskId,
  answerBy: nanda,
  from: 'a2' as AssignmentId,
  status: { _tag: 'Open' },
  when: at(1),
}
const recorded = (seq: number, event: unknown): Recorded =>
  ({
    seq,
    at: at(seq),
    author: { _tag: 'Person', name: 'Nanda', channel: 'terminal' },
    event,
  }) as Recorded
const work = {
  events: [],
  questions: new Map([[q1, open]]),
  reviews: new Map([['v4', { _tag: 'Reject', id: 'v4' }]]),
} as unknown as Work
const step = (w: Work, r: Recorded): Work => foldStep(w, r).work
// The issue of the damage that a step throws, or undefined when it applies.
const issueOf = (w: Work, r: Recorded): unknown => {
  try {
    step(w, r)
  } catch (error) {
    return error instanceof StoreDamaged ? error.issue : error
  }
  return undefined
}

describe('the steps of the fold', () => {
  test('an answer moves its open question through answerQuestion', () => {
    const event = { _tag: 'Question', id: 'q1', move: { _tag: 'Answered', text: 'm1' } }
    const next = step(work, recorded(5, event))
    expect(next.questions.get(q1)).toMatchObject({
      status: { _tag: 'Answered', answer: 'm1', by: nanda, when: at(5) },
    })
    // A second answer of the same question is a damaged store, not a new answer.
    expect(() => step(next, recorded(6, event))).toThrow(StoreDamaged)
  })

  test('a move of a record in the wrong state is a damaged store', () => {
    const runs = new Map([['h1', { _tag: 'Host', id: 'h1', end: { _tag: 'Done', at: at(1) } }]])
    const permissions = new Map([['x1', { id: 'x1', revoked: { _tag: 'Revoked', at: at(1) } }]])
    const sends = [{ id: 'e3', state: { _tag: 'Delivered', at: at(1) } }]
    const w = { ...work, runs, permissions, sends } as unknown as Work
    const run = (id: string) => ({ _tag: 'Run', id, move: { _tag: 'Done' } })
    expect(() => step(w, recorded(8, run('h1')))).toThrow(StoreDamaged)
    const revoke = { _tag: 'Permission', id: 'x1', move: { _tag: 'Revoked' } }
    expect(() => step(w, recorded(8, revoke))).toThrow(StoreDamaged)
    const deliver = { _tag: 'Send', id: 'e3', move: { _tag: 'Delivered' } }
    expect(() => step(w, recorded(8, deliver))).toThrow(StoreDamaged)
  })

  test('the supervisor fixes a problem, and the record keeps that it did', () => {
    const problems = new Map([['sp1', { id: 'sp1', fixed: { _tag: 'NotFixed' } }]])
    const w = { ...work, problems } as unknown as Work
    const fix = { _tag: 'Problem', id: 'sp1', move: { _tag: 'Fixed' } }
    const bySupervisor = {
      ...recorded(9, fix),
      author: { _tag: 'Supervisor', name: 'Nanda' },
    } as Recorded
    expect(step(w, bySupervisor).problems.get('sp1' as ProblemId)?.fixed).toEqual({
      _tag: 'Fixed',
      by: { _tag: 'Supervisor', name: 'Nanda' },
      at: at(9),
    })
  })

  test('a check keeps its outside source; a check of no outside source is damage', () => {
    const page = { _tag: 'Outside', name: 'page', revision: 'v4' } as const
    const w = { ...work, sources: new Map([['page', page]]) } as unknown as Work
    const check = (name: string) =>
      recorded(9, { _tag: 'Source', id: name, move: { _tag: 'Checked' } })
    expect(step(w, check('page')).sources.get('page')).toEqual(page)
    expect(issueOf(w, check('npm'))).toBe('npm is no outside source')
  })
})
