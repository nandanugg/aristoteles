// Round 9, attacker H: "a maker that writes a file needs the workspace of its task" (DESIGN
// section 11, round 8). work assign checks it only for a role whose output form has the words
// <file> or <repo>. A role whose output names its file as it is (output: "docs/tsd.md#<region>")
// is assigned on a task with no workspace: it is outside the file queue, so it takes its brief
// and writes docs/tsd.md while another maker holds that file, and then its report is refused
// (the file is not in the workspace), so it can never report. The test expects the CORRECT
// behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, WORK_YAML, ok, started, tokenIn } from
  './harness.js'

const SCRIBE = '  scribe:\n    tier: low\n    description: Writes the design of the TSD.\n    intro: You write the design.\n' +
  '    responsibilities:\n      - Write the region under its heading in docs/tsd.md.\n    output: "docs/tsd.md#<region>"\n' +
  '    acts: [{ do: write the design }]\n'

describe('H5 a maker whose output names its file in words, on a task with no workspace', () => {
  test('the scribe of t2 (no workspace) is assigned and briefed while a2 holds docs/tsd.md, and its report is refused for ever', async () => {
    const yaml = WORK_YAML.replace('acts: [{ approve: [writer] }]', 'acts: [{ approve: [writer, scribe] }]').replace('  linter:\n', `${SCRIBE}  linter:\n`)
    const { p, lead } = await started({ 'work.yaml': yaml })
    ok(await p.nanda('role fit scribe --answers=fit.yaml'))
    // a2 holds docs/tsd.md (t1 names it in its workspace).
    const first = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${first}`))
    p.write('design.yaml', 'name: The Design\ntext: Write the Design.\ndirections: [tsd-writing]\ncontext: { region: design }\n')
    ok(await p.nanda('task open --file=design.yaml'))
    const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=region-lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const assign = await p.agent(`assign ${lead2} t2 --role=scribe`)
    // Correct: refused, as for the writer in test/round8-f-queue-paths.test.js (F-Q2): the scribe
    // writes docs/tsd.md, and t2 names no workspace.
    expect(assign.code).toBe(1)
    expect(assign.err).toContain('t2 names no workspace')
  }, 20000)
})
