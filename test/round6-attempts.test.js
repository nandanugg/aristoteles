import { describe, expect, test } from 'bun:test'
import { INTRO_V1, INTRO_V2, changeDirection, ok, started, tokenIn } from './harness.js'

const INTRO_V3 = '# TSD\n\n## Introduction\n\nThe export ran twice, and the merchant got two files on one day.\n\n## Design\n\nTODO\n'

describe('attempts: only a fault uses an attempt', () => {
  test('after an approved change resets the attempts, the next fault on the last try needs a new evaluation', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`review ${lead} r1 reject --point="a reviewer cannot repeat it" --breaks=repeatable`))
    // The last try ended on a fault: the task waits for an evaluation (Nanda, 2026-11-08).
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('t1 waits for an evaluation')
    ok(await p.nanda('evaluate t1 --wrong="r1 cannot be repeated" --why="no rule names the numbers that a reader needs" --improve="numbers have units" --level=standard'))
    // The change (drafted by the architect, accepted by the person) resets the attempts.
    await changeDirection(p, 'add:\n  - { id: units, says: Numbers have units. }\n', { flags: '--why="Correct the standard"' })
    expect(ok(await p.agent(`brief ${writer}`)).out).toContain('attempt 1 of 1')
    p.write('docs/tsd.md', INTRO_V3)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`review ${lead} r2 reject --point="a reviewer still cannot repeat it" --breaks=repeatable`))
    // A fault used the last try again: the first evaluation does not cover it.
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('t1 waits for an evaluation')
  })
})
