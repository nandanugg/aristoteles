// Round 8, attacker E. Rule (round 7, C-N1/C-N2; DESIGN section 11): "an agent's remake keeps the
// needs, the rounds left, and the workspace"; the engine: "only the person drops a need or changes
// the directions, the context, the workspace, or the rounds".
import { describe, expect, test } from 'bun:test'
import { TASK, TASK_WHOLE, ok, started, tokenIn } from
  './harness.js'

const UNTIL = '--until=2026-10-26T00:00:00Z'

async function architectOn(p, tid) {
  ok(await p.nanda(`grant --act=change --on=${tid} --to=architect ${UNTIL}`, 'grant'))
  const arch = tokenIn(ok(await p.nanda(`assign ${tid} --role=architect`)).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}

describe('E7a an agent\'s remake drops the verify command of the workspace', () => {
  // The engine compares a workspace by [source, path, base] only (spaceKey), so verify is not kept.
  test('the person\'s verify "work-lint docs/tsd.md" is gone after the architect\'s remake', async () => {
    const { p } = await started({ 'task.yaml': TASK_WHOLE })
    const arch = await architectOn(p, 't1')
    // The same source and path; the file leaves out the verify that the person set.
    p.write('again.yaml', 'name: The Introduction\ntext: Write the Introduction from the agreed facts, in two paragraphs.\n' +
      'workspace:\n  - { source: tsd, path: docs/tsd.md }\n')
    const remake = await p.agent(`task remake ${arch} t1 --file=again.yaml --reason="two paragraphs now"`)
    // Correct: an agent's remake keeps the workspace as the person wrote it, verify too; it is
    // refused (or the new task keeps the verify). Today t2 has no verify, so its maker's brief no
    // longer says to run the person's check.
    if (remake.code === 0) {
      const lead = tokenIn(ok(await p.nanda('assign t2 --role=section-lead')).out)
      const brief = ok(await p.agent(`brief ${lead}`)).out
      expect(brief).toContain('verify: work-lint docs/tsd.md')
    } else {
      expect(remake.err).toContain('keeps the directions, the context, and the workspace')
    }
  })
})

describe('E7b repeated remakes of a part give it a new round each time', () => {
  // Since 2026-11-08 there are no rounds. The attack's point stays: an agent's remake must not
  // be a way around the end of a maker's tries. So a remake waits for the evaluation.
  test('an agent\'s remake of a task that waits for an evaluation is refused; after it, the remake goes on', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    const arch = await architectOn(p, 't1')
    p.write('parts.yaml', '- { name: Facts, text: Write the facts., context: { section: facts } }\n' +
      '- { name: Story, text: Write the story., context: { section: story } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    p.write('docs/tsd.md', '# TSD\n\n## Facts\n\nTODO\n\n## Story\n\nTODO\n')
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', '# TSD\n\n## Facts\n\nThe export ran twice (ABC-2964).\n\n## Story\n\nTODO\n')
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#facts`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="cites a ticket" --breaks=no-ticket-ids`))
    p.write('facts.yaml', 'name: Facts\ntext: Write the facts, as a list.\n')
    expect((await p.agent(`task remake ${arch} t2 --file=facts.yaml --reason="the facts are a list now"`)).err)
      .toContain('t2 waits for an evaluation of the last try of')
    ok(await p.agent(`evaluate ${arch} t2 --wrong="r1 cites a ticket" --why="the text asks for the facts, and the ticket is the first fact the writer finds" ` +
      '--improve="the facts as a list of events, with no ids" --level=task'))
    expect(ok(await p.agent(`task remake ${arch} t2 --file=facts.yaml --reason="the facts are a list now"`)).out).toContain('t2 is remade as t4')
  })
})

// TASK is imported so the coordinator sees the harness task that TASK_WHOLE comes from.
void TASK
