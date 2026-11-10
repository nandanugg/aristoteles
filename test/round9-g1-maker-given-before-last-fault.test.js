// Round 9, attacker G. Rule (DESIGN section 8, "Evaluation"): "a maker used its last try on a
// fault ... Until an evaluation of the task made after the event exists, no new maker starts".
// Review.decide records the Exhaustion only when no other open maker of the task exists (the
// `!another` clause). A maker whose last try waits for its first review is no longer open (openDo),
// so its parent may give the next maker at once, as the old maker's own brief tells it to. The
// fault on the last try then comes after that give, the Exhaustion is never recorded, and the new
// maker works on the same inputs with no evaluation.
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, ok, started, tokenIn } from
  './harness.js'

describe('G1 the next maker is given before the fault on the last try, so no evaluation starts', () => {
  test('a2 reports its one try; the lead gives a4 as a2\'s brief says; the linter rejects r1; a4 takes its brief with no evaluation', async () => {
    const { p, lead } = await started()
    const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    // a2's one try (r1) waits for its review. Today a2's own brief tells the lead to give a new
    // writer now: "a2 has used its 1 attempts; ... STOP and tell your parent: it assigns a new writer."
    await p.agent(`brief ${w}`)
    const give = await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)
    // The last try of a2 ends on a fault.
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
    // Correct: either the next writer is not given while a2's last try is undecided, or the fault
    // still stops t1 until an evaluation, so a4 takes no brief. Today: the give is taken, no
    // Exhaustion is recorded (a4 is open), and a4's brief is printed: attempt 1 of 1 on the same
    // version and the same task text that a2 failed on.
    if (give.code === 0) {
      const brief = await p.agent(`brief ${tokenIn(give.out)}`)
      expect(brief.out).not.toContain('work brief a4 · writer (low) · t1 The Introduction')
      expect(brief.err).toContain('t1 waits for an evaluation of the last try of a2')
    } else {
      expect(give.err).toContain('r1')
    }
  }, 20000)
})
