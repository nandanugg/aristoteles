// The direction commands up to the engine: the refusals before the store (runCli on a line), the
// shape of the events that the forward builds, and the revise file. The engine, the replay and the
// words are other packages, so what needs a Work is tested with the integrated files of BUILD.md
// (company, directions-in-aristoteles, design-review-new-rules, search-and-pieces, replies, acts)
// once they are built.
import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'
import { EVIDENCE_FORM } from './work-support.ts'
import type { Found } from '../../domain/lookup.ts'
import { FilesLive } from '../../services/outside.ts'
import {
  failureOf,
  fakeWork,
  makeDir,
  runEffect,
  runNew,
  words,
  type Options,
} from '../fixture.ts'
import type { ForwardedAct } from '../../domain/events.ts'
import {
  checkHashes,
  evidenceOf,
  forwardWord,
  innerOf,
  pointsOf,
  readRevise,
} from './directions.ts'

const same = async (line: string, options?: Options, dir = makeDir()) => {
  const after = await runNew(dir, words(line), options)
  return after
}

const FILE = 'direction.yaml'
const withFile = () => {
  const dir = makeDir()
  writeFileSync(join(dir, FILE), 'id: x\n')
  return dir
}

describe('direction, before the store', () => {
  test.each([
    ['no act word', 'direction'],
    ['an unknown act word', 'direction frob'],
    ['a revise with no token', 'direction revise d1 --file=e.yaml'],
  ])('%s', async (_name, line) => {
    const r = await same(line, { tty: true })
    expect(r.code).toBe(1)
    expect(r.clock).toBe(0)
  })

  test('the person gives direction in words', async () => {
    const r = await same(`direction new --file=${FILE}`, { tty: true })
    expect(r.err).toStartWith('refused: the person gives direction in words: work suggest --says=')
  })

  test('a new direction needs its file, and shows the template', async () => {
    const r = await same('direction new')
    expect(r.err).toContain('refused: a new direction needs --file=<direction.yaml>')
    expect(r.err).toContain('next: write a file like this, then run the command again:\n  id: <direction id>')
  })

  test('--by names a run, not an assignment', async () => {
    const r = await same(`direction new a1.k0001 --file=${FILE} --by=assess`)
    expect(r.err).toContain('--by names a model run outside any task; an assignment is named by its token')
  })

  test.each(['', '--by=Assess', '--by=1x'])('a run outside a task names itself: "%s"', async (by) => {
    const r = await same(`direction new --file=${FILE} ${by}`)
    expect(r.err).toContain('a model run outside any task names itself: --by=<its name in lower case>')
    expect(r.err).toContain(`next: run it again with --by, for example: work direction new --file=${FILE} --by=assess`)
  })

  test('a file that is not there', async () => {
    const r = await same('direction new --file=nope.yaml --by=assess')
    expect(r.err).toStartWith('refused: there is no file nope.yaml in <project>')
    expect(r.clock).toBe(0)
  })
})

describe('the commands that reach the store', () => {
  // The dir has no store: both refuse at the open, after the readings of the clock that the old
  // command made first (a run's id is one reading).
  test('direction new reads the clock once for a run, then opens the store', async () => {
    const r = await same(`direction new --file=${FILE} --by=assess`, undefined, withFile())
    expect(r.err).toStartWith('refused: no work store in <project>')
    expect(r.clock).toBe(1)
  })

  test.each([
    'direction show d1',
    'direction show tsd@1#rule',
    'direction revise a1.k0001 d1 --file=e.yaml',
    'direction new a1.k0001 --file=direction.yaml',
    'suggest --says=words',
    'suggest a1.k0001 d1 --says=words',
    'revoke x1',
    'confirm e1',
    'forward a1.k0001 Nanda ask a2 --quote=words',
    'forward a1.k0001 Nanda resolve v2 --quote=words',
  ])('work %s', async (line) => {
    const r = await same(line, { tty: true }, withFile())
    expect(r.err).toContain('no work store in <project>')
  })
})

describe('grant checks its flags before it writes', () => {
  test.each([
    ['no act', 'grant --on=a --until=2030-01-01T00:00:00Z --to=r'],
    ['a wrong act', 'grant --act=do --on=a --until=2030-01-01T00:00:00Z --to=r'],
    ['no target', 'grant --act=approve --until=2030-01-01T00:00:00Z --to=r'],
    ['no until', 'grant --act=approve --on=a --to=r'],
    ['an until that is no time', 'grant --act=approve --on=a --until=soon --to=r'],
  ])('%s', async (_name, line) => {
    const r = await same(line, { tty: true })
    expect(r.code).toBe(1)
    expect(r.clock).toBe(0)
  })

  test('an until in the past reads the clock once', async () => {
    const r = await same('grant --act=review --on=a --until=2020-01-01T00:00:00Z --to=r', { tty: true })
    expect(r.err).toStartWith('refused: --until=2020-01-01T00:00:00Z is in the past')
    expect(r.clock).toBe(1)
  })

  test('a good grant reaches the store with that one reading', async () => {
    const r = await same('grant --act=review --on=a --until=2030-01-01T00:00:00Z --to=r', { tty: true })
    expect(r.err).toStartWith('refused: no work store in <project>')
    expect(r.clock).toBe(1)
  })
})

