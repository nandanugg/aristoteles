// The frame of invariant 4.4 (plan/rebuild/BUILD.md): a Refusal has a real choice. The table of
// actions is total now; each action's own refusal cases wait for package P5 (todo below).
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Exit } from 'effect'
import { FilesLive } from '../services/index.ts'
import {
  ACTIONS,
  COMMON,
  defineWorkflow,
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
  Event,
  ResultId,
  RoleName,
  RunId,
  TaskId,
  Time,
} from '../schema/index.ts'
import {
  act,
  agent,
  appendIn,
  derivedIn,
  h,
  NANDA,
  ok,
  refused,
  tokenIn,
  workOf,
} from './fixture.test.ts'

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
      [agent(lead), { _tag: 'Ask', target: { to: 'Above' }, content: { text: '', options: [] } }],
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

// --- the refusals of onboarding (BUILD.md section 3) ---------------------------------------------

const HOST_RUN: Author = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' as Time }
const message = (o: ReturnType<typeof act>) => {
  const r = refused(o)
  expect(choiceProblems(r)).toEqual([])
  return r.message
}
const adjust = (adjustment: unknown): ActionInput =>
  ({ _tag: 'DraftAdjustment', target: {}, content: { adjustment } }) as ActionInput
const retire = (p: { readonly now: () => string } & Parameters<typeof appendIn>[0]) => {
  const drafted = appendIn(p, HOST_RUN, {
    _tag: 'Adjustment',
    create: { _tag: 'Drafted', adjustment: { _tag: 'RetireDirection', direction: 'tsd-writing' } },
  } as Event)
  const w = workOf(p.dir)
  const move = { _tag: 'Accepted', hashes: w.hashes, texts: w.texts }
  return appendIn(p, NANDA, { _tag: 'Adjustment', id: drafted, move } as Event)
}

