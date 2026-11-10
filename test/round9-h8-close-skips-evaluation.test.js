// Round 9, attacker H: "when a fault uses the last attempt, the task waits for an evaluation", and
// an agent's split or remake of that task waits for it (DESIGN section 8, "Evaluation"). An
// agent's close of the same task does not wait: the architect closes the person's task t1 right
// after its maker's last try failed, with no evaluation, and work waiting then shows the person
// nothing. A close is a decision too ("evaluate, not decide"). The test expects the CORRECT
// behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, ok, started, tokenIn } from
  './harness.js'

describe('H8 an agent closes a task that waits for its evaluation', () => {
  test('a2 used its one try on a fault; the architect (change grant) closes t1 with no evaluation, and nothing waits', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
    ok(await p.nanda('grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // Control: the remake waits for the evaluation.
    p.write('again.yaml', 'name: The Introduction again\ntext: Write the Introduction again.\n')
    expect((await p.agent(`task remake ${arch} t1 --file=again.yaml --reason="start again"`)).err).toContain('a remake comes after it')
    const close = await p.agent(`task close ${arch} t1 --reason="not needed any more"`)
    // Correct: the close waits for the evaluation like the remake, so the mistake is evaluated first.
    expect(close.err).toContain('t1 waits for an evaluation')
    expect(close.code).toBe(1)
  }, 20000)
})