describe('checkHashes', () => {
  const stored = { 'aristoteles.yaml': 'not the hash of the file' }
  test('a changed file is refused with the way to restore it', async () => {
    const dir = makeDir()
    const { exit } = await runEffect(
      checkHashes(fakeWork({ hashes: stored }), null).pipe(Effect.provide(FilesLive)),
      dir,
    )
    expect(failureOf(exit)).toEqual({
      message: 'aristoteles.yaml changed since the stored config',
      next: 'the person runs work config restore (back to the stored files), or work config apply (role words only)',
    })
  })

  test('a file that the store never had is to be deleted', async () => {
    const dir = makeDir()
    const { exit } = await runEffect(
      checkHashes(fakeWork({ hashes: {} }), null).pipe(Effect.provide(FilesLive)),
      dir,
    )
    expect(failureOf(exit)).toEqual({
      message: 'aristoteles.yaml (new, not in the store: delete it) changed since the stored config',
      next: 'the person deletes aristoteles.yaml',
    })
  })
})

describe('evidence and points', () => {
  const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromiseExit(effect)

  test('evidence with a rule, and with none', async () => {
    const exit = await run(evidenceOf(['repeatable | the intro | a reviewer can repeat it', 'edit.yaml | the cleanup']))
    expect(exit._tag === 'Success' && exit.value).toEqual([
      { rule: 'repeatable', where: 'the intro', what: 'a reviewer can repeat it' },
      { rule: null, where: 'edit.yaml', what: 'the cleanup' },
    ])
  })

  test.each(['one', 'a | b | c | d', 'a | | c'])('evidence "%s" is refused in the old words', async (line) => {
    const { exit } = { exit: await run(evidenceOf([line])) }
    expect(failureOf(exit).message).toBe(
      `--evidence="${line}" does not read: an accept needs ${EVIDENCE_FORM}`,
    )
  })

  test('a --breaks belongs to the --point before it', async () => {
    const ok = await run(pointsOf([['point', 'a'], ['breaks', 'r1'], ['point', 'b']]))
    expect(ok._tag === 'Success' && ok.value).toEqual([
      { text: 'a', breaks: 'r1' },
      { text: 'b', breaks: null },
    ])
    const bad = await run(pointsOf([['breaks', 'r1'], ['point', 'a']]))
    expect(failureOf(bad).message).toBe('--breaks belongs to the --point before it; put the --point first')
  })
})

describe('the revise file', () => {
  const read = async (raw: unknown): Promise<unknown> => {
    const exit = await Effect.runPromiseExit(readRevise('edit.yaml', raw))
    return exit._tag === 'Success' ? exit.value : failureOf(exit)
  }

  test('a rule gets its supersedes, and a missing key stays absent', async () => {
    expect(
      await read({
        says: 'a new spirit',
        add: [{ id: 's1', says: 'one', rules: [{ id: 'r1', says: 'check', checkedBy: 'linter' }] }],
        remove: ['old'],
      }),
    ).toEqual({
      says: 'a new spirit',
      add: [
        {
          id: 's1',
          says: 'one',
          rules: [{ id: 'r1', says: 'check', checkedBy: 'linter', supersedes: [] }],
        },
      ],
      remove: ['old'],
    })
    expect(await read({})).toEqual({})
    expect(await read(null)).toEqual({})
  })

  test('a replace keeps the standard id and its new standard', async () => {
    expect(
      await read({ replace: [{ id: 's1', with: { id: 's1', says: 'two', where: { repo: 'x' }, rules: [] } }] }),
    ).toEqual({ replace: [{ id: 's1', with: { id: 's1', says: 'two', where: { repo: 'x' }, rules: [] } }] })
  })

  test.each([
    [{ add: [{ says: 'no id' }] }, 'edit.yaml: standard 1 needs an id and says'],
    [{ add: [{ id: 's1', says: 'x', rules: [{ id: 'r1' }] }] }, 'edit.yaml: rule 1 of s1 needs an id and says'],
    [{ replace: [{ with: {} }] }, 'edit.yaml: replace 1 needs an id'],
    [{ says: 3 }, 'edit.yaml: says is words'],
  ])('%j is refused', async (raw, message) => {
    expect(await read(raw)).toEqual({ message, next: null })
  })
})

