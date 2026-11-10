// Round 9, attacker G. Rule (DESIGN section 8, "Evaluation"): "the next maker starts only when its
// inputs differ from those of the maker that failed: ... a task that it needs has a newer accepted
// result". sameInputs looks for a needed result accepted after the Exhaustion (the time of the
// fault), not after the failed result was made. When the needed task gets newer accepted work
// between the failed report and its review, the failed maker used the old work, the next maker
// would read the new work, and still the CLI says that the task "has the inputs that failed".
import { describe, expect, test } from 'bun:test'
import { TASK_WHOLE, ok, started, tokenIn } from
  './harness.js'

const TSD = (handler, flags) => `# TSD\n\n## Introduction\n\n${handler}\n\n## Design\n\n${flags}\n`
// t3 (Handler) runs after t2 (Flags and env): it needs t2's accepted work.
const PARTS = '- { name: Flags and env, text: Write the feature flag and how the env vars are read., context: { region: design } }\n' +
  '- { name: Handler, text: Write the use case and the request handler., context: { region: introduction }, after: [Flags and env] }\n'
const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`
const FLAGS = 'The flag export_v2 is read from the env var EXPORT_V2 where it is used.'
const TYPED = 'The flag export_v2 is read once, through the typed function config.exportV2().'
const HANDLER = 'The handler reads EXPORT_V2 as a string and compares it with "true".'

describe('G11 a needed task got newer accepted work before the fault, and the task still has "the inputs that failed"', () => {
  test('r2 of t3 is made on r1 of t2; t2 is accepted again with new work r3; then r2 fails; after the evaluation t3 takes no writer', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    p.write('parts.yaml', PARTS)
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    const flags = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${flags}`))
    p.write('docs/tsd.md', TSD('TODO', FLAGS))
    ok(await p.agent(`report ${flags} --output=docs/tsd.md#design`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the design')}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="docs/tsd.md#design | the flag and the env var are named"`))
    ok(await p.agent(`finish ${lead} a2`))
    // t3's writer a4 (one try) reports r2 on the work of r1.
    const handler = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${handler}`))
    p.write('docs/tsd.md', TSD(HANDLER, FLAGS))
    ok(await p.agent(`report ${handler} --output=docs/tsd.md#introduction`))
    // Before r2 is reviewed, the lead rejects r1 of t2, and t2 is accepted again with other work:
    // r3 reads the flag through a typed function.
    ok(await p.agent(`review ${lead} r1 reject --point="the body names the env var where it is read, a code detail" --breaks=no-code-proof`))
    ok(await p.agent(`finish ${lead} a4`))
    const again = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${again}`))
    p.write('docs/tsd.md', TSD(HANDLER, TYPED))
    ok(await p.agent(`report ${again} --output=docs/tsd.md#design`))
    const linter2 = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter2}`))
    ok(await p.agent(`review ${linter2} r3 accept ${LINT('the design')}`))
    ok(await p.agent(`review ${lead} r3 accept --evidence="docs/tsd.md#design | the typed function is named"`))
    expect(ok(await p.agent('blockers r2')).out).toContain('r2 was made before r3 of t2 (Flags and env)')
    // Now r2 (made on r1) is rejected: the last try of a4 ends on a fault, and the architect
    // evaluates it.
    const linter3 = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=linter`)).out)
    ok(await p.agent(`brief ${linter3}`))
    ok(await p.agent(`review ${linter3} r2 reject --point="the handler parses a string flag by hand" --breaks=no-code-proof`))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    ok(await p.agent(`evaluate ${arch} t3 --wrong="r2 parses the flag by hand" --why="r2 was made on the old flags of r1" ` +
      '--improve="make the handler on the typed function of r3" --level=task'))
    // Correct: the next writer reads r3, which a4 never had, so its inputs differ and it starts.
    // Today: "t3 has the inputs that failed in the last try of a4".
    const assign = await p.agent(`assign ${lead} t3 --role=writer --max-attempts=1`)
    expect(assign.err).not.toContain('t3 has the inputs that failed')
    expect(assign.code).toBe(0)
  }, 30000)
})
