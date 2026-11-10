// Round 9, attacker G. Rule (DESIGN section 8, "Evaluation"): "An evaluation at the level
// direction or principle counts only after the person accepts it; at task or standard it counts
// when it is written." Evaluation.write refuses only when nothing waits; an evaluation that waits
// for the person does not count, so the stop still "waits", and the same high agent writes the
// same evaluation again at the level task. That one counts at once, and waiting drops the
// person's accept of the first (it shows only an evaluation written after the newest counted one).
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, ok, started, tokenIn } from
  './harness.js'

const SAME = '--wrong="r1 cites the ticket" --why="the spirit counts ids as facts" --improve="the spirit says that ids are not facts"'

describe('G4 an agent passes the person\'s accept of its own evaluation by writing it again at the level task', () => {
  test('ev1 (principle) waits for Nanda; the architect writes ev2 with the same words at the level task; t1 goes on and waiting is empty', async () => {
    const { p, lead } = await started()
    const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // The architect finds the cause in a principle: only Nanda's accept makes it count.
    ok(await p.agent(`evaluate ${arch} t1 ${SAME} --level=principle`))
    expect(ok(await p.nanda('waiting')).out).toContain('ev1 evaluates t1 at the level principle, and waits for your accept')
    // The same agent writes the same evaluation at the level task.
    await p.agent(`evaluate ${arch} t1 ${SAME} --level=task`)
    // Correct: t1 still waits for Nanda's accept of the principle (the second evaluation is
    // refused, or waits for her too). Today: ev2 counts at once, the lead's next says that t1 waits
    // for the change that ev2 asks for, waiting says "nothing waits", and ev1 still "waits for the
    // person" in work evaluation show.
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).not.toContain('nothing waits')
    expect(waiting).toContain('waits for your accept')
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('t1 waits for the change that ev2 asks for')
  }, 20000)
})
