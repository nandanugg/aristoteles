// Round 8, attacker E. Rule: a question waits only for an assignment that can act ("a question to
// a finished assignment is refused"; Assignment.finish moves an open question up). The round-7 fix
// "a new maker of a task ends the makers before it" sets finished directly in Assignment.give, so a
// question that the person asked the old maker stays with a finished assignment.
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, ok, started, tokenIn } from
  './harness.js'

const INTRO_V3 = '# TSD\n\n## Introduction\n\nThe export ran twice, and the merchant got two files on one day.\n\n## Design\n\nTODO\n'
const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the region" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the region"'
const REPEATABLE = '--evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export"'

describe('E1 a new maker ends the old maker, and the person\'s question to the old maker waits for ever', () => {
  test('the question stays with the finished writer a2; nobody can answer it, and t1 is never Accepted', async () => {
    const { p, lead } = await started()
    const w1 = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${w1}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${w1} --output=docs/tsd.md#introduction`))
    // The lead is the top agent: it relays the person's question to the writer (it counts at once).
    const relay = ok(await p.agent(`relay ${lead} Nanda ask a2 --quote="Which merchant got the two files?" --channel=chat`)).out
    const qid = relay.match(/-> (q\d+)/)[1]
    // The writer's one try waits for its review, so the lead may give t1 to a new writer (since
    // 2026-11-08 a try that ended on a fault is evaluated first, so this is the path left).
    const assign2 = await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)
    // Two fixes are correct: the assign moves the question up (as Assignment.finish does), or the
    // assign is refused while a question waits for the old maker.
    if (assign2.code !== 0) {
      expect(assign2.err).toContain(qid)
      return
    }
    const w2 = tokenIn(assign2.out)
    // The new writer's result is checked and decided.
    ok(await p.agent(`brief ${w2}`))
    p.write('docs/tsd.md', INTRO_V3)
    ok(await p.agent(`report ${w2} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r2 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r2 accept ${REPEATABLE}`))
    // The person's question still stops t1. Every way to answer it is refused:
    const byOldWriter = await p.agent(`answer ${w1} ${qid} --text="merchant 42"`)
    const byPerson = await p.nanda(`answer ${qid} --text="merchant 42"`)
    const byLead = await p.agent(`answer ${lead} ${qid} --text="merchant 42"`)
    const answers = [byOldWriter, byPerson, byLead]
    const waiting = ok(await p.nanda('waiting')).out
    const show = ok(await p.agent('task show t1')).out
    // What happens now (kept in the message, so the run shows it):
    const seen = `answers: ${answers.map((r) => r.code === 0 ? 'ok' : r.err).join(' / ')}\nwaiting:\n${waiting}\ntask show:\n${show}`
    // Correct: the question went up with the old writer's end (to the lead, else the owner), so one
    // of them answers it, and t1 is Accepted after that; or the question does not stop t1.
    const answeredBySomeone = answers.some((r) => r.code === 0)
    const after = ok(await p.agent('task show t1')).out
    expect({ answeredBySomeone, accepted: after.includes('Accepted'), seen }).toMatchObject({ answeredBySomeone: true, accepted: true })
  }, 30000)
})
