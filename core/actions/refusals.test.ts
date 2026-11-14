// The frame of invariant 4.4 (plan/rebuild/BUILD.md): a Refusal has a real choice. The table of
// actions is total now; each action's own refusal cases wait for package P5 (todo below).
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACTIONS,
  COMMON,
  type Maker,
  REFUSALS,
  type RefusalsOf,
  STORE,
  WORKSPACE,
} from './index.ts'
import { type ActionInput, type ActionTag, type ChoiceKind, Refusal } from './types.ts'
import type {
  AssignmentId,
  Author,
  ResultId,
  RoleName,
  RunId,
  TaskId,
  Time,
} from '../schema/index.ts'
import { act, agent, derivedIn, h, NANDA, ok, refused } from './fixture.test.ts'

const T1 = 't1' as TaskId
const A2 = 'a2' as AssignmentId
const R1 = 'r1' as ResultId

const KINDS: ReadonlyArray<ChoiceKind> = ['Write', 'Pick', 'Wait', 'Escalate']
// Words that tell a mechanical step, not a choice (BUILD.md 4.4).
const MECHANICAL = [
  /run the command again/i,
  /the token goes/i,
  /^finish\b/i,
  /work next lists/i,
]

// What is wrong with the choice of a refusal; an empty list is a real choice.
const choiceProblems = (r: Refusal): ReadonlyArray<string> => {
  const { kind, words } = r.choice
  return [
    ...(KINDS.includes(kind) ? [] : [`kind ${String(kind)} is not a choice kind`]),
    ...(/\S/.test(words) ? [] : ['words are blank']),
    ...MECHANICAL.filter((m) => m.test(words)).map((m) => `words tell a mechanical step ${m}`),
  ]
}

// The tags of ActionInput, read from its source: a list that the table does not repeat.
const tagsOfInput = (): ReadonlyArray<string> => {
  const text = readFileSync(join(import.meta.dir, '../schema/actions.ts'), 'utf8')
  return [...text.matchAll(/\|\s+In<'(\w+)'/g)].map((m) => m[1] ?? '')
}

describe('the table of actions', () => {
  test('it has exactly one action for each tag of ActionInput', () => {
    const tags = tagsOfInput()
    expect(tags.length).toBeGreaterThan(40)
    expect(new Set(tags).size).toBe(tags.length)
    expect(Object.keys(ACTIONS).sort()).toEqual([...tags].sort())
  })

  test('each entry is a function', () => {
    const kinds = Object.entries(ACTIONS).map(([tag, action]) => [tag, typeof action])
    expect(kinds.filter(([, kind]) => kind !== 'function')).toEqual([])
  })
})

describe('the choice of a refusal', () => {
  // `as never`: the test builds blank words, which NonBlank forbids.
  const refusal = (kind: ChoiceKind, words: string) =>
    new Refusal({ message: 'm', choice: { kind, words: words as never } })

  test('a Refusal cannot be built without a choice (type level)', () => {
    // @ts-expect-error a refusal with no choice is a bug
    const none = new Refusal({ message: 'no choice' })
    expect(none).toBeInstanceOf(Refusal)
  })

  test('a real choice has no problem', () => {
    expect(choiceProblems(refusal('Write', 'write the reason with --reason'))).toEqual([])
    expect(choiceProblems(refusal('Pick', 'give the task to a lower role'))).toEqual([])
  })

  test('a blank choice, or one that tells a mechanical step, is a problem', () => {
    expect(choiceProblems(refusal('Write', '  '))).toHaveLength(1)
    expect(choiceProblems(refusal('Wait', 'run the command again'))).toHaveLength(1)
    expect(choiceProblems(refusal('Wait', 'work next lists the steps'))).toHaveLength(1)
    expect(choiceProblems(refusal('Wait', 'the token goes in the first word'))).toHaveLength(1)
    expect(choiceProblems(refusal('Pick', 'finish the assignment'))).toHaveLength(1)
  })
})

// One case for each action: every refusal path of the action is a maker of its row of REFUSALS
// (an action refuses only through them, and through canAct, whose refusals are core/derived's).
// Each maker, given words for its ids, makes a refusal with a real choice.
const placeholders = (make: Maker): ReadonlyArray<string> =>
  Array.from({ length: make.length }, (_, i) => `x${i + 1}`)
const problemsOf = (makers: RefusalsOf): ReadonlyArray<string> =>
  Object.entries(makers).flatMap(([name, make]) => {
    const r = make(...placeholders(make))
    const message = /\S/.test(r.message) ? [] : ['the message is blank']
    return [...message, ...choiceProblems(r)].map((p) => `${name}: ${p}`)
  })

