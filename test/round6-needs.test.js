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
  test('a part of a task that needs t1 does not start before t1 is accepted', async () => {
    const { p } = await started()
    // t2 uses the work of t1 (it needs t1); the architect splits t2 into one part.
    p.write('t2.yaml', 'name: The Design\ntext: Write the design from the introduction.\ndirections: [tsd-writing]\n' +
      'workspace:\n  - { source: tsd, path: docs/tsd.md }\nneeds: [t1]\n')
    ok(await p.nanda('task open --file=t2.yaml'))
    const arch = await architectOn(p, 't2')
    p.write('parts.yaml', '- { name: Design body, text: Write the design body from the introduction. }\n')
    ok(await p.agent(`task split ${arch} t2 --file=parts.yaml`))
    const lead = tokenIn(ok(await p.agent(`assign ${arch} t3 --role=region-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    // t1 has no result yet: the work of t3 is t2's work, and t2 needs t1.
    const assign = await p.agent(`assign ${lead} t3 --role=writer`)
    expect(assign.code).not.toBe(0)
  })

  test('a part of a part that runs after Facts does not start before Facts is accepted', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    const arch = await architectOn(p, 't1')
    p.write('parts.yaml', '- { name: Facts, text: Write the facts., context: { region: facts } }\n' +
      '- { name: Story, text: Write the story from the facts., after: [Facts], context: { region: story } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    // Story (t3) runs after Facts (t2); the architect splits Story further.
    p.write('story.yaml', '- { name: Story start, text: Write the first paragraph of the story from the facts. }\n')
    // Story has its own region, so it is one unit (round 7): it is not split further, and its
    // maker starts only after Facts.
    expect((await p.agent(`task split ${arch} t3 --file=story.yaml`)).err).toContain('has the region story, so it is one unit of work')
    expect((await p.agent(`assign ${lead} t3 --role=writer`)).code).not.toBe(0)
  })

  test('after: names one part; a second part with the same name is not left out of the wait', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    p.write('parts.yaml', '- { name: Facts, text: Write the facts. }\n' +
      '- { name: Story, text: Write the story from the facts., after: [Facts] }\n' +
      '- { name: Facts, text: Write the second list of facts. }\n')
    const split = await p.nanda('task split t1 --file=parts.yaml')
    // The fix (2026-11-07): two parts with one name are refused.
    expect(split.err).toContain('two parts in parts.yaml are named Facts')
  })

  test('a remake keeps the wait of the part that it replaces', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    const arch = await architectOn(p, 't1')
    p.write('parts.yaml', '- { name: Facts, text: Write the facts., context: { region: facts } }\n' +
      '- { name: Story, text: Write the story from the facts., after: [Facts], context: { region: story } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    expect(ok(await p.agent('task show t3')).out).toContain('needs: t2')
    // The remake file is a task file, as the template of work task open prints it (no needs key).
    p.write('story.yaml', 'name: Story\ntext: Write the story from the facts, in two paragraphs.\n' +
      'directions: [tsd-writing]\nworkspace:\n  - { source: tsd, path: docs/tsd.md, verify: "work-lint docs/tsd.md" }\n')
    ok(await p.agent(`task remake ${arch} t3 --file=story.yaml --reason="the story has two paragraphs now"`))
    // t4 replaces Story; Facts (t2) has no result, so the maker of t4 does not start yet.
    const assign = await p.agent(`assign ${lead} t4 --role=writer`)
    expect(assign.code).not.toBe(0)
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
    const lead2 = tokenIn(ok(await p.nanda('assign t1 --role=region-lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const answers = [
      await p.agent(`answer ${lead} q1 --text="no, one merchant"`),
      await p.nanda('answer q1 --text="no, one merchant"'),
      await p.agent(`answer ${lead2} q1 --text="no, one merchant"`),
    ]
    expect(answers.some((r) => r.code === 0)).toBe(true)
  })
})
