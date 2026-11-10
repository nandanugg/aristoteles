// Round 7, attacker C: the decide and approvedBy fixes of 2026-11-07, and the question that goes
// up when its assignment finishes. Each test expects the CORRECT behaviour (a printed step that
// works, or someone who can act), so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, init, INTRO_V2, ok, project, started, tokenIn, withWriter, WORK_YAML } from
  './harness.js'

const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const READ = '--evidence="docs/tsd.md, the introduction | it tells the problem in plain words"'
const fitAll = async (p) => {
  for (const role of ['architect', 'region-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
}

// The architect is the parent of the region lead; the lead runs the writer and the linter, and
// the linter accepted r1.
async function underArchitect(decide) {
  const p = project({ 'work.yaml': `${WORK_YAML}decide:\n  - { resultsOf: writer, by: ${decide} }\n` })
  await init(p)
  await fitAll(p)
  ok(await p.nanda('task open --file=task.yaml'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  const lead = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=region-lead`)).out)
  ok(await p.agent(`brief ${lead}`))
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V2)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
  return { p, arch, lead }
}

describe('C-O1 decide order [architect, region-lead]: the lead checks its own rule out of turn', () => {
  test('the only printed step (the lead checks repeatable) is refused, and the architect gets no decide step', async () => {
    const { p, arch, lead } = await underArchitect('{ order: [architect, region-lead] }')
    const leadNext = ok(await p.agent(`next ${lead}`)).out
    const archNext = ok(await p.agent(`next ${arch}`)).out
    expect(leadNext).toContain('check r1 yourself')
    // The lead runs its printed step: its evidence for repeatable, the rule that names its role.
    const check = await p.agent(`review ${lead} r1 accept ${REPEATABLE}`)
    // Correct: a printed step works, or the architect is told to decide first.
    expect(check.code === 0 || archNext.includes('decide r1')).toBe(true)
  })
})

describe('C-O2 decide order [region-lead, architect] when no architect works on the task', () => {
  test('after the lead accepts, nothing says that r1 waits for an architect, nor how to get one', async () => {
    const yaml = `${WORK_YAML}decide:\n  - { resultsOf: writer, by: { order: [region-lead, architect] } }\n`
    const { p, lead } = await started({ 'work.yaml': yaml })
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    expect(ok(await p.agent('blockers r1')).out).toContain('no accept yet by architect')
    // The lead (medium) cannot assign a high role; the person can. Someone must be told.
    const steps = [ok(await p.agent(`next ${lead}`)).out, ok(await p.nanda('waiting')).out].join('\n')
    expect(steps).toContain('architect')
  })
})

describe('C-V1 approvedBy order [architect, Nanda] when the architect suggests the version', () => {
  // DESIGN section 8 names this approvedBy, and section 2 says that the high role suggests.
  test('next tells the suggester to review its own version, and waiting offers an approve; both are refused', async () => {
    const direction = DIRECTION.replace('from: [Pathos, Logos]\n',
      'from: [Pathos, Logos]\napprovedBy: { order: [architect, Nanda] }\n')
    const { p } = await started({ 'directions/tsd-writing.yaml': direction })
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: units, says: Numbers have units. }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const archNext = ok(await p.agent(`next ${arch}`)).out
    const waiting = ok(await p.nanda('waiting')).out
    const ran = []
    if (archNext.includes('direction review') && archNext.includes('tsd-writing@2')) {
      ran.push(await p.agent(`direction review ${arch} s1 accept --reason="precise: it names the units"`))
    }
    if (waiting.includes('work direction approve s1')) {
      ran.push(await p.nanda('direction approve s1 --why="name the units"', 'approve'))
    }
    // Correct: each step that next and waiting print for tsd-writing@2 runs; when none is printed,
    // they say how to get the review that it waits for (an architect outside the suggester's tree).
    for (const r of ran) expect(r.err).toBe('')
    if (ran.length === 0) expect(`${archNext}\n${waiting}`).toMatch(/assign[^\n]*architect/)
  })
})

describe('C-Q1 a relayed question to an assignment that finished', () => {
  test('the top agent relays the person\'s question to a finished writer; nobody can answer it, and t1 waits for ever', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`finish ${lead} a2`))
    // The lead is the top agent (medium, no parent, with a claim): it relays the person's question.
    const relay = await p.agent(`relay ${lead} Nanda ask a2 --quote="Which merchant got the two files?" --channel=chat`)
    // The fix (2026-11-07): a question to a finished assignment is refused.
    expect(relay.err).toContain('is finished, so it answers no question')
  })
})

describe('C-S1 a decider settles a Raise to another assignment', () => {
  // Section 6: a settle comes from "the assignment that a raise names, or a decider". The engine
  // takes an assignment for a person (isHuman of an object), so only the named assignment settles.
  test('the architect, which decides the writer\'s results, may not settle the linter\'s raise to the lead', async () => {
    const p = project()
    await init(p)
    await fitAll(p)
    ok(await p.nanda('task open --file=task.yaml'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    const lead = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=region-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`raise ${linter} --result=r1 --reason="the facts have no date for the second run"`))
    const settle = await p.agent(`review ${arch} r1 accept --settles=v2 --reason="the date is not needed"`)
    expect(settle.err).toBe('')
  })
})
