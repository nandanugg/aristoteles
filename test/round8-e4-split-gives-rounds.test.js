// Round 8, attacker E found that an agent's split gave a part more rounds than its task had left.
// Since 2026-11-08 there are no rounds (Nanda: a new maker with the same inputs would make the
// same mistake; a mistake is evaluated), so a parts file that names rounds is refused.
import { describe, expect, test } from 'bun:test'
import { TASK_WHOLE, ok, started, tokenIn } from './harness.js'

const UNTIL = '--until=2026-10-26T00:00:00Z'

describe('E4 an agent\'s split gives a part more rounds than its task has left', () => {
  test('a part that names maxRounds is refused: there are no rounds', async () => {
    const { p } = await started({ 'task.yaml': TASK_WHOLE })
    ok(await p.nanda(`grant --act=change --on=t1 --to=architect ${UNTIL}`, 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('parts.yaml', '- { name: Facts, text: Write the facts., context: { section: facts }, maxRounds: 5 }\n' +
      '- { name: Story, text: Write the story., context: { section: story } }\n')
    expect((await p.agent(`task split ${arch} t1 --file=parts.yaml`)).err)
      .toContain('part Facts: maxRounds is gone; when the tries of a maker end on a fault, the high role evaluates the mistake')
  })
})
