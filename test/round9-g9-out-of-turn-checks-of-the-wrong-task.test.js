// Round 9, attacker G. Rule (DESIGN section 11, round 8): "In an order of deciders, a decider
// before its turn only checks its own rules: an accept with that evidence, or a Reject that breaks
// one of them." Review.decide reads those rules with checksOf(by), which takes the rules of the
// decider's own assignment task, not of the result's task. A lead on the whole TSD (t1, no section)
// that decides the parts is refused its own rule `repeatable` on the result of the Intro part
// (section introduction): the same Reject is taken when the lead is assigned on the part itself.
import { describe, expect, test } from 'bun:test'
import { init, INTRO_V2, ok, project, TASK_WHOLE, tokenIn, WORK_YAML } from
  './harness.js'

const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the section" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the section"'
const PARTS = '- { name: Intro, text: Write the introduction., context: { section: introduction } }\n' +
  '- { name: Design, text: Write the design., context: { section: design } }\n'

describe('G9 order [architect, section-lead]: the lead of the whole TSD may not check its own rule of a part before its turn', () => {
  test('repeatable (checkedBy section-lead) is a rule of t2; the lead on t1 rejects r1 of t2 for it before the architect, and is refused', async () => {
    const p = project({ 'aristoteles.yaml': `${WORK_YAML}decide:\n  - { resultsOf: writer, by: { order: [architect, section-lead] } }\n`, 'task.yaml': TASK_WHOLE })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    p.write('parts.yaml', PARTS)
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    const lead = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=section-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    const w = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    // repeatable applies to t2 (section introduction) and names the lead's role as its checker.
    expect(ok(await p.agent(`assignment show a3`)).out).toContain("repeatable     A reviewer can repeat the problem without the design  (section-lead)")
    const reject = await p.agent(`review ${lead} r1 reject --point="a reader cannot repeat the double export from it" --breaks=repeatable`)
    // Correct: the Reject breaks a rule that the lead checks, so it is taken before its turn (as it
    // is for a lead assigned on t2). Today: "section-lead decides this result after the accept of
    // architect".
    expect(reject.err).not.toContain('decides this result after the accept of architect')
    expect(reject.code).toBe(0)
  }, 20000)
})
