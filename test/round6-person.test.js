import { describe, expect, test } from 'bun:test'
import { ok, reported } from './harness.js'

const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'

// Decided 2026-11-07 (derived from "the person accepts no result"): a waiver is a decider's
// accept with less evidence, so the person gives none, and the refusal says the true reason.
describe('the person: no waiver from the person', () => {
  test('the person\'s waive of a result that its decider accepted is refused with the true reason', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    const waive = await p.nanda('waive r1 --rules=no-code-proof --reason="the incident needs it today" --until=2026-10-26T00:00:00Z')
    // The waiver is removed (the owner's ruling 10, 2026-11-12): there is no waive.
    expect(waive.err).toContain('there is no command "waive"')
    expect(waive.err).not.toContain('never from the maker')
  })
})
