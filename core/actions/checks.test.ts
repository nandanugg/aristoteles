// The state checks that the actions held and canAct holds now (package P5b, gap 1): who may split,
// remake or close a task, record or fix a problem, draft or revise a direction, review a draft
// or an evaluation, forward the person, and fit a role. Each case shows the three in lockstep:
// canAct refuses with the old words and a real choice, the action refuses with the same words,
// and nextFor offers no step of that act to that actor.
import { beforeAll, describe, expect, test } from 'bun:test'
import { canAct, type Derived, nextFor } from '../derived/index.ts'
import type { Author } from '../schema/index.ts'
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

// The reported scenario: a1 the section lead (a lead, top), a2 the writer, a3 the linter
// (briefed); the person recorded the problem sp1 on t1.
describe('the checks of a role, its acts and a top', () => {
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

  test('a role with no split act does not split, remake or close a task', () => {
    const file = { file: 'parts.yaml' }
    lockstep(
      d,
      lead,
      { _tag: 'SplitTask', target: { task: 't1' as never, answers: null }, content: file },
      'section-lead has no split act, so it does not split tasks',
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
      'section-lead has no split act, so it does not remake tasks',
      'Escalate',
    )
    lockstep(
      d,
      lead,
      { _tag: 'CloseTask', target: { task: 't1' as never }, content: { reason: 'done' } },
      'section-lead has no split act, so it does not close tasks',
      'Escalate',
    )
  })

  test('only the host (a role that splits) records or fixes a system problem', () => {
    const host = 'the host (a role that splits) records a system problem; escalate it to your parent'
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

  test('a role with no direct act drafts and revises no direction; the person suggests in words', () => {
    const content = { file: 'd.yaml', answers: [], why: NO_WHY }
    lockstep(
      d,
      lead,
      { _tag: 'DraftDirection', target: {}, content },
      'section-lead has no direct act, so it does not draft directions',
      'Write',
    )
    lockstep(
      d,
      lead,
      { _tag: 'ReviseDirection', target: { direction: 'tsd-writing' as never }, content },
      'section-lead has no direct act, so it does not revise directions; escalate it, or suggest it',
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
      'only the top agent (a lead, with no parent) forwards the person',
      'Escalate',
    )
  })

  test('a person or a role that fits roles records role fitness', () => {
    lockstep(
      d,
      lead,
      { _tag: 'FitRole', target: { role: 'writer' as never }, content: { answers: 'fit.yaml' } },
      'a person or a role that fits roles records role fitness',
      'Escalate',
    )
  })
})
