// The state checks that the actions held and canAct holds now (package P5b, gap 1): who may split,
// remake or close a task, record or fix a problem, draft or revise a direction, review a draft
// or an evaluation, forward the person, and fit a role. Each case shows the three in lockstep:
// canAct refuses with the old words and a real choice, the action refuses with the same words,
// and nextFor offers no step of that act to that actor.
import { beforeAll, describe, expect, test } from 'bun:test'
import { canAct, type Derived, nextFor } from '../derived/index.ts'
import { candidatesOf } from '../derived/steps.ts'
import type { AssignmentId, Author, RevisionId } from '../schema/index.ts'
import { act, agent, derivedIn, h, NANDA, ok, refused } from './fixture.test.ts'
import { type ActionInput, type ChoiceKind, intentOf } from './types.ts'

const NO_WHY = { reason: null, words: null }

const lockstep = (
  d: Derived,
  by: Author,
  input: ActionInput,
  message: string,
  kind: ChoiceKind,
): void => {
  const r = canAct(d, by, intentOf(input))
  const refusal = r._tag === 'MayNot' ? r.refusal : undefined
  expect([refusal?.message, refusal?.choice.kind]).toEqual([message, kind])
  expect(refusal?.choice.words.trim()).not.toBe('')
  expect(refused(act(d, by, input)).message).toBe(message)
  const intent = JSON.stringify(intentOf(input))
  const offered = nextFor(d, by).filter(
    (s) => s._tag === 'Do' && s.intents.some((i) => JSON.stringify(i) === intent),
  )
  expect(offered).toEqual([])
}

// The reported scenario: a1 the section lead (medium, top), a2 the writer (low), a3 the linter
// (low, briefed); the person recorded the problem sp1 on t1.
describe('the checks of a role, a tier and a top', () => {
  let d: Derived
  let lead: Author
  let linter: Author
  beforeAll(async () => {
    const s = await h.reported()
    ok(await s.p.ui('problem t1 --says="the cluster is down: run make up, then press Fixed"'))
    d = derivedIn(s.p)
    lead = agent(s.lead)
    linter = agent(s.linter)
  }, 60000)

  test('a medium role does not split, remake or close a task', () => {
    const file = { file: 'parts.yaml' }
    lockstep(
      d,
      lead,
      { _tag: 'SplitTask', target: { task: 't1' as never, answers: null }, content: file },
      'a medium role does not split tasks',
      'Escalate',
    )
    lockstep(
      d,
      lead,
      {
        _tag: 'RemakeTask',
        target: { task: 't1' as never, answers: null },
        content: { file: 'task.yaml', reason: 'smaller' },
      },
      'a medium role does not remake tasks',
      'Escalate',
    )
    lockstep(
      d,
      lead,
      { _tag: 'CloseTask', target: { task: 't1' as never }, content: { reason: 'done' } },
      'a medium role does not close tasks',
      'Escalate',
    )
  })

  test('only the host (a high role) records or fixes a system problem', () => {
    const host = 'the host (a Sol) records a system problem; escalate it to your parent'
    lockstep(
      d,
      lead,
      { _tag: 'RecordProblem', target: { task: 't1' as never }, content: { says: 'down' } },
      host,
      'Escalate',
    )
    lockstep(
      d,
      lead,
      { _tag: 'FixProblem', target: { problem: 'sp1' as never }, content: {} },
      host,
      'Escalate',
    )
  })

  test('a medium role drafts and revises no direction; the person suggests in words', () => {
    const content = { file: 'd.yaml', answers: [], why: NO_WHY }
    lockstep(
      d,
      lead,
      { _tag: 'DraftDirection', target: {}, content },
      'a medium role does not draft directions',
      'Write',
    )
    lockstep(
      d,
      lead,
      { _tag: 'ReviseDirection', target: { direction: 'tsd-writing' as never }, content },
      'a medium role does not revise directions; escalate it, or suggest it',
      'Write',
    )
    lockstep(
      d,
      NANDA,
      { _tag: 'DraftDirection', target: {}, content },
      'the person gives direction in words: work suggest --says="<the direction that is ' +
        'missing>"; a model drafts it, and you accept or reject it',
      'Write',
    )
  })

  test('only the top agent forwards the person', () => {
    const inner = {
      _tag: 'Review',
      create: { _tag: 'Reject', of: { _tag: 'Task', id: 't1', points: [{ text: 'no' }] } },
    } as const
    lockstep(
      d,
      linter,
      {
        _tag: 'Forward',
        target: { act: inner as never },
        content: { person: 'Nanda', quote: 'no', channel: 'chat' },
      },
      'only the top agent (medium or high, with no parent) forwards the person',
      'Escalate',
    )
  })

  test('a person or a high role records role fitness', () => {
    lockstep(
      d,
      lead,
      { _tag: 'FitRole', target: { role: 'writer' as never }, content: { answers: 'fit.yaml' } },
      'a person or a high role records role fitness',
      'Escalate',
    )
  })
})

// A low role reviews results only. With a change grant on the direction, the low linter is a
// candidate reviewer of the open draft d2 (the owner's leaf): its step now waits, as canAct
// refuses it, where before nextFor offered an accept that the action refused.
describe('a low role reviews no draft and no evaluation', () => {
  let d: Derived
  let linter: AssignmentId
  let draft: RevisionId
  let evaluation: string
  beforeAll(async () => {
    const s = await h.reported()
    const { p } = s
    const change = 'add:\n  - { id: short, says: Keep it short. }\n'
    draft = (await h.changeDirection(p, change, { accept: false })).draft as RevisionId
    const grant = '--until=2026-12-31T00:00:00Z'
    ok(await p.nanda(`grant --act=change --on=tsd-writing --to=linter ${grant}`, 'grant'))
    ok(await p.nanda('review t1 reject --point="the scope is wrong"'))
    const evaluated = ok(
      await p.nanda(
        'evaluate t1 --wrong="the work misses what was asked" --why="the directions do not ' +
          'say it" --improve="say it in a standard" --level=standard',
      ),
    )
    evaluation = /\b(ev\d+)\b/.exec(evaluated.out)?.[1] ?? ''
    linter = s.linter.split('.')[0] as AssignmentId
    d = derivedIn(p)
  }, 60000)

  test('an accept or a reject of a draft', () => {
    const by: Author = { _tag: 'Agent', assignment: linter }
    const of = { _tag: 'Revision', id: draft } as const
    const words = 'a low role does not review drafts of directions'
    lockstep(
      d,
      by,
      { _tag: 'Accept', target: { of }, content: { evidence: [], reason: null } },
      words,
      'Escalate',
    )
    lockstep(
      d,
      by,
      { _tag: 'Reject', target: { of }, content: { points: [], reason: 'unclear' } },
      words,
      'Escalate',
    )
    // The candidate step is there, and it waits: no intent of it passes canAct.
    const review = candidatesOf(d, linter).find((c) => c.what._tag === 'ReviewDraft')
    expect(review?.intents.map((i) => i._tag)).toEqual(['Accept', 'Reject'])
    const step = nextFor(d, by).find((x) => x.what._tag === 'ReviewDraft')
    expect(step?._tag).toBe('Wait')
  })

  test('a reject of an evaluation', () => {
    expect(evaluation).toMatch(/^ev\d+$/)
    lockstep(
      d,
      { _tag: 'Agent', assignment: linter },
      {
        _tag: 'Reject',
        target: { of: { _tag: 'Evaluation', id: evaluation as never } },
        content: { points: [], reason: 'not this' },
      },
      'a low role does not review evaluations',
      'Escalate',
    )
  })
})
