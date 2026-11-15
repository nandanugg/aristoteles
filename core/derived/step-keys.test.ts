// The key of a step names the facts that make it new work (Nanda, 2026-11-15). work wait returns at
// once only for ready work whose key it did not print; a step that comes back for new work with
// its old key left the writer's wait blocked, and the whole run stopped.
import { beforeAll, describe, expect, test } from 'bun:test'
import type {
  AssignmentId,
  Author,
  ResultId,
  RoleName,
  TaskId,
  Time,
  Work,
} from '../schema/index.ts'
import { foldStep, fold } from '../state/index.ts'
import { derive, nextFor, type NextStep, stepKey, type StepWhat } from './index.ts'
import { keyOfWhat } from './steps.ts'
import {
  momentOf,
  ok,
  outsideNow,
  recordedOf,
  SCENARIOS,
  type Scenario,
  tokenIn,
} from './support.test.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'

interface Dir {
  readonly p: { readonly dir: string; readonly now: () => string }
}
const agent = (id: string): Author => ({ _tag: 'Agent', assignment: id as AssignmentId })
const keyOf = (s: Dir, id: string): string =>
  stepKey(nextFor(derive(momentOf(s.p.dir, s.p.now() as Time)), agent(id)))
// The line of one tag in a key, without the mark of a wait.
const lineOf = (key: string, tag: string): string | undefined =>
  key
    .split('\n')
    .map((l) => l.replace(/^wait /, ''))
    .find((l) => l.startsWith(`${tag} `))

// --- each brief, free and give is new work (the harness) -----------------------------------------

// The lead a1 gives the writer a2; a2 reads its brief, the lead frees it, it reads it again, and
// the lead finishes it. Then a linter a3 of a reported result, the same way.
const keys: Record<string, string> = {}
beforeAll(async () => {
  const s = await harness.started()
  const writer = tokenIn(ok(await s.p.agent(`assign ${s.lead} t1 --role=writer`)).out)
  const at = (name: string) => {
    keys[`${name} a1`] = keyOf(s, 'a1')
    keys[`${name} a2`] = keyOf(s, 'a2')
  }
  at('given')
  ok(await s.p.agent(`brief ${writer}`))
  at('brief')
  ok(await s.p.agent(`free ${s.lead} a2`))
  at('freed')
  ok(await s.p.agent(`brief ${writer}`))
  at('brief2')
  keys['start a1'] = keyOf(s, 'a1')
  ok(await s.p.agent(`finish ${s.lead} a2`))
  at('finished')
  const r = await harness.reported()
  keys['checker a1'] = keyOf(r, 'a1')
  ok(await r.p.agent(`free ${r.lead} a3`))
  keys['checker freed a1'] = keyOf(r, 'a1')
  ok(await r.p.agent(`brief ${r.linter}`))
  keys['checker brief2 a1'] = keyOf(r, 'a1')
  ok(await r.p.agent(`finish ${r.lead} a3`))
  keys['checker finished a1'] = keyOf(r, 'a1')
}, 120000)

// Two works of one step: their lines in the two keys, which must differ.
const twoWorks = (tag: string, one: string, two: string) => {
  const [x, y] = [lineOf(keys[one] ?? '', tag), lineOf(keys[two] ?? '', tag)]
  expect([x === undefined, y === undefined]).toEqual([false, false])
  expect(x).not.toBe(y)
}

