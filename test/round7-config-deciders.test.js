// Round 7, attacker C: who accepts a new version (approvedBy), read at work init. The fixes of
// 2026-11-07 made init refuse a name given twice and a person before another item of an order;
// these approvedBy entries pass init and can never be met. Each test expects the CORRECT
// behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, WORK_YAML, ok, project, started, tokenIn } from
  './harness.js'
import { main } from '../cli.js'

const withApprovedBy = (by) => DIRECTION.replace('from: [Pathos, Logos]\n', `from: [Pathos, Logos]\napprovedBy: ${by}\n`)

describe('C-C1 approvedBy names a low role, which never reviews a direction', () => {
  test('approvedBy: { order: [writer, Nanda] } passes init, and no version of tsd-writing can become official', async () => {
    const p = project({ 'directions/tsd-writing.yaml': withApprovedBy('{ order: [writer, Nanda] }') })
    ok(await p.nanda('init'))
    const init = await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess')
    // The fix (2026-11-07): the draft of the direction is refused (init, before 2026-11-10).
    expect(init.err).toContain('approvedBy names writer, a role that reviews no direction')
  })
})

describe('C-C2 approvedBy names a person who is not the owner', () => {
  test('approvedBy: { order: [architect, Bob] } passes init; neither Bob nor the owner can make a version official', async () => {
    const people = WORK_YAML.replace('  - name: Nanda\n', '  - name: Nanda\n  - name: Bob\n')
    const p = project({ 'work.yaml': people, 'directions/tsd-writing.yaml': withApprovedBy('{ order: [architect, Bob] }') })
    ok(await p.nanda('init'))
    const init = await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess')
    // The fix (2026-11-07): the draft of the direction is refused (init, before 2026-11-10).
    expect(init.err).toContain('approvedBy names Bob, who is not the owner (Nanda)')
  })
})
