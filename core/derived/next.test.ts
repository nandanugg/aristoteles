// nextFor, canAct and stepKey over the scenario stores (BUILD.md 3.5, 4.2, 4.5): every Do step of
// every actor passes canAct; the steps equal those of the old `work next` (pinned in
// next.pins.json at the switch, 2026-11-14) but for the bookkeeping steps of D14 and the agents
// that C1 ended; stepKey keeps the tags and ids only.
import { beforeAll, describe, expect, test } from 'bun:test'
import type { AssignmentId, Author, ResultId, TaskId, Time, Work } from '../schema/index.ts'
import { canAct, type Derived, derive, type NextStep, nextFor, stepKey } from './index.ts'
import { candidatesOf } from './steps.ts'
import { momentOf, pinned, SCENARIOS, type Scenario } from './support.test.ts'

// The tags of the steps that the old `work next` gave, and the stepKey of those that D14 keeps.
const old = pinned(`${import.meta.dir}/next.pins.json`)

interface Built {
  readonly s: Scenario
  readonly w: Work
  readonly d: Derived
}
const built: Array<Built> = []
beforeAll(async () => {
  for (const [, make] of SCENARIOS) {
    const s = await make()
    const m = momentOf(s.p.dir, s.at)
    built.push({ s, w: m.work, d: derive(m) })
  }
}, 240000)

// Every actor that may act: each assignment that is not Ended, and each person of the config.
const actorsOf = ({ w, d }: Built): ReadonlyArray<Author> => [
  ...[...w.assignments.keys()]
    .filter((a) => d.states.assignments.get(a)?._tag !== 'Ended')
    .map((assignment): Author => ({ _tag: 'Agent', assignment })),
  ...w.config.people.map((name): Author => ({ _tag: 'Person', name, channel: 'terminal' })),
]
const tierOf = (w: Work, a: AssignmentId): string | undefined => {
  const role = w.workflow.roles.get(w.assignments.get(a)?.role ?? ('' as never))
  return role?._tag === 'Model' ? role.tier : undefined
}
// D14 (C1, I2): the bookkeeping steps that the new tree does not give.
const D14 = ['FinishChildOfClosedTask', 'FinishInClosedTask', 'FinishChild']

describe('next => canAct (BUILD.md 4.2)', () => {
  test('every intent of every Do step of every actor passes canAct', () => {
    let checked = 0
    for (const b of built) {
      for (const actor of actorsOf(b)) {
        for (const step of nextFor(b.d, actor)) {
          if (step._tag !== 'Do') continue
          for (const intent of step.intents) {
            checked++
            const r = canAct(b.d, actor, intent)
            expect([b.s.name, actor, intent, r._tag]).toEqual([b.s.name, actor, intent, 'May'])
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  test('no candidate step of a medium or high agent is one that its act refuses', () => {
    for (const b of built) {
      for (const [a] of b.w.assignments) {
        const tier = tierOf(b.w, a)
        if (tier === 'low' || b.d.states.assignments.get(a)?._tag === 'Ended') continue
        const actor: Author = { _tag: 'Agent', assignment: a }
        for (const c of candidatesOf(b.d, a)) {
          for (const intent of c.intents) {
            const r = canAct(b.d, actor, intent)
            const why = r._tag === 'MayNot' ? r.refusal.message : 'May'
            expect([b.s.name, a, c.what._tag, why]).toEqual([b.s.name, a, c.what._tag, 'May'])
          }
        }
      }
    }
  })

  test('the top agent of an accepted task finishes itself; settled children hold it not', () => {
    const b = built.find((x) => x.s.name === 'accepted')
    const steps = b === undefined ? [] : nextFor(b.d, { _tag: 'Agent', assignment: 'a1' as never })
    expect(steps.map((s) => [s._tag, s.what._tag])).toEqual([['Do', 'FinishAcceptedTask']])
  })

  test('the person gets the steps of their waiting items, each with its act', () => {
    const relay = built.find((b) => b.s.name === 'relay')
    const nanda: Author = { _tag: 'Person', name: 'Nanda', channel: 'terminal' }
    const steps = relay === undefined ? [] : nextFor(relay.d, nanda)
    expect(steps.map((s) => (s._tag === 'Do' ? s.intents.map((i) => i._tag) : []))).toEqual([
      ['Confirm'],
      ['Accept', 'Reject'],
    ])
  })
})

// Ruling 10.1: what the watcher typed into a terminal before is a step of nextFor now.
const NOTICES: ReadonlyArray<string> = [
  'AnswerPrompt',
  'RecordFailure',
  'WriteEndWords',
  'TestProblem',
  'WaitsForAnswer',
  'Answered',
  'Resolved',
]

describe('nextFor equals the old work next, or D14 and C1 explain it', () => {
  test('the step keys of each open agent', () => {
    const seen: Array<string> = []
    for (const { s, w, d } of built) {
      for (const a of w.assignments.values()) {
        if (a.end._tag !== 'NotEnded') continue
        const was = old<{ tags: ReadonlyArray<string>; key: string }>(s, `next ${a.id}`)
        const now = nextFor(d, { _tag: 'Agent', assignment: a.id })
        const state = d.states.assignments.get(a.id)
        if (state?._tag === 'Ended') {
          // C1: an agent of an ended task has no step; the old one was told to finish.
          expect(state.why._tag).toBe('TaskEnded')
          expect(now).toEqual([])
          seen.push(`${s.name}: C1: ${a.id} has no step (was: ${was.tags})`)
          continue
        }
        const kept = was.tags.filter((tag) => !D14.includes(tag))
        if (kept.length !== was.tags.length) seen.push(`${s.name}: D14: ${a.id}`)
        // Ruling 10.1: the notices that the watcher typed before are steps now (notices.ts).
        const steps = now.filter((x) => !NOTICES.includes(x.what._tag))
        expect([s.name, a.id, stepKey(steps)]).toEqual([s.name, a.id, was.key])
      }
    }
    expect(seen.some((x) => x.startsWith('uiRunRemade: C1: a1 has no step'))).toBe(true)
    expect(seen).toContain('accepted: D14: a1')
  })
})

describe('stepKey', () => {
  test('has the tag and the ids of each step, and no words, flags, revisions or times', () => {
    const steps: ReadonlyArray<NextStep> = [
      {
        _tag: 'Wait',
        what: {
          _tag: 'ReadSource',
          source: 'page',
          revision: 'v4',
          seenAt: '2026-10-25T09:00:00.000Z' as Time,
          hours: 72,
        },
      },
      {
        _tag: 'Wait',
        what: {
          _tag: 'GiveMakerCommand',
          maker: 'a2' as AssignmentId,
          task: 't1' as TaskId,
          redo: true,
          ownChild: true,
        },
      },
      {
        _tag: 'Do',
        what: { _tag: 'Decide', result: 'r1' as ResultId, again: false },
        intents: [{ _tag: 'Accept', target: { of: { _tag: 'Result', id: 'r1' as ResultId } } }],
      },
    ]
    expect(stepKey(steps)).toBe('ReadSource page\nGiveMakerCommand a2 t1\nDecide r1')
    const other = steps.map((s) =>
      s.what._tag === 'ReadSource'
        ? { ...s, what: { ...s.what, revision: 'v5', hours: 24 } }
        : s.what._tag === 'Decide'
          ? { _tag: 'Wait' as const, what: { ...s.what, again: true } }
          : s,
    )
    expect(stepKey(other)).toBe(stepKey(steps))
  })
})
