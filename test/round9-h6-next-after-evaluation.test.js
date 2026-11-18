// Round 9, attacker H: "next, waiting, and the brief must always give a correct next step" after a
// mistake is evaluated (DESIGN section 8, "Evaluation"). The step that the words print for an
// evaluated task (evaluationStep) does not look at what was already done for it, or at what its
// reader may do: it repeats a revise while the version waits for its approval, repeats "remake
// or split" after the split, offers a split that a task with a section refuses, and sends a high
// role with no change act into an escalation loop where work waiting shows the person nothing. Each test
// expects the CORRECT behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, TASK, TASK_WHOLE, ok, reported, started, tokenIn } from
  './harness.js'

const GRANT = 'grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z'

// t1's writer (one try) used it on a fault, so t1 waits for an evaluation; the person assigned the
// architect (a4), with a change grant on t1 and tsd-writing when grant is true.
async function exhausted(task, grant = true) {
  const { p, lead } = await started({ 'task.yaml': task })
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V1)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
  if (grant) ok(await p.nanda(GRANT, 'grant'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  return { p, lead, arch }
}
const evaluate = (arch, level, improve) => `evaluate ${arch} t1 --wrong="r1 cites the ticket ABC-2964" ` +
  `--why="the task text asks for the facts of the ticket" --improve="${improve}" --level=${level}`

describe('H6 work next after an evaluation', () => {
  test('the person rejects r1 with a rule; the evaluate command says a change must come first, while next says the maker redoes now', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes there" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids there"'))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    ok(await p.nanda('review r1 reject --point="the introduction does not say which merchant" --breaks=repeatable'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    const out = ok(await p.agent(`evaluate ${arch} t1 --wrong="r1 names no merchant" --why="the writer left the merchant out" ` +
      '--improve="name the merchant" --level=task')).out
    // The work goes on at once: changed work with evidence for repeatable answers the point.
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('redo t1: give a new subagent the command of a2')
    // Correct: the evaluate command says the same, and does not send the architect to make a change first.
    expect(out).not.toContain('The next maker starts after a change')
  }, 20000)

  test('a task with no directions, evaluated at the level standard: waiting prints a revise of no direction and an accept of undefined', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK.replace('directions: [tsd-writing]', 'directions: []') })
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`review ${lead} r1 reject --point="the first line cites a ticket"`))
    ok(await p.nanda('evaluate t1 --wrong="r1 cites a ticket" --why="no standard says it" --improve="a standard against ids" --level=standard'))
    // Correct: every printed command names real ids; t1 follows no direction, so no revise changes
    // its inputs (only a remake does).
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).not.toContain('accept undefined')
    expect(waiting).not.toContain('undefined@')
    expect(waiting).not.toContain('work direction revise  --file')
  }, 20000)
})
