// The guard of an agent's acts: the table is total over the acts that an agent may write, the
// first check (keyed by the command) and the second (keyed by the event) refuse in the old words.
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { type Event as EventType, WRITTEN_BY } from '../domain/events.ts'
import type { Work } from '../domain/work.ts'
import { type Call } from './command.ts'
import { parseArgs, withoutName } from './args.ts'
import { GUARD, type Guard, guard, guardCall } from './guard.ts'
import { failureOf, fakeWork } from './fixture.ts'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

// A call as runCli decodes it.
const callOf = (line: string, token: string | null): Call => {
  const args = withoutName(parseArgs(line.split(' ')))
  return { argv: line.split(' '), args, name: line.split(' ')[0] as Call['name'], act: null, token }
}

const rows = Object.entries(GUARD) as ReadonlyArray<readonly [string, Guard | null]>

describe('GUARD', () => {
  test('has a row for every kind that an agent writes, and no other', () => {
    // The compiler checks the same: a new kind of an agent fails the type of GUARD until it has
    // a row.
    expect<ReadonlyArray<string>>(rows.map(([k]) => k).sort()).toEqual(
      [...WRITTEN_BY.Agent].sort(),
    )
  })

  test('the acts that the old table had no row for stay unguarded', () => {
    const none = rows.filter(([, g]) => g === null).map(([k]) => k).sort()
    expect(none).toEqual([
      'Assignment.Briefed',
      'Assignment.BriefedFirst',
      'Assignment.BriefedToCheck',
      'Problem.Fixed',
      'Problem.Recorded',
      'Send.Sent',
    ])
  })

  test('the old rows, act by act: the claim, and the targets that each one reads', () => {
    const given = { task: 't2' as never, role: 'writer' as never, secret: 's' }
    const maker = GUARD['Assignment.GivenMaker']
    expect(maker?.claim).toBe(true)
    const assign = { _tag: 'GivenMaker', ...given, maxAttempts: null } as const
    expect(maker?.targets({ _tag: 'Assignment', create: assign })).toEqual(['t2'])
    expect(GUARD['Result.Result']?.claim).toBe(true)
    const reject = GUARD['Review.Reject']
    const points = [{ text: 'x', breaks: null }] as const
    const of = { _tag: 'Result', id: 'r3' as never, points } as const
    expect(reject?.targets({ _tag: 'Review', create: { _tag: 'Reject', of } })).toEqual(['r3'])
    const escalate = GUARD['Review.Escalate']
    expect(escalate?.claim).toBe(false)
    const escalation = { _tag: 'Escalate', of: 'r4' as never, reason: 'x' } as const
    expect(escalate?.targets({ _tag: 'Review', create: escalation })).toEqual(['r4'])
    const answered = GUARD['Question.Answered']
    expect(answered?.claim).toBe(false)
    const answer = { _tag: 'Question', id: 'q1' as never, move: { _tag: 'Answered', text: 'x' } }
    expect(answered?.targets(answer as never)).toEqual(['q1'])
    expect(GUARD['Assignment.Freed']?.claim).toBe(false)
  })
})

describe('the checks of an agent that has no brief', () => {
  const work: Work = fakeWork({
    assignments: new Map([
      ['a1', { id: 'a1', role: 'writer', task: 't1', parent: { _tag: 'GivenByPerson' }, end: { _tag: 'NotEnded' } }],
      ['a2', { id: 'a2', role: 'writer', task: 't1', parent: { _tag: 'GivenByPerson' }, end: { _tag: 'Finished', when: 'x' } }],
    ]),
    meta: new Map([
      ['a1', { secret: sha('k1'), claim: { _tag: 'Free' } }],
      ['a2', { secret: sha('k2'), claim: { _tag: 'Free' } }],
    ]),
    workflow: { roles: new Map([['writer', { _tag: 'Model', tier: 'low' }]]) },
  })
  const refusal = async (effect: Effect.Effect<void, unknown>) => failureOf(await Effect.runPromiseExit(effect))

  test('before the command builds its act: a report needs a claim', async () => {
    expect((await refusal(guardCall(work, callOf('report a1.k1', 'a1.k1')))).message).toBe(
      'you have no brief in this attempt',
    )
  })

  test('a finished assignment is refused first, with its own words', async () => {
    expect((await refusal(guardCall(work, callOf('escalate a2.k2', 'a2.k2')))).message).toBe('a2 is finished')
  })

  test('a wrong token is refused before anything else', async () => {
    expect((await refusal(guardCall(work, callOf('report a1.zz', 'a1.zz')))).message).toBe('the token of a1 is wrong')
  })

  test.each([
    ['a call with no token (the person)', 'report', null],
    ['brief, which is the claim itself', 'brief a1.k1', 'a1.k1'],
    ['send, which checks its own words', 'send a1.k1 a3', 'a1.k1'],
    ['problem, which checks its own words', 'problem a1.k1 t1', 'a1.k1'],
    ['a command that writes no act of an agent', 'status', 'a1.k1'],
  ])('no first check for %s', async (_name, line, token) => {
    await Effect.runPromise(guardCall(work, callOf(line, token)))
  })

  test('the second check reads the event: open, claim, then the targets', async () => {
    const report: EventType = {
      _tag: 'Result',
      create: {
        _tag: 'Result',
        output: 'x',
        madeFrom: [],
        work: { _tag: 'File', digest: 'd', size: 1 },
        files: [],
        after: null,
      },
    }
    expect((await refusal(guard(work, report, 'a1.k1'))).message).toBe('you have no brief in this attempt')
    const freed: EventType = { _tag: 'Assignment', id: 'a2' as never, move: { _tag: 'Freed' } }
    expect((await refusal(guard(work, freed, 'a2.k2'))).message).toBe('a2 is finished')
    // An act with no row is not checked at all (a host's task draft has a run, not an assignment).
    const to = { _tag: 'Terminal', session: 's-3' as never, via: { _tag: 'Tmux' } } as const
    const sent: EventType = {
      _tag: 'Send',
      create: {
        _tag: 'Sent',
        from: { _tag: 'Agent', to },
        keys: { _tag: 'Line', text: 'x' },
      },
    }
    await Effect.runPromise(guard(work, sent, 'a2.k2'))
  })
})
