// Round 9, attacker G. Rule (DESIGN section 8, "Evaluation"): "After a maker's last try, an
// evaluation does not reopen the work by itself: the next maker starts only when its inputs differ
// from those of the maker that failed: ... a task that it needs has a newer accepted result".
// sameInputs in engine.js asks only whether a needed task has an accepted result made after the
// Exhaustion; it does not compare the work. A recheck lets the needed task report the same bytes
// again (a recheck lifts "nothing changed"), and that newer, identical result reopens the task.
// The engine already treats a later result with the same digest as the same work elsewhere
// (blockerItems, kind old-need).
import { describe, expect, test } from 'bun:test'
import { TASK_WHOLE, ok, started, tokenIn } from
  './harness.js'

const TSD = (handler, flags) => `# TSD\n\n## Introduction\n\n${handler}\n\n## Design\n\n${flags}\n`
// t3 (Handler) runs after t2 (Flags and env): it needs t2's accepted work.
const PARTS = '- { name: Flags and env, text: Write the feature flag and how the env vars are read., context: { region: design } }\n' +
  '- { name: Handler, text: Write the use case and the request handler., context: { region: introduction }, after: [Flags and env] }\n'
const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`
const FLAGS = 'The flag export_v2 is read from the env var EXPORT_V2 where it is used.'

describe('G2 a newer accepted result of a needed task with the same work reopens a task after its last try', () => {
  test('t3\'s writer fails its one try; t2 is rechecked and reports the same design region again; t3 takes a new writer on the same inputs', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    p.write('parts.yaml', PARTS)
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    // t2 is accepted (r1), and its writer a2 finished.
    const flags = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${flags}`))
    p.write('docs/tsd.md', TSD('TODO', FLAGS))
    ok(await p.agent(`report ${flags} --output=docs/tsd.md#design`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the design')}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="docs/tsd.md#design | the flag and the env var are named"`))
    ok(await p.agent(`finish ${lead} a2`))
    // t3's writer a4 has one try; r2 is rejected, so t3 waits for an evaluation.
    const handler = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${handler}`))
    p.write('docs/tsd.md', TSD('The handler reads EXPORT_V2 as a string and compares it with "true".', FLAGS))
    ok(await p.agent(`report ${handler} --output=docs/tsd.md#introduction`))
    const linter3 = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=linter`)).out)
    ok(await p.agent(`brief ${linter3}`))
    ok(await p.agent(`review ${linter3} r2 reject --point="the handler parses a string flag by hand" --breaks=no-code-proof`))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    ok(await p.agent(`evaluate ${arch} t3 --wrong="r2 parses the flag by hand" --why="t2 reads the env vars where they are used" ` +
      '--improve="t2 reads the env vars through one typed function" --level=task'))
    expect((await p.agent(`assign ${lead} t3 --role=writer --max-attempts=1`)).err).toContain('t3 has the inputs that failed in the last try of a4')
    // The lead rechecks t2, and a new writer of t2 reports the design region with no change (the
    // file is not touched): r3 is the same work as r1, and it is accepted again.
    ok(await p.agent(`recheck ${lead} r1 --reason="the flags region is checked again after the evaluation of t3"`))
    ok(await p.agent(`finish ${lead} a4`))
    const again = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${again}`))
    ok(await p.agent(`report ${again} --output=docs/tsd.md#design`))
    const linter2 = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter2}`))
    ok(await p.agent(`review ${linter2} r3 accept ${LINT('the design')}`))
    ok(await p.agent(`review ${lead} r3 accept --evidence="docs/tsd.md#design | the flag and the env var are named"`))
    expect(ok(await p.agent('task show t2')).out).toContain('r3 (docs/tsd.md#design) has no blockers; it is accepted.')
    // Correct: t2's accepted work is the same as before, so t3 still has the inputs that failed.
    // Today the assign is taken (a9), and its writer reads the same t2 work and the same version.
    const assign = await p.agent(`assign ${lead} t3 --role=writer --max-attempts=1`)
    expect(assign.code).not.toBe(0)
    expect(assign.err).toContain('t3 has the inputs that failed in the last try of a4')
  }, 30000)
})
