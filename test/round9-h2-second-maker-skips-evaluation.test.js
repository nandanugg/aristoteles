// Round 9, attacker H: "a maker's last try that ends on a fault stops the task until an
// evaluation counts; until then no new maker starts" (DESIGN section 8, "Evaluation"). The
// engine records that stop only when no other open maker is on the task, and a reported result
// that waits for its review already uses the try, so the lead may assign a second writer between
// the last report and its review. The review then records no stop, and the second writer works
// on the inputs that failed, with no evaluation. The test expects the CORRECT behaviour, so it
// fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, INTRO_V2, ok, started, tokenIn } from
  './harness.js'

describe('H2 a second maker before the review of the last try skips the evaluation', () => {
  test('a2 (one try) reports r1; the lead assigns a3 before the linter rejects r1; a3 briefs and reports on the same inputs', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    // r1 waits for its review, so a2 has no try left, and the assign of a new writer is not refused.
    const second = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
    // Correct: the last try of a2 ended on a fault, so t1 waits for an evaluation: work next of the
    // lead says so, and the new writer takes no brief before it.
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('t1 waits for an evaluation')
    const brief = await p.agent(`brief ${second}`)
    expect(brief.code).toBe(1)
    expect(brief.err).toContain('t1 waits for an evaluation of the last try of a2')
    // What happens instead: a3 makes r2 on the inputs that failed, and no evaluation was written.
    p.write('docs/tsd.md', INTRO_V2)
    expect((await p.agent(`report ${second} --output=docs/tsd.md#introduction`)).code).toBe(1)
  }, 20000)

  // The same hole from the other side: work next itself prints "work finish ..., then work assign
  // ... (a new round)". A finished maker makes no more tries, so its last result is its last try;
  // when it ended on a fault, a new maker on the same inputs is the round that the evaluation
  // replaced (DESIGN section 0, "Evaluation": rounds are gone).
  test('a2 (two tries) fails once; the lead finishes it and assigns a4, which gets three new tries on the same inputs', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=2`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
    const next = ok(await p.agent(`next ${lead}`)).out
    ok(await p.agent(`finish ${lead} a2`))
    // Correct: r1 was a2's last try and ended on a fault, so the new writer waits for an evaluation.
    const assign = await p.agent(`assign ${lead} t1 --role=writer`)
    if (assign.code !== 0) expect(assign.err).toContain('t1 waits for an evaluation')
    // Another correct fix: the new writer gets only the try that a2 had left, not three new ones.
    else expect(ok(await p.agent(`brief ${tokenIn(assign.out)}`)).out).toMatch(/attempt (2 of 2|1 of 1)/)
    // Correct: there are no rounds, so next offers none.
    expect(next).not.toContain('(a new round)')
  }, 20000)
})
