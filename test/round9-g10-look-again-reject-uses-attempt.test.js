// Round 9, attacker G. Rule (DESIGN section 11, round 8): "A result that its deciders decided once
// uses no attempt, also when a later criticism makes them look again." `used` in engine.js counts a
// result that has any fault review, decided or not. The person's criticism of t1 makes the lead
// look again at r1 (its earlier accept stops counting); when the lead's look ends in a Reject, r1
// uses the writer's attempt, and with one try that fault is recorded as the last try of a2: t1
// waits for a second evaluation of the mistake that the person's evaluation already covered.
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, ok, started, tokenIn } from
  './harness.js'

const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the region" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the region"'
const REPEATABLE = '--evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export"'

describe('G10 a decided result uses an attempt when its decider looks again after a criticism and rejects it', () => {
  test('r1 is decided; Nanda criticises t1 and evaluates it; the lead looks again and rejects r1; a2 shows 1/1 and t1 waits for a new evaluation', async () => {
    const { p, lead } = await started()
    const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    ok(await p.nanda('review t1 reject --point="the introduction misses the impact on the merchant"'))
    ok(await p.nanda('evaluate t1 --wrong="the introduction misses the impact" --why="no standard asks for it" ' +
      '--improve="a standard for the impact" --level=standard'))
    expect(ok(await p.agent('status')).out).toContain('a2 writer (low) on t1 · attempts 0/1')
    // The criticism makes the lead look again; it agrees with Nanda and rejects r1.
    ok(await p.agent(`review ${lead} r1 reject --point="looking again: the impact on the merchant is missing"`))
    // Correct: r1 was decided once, so it uses no attempt, and nothing new waits for an
    // evaluation. Today: "attempts 1/1", and the lead's next says that t1 waits for an evaluation of
    // the last try of a2.
    expect(ok(await p.agent('status')).out).toContain('a2 writer (low) on t1 · attempts 0/1')
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('used its last try on a fault')
  }, 20000)
})