describe('the refusals of onboarding, each with its words and a real choice', () => {
  test('an assign by a subagent, and a top task for a disposable role', async () => {
    const yaml = h.WORK_YAML.replace(
      'persistent: true\n      why: It runs one section',
      'persistent: false\n      why: It runs one section',
    )
    const p = h.project({ 'aristoteles.yaml': yaml })
    await h.init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
      ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    }
    ok(await p.nanda('task open --file=task.yaml'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    const lead = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=section-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    const d = derivedIn(p)
    const give = (role: string): ActionInput => ({
      _tag: 'Give',
      target: { task: T1, role: role as RoleName },
      content: { maxAttempts: null, secret: 's' },
    })
    expect(message(act(d, agent(lead), give('writer')))).toBe(
      'only a terminal (the host or a persistent agent) starts subagents; a2 runs as a ' +
        'subagent of a1: tell a1 what the work needs (work ask)',
    )
    expect(message(act(d, NANDA, give('section-lead')))).toBe(
      'a top task goes to a persistent role: section-lead is disposable, so it runs only as a ' +
        'subagent of a terminal',
    )
  }, 60000)

  test('a task draft for a disposable high role', async () => {
    const advisor =
      '  advisor:\n    tier: high\n    description: Advises on the field of the project.\n' +
      '    intro: You advise.\n    responsibilities:\n' +
      '      - Answer the questions of the field.\n' +
      '    acts: [{ approve: [writer] }]\n' +
      '    persistence: { persistent: false, why: It answers once. }\n    icon: lightbulb\n'
    const p = h.project({
      'aristoteles.yaml': `${h.WORK_YAML}${advisor}`,
      'top.yaml': `${h.TASK_WHOLE}role: advisor\n`,
    })
    await h.init(p)
    ok(await p.run('run start', h.HOST))
    const r = await p.run('task draft --file=top.yaml --by=h1', h.HOST)
    expect(r.err).toContain(
      'a top task goes to a persistent role: advisor is disposable, so it runs only as a ' +
        'subagent of a terminal',
    )
  }, 60000)

  test('the store start: a checker, an owner, ids, supersedes, the host role', async () => {
    const p = h.project()
    const tsd = Bun.YAML.parse(h.DIRECTION) as Record<string, unknown>
    const file = tsd
    const standards = (file.standards as ReadonlyArray<{ rules: ReadonlyArray<object> }>).map(
      (s) => ({ ...s, rules: s.rules.map((r) => ({ ...r, supersedes: [] })) }),
    )
    const direction = { ...file, standards }
    const one = (d: object) => ({ direction: d, source: { _tag: 'Local' } })
    const startIn = (dir: string, directions: ReadonlyArray<object>) =>
      Effect.runSyncExit(
        defineWorkflow(NANDA, dir, directions as never).pipe(Effect.provide(FilesLive)),
      )
    const why = (dir: string, directions: ReadonlyArray<object>) => {
      const exit = startIn(dir, directions)
      if (Exit.isSuccess(exit)) throw new Error('the start was not refused')
      const failure = exit.cause.reasons.find((x) => x._tag === 'Fail')
      const r = failure?._tag === 'Fail' ? (failure.error as Refusal) : undefined
      if (r === undefined) throw new Error(String(exit.cause))
      expect(choiceProblems(r)).toEqual([])
      return r.message
    }
    const rule = (checkedBy: string, supersedes: ReadonlyArray<string> = []) => ({
      ...direction,
      standards: [
        {
          id: 'facts',
          says: 'Facts.',
          rules: [{ id: 'r1', says: 'A fact.', checkedBy, supersedes }],
        },
      ],
    })
    expect(why(p.dir, [one(rule('ghost'))])).toBe(
      'rule r1 of tsd-writing is checked by ghost, which is not an accepted role',
    )
    expect(why(p.dir, [one(rule('writer'))])).toBe(
      'rule r1 is checked by writer, which reviews or approves no role that does the work, so ' +
        'its evidence never counts',
    )
    expect(why(p.dir, [one({ ...direction, owner: 'Dewi' })])).toBe(
      'the owner Dewi of tsd-writing is not in the people of aristoteles.yaml',
    )
    expect(why(p.dir, [one(direction), one(direction)])).toBe(
      'two directions have the id tsd-writing',
    )
    expect(why(p.dir, [one(direction), one({ ...direction, id: 'other' })])).toBe(
      'the rule id "no-code-proof" is already used; a new rule needs a new id',
    )
    expect(why(p.dir, [one(rule('linter', ['old']))])).toBe(
      'rule r1 supersedes "old", which is not in the current version',
    )
    expect(why(p.dir, [one({ ...direction, approvedBy: 'writer' })])).toBe(
      'tsd-writing: approvedBy names writer, a role that reviews no direction (only a medium ' +
        'or high role does)',
    )
    const noHost = h.WORK_YAML.replace(
      'persistent: true\n      why: It holds the TSD',
      'persistent: false\n      why: It holds the TSD',
    )
    const q = h.project({ 'aristoteles.yaml': noHost })
    expect(why(q.dir, [])).toBe(
      'the workflow has no persistent high role; the host plays the high role of each top task, ' +
        'and the host is a terminal (ruling 15)',
    )
    expect(Exit.isSuccess(startIn(p.dir, [one(direction)]))).toBe(true)
  }, 60000)

  test('a new task that names a retired direction; a remake that names it again', async () => {
    const { p } = await h.started()
    const by = retire(p)
    const d = derivedIn(p)
    const words = `tsd-writing is retired (${by}); a new task cannot name it`
    const open = { _tag: 'OpenTask', target: {}, content: { file: 'task.yaml' } } as const
    expect(message(act(d, NANDA, open))).toBe(words)
    const remake = {
      _tag: 'RemakeTask',
      target: { task: T1, answers: null },
      content: { file: 'task.yaml', reason: 'the scope grew' },
    } as const
    expect(message(act(d, NANDA, remake))).toBe(words)
  }, 60000)

  test('adjustments: who drafts, what exists, what is used, the tiers', async () => {
    const { p, lead } = await h.started()
    const editor = (more: string) =>
      'tier: medium\ndescription: Edits one section.\nintro: You edit one section.\n' +
      'responsibilities:\n  - Edit the section under its heading.\n' +
      `acts: [{ approve: [writer] }]\n${more}`
    const persistent = 'persistence: { persistent: true, why: It edits. }\n'
    p.write('editor.yaml', editor(`${persistent}icon: pen-tool\n`))
    p.write('bare.yaml', editor('icon: pen-tool\n'))
    const d = derivedIn(p)
    const setTier = { _tag: 'SetTier', role: 'writer', tier: 'medium' }
    expect(message(act(d, NANDA, adjust(setTier)))).toBe(
      'a model drafts an adjustment; the person says it in words',
    )
    expect(message(act(d, agent(lead), adjust(setTier)))).toBe(
      'a high role drafts an adjustment; this assignment is medium',
    )
    const draft = (a: unknown) => message(act(d, HOST_RUN, adjust(a)))
    expect(draft({ _tag: 'AddRole', role: 'writer', file: 'editor.yaml' })).toBe(
      'there is a role writer already',
    )
    expect(draft({ _tag: 'AddRole', role: 'editor', file: 'bare.yaml' })).toContain(
      'aristoteles.yaml roles.editor: persistence is required',
    )
    expect(draft({ _tag: 'RemoveRole', role: 'section-lead' })).toBe(
      'section-lead is in use: a1 plays it',
    )
    expect(draft({ _tag: 'RemoveRole', role: 'writer' })).toBe(
      'writer is in use: an act of architect names it',
    )
    expect(draft({ _tag: 'RemoveRole', role: 'linter' })).toBe(
      'linter is in use: it checks the rule no-code-proof of tsd-writing',
    )
    expect(draft({ _tag: 'SetTier', role: 'section-lead', tier: 'high' })).toBe(
      'the workflow would have no medium role; every workflow has the three tiers',
    )
    const keep = { persistent: false, why: 'It plans.' }
    expect(draft({ _tag: 'SetPersistence', role: 'architect', ...keep })).toBe(
      'the workflow would have no persistent high role; the host plays the high role of each ' +
        'top task, and the host is a terminal',
    )
    expect(draft({ _tag: 'RetireDirection', direction: 'ghost' })).toBe(
      'there is no direction ghost',
    )
    const hld = h.DIRECTION.replaceAll('tsd-writing', 'hld-writing')
      .replaceAll('no-code-proof', 'hld-no-code')
      .replaceAll('no-ticket-ids', 'hld-no-ids')
      .replaceAll('repeatable', 'hld-repeatable')
    p.write('hld.yaml', hld)
    ok(await p.agent('direction new --file=hld.yaml --by=assess'))
    const drafted = { _tag: 'RetireDirection', direction: 'hld-writing' }
    expect(message(act(derivedIn(p), HOST_RUN, adjust(drafted)))).toBe(
      'hld-writing has no version yet; its draft waits for its accept',
    )
    retire(p)
    const after = derivedIn(p)
    const again = { _tag: 'RetireDirection', direction: 'tsd-writing' }
    const twice = message(act(after, HOST_RUN, adjust(again)))
    expect(twice).toMatch(/^tsd-writing is retired \(e\d+\)$/)
  }, 60000)

  test('the role of the host stays persistent', async () => {
    const { p } = await h.started()
    ok(await p.run('run start', h.HOST))
    p.write('top.yaml', `${h.TASK_WHOLE}role: architect\n`)
    ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
    const d = derivedIn(p)
    const keep = { _tag: 'SetPersistence', role: 'architect', persistent: false, why: 'It plans.' }
    expect(message(act(d, HOST_RUN, adjust(keep)))).toBe(
      'architect is the role of the host, which plays the high role of each top task; the host ' +
        'is a terminal, so its role stays persistent',
    )
  }, 60000)
})
