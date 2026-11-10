// Round 9, attacker H: "next, waiting, and the brief must always give a correct next step" after a
// mistake is evaluated (DESIGN section 8, "Evaluation"). The step that render.js prints for an
// evaluated task (evaluationStep) does not look at what was already done for it, or at what its
// reader may do: it repeats a revise while the version waits for its approval, repeats "remake
// or split" after the split, offers a split that a task with a region refuses, and sends a high
// role with no change act into a raise loop where work waiting shows the person nothing. Each test
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
  test('level standard: after the architect drafts d2, next still prints the revise, not the draft that waits', async () => {
    const { p, arch } = await exhausted(TASK_WHOLE)
    ok(await p.agent(evaluate(arch, 'standard', 'a standard says that ticket ids stay out of the body')))
    expect(ok(await p.agent(`next ${arch}`)).out).toContain(`work direction revise ${arch} tsd-writing --file=<edit.yaml>`)
    p.write('edit.yaml', 'add:\n  - id: plain\n    says: The body names no ticket.\n    rules:\n' +
      '      - { id: no-ids-in-body, says: "No ticket ids in the body", checkedBy: linter }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    // Correct: the change is drafted, so next says that d2 waits for its accept
    // (as changeStep does), and does not ask for the same revise again (a second draft).
    const next = ok(await p.agent(`next ${arch}`)).out
    expect(next).toContain('d2 waits for the accept of Nanda')
    expect(next).not.toContain(`work direction revise ${arch} tsd-writing --file=<edit.yaml>`)
  }, 20000)

  test('level task: after the architect splits t1 as next said, next still says to remake or split t1 (a remake closes the new parts)', async () => {
    const { p, arch } = await exhausted(TASK_WHOLE)
    ok(await p.agent(evaluate(arch, 'task', 'split the TSD into its regions')))
    expect(ok(await p.agent(`next ${arch}`)).out).toContain(`work task split ${arch} t1 --file=<parts.yaml>`)
    p.write('parts.yaml', '- { name: Intro, text: Write the introduction., context: { region: introduction } }\n' +
      '- { name: Design, text: Write the design., context: { region: design } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    // Correct: t1 now waits for its parts t2 and t3; the evaluation's change is made.
    const next = ok(await p.agent(`next ${arch}`)).out
    expect(next).not.toContain('remake or split it')
    expect(next).not.toContain(`work task remake ${arch} t1`)
  }, 20000)

  test('level task on a task with a region: next offers work task split, which the split refuses', async () => {
    const { p, arch } = await exhausted(TASK)
    ok(await p.agent(evaluate(arch, 'task', 'the task text names no ticket')))
    const next = ok(await p.agent(`next ${arch}`)).out
    expect(next).toContain(`work task remake ${arch} t1`)
    // Correct: a task with a region is one unit and is not split, so next offers only the remake.
    expect(next).not.toContain(`work task split ${arch} t1`)
  }, 20000)

  test('level task, and the architect has no change act: next says raise; the person answers; then nothing waits, and next says raise again', async () => {
    const { p, arch } = await exhausted(TASK, false)
    ok(await p.agent(evaluate(arch, 'task', 'the task text names no ticket')))
    const raise = ok(await p.agent(`next ${arch}`)).out.match(/work raise (\S+ --reason="[^"]*")/)
    expect(raise).not.toBeNull()
    ok(await p.agent(`raise ${raise[1]}`))
    // The person sees only the question; the remake that the evaluation asks for is not printed.
    expect(ok(await p.nanda('waiting')).out).toContain('q1 for Nanda: t1 needs the remake that ev1 asks for')
    ok(await p.nanda('answer q1 --text="yes, remake it"'))
    // Correct: t1 still waits for a remake that only the person (or a change grant) can make, so
    // work waiting gives the person that step; it is not "nothing waits".
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).not.toBe('nothing waits.')
    expect(waiting).toContain('work task remake t1')
  }, 20000)

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