describe('the inner act of a forward', () => {
  const found = {
    escalation: { _tag: 'Review', review: { _tag: 'Escalate', id: 'v3', of: 'r1' } },
    accept: { _tag: 'Review', review: { _tag: 'Accept', id: 'v4' } },
    result: { _tag: 'Result', result: { id: 'r1', task: 't1' } },
    task: { _tag: 'Task', task: { id: 't1' } },
    draft: { _tag: 'Revision', revision: { id: 'd2' } },
    assignment: { _tag: 'Assignment', assignment: { id: 'a2' } },
    question: { _tag: 'Question', question: { _tag: 'Question', id: 'q1', stops: 't1' } },
  } as unknown as Record<string, Found>
  const base = {
    quote: 'the words' as const,
    points: [],
    evidence: [],
    reason: undefined,
  }
  const inner = async (act: string, kind: string, extra: object = {}): Promise<unknown> => {
    const exit = await Effect.runPromiseExit(
      innerOf({ ...base, act: act as 'reject', found: found[kind] as Found, ...extra }),
    )
    return exit._tag === 'Success' ? exit.value : failureOf(exit)
  }

  const review = (data: object) => ({ _tag: 'Review', create: data })

  test('a reject with no point is one point of the quote', async () => {
    expect(await inner('reject', 'result')).toEqual(
      review({
        _tag: 'Reject',
        of: { _tag: 'Result', id: 'r1', points: [{ text: 'the words', breaks: null }] },
      }),
    )
    const points = [
      { text: 'a', breaks: null },
      { text: 'b', breaks: null },
    ]
    expect(await inner('reject', 'task', { points })).toEqual(
      review({ _tag: 'Reject', of: { _tag: 'Task', id: 't1', points: [{ text: 'a' }, { text: 'b' }] } }),
    )
    expect(await inner('reject', 'task', { points: [{ text: 'a', breaks: 'r1' }] })).toEqual({
      message:
        'a Reject of a task names no rule; reject a result for r1, or give the point with no rule',
      next: null,
    })
  })

  test('a reject of a draft is a review with the points as its reason', async () => {
    const points = [
      { text: 'a', breaks: null },
      { text: 'b', breaks: null },
    ]
    expect(await inner('reject', 'draft', { points })).toEqual(
      review({ _tag: 'Reject', of: { _tag: 'Revision', id: 'd2', reason: 'a; b' } }),
    )
  })

  test('an accept of a result needs evidence', async () => {
    const evidence = [{ rule: null, where: 'intro', what: 'it reads fine to me' }]
    expect(await inner('accept', 'result', { evidence })).toEqual(
      review({ _tag: 'Accept', of: { _tag: 'Result', id: 'r1', evidence }, reason: 'the words' }),
    )
    expect(await inner('accept', 'result')).toEqual({
      message: `an accept needs ${EVIDENCE_FORM}`,
      next: null,
    })
  })

  test('a resolve is a Resolve of the escalation in the quote; it forwards so', async () => {
    const resolved = await inner('resolve', 'escalation')
    expect(resolved).toEqual(
      review({ _tag: 'Resolve', escalation: 'v3', resolution: 'the words', evidence: [] }),
    )
    expect(forwardWord(resolved as ForwardedAct)).toBe('resolve')
    const evidence = [{ rule: null, where: 'intro', what: 'the date is not needed' }]
    expect(await inner('resolve', 'escalation', { evidence })).toEqual(
      review({ _tag: 'Resolve', escalation: 'v3', resolution: 'the words', evidence }),
    )
  })

  test('a resolve names an escalation', async () => {
    expect(await inner('resolve', 'accept')).toEqual({
      message: 'a resolve ends an escalation; this review is not an escalation',
      next: null,
    })
  })

  test('a task takes only a reject', async () => {
    expect(await inner('accept', 'task')).toEqual({
      message: 'a task takes only a Reject; an Accept goes on a result of the task',
      next: null,
    })
  })

  test('an accept of a draft keeps the evidence, empty or not', async () => {
    expect(await inner('accept', 'draft')).toEqual(
      review({ _tag: 'Accept', of: { _tag: 'Revision', id: 'd2', evidence: [] }, reason: 'the words' }),
    )
  })

  test('ask, answer and comment', async () => {
    expect(await inner('ask', 'assignment')).toEqual({
      _tag: 'Question',
      create: { _tag: 'Asked', text: 'the words', to: { _tag: 'Agent', assignment: 'a2' } },
    })
    expect(await inner('answer', 'question')).toEqual({
      _tag: 'Question',
      id: 'q1',
      move: { _tag: 'Answered', text: 'the words' },
    })
    expect(await inner('comment', 'task')).toEqual({
      _tag: 'Note',
      create: { _tag: 'Message', about: 't1', text: 'the words' },
    })
  })

  test('the CLI word of each forwarded act', async () => {
    const words = await Promise.all(
      (
        [
          ['reject', 'result', {}],
          ['accept', 'draft', {}],
          ['resolve', 'escalation', {}],
          ['ask', 'assignment', {}],
          ['answer', 'question', {}],
          ['comment', 'task', {}],
        ] as const
      ).map(async ([act, kind, extra]) =>
        forwardWord((await inner(act, kind, extra)) as ForwardedAct),
      ),
    )
    expect(words).toEqual(['reject', 'accept', 'resolve', 'ask', 'answer', 'comment'])
  })
})
