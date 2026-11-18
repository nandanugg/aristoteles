import { describe, expect, test } from 'bun:test'
import { INTRO_V2, TASK_WHOLE, ok, started, tokenIn } from './harness.js'

const UNTIL = '--until=2026-10-26T00:00:00Z'
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'

// An architect with a change grant on a task, assigned on it by the person.
async function architectOn(p, tid) {
  ok(await p.nanda(`grant --act=change --on=${tid} --to=architect ${UNTIL}`, 'grant'))
  const arch = tokenIn(ok(await p.nanda(`assign ${tid} --role=architect`)).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}

describe('needs: a maker starts only when the tasks that its task needs are accepted', () => {
  test('after: names one part; a second part with the same name is not left out of the wait', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    p.write('parts.yaml', '- { name: Facts, text: Write the facts. }\n' +
      '- { name: Story, text: Write the story from the facts., after: [Facts] }\n' +
      '- { name: Facts, text: Write the second list of facts. }\n')
    const split = await p.nanda('task split t1 --file=parts.yaml')
    // The fix (2026-11-07): two parts with one name are refused.
    expect(split.err).toContain('two parts in parts.yaml are named Facts')
  })

})

describe('needs: nothing waits for ever', () => {
  test('a question to a lead that finished still has someone who answers it, so the task that needs t1 can start', async () => {
    const { p, lead } = await started()
    p.write('t2.yaml', 'name: The Design\ntext: Write the design from the introduction.\ndirections: [tsd-writing]\n' +
      'workspace:\n  - { source: tsd, path: docs/tsd.md }\nneeds: [t1]\n')
    ok(await p.nanda('task open --file=t2.yaml'))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`ask ${writer} --text="the facts name one merchant; is the second one in scope?"`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    // The lead finishes its children and itself while q1 waits for its answer.
    const finished = [await p.agent(`finish ${lead} a2`), await p.agent(`finish ${lead} a3`), await p.agent(`finish ${lead}`)]
    if (finished.some((r) => r.code !== 0)) return // a finish with an open question to it is refused: held
    // q1 stops t1 (and so t2). Someone must still be able to answer it: the lead, the person, or a new lead.
    const lead2 = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const answers = [
      await p.agent(`answer ${lead} q1 --text="no, one merchant"`),
      await p.nanda('answer q1 --text="no, one merchant"'),
      await p.agent(`answer ${lead2} q1 --text="no, one merchant"`),
    ]
    expect(answers.some((r) => r.code === 0)).toBe(true)
  })
})
