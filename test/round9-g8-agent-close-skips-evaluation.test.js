// Round 9, attacker G. Rule (Nanda, 2026-11-08, DESIGN section 8 "Evaluation"): "when mistake
// happen, the correct course would be to evaluate, not to decide"; a maker's last try on a fault
// stops the task until an evaluation, and an agent's split or remake of it waits for that
// evaluation. Task.close has no such check: the high agent whose next says "evaluate t1" closes
// t1 instead (a decision), and the mistake is never evaluated. (An agent's close is refused when
// the stop is the person's Reject, but not when it is the last try of a maker.)
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, ok, started, tokenIn } from
  './harness.js'

describe('G8 an agent closes a task that waits for the evaluation of a mistake', () => {
  test('a2 fails its one try; the architect is told to evaluate t1, and closes it instead', async () => {
    const { p, lead } = await started()
    const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
    ok(await p.nanda('grant --act=change --on=t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('evaluate t1: a2 used its last try on a fault')
    const close = await p.agent(`task close ${arch} t1 --reason="the writer cannot do it; drop the task"`)
    // Correct: the close waits for the evaluation, as a split or a remake does. Today: "t1 closed."
    expect(close.code).not.toBe(0)
    expect(close.err).toContain('waits for an evaluation')
  }, 20000)
})
