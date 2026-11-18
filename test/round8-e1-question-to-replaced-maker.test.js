// Round 8, attacker E. Rule: a question waits only for an assignment that can act ("a question to
// a finished assignment is refused"; Assignment.finish moves an open question up). The round-7 fix
// "a new maker of a task ends the makers before it" sets finished directly in Assignment.give, so a
// question that the person asked the old maker stays with a finished assignment.
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, ok, started, tokenIn } from
  './harness.js'

const INTRO_V3 = '# TSD\n\n## Introduction\n\nThe export ran twice, and the merchant got two files on one day.\n\n## Design\n\nTODO\n'
const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the section" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the section"'
const REPEATABLE = '--evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export"'

describe('E1 a new maker ends the old maker, and the person\'s question to the old maker waits for ever', () => {
})
