// Round 9, attacker G. Rule (DESIGN section 11, round 8): "Standards compare by what they say, in
// any order of rules or of the keys of where". sameStandard compares the rules by object identity,
// and buildStandard keeps a rule object only from the version just before the revise. So a
// standard that a version removes and the next version adds back with the same id, words, where,
// and rules is a new standard: a version that says to the task exactly what the old one said
// does not "say the same". Two harms follow: the maker whose last try failed works again on the
// inputs that failed (sameInputs, and the attempts that underNow resets), and accepted work is
// "under an old version" and needs its checks and its decider again.
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, INTRO_V2, ok, started, tokenIn } from
  './harness.js'

const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the section" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the section"'
const REPEATABLE = '--evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export"'
// intro-story of harness.js DIRECTION, word for word.
const READD = 'add:\n  - id: intro-story\n    where: { section: introduction }\n    says: Tell the story first, in plain words.\n    rules:\n' +
  '      - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: section-lead }\n'

// The architect removes intro-story (tsd-writing@2), then adds it back as it was (tsd-writing@3);
// the person accepts each draft (the reviser cannot review its own draft).
async function removeAndAddBack(p) {
  ok(await p.nanda('grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  p.write('remove.yaml', 'remove: [intro-story]\n')
  ok(await p.agent(`direction revise ${arch} tsd-writing --file=remove.yaml --why="Shorten"`))
  ok(await p.nanda('review d2 accept --evidence="remove.yaml | intro-story goes"', 'accept'))
  p.write('readd.yaml', READD)
  ok(await p.agent(`direction revise ${arch} tsd-writing --file=readd.yaml --why="Correct the standard"`))
  return ok(await p.nanda('review d3 accept --evidence="readd.yaml | the story standard is back as it was"', 'accept')).out
}

describe('G5 a standard removed and added back with the same words is not the same standard', () => {
  test('a2 used its one try on a fault under @1; after @2 and @3 (which says what @1 said) a2 works again on the inputs that failed', async () => {
    const { p, lead } = await started()
    const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
    ok(await p.nanda('evaluate t1 --wrong="r1 cites the ticket" --why="the writer copied the facts" --improve="say that ids stay out" --level=standard'))
    await removeAndAddBack(p)
    // tsd-writing@3 says to t1 what @1 said: same spirit, same standards, same rules.
    expect(ok(await p.agent('direction show tsd-writing@3')).out).toContain('intro-story where {"section":"introduction"}: Tell the story first, in plain words.')
    // Correct: t1 still has the inputs that failed, so a2 takes no brief. Today: a2's attempts
    // are reset (status "attempts 0/1"), and its brief is printed under tsd-writing@3.
    const brief = await p.agent(`brief ${w}`)
    expect(brief.out).not.toContain('work brief a2 · writer (low) · t1 The Introduction')
    expect(brief.err).toContain('t1 has the inputs that failed in the last try of a2')
  }, 20000)

  test('r1 is accepted under @1; after @2 and @3 (which says what @1 said) r1 is old and t1 is not accepted', async () => {
    const { p, lead } = await started()
    const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${w}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
    const approved = await removeAndAddBack(p)
    // Correct: @3 says to t1 what @1 said, so r1 is not old and t1 is accepted again with the
    // evidence it has. Today: "now under an old version: r1 (t1)", and r1 needs the evidence for
    // repeatable and the lead's accept again.
    expect(approved).not.toContain('now under an old version: r1')
    expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
  }, 20000)
})
