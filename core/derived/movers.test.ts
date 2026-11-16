// P9 (live, 2026-11-15): a writer that leads reported, a checker rejected its result, and every
// open assignment waited on the writer's claim; the writer waited on itself. A claim ends with
// the maker's report, a maker does not choose its reviewers, one checker of a role checks a task,
// and every wait on a maker or a checker has a mover with a step.
import { beforeAll, describe, expect, test } from 'bun:test'
import type { AssignmentId, Time, Work } from '../schema/index.ts'
import { derive, type Derived, nextFor, type NextStep, stepKey, type StepWhat } from './index.ts'
import { momentOf, ok, SCENARIOS, tokenIn, type Scenario } from './support.test.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'

// The writer of the live run: a persistent sonnet that makes the result, and assigns a checker.
const LEADING = (harness.WORK_YAML as string)
  .replace('model: haiku\n    description: Writes', 'model: sonnet\n    description: Writes')
  .replace(
    'acts: [{ do: write one TSD section }]\n    persistence:\n      persistent: false',
    'acts: [{ do: write one TSD section }, { assign: [linter] }]\n    persistence:\n      persistent: true',
  )
// The writer a2 reports r1 (the lead a1 gave it).
const writerReported = async () => {
  const s = await harness.withWriter({ 'aristoteles.yaml': LEADING })
  ok(await s.p.agent(`brief ${s.writer}`))
  s.p.write('docs/tsd.md', harness.INTRO_V2)
  ok(await s.p.agent(`report ${s.writer} --output=docs/tsd.md#introduction`))
  return s
}
// ... the lead's linter a3 rejects r1 on a rule.
const rejected = async () => {
  const s = await writerReported()
  const linter = tokenIn(ok(await s.p.agent(`assign ${s.lead} t1 --role=linter`)).out)
  ok(await s.p.agent(`brief ${linter}`))
  const point = '--point="ABC-2964 is a ticket id" --breaks=no-ticket-ids'
  ok(await s.p.agent(`review ${linter} r1 reject ${point}`))
  return { ...s, linter }
}
type Dir = { readonly dir: string; readonly now: () => string }
const derivedOf = (s: { readonly p: Dir } | Dir) => {
  const p = 'p' in s ? s.p : s
  return derive(momentOf(p.dir, p.now() as Time))
}
const tags = (steps: ReadonlyArray<NextStep>) => steps.map((x) => `${x._tag} ${x.what._tag}`)
const agent = (id: string) => ({ _tag: 'Agent', assignment: id as AssignmentId }) as const

describe('a claim ends with the report of its maker', () => {
  test('after a reject the maker reads its brief again; nobody waits on its old claim', async () => {
    const s = await rejected()
    const d = derivedOf(s)
    expect(tags(nextFor(d, agent('a2')))).toEqual(['Do BriefToMake'])
    expect(tags(nextFor(d, agent('a1')))).not.toContain('Wait MakerWorking')
    const next = ok(await s.p.agent(`next ${s.writer}`)).out
    expect(next).toContain('redo t1: read your brief again; it holds what the reviews found')
    expect(next).toContain(`work brief ${s.writer}`)
    // After its brief the maker holds a claim again, and its step is the report.
    ok(await s.p.agent(`brief ${s.writer}`))
    expect(tags(nextFor(derivedOf(s), agent('a2')))).toEqual(['Do ReportWork'])
  }, 30000)
})

// Live, 2026-11-15: the writer fixed r1 and reported r2, the lead rejected r2, and the writer's
// work wait never returned: the step "read your brief again for t1" had the same key as after
// the reject of r1, so the wait took it for work it had printed already.
describe('each new result makes the redo new work', () => {
  test('the key of the redo step names the latest result', async () => {
    const s = await rejected()
    const first = stepKey(nextFor(derivedOf(s), agent('a2')))
    ok(await s.p.agent(`brief ${s.writer}`))
    s.p.write('docs/tsd.md', harness.INTRO_V1)
    ok(await s.p.agent(`report ${s.writer} --output=docs/tsd.md#introduction`))
    const point = '--point="still a ticket id" --breaks=no-ticket-ids'
    ok(await s.p.agent(`brief ${s.linter}`))
    ok(await s.p.agent(`review ${s.linter} r2 reject ${point}`))
    const second = stepKey(nextFor(derivedOf(s), agent('a2')))
    expect(tags(nextFor(derivedOf(s), agent('a2')))).toEqual(['Do BriefToMake'])
    expect(second).not.toBe(first)
  }, 30000)
})

