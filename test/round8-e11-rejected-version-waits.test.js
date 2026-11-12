// Round 8, attacker E. Rule (round 7, C-V1): "a version is reviewed outside the tree of its
// suggester, and waiting names that assign"; every printed line says what to do next. After the
// approvedBy reviewer rejects the version, waiting still says that the version waits for that
// reviewer's review (the words pick any open architect, also one that reviewed), the reviewer's
// next skips it (it reviewed), and the suggester's next does not say that its version was rejected.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, ok, started, tokenIn } from
  './harness.js'

describe('E11 approvedBy order [architect, Nanda]: the reviewer rejects the draft, and every line says it waits for that reviewer', () => {
  test('a3 rejects d2; waiting says "waits for the review of a3"; nobody is told to revise or to review again', async () => {
    const direction = DIRECTION.replace('from: [Pathos, Logos]\n', 'from: [Pathos, Logos]\napprovedBy: { order: [architect, Nanda] }\n')
    const { p } = await started({ 'directions/tsd-writing.yaml': direction })
    const suggester = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${suggester}`))
    p.write('edit.yaml', 'add:\n  - { id: units, says: Numbers have units. }\n')
    ok(await p.agent(`direction revise ${suggester} tsd-writing --file=edit.yaml`))
    // waiting names the assign of an architect outside the suggester's tree (the C-V1 fix); the
    // person runs it, and the new architect follows its next step.
    expect(ok(await p.nanda('waiting')).out).toContain('work assign t1 --role=architect')
    const reviewer = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${reviewer}`))
    expect(ok(await p.agent(`next ${reviewer}`)).out).toContain('review d2')
    ok(await p.agent(`review ${reviewer} d2 reject --reason="units are not a rule of the story"`))
    const waiting = ok(await p.nanda('waiting')).out
    const suggesterNext = ok(await p.agent(`next ${suggester}`)).out
    const reviewerNext = ok(await p.agent(`next ${reviewer}`)).out
    // Correct: the lines say that d2 is rejected, and what comes next (the reviser
    // revises again). Before, waiting said "d2 waits for the review of a3 (architect)",
    // and neither next mentioned d2.
    expect(waiting).not.toContain('waits for the review of a3 (architect)')
    expect(`${waiting}\n${suggesterNext}\n${reviewerNext}`).toMatch(/d2[^\n]*reject/i)
  })
})