describe('a step that comes back for new work has a new key', () => {
  test('BriefToMake: the brief after a free is a new attempt', () => {
    twoWorks('BriefToMake', 'given a2', 'freed a2')
  })
  test('ReportWork: the report of each brief', () => {
    twoWorks('ReportWork', 'brief a2', 'brief2 a2')
  })
  test('MakerWorking: each brief of the maker', () => {
    twoWorks('MakerWorking', 'brief a1', 'brief2 a1')
  })
  test('GiveMakerCommand: the start of a freed maker', () => {
    twoWorks('GiveMakerCommand', 'given a1', 'freed a1')
  })
  test('AssignMaker: a give after the maker ended', async () => {
    const s = await harness.started()
    const first = lineOf(keyOf(s, 'a1'), 'AssignMaker')
    expect(first).toBeDefined()
    expect(lineOf(keys['finished a1'] ?? '', 'AssignMaker')).not.toBe(first)
  }, 30000)
  test('CheckerWorking: each brief of the checker', () => {
    twoWorks('CheckerWorking', 'checker a1', 'checker brief2 a1')
  })
  test('GiveCheckerCommand: the start of a freed checker', async () => {
    // The checker is given and not briefed: its first start.
    const s = await harness.started()
    const writer = tokenIn(ok(await s.p.agent(`assign ${s.lead} t1 --role=writer`)).out)
    ok(await s.p.agent(`brief ${writer}`))
    s.p.write('docs/tsd.md', harness.INTRO_V2)
    ok(await s.p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await s.p.agent(`assign ${s.lead} t1 --role=linter`))
    keys['checker given a1'] = keyOf(s, 'a1')
    twoWorks('GiveCheckerCommand', 'checker given a1', 'checker freed a1')
  }, 30000)
  test('AssignChecker: a give after the checker ended', async () => {
    const s = await harness.started()
    const writer = tokenIn(ok(await s.p.agent(`assign ${s.lead} t1 --role=writer`)).out)
    ok(await s.p.agent(`brief ${writer}`))
    s.p.write('docs/tsd.md', harness.INTRO_V2)
    ok(await s.p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    keys['checker none a1'] = keyOf(s, 'a1')
    twoWorks('AssignChecker', 'checker none a1', 'checker finished a1')
  }, 30000)
})

// --- the facts that no scenario of the harness reaches: the key of two works -------------------

const at = (t: string) => t as Time
const differ = (one: StepWhat, two: StepWhat) => expect(keyOfWhat(one)).not.toBe(keyOfWhat(two))
const t1 = 't1' as TaskId
const r1 = 'r1' as ResultId

describe('the key names the fact of new work', () => {
  test('ReadSource: a new read expires as new work', () => {
    const read = { _tag: 'ReadSource', source: 'page', revision: 'v4', hours: 72 } as const
    differ(
      { ...read, seenAt: at('2026-10-25T09:00:00.000Z') },
      { ...read, seenAt: at('2026-10-28T10:00:00.000Z') },
    )
  })
  test('RecheckStaleSource: a source that changed again', () => {
    const stale = { _tag: 'RecheckStaleSource', result: r1, source: 'page', was: 'v1' } as const
    differ({ ...stale, now: 'v2' }, { ...stale, now: 'v3' })
  })
  test('FinishAcceptedTask: a task returned and accepted again', () => {
    differ(
      { _tag: 'FinishAcceptedTask', task: t1, result: r1 },
      { _tag: 'FinishAcceptedTask', task: t1, result: 'r2' as ResultId },
    )
  })
  test('RunWithLead and RunSectionWithLead: a give after the lead ended', () => {
    const roles: [RoleName] = ['section-lead' as RoleName]
    const a2 = 'a2' as AssignmentId
    differ(
      { _tag: 'RunWithLead', task: t1, roles, last: null },
      { _tag: 'RunWithLead', task: t1, roles, last: a2 },
    )
    differ(
      { _tag: 'RunSectionWithLead', task: t1, roles, last: null },
      { _tag: 'RunSectionWithLead', task: t1, roles, last: a2 },
    )
  })
  test('AssignDecider: a give after the decider ended', () => {
    const give = { _tag: 'AssignDecider', result: r1, role: 'lead' as RoleName, task: t1 } as const
    differ({ ...give, last: null }, { ...give, last: 'a4' as AssignmentId })
  })
  test('Decide: a decide again under each new version', () => {
    const decide = { _tag: 'Decide', result: r1, again: true } as const
    differ({ ...decide, versions: ['tsd-writing@2'] }, { ...decide, versions: ['tsd-writing@3'] })
  })
  test('CheckAgainUnderNewVersion: each new version', () => {
    const check = { _tag: 'CheckAgainUnderNewVersion', result: r1 } as const
    differ({ ...check, versions: ['tsd-writing@2'] }, { ...check, versions: ['tsd-writing@3'] })
  })
  test('a step that waits and then gets its act is ready work the wait did not print', () => {
    const what: StepWhat = { _tag: 'SplitFirst', task: t1 }
    const waits: NextStep = { _tag: 'Wait', what }
    const ready: NextStep = {
      _tag: 'Do',
      what,
      intents: [{ _tag: 'SplitTask', target: { task: t1, answers: null } }],
    }
    expect(stepKey([waits])).not.toBe(stepKey([ready]))
  })
  test('a fact that only picks words is no new work', () => {
    const decide = { _tag: 'Decide', result: r1, versions: [] } as const
    expect(keyOfWhat({ ...decide, again: false })).toBe(keyOfWhat({ ...decide, again: true }))
    const a2 = 'a2' as AssignmentId
    const give = { _tag: 'GiveMakerCommand', maker: a2, task: t1, briefs: 1 } as const
    expect(keyOfWhat({ ...give, redo: false, ownChild: true })).toBe(
      keyOfWhat({ ...give, redo: true, ownChild: false }),
    )
  })
})

// --- the scenarios, event by event ---------------------------------------------------------------

// The keys of each open assignment after each event of a store. A ready key that went away after
// the actor acted, and comes back, is a work wait that does not return: the step came back for new
// work with the key that the actor printed before.
const comeBack = (s: Scenario): ReadonlyArray<string> => {
  const events = recordedOf(s.p.dir)
  const outside = outsideNow(fold(events), s.p.dir)
  const found: Array<string> = []
  // For each actor: the ready keys it had, and whether it acted since each one went away.
  const had = new Map<AssignmentId, Map<string, { gone: boolean; acted: boolean }>>()
  let work: Work | undefined
  for (const recorded of events) {
    work = work === undefined ? fold([recorded]) : foldStep(work, recorded).work
    const author = recorded.author
    const d = derive({ work, at: recorded.at as Time, outside })
    for (const a of work.assignments.keys()) {
      if (d.states.assignments.get(a)?._tag === 'Ended') continue
      const mine = had.get(a) ?? new Map()
      had.set(a, mine)
      if (author._tag === 'Agent' && author.assignment === a) {
        for (const x of mine.values()) x.acted = true
      }
      const steps = nextFor(d, agent(a))
      const key = stepKey(steps)
      const ready = steps.some((x) => x._tag === 'Do')
      const before = mine.get(key)
      if (ready && before?.gone && before.acted) {
        found.push(`${s.name} ${a} at ${recorded.seq}: ${key.replaceAll('\n', ' | ')}`)
      }
      for (const [k, x] of mine) if (k !== key) x.gone = true
      if (ready) mine.set(key, { gone: false, acted: false })
    }
  }
  return found
}

describe('the scenarios, event by event', () => {
  const built: Array<Scenario> = []
  beforeAll(async () => {
    for (const [, make] of SCENARIOS) built.push(await make())
  }, 240000)

  test('no ready key comes back after its actor acted', () => {
    expect(built.flatMap(comeBack)).toEqual([])
  })
})