// Live, 2026-11-15: a checker reviewed r2, the writer reported r3, and the checker's accept of r3
// was refused (its claim ended with its review); its step fell back to a wait that woke no one.
describe('a checker with no claim reads its brief again', () => {
  test('after its review, the next result gives it a brief step, then the check', async () => {
    const s = await rejected()
    ok(await s.p.agent(`brief ${s.writer}`))
    s.p.write('docs/tsd.md', harness.INTRO_V1)
    ok(await s.p.agent(`report ${s.writer} --output=docs/tsd.md#introduction`))
    expect(tags(nextFor(derivedOf(s), agent('a3')))).toEqual(['Do BriefToCheck'])
    ok(await s.p.agent(`brief ${s.linter}`))
    expect(tags(nextFor(derivedOf(s), agent('a3')))).toEqual(['Do CheckYourself'])
  }, 30000)
})

// Live, 2026-11-15: a lead was given t4 and had read no brief; its give of a writer was refused,
// and its step fell back to a wait. Any agent with no claim whose acts are refused reads its brief.
describe('an agent with no claim reads its brief first', () => {
  test('a new lead gets a brief step that leads to its give of a maker', async () => {
    const p = harness.project()
    await harness.init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
      ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    }
    ok(await p.nanda('task open --file=task.yaml'))
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    const before = nextFor(derivedOf(p), agent('a1'))
    expect(tags(before)).toEqual(['Do BriefFirst'])
    const then = before[0]?.what
    expect(then?._tag === 'BriefFirst' ? then.then._tag : '').toBe('AssignMaker')
    ok(await p.agent(`brief ${lead}`))
    expect(tags(nextFor(derivedOf(p), agent('a1')))).toEqual(['Do AssignMaker'])
  }, 30000)
  // Live, 2026-11-15: while the writer worked, its checkers were told to read their briefs to
  // free it, an act refused because they do not lead, not because they have no brief.
  test('a step refused for another reason stays a wait', async () => {
    const s = await rejected()
    ok(await s.p.agent(`brief ${s.writer}`))
    const steps = tags(nextFor(derivedOf(s), agent('a3')))
    expect(steps).not.toContain('Do BriefFirst')
  }, 30000)
})

// Live, 2026-11-15: a direction changed after the lead read its brief; its accepts of r8 were
// made under the old version and never counted, while its step kept saying "decide r8".
describe('a decider with an old snapshot reads its brief again', () => {
  test('after a direction change, the decide step becomes a brief step', async () => {
    const s = await harness.reported()
    const ev =
      '--evidence="no-code-proof | docs/tsd.md#introduction | I saw no file path and no commit hash" ' +
      '--evidence="no-ticket-ids | docs/tsd.md#introduction | I saw no ticket id and no chat citation"'
    ok(await s.p.agent(`review ${s.linter} r1 accept ${ev}`))
    const yaml = 'add:\n  - { id: short, says: Keep it short. }\n'
    await harness.changeDirection(s.p, yaml, { flags: '--why="Correct the standard"' })
    expect(tags(nextFor(derivedOf(s), agent('a1')))).toContain('Do BriefForVersion')
    ok(await s.p.agent(`brief ${s.lead}`))
    expect(tags(nextFor(derivedOf(s), agent('a1')))).not.toContain('Do BriefForVersion')
  }, 30000)
})

// Live, 2026-11-15: the lead of a working writer had a ready step to free it, shown again each
// minute; a claim is freed only when its holder stopped.
describe('a working claim is freed only when its holder stopped', () => {
  test('while the writer works, its lead waits', async () => {
    const s = await harness.withWriter()
    ok(await s.p.agent(`brief ${s.writer}`))
    expect(tags(nextFor(derivedOf(s), agent('a1')))).toContain('Wait MakerWorking')
  }, 30000)
})

