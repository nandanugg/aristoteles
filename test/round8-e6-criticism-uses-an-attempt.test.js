// Round 8, attacker E. Rule (section 8, "Attempts and the end of a round"): only a fault uses an
// attempt; "a recheck, the person's criticism, and a Reject of a result made under an older version
// use none". Round 7 added two fixes that meet here: "a decider's accept counts only after the latest
// Reject of its task" (lastTaskReject) and "a result is an attempt until its deciders decide it"
// (settled). The person's Reject of the TASK moves lastTaskReject, the decided result is no longer
// settled, and so it uses the maker's attempt again, with no fault.
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, ok, started, tokenIn } from
  './harness.js'

const UNTIL = '--until=2026-12-31T00:00:00Z'
const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the region" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the region"'
const REPEATABLE = '--evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export"'
const INTRO_V3 = '# TSD\n\n## Introduction\n\nThe export ran twice, and the merchant got two files on one day.\n\n## Design\n\nTODO\n'

describe('E6 the person\'s criticism of a task uses the maker\'s attempt', () => {
  test('a writer with one attempt: its decided r1 counts again after the person rejects t1, and its new work is refused', async () => {
    const { p, lead } = await started()
    const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    expect(ok(await p.agent('status')).out).toContain('a2 writer (low) on t1 · attempts 0/1')
    // The person criticises t1 (no fault of the writer).
    const reject = ok(await p.nanda('review t1 reject --point="the introduction misses the impact on the merchant"')).out
    const vid = reject.match(/^(v\d+): reject/)[1]
    const afterCriticism = ok(await p.agent('status')).out
    // The C-D1 path: a change answers the point, and a later change takes it back.
    ok(await p.nanda(`grant --act=change --on=tsd-writing --to=architect ${UNTIL}`, 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // A second architect reviews the drafts of the first (the reviser cannot).
    const arch2 = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch2}`))
    ok(await p.agent(`evaluate ${arch} t1 --wrong="the introduction misses the impact" --why="no standard asks for it" ` +
      '--improve="a standard for the impact" --level=standard'))
    p.write('add.yaml', 'add:\n  - id: impact-story\n    where: { region: introduction }\n' +
      '    says: The introduction says what the merchant lost.\n' +
      '    rules:\n      - { id: says-impact, says: "The introduction names the impact on the merchant", checkedBy: linter }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=add.yaml --answers=${vid}`))
    ok(await p.agent(`review ${arch2} d2 accept --evidence="add.yaml | precise: it names the impact to check"`))
    p.write('remove.yaml', 'remove: [impact-story]\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=remove.yaml`))
    ok(await p.agent(`review ${arch2} d3 accept --evidence="remove.yaml | the standard was too strict for one page"`))
    // No reviewer or decider rejected r1, so the writer has its one attempt for new work.
    const brief = await p.agent(`brief ${w}`)
    p.write('docs/tsd.md', INTRO_V3)
    const report = await p.agent(`report ${w} --output=docs/tsd.md#introduction`)
    // Correct: the person's criticism uses no attempt, so status shows 0/1 after it, and the
    // writer's new work is taken. Today status shows 1/1, the brief says "a2 has used its 1
    // attempts; it makes no new result. STOP and tell your parent: it assigns a new writer", and the
    // report is refused (no claim), so the lead spends a new round.
    expect(afterCriticism).toContain('a2 writer (low) on t1 · attempts 0/1')
    expect(brief.out).not.toContain('has used its 1 attempts')
    expect(report.code).toBe(0)
  }, 20000)
})
