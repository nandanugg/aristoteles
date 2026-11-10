// Round 7, attacker C: "a direction change answers a Reject only when it says something new to
// that task" (B2 of round 6), and the attempts that an approved change resets.
// Each test expects the CORRECT behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, changeDirection, codeStarted, git, ok, reported, started, tokenIn } from
  './harness.js'

const UNTIL = '--until=2026-12-31T00:00:00Z'
const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the region" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the region"'
const REPEATABLE = '--evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export"'
const INTRO_V3 = '# TSD\n\n## Introduction\n\nThe export ran twice, and the merchant got two files on one day.\n\n## Design\n\nTODO\n'

describe('C-D1 a change that is undone still answers the person\'s Reject', () => {
  test('agents answer the person\'s Reject of t1 with a new standard, remove it again, and t1 is Accepted on the old accepts', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
    // The person criticises t1 after its deciders accepted r1.
    const reject = ok(await p.nanda('review t1 reject --point="the introduction misses the impact on the merchant"')).out
    const vid = reject.match(/^(v\d+): reject/)[1]
    ok(await p.nanda(`grant --act=change --on=tsd-writing --to=architect ${UNTIL}`, 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // A second architect reviews the drafts of the first (the reviser cannot).
    const arch2 = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch2}`))
    // The person's criticism is evaluated first (2026-11-08).
    ok(await p.agent(`evaluate ${arch} t1 --wrong="the introduction misses the impact on the merchant" ` +
      '--why="no standard of the introduction asks for the impact" --improve="a standard for the impact" --level=standard'))
    // v3 says something new to t1 (a standard for the introduction), so it answers the point.
    p.write('add.yaml', 'add:\n  - id: impact-story\n    where: { region: introduction }\n' +
      '    says: The introduction says what the merchant lost.\n' +
      '    rules:\n      - { id: says-impact, says: "The introduction names the impact on the merchant", checkedBy: linter }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=add.yaml --answers=${vid}`))
    ok(await p.agent(`review ${arch2} d2 accept --evidence="add.yaml | precise: it names the impact to check"`))
    expect(ok(await p.agent('task show t1')).out).not.toContain('Accepted')
    // v4 removes that standard again: tsd-writing says to t1 what it said when the person rejected it.
    p.write('remove.yaml', 'remove: [impact-story]\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=remove.yaml`))
    ok(await p.agent(`review ${arch2} d3 accept --evidence="remove.yaml | the standard was too strict for one page"`))
    // Correct: no change says anything new to t1 now, and nobody checked r1 after the person's
    // point; r1 is the work that the person rejected, so t1 is not Accepted.
    const show = ok(await p.agent('task show t1')).out
    expect(show).not.toContain('Accepted')
  }, 20000)
})

describe('C-A1 an approved change resets the attempts of a maker that a new maker replaced', () => {
  // Since 2026-11-08 the last try that ends on a fault is evaluated; no new writer starts on the
  // inputs that failed, so the case of two open writers cannot begin. The change resets w1 instead.
  test('after the evaluation and the change, the old writer works again, and no second writer opens', async () => {
    const { p, lead } = await started()
    const w1 = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w1}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${w1} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`review ${lead} r1 reject --point="a reviewer cannot repeat it" --breaks=repeatable`))
    expect((await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).err).toContain('t1 waits for an evaluation')
    ok(await p.nanda('evaluate t1 --wrong="r1 cannot be repeated" --why="no rule names the numbers that a reader needs" --improve="numbers have units" --level=standard'))
    expect((await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).err).toContain('has the inputs that failed')
    await changeDirection(p, 'add:\n  - { id: units, says: Numbers have units. }\n', { flags: '--why="name the units"' })
    // The change resets w1's attempts, so w1 is the open writer of t1.
    expect((await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).err).toContain('already has an open Do assignment')
    ok(await p.agent(`brief ${w1}`))
    p.write('docs/tsd.md', INTRO_V3)
    expect(ok(await p.agent(`report ${w1} --output=docs/tsd.md#introduction`)).out).toContain('r2 reported on t1')
  }, 20000)
})

describe('C-D2 a replace with the same words says something new to every task', () => {
  test('an agent answers the person\'s Reject of t1 with intro-story replaced by an identical copy', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    const reject = ok(await p.nanda('review t1 reject --point="the introduction misses the impact on the merchant"')).out
    const vid = reject.match(/^(v\d+): reject/)[1]
    ok(await p.nanda(`grant --act=change --on=tsd-writing --to=architect ${UNTIL}`, 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // The person's criticism is evaluated first (2026-11-08), so the revise is judged on its words.
    ok(await p.agent(`evaluate ${arch} t1 --wrong="the introduction misses the impact" --why="no standard asks for it" ` +
      '--improve="a standard for the impact" --level=standard'))
    // The standard of the introduction, word for word as in tsd-writing@1.
    p.write('same.yaml', 'replace:\n  - id: intro-story\n    with:\n      id: intro-story\n      where: { region: introduction }\n' +
      '      says: Tell the story first, in plain words.\n      rules:\n' +
      '        - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: region-lead }\n')
    const revise = await p.agent(`direction revise ${arch} tsd-writing --file=same.yaml --answers=${vid}`)
    // Correct: the draft says to t1 word for word what @1 said, so it does not answer the point.
    expect(revise.code).toBe(1)
    expect(revise.err).toContain('says the same to t1 as before')
    expect(ok(await p.agent('task show t1')).out).toContain('Returned')
  }, 20000)
})

describe('C-A3 a result that its gate accepted uses no attempt, also when the maker replaces it', () => {
  // By the letter of section 8 a gate accept is a first review; the bound of maxAttempts is gone.
  test('an implementer with 3 attempts reports 4 commits that its lead never decided, and the fourth is refused', async () => {
    const { p, app, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'fix')
    const reports = []
    for (let i = 1; i <= 4; i++) {
      p.write('app/key.txt', `key = ${i}\n`)
      git(app, 'add', '.')
      git(app, 'commit', '-q', '-m', `try ${i}`)
      if (i > 1) await p.agent(`brief ${impl}`)
      reports.push(await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD')}`))
    }
    // The fix (2026-11-07): a result that its deciders never decided is an attempt in flight, also
    // when the gate accepted it; the fourth report is refused.
    expect(reports[2].out).toContain('attempt 3 of 3')
    expect(reports[3].code).not.toBe(0)
  }, 30000)
})