describe('the reviewers of a result', () => {
  test('a maker may not assign a reviewer of its own result', async () => {
    const s = await writerReported()
    const refused = await s.p.agent(`assign ${s.writer} t1 --role=linter`)
    expect(refused.err).toContain('a2 makes t1; a maker does not choose who reviews its result')
    expect(ok(await s.p.agent(`next ${s.writer}`)).out).not.toContain('work assign')
  }, 30000)

  test('one checker of a role checks a task at a time', async () => {
    const s = await rejected()
    const refused = await s.p.agent(`assign ${s.lead} t1 --role=linter`)
    expect(refused.err).toContain('a3 of linter reviews t1 already')
  }, 30000)
})

// --- every wait has a mover ----------------------------------------------------------------------

// The assignment that a wait on a maker or a checker names.
const subjectOf = (what: StepWhat): AssignmentId | undefined => {
  switch (what._tag) {
    case 'MakerWorking':
    case 'GiveMakerCommand':
      return what.maker
    case 'CheckerWorking':
    case 'GiveCheckerCommand':
      return what.checker
    case 'ChangeWaitsForDirector':
      return what.director ?? undefined
    default:
      return undefined
  }
}
// Its parent starts a subagent: a wait that prints the command of the start is its own act.
const starts = (step: NextStep, x: AssignmentId): boolean =>
  (step.what._tag === 'GiveMakerCommand' || step.what._tag === 'GiveCheckerCommand') &&
  step.what.ownChild &&
  subjectOf(step.what) === x
const open = (d: Derived, w: Work) =>
  [...w.assignments.values()].filter((a) => d.states.assignments.get(a.id)?._tag !== 'Ended')
// x moves: it has a Do step; or its parent has a Do step or starts it; or the person gave it.
const moves = (d: Derived, w: Work, x: AssignmentId): boolean => {
  const a = w.assignments.get(x)
  if (a === undefined) return false
  if (nextFor(d, agent(x)).some((s) => s._tag === 'Do')) return true
  if (a.parent._tag === 'GivenByPerson') return true
  return nextFor(d, agent(a.parent.id)).some((s) => s._tag === 'Do' || starts(s, x))
}

