// Round 9, attacker H: the person's Reject of a task stops it until an evaluation counts, and
// nothing answers that Reject before it (DESIGN section 8, "Evaluation"). But the Reject of the
// task is not a blocker of a result reported before it, so the decider decides instead: it
// accepts the same r1 again, the task counts as accepted, work next tells the lead to finish
// everything, and work waiting shows nothing for the person. Each test expects the CORRECT
// behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { ok, reported } from
  './harness.js'

const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'

describe('H1 the decider decides where the person asked for an evaluation', () => {
  test('the person rejects t1 after its deciders accepted r1; the lead accepts the same r1 again, and t1 is accepted with no evaluation', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    // Nanda: "we can critique a task before or after it's done".
    ok(await p.nanda('review t1 reject --point="the introduction misses the cause"'))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('t1 waits for an evaluation: Nanda rejected t1')
    // The decider looks again and accepts the same, unchanged work (a refusal is also correct).
    const again = await p.agent(`review ${lead} r1 accept ${REPEATABLE}`)
    if (again.code !== 0) expect(again.err).toContain('waits for an evaluation')
    // Correct: t1 still waits for the evaluation of the person's Reject; the work is not done.
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).not.toContain('t1 is accepted: finish yourself')
    expect(next).toContain('t1 waits for an evaluation')
    expect(ok(await p.nanda('waiting')).out).toContain('t1 The Introduction waits for an evaluation')
  }, 20000)

  test('the person rejects t1 while r1 waits for its review; the linter and the lead accept r1, and t1 is accepted with no evaluation', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.nanda('review t1 reject --point="the introduction misses the cause"'))
    // The checker and the decider accept r1 (a refusal of either is also correct).
    for (const line of [`review ${linter} r1 accept ${LINT}`, `review ${lead} r1 accept ${REPEATABLE}`]) {
      const r = await p.agent(line)
      if (r.code !== 0) expect(r.err).toContain('waits for an evaluation')
    }
    // Correct: nothing answers the person's Reject before its evaluation, and an accept of the
    // work that was there before the Reject does not answer it either.
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).not.toContain('t1 is accepted: finish yourself')
    expect(next).toContain('t1 waits for an evaluation')
    expect(ok(await p.nanda('waiting')).out).toContain('t1 The Introduction waits for an evaluation')
  }, 20000)
})