describe('each refusal of each action has a choice', () => {
  for (const tag of Object.keys(ACTIONS) as ReadonlyArray<ActionTag>)
    test(`${tag}: each refusal path has a choice kind and non-blank words`, () => {
      expect(problemsOf(REFUSALS[tag])).toEqual([])
    })

  test('the refusals that the actions share have a real choice too', () => {
    expect(problemsOf(COMMON)).toEqual([])
    expect(problemsOf(STORE)).toEqual([])
    expect(problemsOf(WORKSPACE)).toEqual([])
  })

  test('REFUSALS has a row for each tag, and only those', () => {
    expect(Object.keys(REFUSALS).sort()).toEqual(Object.keys(ACTIONS).sort())
  })

  test('no action module refuses but through a maker: no refusal is built inline', () => {
    const dir = import.meta.dir
    const modules = [
      'config',
      'runs',
      'tasks',
      'report',
      'reviews',
      'directions',
      'drafts',
      'dispatch',
    ]
    const inline = modules.flatMap((m) => {
      const text = readFileSync(join(dir, `${m}.ts`), 'utf8')
      return [...text.matchAll(/new Refusal\(|refusal\(/g)].map(() => m)
    })
    expect(inline).toEqual([])
  })
})

// Real refusals of the actions on a scenario store: a content refusal and a refusal of state
// (canAct) each reach the actor with a real choice.
describe('a sample of real refusals, each with a real choice', () => {
  test('content and state refusals over the reported scenario', async () => {
    const { p, lead, writer, linter } = await h.reported()
    const d = derivedIn(p)
    const calls: ReadonlyArray<readonly [Author, ActionInput]> = [
      [NANDA, { _tag: 'CloseTask', target: { task: T1 }, content: { reason: ' ' } }],
      [
        agent(writer),
        { _tag: 'Report', target: { assignment: A2 }, content: { output: '', madeFrom: [] } },
      ],
      [
        agent(linter),
        {
          _tag: 'Accept',
          target: { of: { _tag: 'Result', id: R1 } },
          content: { evidence: [], reason: null },
        },
      ],
      [
        agent(lead),
        {
          _tag: 'Reject',
          target: { of: { _tag: 'Result', id: R1 } },
          content: { points: [], reason: null },
        },
      ],
      [
        NANDA,
        {
          _tag: 'FitRole',
          target: { role: 'nobody' as RoleName },
          content: { answers: 'fit.yaml' },
        },
      ],
      [NANDA, { _tag: 'OpenTask', target: {}, content: { file: 'missing.yaml' } }],
      [agent(lead), { _tag: 'Ask', target: { to: 'Above' }, content: { text: '' } }],
      [
        agent(writer),
        {
          _tag: 'Give',
          target: { task: T1, role: 'linter' as RoleName },
          content: { maxAttempts: null, secret: 's' },
        },
      ],
      [NANDA, { _tag: 'EndRun', target: { run: 'h9' as RunId }, content: {} }],
      [
        agent(lead),
        {
          _tag: 'Grant',
          target: { act: { _tag: 'Review', resultsOf: [] }, to: 'writer' as RoleName },
          content: { until: '2020-01-01T00:00:00.000Z' as Time },
        },
      ],
    ]
    const seen = calls.map(([by, input]) => {
      const r = refused(act(d, by, input))
      return [input._tag, choiceProblems(r)] as const
    })
    expect(seen).toEqual(calls.map(([, input]) => [input._tag, []] as const))
  }, 60000)
})

// The guard of an agent's act, now in canAct (the old CLI's guard table): a claim from a brief in
// this attempt, and a target in its own task tree (file-queue, round3 I-N2 and I-N14).
describe('the guard of an agent act is a refusal of canAct with a real choice', () => {
  test('no brief, a unit that is done, a target outside the tree', async () => {
    const { p, lead, writer } = await h.withWriter()
    const report = {
      _tag: 'Report',
      target: { assignment: A2 },
      content: { output: 'docs/tsd.md#introduction', madeFrom: [] },
    } as const
    const noBrief = refused(act(derivedIn(p), agent(writer), report))
    expect([noBrief.message, noBrief.choice.kind]).toEqual([
      'you have no brief in this attempt',
      'Wait',
    ])
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', h.INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const done = refused(act(derivedIn(p), agent(writer), report))
    expect(done.message).toBe('your unit is done; this assignment has no open brief')
    p.write('t2.yaml', 'name: The Design\ntext: Write the Design.\ndirections: [tsd-writing]\n')
    ok(await p.nanda('task open --file=t2.yaml'))
    const checkpoint = {
      _tag: 'Checkpoint',
      target: { task: 't2' as TaskId },
      content: { next: 'close it' },
    } as const
    const outside = refused(act(derivedIn(p), agent(lead), checkpoint))
    expect([outside.message, outside.choice.kind]).toEqual([
      't2 is outside the task tree of a1 (t1)',
      'Pick',
    ])
    for (const r of [noBrief, done, outside]) expect(choiceProblems(r)).toEqual([])
  }, 60000)
})