describe('every wait has a mover', () => {
  const built: Array<{ readonly name: string; readonly d: Derived }> = []
  beforeAll(async () => {
    for (const [, make] of SCENARIOS) {
      const s: Scenario = await make()
      built.push({ name: s.name, d: derive(momentOf(s.p.dir, s.at)) })
    }
    built.push({ name: 'p9', d: derivedOf(await rejected()) })
    built.push({ name: 'b6-open', d: derivedOf(await pointEscalated()) })
    built.push({ name: 'b6-resolved', d: derivedOf(await pointResolved()) })
  }, 240000)

  test('no open assignment only waits on itself', () => {
    for (const { name, d } of built) {
      for (const a of open(d, d.moment.work)) {
        const steps = nextFor(d, agent(a.id))
        const self = steps.filter((s) => s._tag === 'Wait' && subjectOf(s.what) === a.id)
        const stuck = steps.length > 0 && self.length === steps.length
        expect([name, a.id, stuck]).toEqual([name, a.id, false])
      }
    }
  })

  test('a wait on a maker or a checker names one that moves', () => {
    let checked = 0
    for (const { name, d } of built) {
      const w = d.moment.work
      for (const a of open(d, w)) {
        for (const step of nextFor(d, agent(a.id))) {
          const x = subjectOf(step.what)
          if (step._tag !== 'Wait' || x === undefined || starts(step, x)) continue
          checked++
          expect([name, a.id, step.what._tag, x, moves(d, w, x)]).toEqual([
            name,
            a.id,
            step.what._tag,
            x,
            true,
          ])
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

// Live, 2026-11-15: the lead, the writer and the checkers each escalated the same point after
// another had escalated it (and it was resolved). One escalation of a point serves everyone (B6).
const why = '--reason="v2.1 needs a direction change"'
// The linter a3 rejects r1 with a point that no rule covers (v2.1), and escalates it as v3.
const pointEscalated = async (files?: Record<string, string>) => {
  const s = await harness.reported(files)
  ok(await s.p.agent(`review ${s.linter} r1 reject --point="the reader cannot see the cost"`))
  ok(await s.p.agent(`escalate ${s.linter} --result=r1 --point=v2.1 ${why}`))
  return s
}
// ... and the lead a1 resolves v3 with no draft.
const pointResolved = async () => {
  const s = await pointEscalated()
  ok(await s.p.agent(`resolve ${s.lead} v3 --resolution="the cost is out of scope"`))
  return s
}
const escalates = (d: Derived, id: string) =>
  tags(nextFor(d, agent(id))).filter((x) => x.includes('EscalateForPoint'))

describe('a point that one assignment escalated needs no escalation from another', () => {
  test('the escalate step names the point', async () => {
    const s = await harness.reported()
    ok(await s.p.agent(`review ${s.linter} r1 reject --point="the reader cannot see the cost"`))
    expect(ok(await s.p.agent(`next ${s.lead}`)).out).toContain(
      `work escalate ${s.lead} --result=r1 --point=v2.1 ${why}`,
    )
  }, 30000)
  test('while the escalation is open, the others wait for it', async () => {
    const s = await pointEscalated()
    const d = derivedOf(s)
    for (const id of ['a1', 'a2', 'a3']) expect(escalates(d, id)).toEqual([])
    expect(tags(nextFor(d, agent('a2')))).toEqual(['Wait ChangeWaitsForEscalation'])
    expect(ok(await s.p.agent(`next ${s.lead}`)).out).toContain(
      'v2.1 needs a direction change; it is escalated in v3; wait until it is resolved',
    )
    const again = await s.p.agent(`escalate ${s.lead} --result=r1 --point=v2.1 ${why}`)
    expect(again.err).toContain('v2.1 is escalated in v3 already')
  }, 30000)
  test('an escalation that names no point leaves the point to escalate', async () => {
    const s = await harness.reported()
    ok(await s.p.agent(`review ${s.linter} r1 reject --point="the reader cannot see the cost"`))
    ok(await s.p.agent(`escalate ${s.linter} --result=r1 --reason="the facts are thin"`))
    expect(escalates(derivedOf(s), 'a2')).toEqual(['Do EscalateForPoint'])
  }, 30000)
  test('after its resolve, nobody escalates the point again; they wait on its owner', async () => {
    const s = await pointResolved()
    const d = derivedOf(s)
    for (const id of ['a1', 'a2', 'a3']) expect(escalates(d, id)).toEqual([])
    expect(tags(nextFor(d, agent('a2')))).toEqual(['Wait ChangeWaitsForDirector'])
    const again = await s.p.agent(`escalate ${s.lead} --result=r1 --point=v2.1 ${why}`)
    expect(again.err).toContain('v2.1 was escalated in v3, and it is resolved')
    // No role of the tree directs: the person changes it.
    expect(ok(await s.p.nanda('waiting')).out).toContain('v2.1 needs a change of tsd-writing')
  }, 30000)
  test('after its resolve, the role that directs drafts the change', async () => {
    const s = await pointEscalated()
    const arch = tokenIn(ok(await s.p.nanda('assign t1 --role=architect')).out)
    ok(await s.p.agent(`brief ${arch}`))
    ok(await s.p.agent(`resolve ${s.lead} v3 --resolution="the architect changes the direction"`))
    const d = derivedOf(s)
    const director = arch.split('.')[0] as string
    expect(tags(nextFor(d, agent(director)))).toContain('Do ReviseForPoint')
    const waits = nextFor(d, agent('a2')).map((x) => x.what)
    const what = { _tag: 'ChangeWaitsForDirector', point: 'v2.1', director, first: false }
    expect(waits).toEqual([what] as never)
  }, 30000)
})
