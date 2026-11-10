// Round 9, attacker G. Rule: a draft that its approvedBy reviewer rejects is ended; its reviser
// revises again (waiting says so). After the reviewer's Reject, another architect's accept and the
// person's accept of the same draft are refused, so the rejected draft is never made official.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, ok, started, tokenIn } from
  './harness.js'

describe('G7 approvedBy order [architect, Nanda]: a draft that its reviewer rejected becomes official', () => {
  test('a3 rejects d2; a4 and Nanda\'s accept of d2 are refused; tsd-writing@2 is not made', async () => {
    const direction = DIRECTION.replace('from: [Pathos, Logos]\n', 'from: [Pathos, Logos]\napprovedBy: { order: [architect, Nanda] }\n')
    const { p } = await started({ 'directions/tsd-writing.yaml': direction })
    const suggester = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${suggester}`))
    p.write('edit.yaml', 'add:\n  - { id: units, says: Numbers have units. }\n')
    ok(await p.agent(`direction revise ${suggester} tsd-writing --file=edit.yaml`))
    const reviewer = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${reviewer}`))
    ok(await p.agent(`review ${reviewer} d2 reject --reason="units are not a rule of the story"`))
    expect(ok(await p.nanda('waiting')).out).toContain('d2 is rejected by a3')
    // A second architect, outside the suggester's tree (today its next still offers
    // the review), accepts the same draft.
    const other = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${other}`))
    const late = await p.agent(`review ${other} d2 accept --evidence="edit.yaml | units help the reader"`)
    expect(late.err).toContain('d2 is ended by the Reject of a3')
    const approve = await p.nanda('review d2 accept --evidence="edit.yaml | units"', 'accept')
    expect(approve.out).not.toContain('is official')
    expect(approve.err).toContain('d2 is ended by the Reject of a3')
    // Correct: s1 waits for a new suggestion of its suggester, so it stays unapproved. Today:
    // "tsd-writing@2 is official."
    expect(approve.out).not.toContain('tsd-writing@2 is official')
    expect(ok(await p.agent('direction show d2')).out).toContain('ended by a Reject')
    expect(ok(await p.agent('direction show tsd-writing')).out).not.toContain('tsd-writing@2')
  }, 20000)
})
