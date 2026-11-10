// Round 9, attacker G. Rule (DESIGN section 8, "Evaluation"): "After a maker's last try, an
// evaluation does not reopen the work by itself: the next maker starts only when its inputs differ
// from those of the maker that failed: ... or the task is remade or split." Task.remake makes a new
// task with no check that anything changed: a high agent remakes the failed task from the same
// task file (same name, text, directions, context, workspace, needs), and the new task's maker
// starts on exactly the inputs that failed.
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, ok, started, tokenIn } from
  './harness.js'

describe('G6 a remake that changes nothing reopens the task after its last try', () => {
  test('a2 fails its one try; the architect evaluates, then remakes t1 from the same task.yaml; t2 takes a writer on the same inputs', async () => {
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
    ok(await p.agent(`evaluate ${arch} t1 --wrong="r1 cites the ticket" --why="the task text does not say that ids stay out" ` +
      '--improve="the task text says that ticket ids stay out of the body" --level=task'))
    expect((await p.agent(`assign ${lead} t1 --role=writer`)).err).toContain('t1 has the inputs that failed in the last try of a2')
    // The remake names the same file that opened t1: nothing that the failed maker read changes.
    const remake = await p.agent(`task remake ${arch} t1 --file=task.yaml --reason="the evaluation asks for a remake"`)
    // Correct: the work does not go on with the inputs that failed (the remake is refused, or the
    // new task waits for a change too). Today: t1 is remade as t2 with the same text, and a new
    // lead gives t2 a writer.
    if (remake.code === 0) {
      const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=region-lead')).out)
      ok(await p.agent(`brief ${lead2}`))
      const assign = await p.agent(`assign ${lead2} t2 --role=writer --max-attempts=1`)
      expect(assign.code).not.toBe(0)
      expect(assign.err).toContain('the inputs that failed')
    } else {
      expect(remake.err).toContain('t1')
    }
  }, 20000)
})
