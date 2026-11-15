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
const derivedOf = (s: { readonly p: { readonly dir: string; readonly now: () => string } }) =>
  derive(momentOf(s.p.dir, s.p.now() as Time))
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
