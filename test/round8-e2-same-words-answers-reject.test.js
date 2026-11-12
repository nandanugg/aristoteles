// Round 8, attacker E. Rule (round 7, C-D2): "a replace with the same words says nothing new to a
// task, so it answers no Reject"; "standards compare by what they say" (DESIGN section 8). The fix
// (sameStandard in the engine) compares the rules of two standards by position and by object, so a
// replace that says the same words in another way still says "something new" to t1, and an agent
// answers the person's Reject with it.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, ok, reported, tokenIn } from
  './harness.js'

const UNTIL = '--until=2026-12-31T00:00:00Z'
const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the section" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the section"'
const REPEATABLE = '--evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export"'

// t1 is Accepted, the person rejects it, and the architect (with a change grant) can revise.
async function criticised(files) {
  const s = await reported(files)
  const { p, lead, linter } = s
  ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
  ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
  expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
  const reject = ok(await p.nanda('review t1 reject --point="the introduction misses the impact on the merchant"')).out
  const vid = reject.match(/^(v\d+): reject/)[1]
  ok(await p.nanda(`grant --act=change --on=tsd-writing --to=architect ${UNTIL}`, 'grant'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  // The criticism is evaluated first (2026-11-08), so the approve below is judged on its words.
  ok(await p.agent(`evaluate ${arch} t1 --wrong="the introduction misses the impact" --why="no standard asks for it" ` +
    '--improve="a standard for the impact" --level=standard'))
  return { ...s, vid, arch }
}

describe('E2 a replace with the same words in another order answers the person\'s Reject', () => {
  test('facts-not-proof replaced by the same two rules, listed in the other order', async () => {
    const { p, arch, vid } = await criticised()
    // The same standard, word for word as in tsd-writing@1; only the order of its two rules differs.
    p.write('same.yaml', 'replace:\n  - id: facts-not-proof\n    with:\n      id: facts-not-proof\n' +
      '      says: The body states facts; the proof stays in the agreed facts.\n      rules:\n' +
      '        - { id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", checkedBy: linter }\n' +
      '        - { id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }\n')
    const revise = await p.agent(`direction revise ${arch} tsd-writing --file=same.yaml --answers=${vid}`)
    // Correct: the draft says to t1 what @1 said, so it does not answer the person's point.
    // The answer checks run at the revise, so no draft is made.
    expect(revise.err).toContain('says the same to t1 as before')
    expect(ok(await p.agent('task show t1')).out).toContain('Returned')
  }, 20000)

  test('a "where" with the same two keys, written in the other order', async () => {
    // A direction whose introduction standard applies by two keys of the context.
    const direction = DIRECTION.replace('    where: { section: introduction }\n', '    where: { section: introduction, audience: merchant }\n')
    const task = 'name: The Introduction\ntext: Write the Introduction from the agreed facts.\ndirections: [tsd-writing]\n' +
      'context: { section: introduction, audience: merchant }\nworkspace:\n  - { source: tsd, path: docs/tsd.md }\n'
    const { p, arch, vid } = await criticised({ 'directions/tsd-writing.yaml': direction, 'task.yaml': task })
    p.write('same.yaml', 'replace:\n  - id: intro-story\n    with:\n      id: intro-story\n      where: { audience: merchant, section: introduction }\n' +
      '      says: Tell the story first, in plain words.\n      rules:\n' +
      '        - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: section-lead }\n')
    const revise = await p.agent(`direction revise ${arch} tsd-writing --file=same.yaml --answers=${vid}`)
    expect(revise.err).toContain('says the same to t1 as before')
    expect(ok(await p.agent('task show t1')).out).toContain('Returned')
  }, 20000)
})

describe('E3 a rule that supersedes itself is a "new" rule with the same words', () => {
  test('an agent answers the person\'s point on repeatable with an identical copy of intro-story whose rule supersedes repeatable, then closes t1', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    // The person criticises r1 after its deciders accepted it, and names the rule that it breaks.
    const reject = ok(await p.nanda('review r1 reject --point="I cannot repeat the problem from it" --breaks=repeatable')).out
    const vid = reject.match(/^(v\d+): reject/)[1]
    ok(await p.nanda(`grant --act=change --on=tsd-writing,t1 --to=architect ${UNTIL}`, 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // The person's open point stops an agent's close (round 5).
    expect((await p.agent(`task close ${arch} t1 --reason="done enough"`)).err).toContain("is the person's open Reject on t1")
    // intro-story word for word as in tsd-writing@1; the rule keeps its id, words, and checker,
    // and says that it supersedes the rule of the same id.
    p.write('same.yaml', 'replace:\n  - id: intro-story\n    with:\n      id: intro-story\n      where: { section: introduction }\n' +
      '      says: Tell the story first, in plain words.\n      rules:\n' +
      '        - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: section-lead, supersedes: [repeatable] }\n')
    // The fix (2026-11-08): a rule does not supersede itself, so the revise is refused.
    expect((await p.agent(`direction revise ${arch} tsd-writing --file=same.yaml`)).err)
      .toContain('rule repeatable supersedes itself; a changed rule keeps its id, and supersedes names other rules')
    const close = await p.agent(`task close ${arch} t1 --reason="done enough"`)
    // Correct (section 8): a point that names a rule closes with changed work that has evidence for
    // that rule; no draft says anything new to t1, so the agent's close still stops at the
    // person's point.
    expect(close.err).toContain("is the person's open Reject on t1")
  }, 20000)
})
