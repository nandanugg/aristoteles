// Round 8, attacker E. Rules: "next and waiting name the assign when a decider role has no open
// assignment" (round 7, C-O2), and "decide ... read at work init" with "init refuses the rest"
// (round 7, C-C1/C-C2 for approvedBy). Each test expects the CORRECT behaviour, so it fails while
// the fault is there.
import { describe, expect, test } from 'bun:test'
import { init, INTRO_V2, ok, project, tokenIn, WORK_YAML } from
  './harness.js'

const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const PROOFREADER = `  proofreader:
    tier: low
    description: Reads one section and decides it after the lead.
    intro: You read one section.
    responsibilities:
      - Accept or reject the section with work review.
    acts: [{ approve: [writer] }]
`

// The lead runs t1; the writer reported r1; the linter and the lead accepted it.
async function decidedByLead(yaml, roles) {
  const p = project({ 'aristoteles.yaml': yaml })
  await init(p)
  for (const role of roles) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
  ok(await p.agent(`brief ${lead}`))
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V2)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
  ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
  return { p, lead }
}

describe('E8 decide order [section-lead, proofreader] with a low decider: the printed assign is the person\'s, and it is refused', () => {
  test('next tells the lead that the person assigns a proofreader; waiting gives the person an assign that is refused', async () => {
    const yaml = `${WORK_YAML}${PROOFREADER}decide:\n  - { resultsOf: writer, by: { order: [section-lead, proofreader] } }\n`
    const { p, lead } = await decidedByLead(yaml, ['architect', 'section-lead', 'writer', 'linter', 'proofreader'])
    expect(ok(await p.agent('blockers r1')).out).toContain('no accept yet by proofreader')
    const leadNext = ok(await p.agent(`next ${lead}`)).out
    const waiting = ok(await p.nanda('waiting')).out
    // Run the assign that waiting prints for the person, if it prints one.
    const personAssign = waiting.match(/work assign (t\d+) --role=proofreader/)
    const ran = personAssign ? await p.nanda(`assign ${personAssign[1]} --role=proofreader`) : undefined
    // Correct: the step works. The lead (medium) gives a low role its work, so its next says
    // "work assign <lead token> t1 --role=proofreader"; a step printed for the person runs.
    // Today next says "the person assigns one", and the person's assign is refused ("the person
    // gives work to a medium or high role; proofreader is low, so a lead gives it its work").
    if (ran) expect(ran.err).toBe('')
    expect(leadNext).toMatch(/work assign a\d+\.[a-z0-9]+ t1 --role=proofreader/)
  })
})

describe('E9 two decide entries for the results of one role: init keeps the first and drops the second', () => {
  test('decide writer by section-lead, then writer by architect: init passes, and r1 is Accepted with no architect', async () => {
    const yaml = `${WORK_YAML}decide:\n  - { resultsOf: writer, by: section-lead }\n  - { resultsOf: writer, by: architect }\n`
    const p = project({ 'aristoteles.yaml': yaml })
    const init = await p.nanda('init')
    // Correct: init refuses an entry that it would not use (or both entries apply, and r1 also
    // waits for the architect). Today the second entry is read and never used.
    if (init.code === 0) {
      for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
      ok(await p.nanda('task open --file=task.yaml'))
      const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
      ok(await p.agent(`brief ${lead}`))
      const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
      ok(await p.agent(`brief ${writer}`))
      p.write('docs/tsd.md', INTRO_V2)
      ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
      const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
      ok(await p.agent(`brief ${linter}`))
      ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
      ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
      expect(ok(await p.agent('task show t1')).out).not.toContain('Accepted')
    } else {
      expect(init.err).toContain('decide 1 already says who decides writer')
    }
  })
})
