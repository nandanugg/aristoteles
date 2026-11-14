// Round 8, attacker F: the file queue and the needs of a task cross. A maker holds the file,
// but it cannot report until a task is accepted whose next maker waits for that file. work next
// tells the parent to finish a maker only when its task is accepted or it has no attempts left,
// so neither maker moves and no printed step frees them. Each test expects the CORRECT behaviour,
// so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, TASK_WHOLE, evaluated, ok, started, tokenIn } from
  './harness.js'

const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const WITH_DESIGN = INTRO_V2.replace('## Design\n\nTODO', '## Design\n\nOne file per merchant per day.')

describe('F-Q3 a maker of a task that is split later holds the file for ever', () => {
  test('the writer of t1 holds docs/tsd.md after the person splits t1; the part writer waits, and next never says to finish a2', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    // work next of the lead says "make t1", so the lead gives t1 to a writer (a2), which starts.
    const whole = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${whole}`))
    p.write('parts.yaml', '- { name: Intro, text: Write the introduction., context: { section: introduction } }\n' +
      '- { name: Design, text: Write the design., context: { section: design } }\n')
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    const intro = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    // a2 can make no result now: t1 needs its parts, and its part t2 waits for a2's file.
    p.write('docs/tsd.md', INTRO_V2)
    const report = await p.agent(`report ${whole} --output=docs/tsd.md`)
    expect(report.err).toContain('t1 needs t2 (Intro), which is not accepted')
    ok(await p.agent(`escalate ${whole} --reason="t1 was split; my report is refused: t1 needs t2"`))
    const next = ok(await p.agent(`next ${lead}`)).out
    const brief = await p.agent(`brief ${intro}`)
    // Correct: either the split ends the maker of t1 (a3 starts), or next tells the lead to
    // finish a2, which can make no result while its parts wait for its file.
    if (brief.code !== 0) {
      expect(brief.err).toContain('a3 waits for docs/tsd.md: a2')
      expect(next).toContain(`work finish ${lead} a2`)
    } else {
      expect(brief.out).toContain('work brief a3 · writer (low) · t2 Intro')
      expect(brief.out).not.toContain('writes docs/tsd.md first')
    }
  })
})

describe('F-Q4 a needs that crosses the queue: the person criticises a part that a later part runs after', () => {
  test('a5 (the new writer of t2) waits for a4 (t3, after: [Intro]), and a4 cannot report until t2 is accepted', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    p.write('parts.yaml', '- { name: Intro, text: Write the introduction., context: { section: introduction } }\n' +
      '- { name: Design, text: Write the design., context: { section: design }, after: [Intro] }\n')
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    const intro = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${intro}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${intro} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    // t2 is accepted, so t3 starts. Ruling 10.2 (D14, I2): a settled maker reserves no turn, so
    // a4 may write the file at once; next names no finish of a2 (the lead may still finish it).
    const design = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=writer`)).out)
    const turn = ok(await p.agent(`next ${lead}`)).out
    expect(turn).not.toContain(`work finish ${lead} a2`)
    expect(turn).toContain('make t3: give a new subagent the command of a4')
    ok(await p.agent(`finish ${lead} a2`))
    ok(await p.agent(`brief ${design}`))
    p.write('docs/tsd.md', WITH_DESIGN)
    // The person reads r1 and criticises it (after its deciders accepted it).
    ok(await p.nanda('review r1 reject --point="the intro does not say which merchant" --breaks=repeatable'))
    await evaluated(p, 't2')
    // a4 cannot report now: t3 runs after t2, which is not accepted.
    expect((await p.agent(`report ${design} --output=docs/tsd.md#design`)).err).toContain('t3 needs t2 (Intro), which is not accepted')
    // next says to make t2 again; the new writer a5 waits for a4.
    expect(ok(await p.agent(`next ${lead}`)).out).toContain(`work assign ${lead} t2 --role=writer`)
    const redo = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    const next = ok(await p.agent(`next ${lead}`)).out
    // A part of the same tree is not "of another task tree" (attacker F's note, fixed too).
    expect(ok(await p.nanda('waiting')).out).not.toContain('of another task tree')
    const brief = await p.agent(`brief ${redo}`)
    // Correct: a printed step moves the work: either a5 does not wait for a4 (which writes
    // nothing until t2 is accepted), or next tells the lead to finish a4.
    if (brief.code !== 0) {
      expect(brief.err).toContain('a5 waits for docs/tsd.md: a4')
      expect(next).toContain(`work finish ${lead} a4`)
    } else {
      expect(brief.out).toContain('work brief a5 · writer (low) · t2 Intro')
      expect(brief.out).not.toContain('writes docs/tsd.md first')
    }
  })
})
