// Round 8, attacker E. Rule (round 7, C-O1): "A decider that also checks a rule of the task may give
// that evidence before its turn in an order; it decides again at its turn." Order: "an item decides
// only after the items before it accepted"; "the decider may Reject instead" (a Reject is a
// decision). The fix in Review.decide skips the turn check for every act of a decider that checks
// any rule (checksOf(by).length > 0), so the second decider decides (rejects) before the first.
import { describe, expect, test } from 'bun:test'
import { init, INTRO_V2, ok, project, tokenIn, WORK_YAML } from
  './harness.js'

const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'

describe('E5 decide order [architect, region-lead]: the lead rejects r1 before the architect decides', () => {
  test('the lead (which checks repeatable) rejects with a point that names no rule, and ends the writer\'s round', async () => {
    const p = project({ 'work.yaml': `${WORK_YAML}decide:\n  - { resultsOf: writer, by: { order: [architect, region-lead] } }\n` })
    await init(p)
    for (const role of ['architect', 'region-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    const lead = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=region-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    // The architect decides first; it has not decided r1 yet.
    expect(ok(await p.agent('blockers r1')).out).toContain('no accept yet by architect')
    // The lead decides r1 out of turn: a Reject with no rule (no evidence for a rule it checks).
    const reject = await p.agent(`review ${lead} r1 reject --point="the story is not told first"`)
    const waiting = ok(await p.nanda('waiting')).out
    // Today: the reject is stored, it uses the writer's one attempt, and q1 ends the round before
    // the architect had its turn.
    expect(`${reject.err}\n${waiting}`).not.toContain('(the end of a round)')
    // Correct: the lead decides after the accept of the architect, as for an accept.
    expect(reject.err).toContain('decides this result after the accept of architect')
  })
})
