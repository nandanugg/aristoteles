// Round 9, attacker G. Rules (DESIGN sections 6 and 8): `work recheck <you> <r> --reason=<what
// changed outside>` is the "Recheck after a change outside" (a source revision that `work source`
// records, or newer work of a needed task, as `next` prints it); "Only a fault uses an attempt ...
// A recheck ... use[s] none", and "When a fault uses the last attempt, the task waits for an
// evaluation". The recheck handler takes any reason with no change outside, so a decider that
// answers each report with a recheck gives a maker with one try any number of tries, and no fault
// is ever recorded, so the mistake is never evaluated.
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, ok, started, tokenIn } from
  './harness.js'

describe('G12 a recheck with no change outside gives a maker endless tries with no evaluation', () => {
  test('a2 has one try; the lead rechecks r1 and r2 with nothing changed outside; a2 reports r3', async () => {
    const { p, lead } = await started()
    const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    // No source changed: nobody ran work source, t1 needs no task, the version is the same.
    const recheck = await p.agent(`recheck ${lead} r1 --reason="look at it again"`)
    // Correct: a recheck names a change outside, so this one is refused (the lead rejects r1, and
    // the fault uses a2's one try). Today: v1 asks for a new result, and a2 goes on.
    if (recheck.code === 0) {
      ok(await p.agent(`brief ${w}`))
      p.write('docs/tsd.md', INTRO_V1.replace('ran twice', 'ran two times'))
      ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
      ok(await p.agent(`recheck ${lead} r2 --reason="look at it again"`))
      ok(await p.agent(`brief ${w}`))
      p.write('docs/tsd.md', INTRO_V1.replace('ran twice', 'ran 2 times'))
      ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
      // a2 made three results (r1, r2, r3) on its one try, none of them is a fault, and nothing
      // waits for an evaluation.
      expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('evaluat')
    }
    expect(recheck.code).not.toBe(0)
  }, 20000)
})
