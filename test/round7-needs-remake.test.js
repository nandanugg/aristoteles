// Round 7, attacker C: the needs fixes of 2026-11-07, through an agent's remake.
// Each test expects the CORRECT behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { TASK_WHOLE, ok, started, tokenIn } from
  './harness.js'

const UNTIL = '--until=2026-10-26T00:00:00Z'

async function architectOn(p, tid) {
  ok(await p.nanda(`grant --act=change --on=${tid} --to=architect ${UNTIL}`, 'grant'))
  const arch = tokenIn(ok(await p.nanda(`assign ${tid} --role=architect`)).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}

describe('C-N1 an agent\'s remake that names needs: [] drops the wait', () => {
  test('a remade part runs after the part that its file no longer names', async () => {
    const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
    const arch = await architectOn(p, 't1')
    p.write('parts.yaml', '- { name: Facts, text: Write the facts., context: { region: facts } }\n' +
      '- { name: Story, text: Write the story from the facts., after: [Facts], context: { region: story } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    // The same remake as round6-needs, but the file names needs: [] (an empty list).
    p.write('story.yaml', 'name: Story\ntext: Write the story from the facts, in two paragraphs.\n' +
      'directions: [tsd-writing]\nneeds: []\nworkspace:\n  - { source: tsd, path: docs/tsd.md, verify: "work-lint docs/tsd.md" }\n')
    // The fix (2026-11-07): an agent's remake keeps the needs; it may add one, not drop one.
    expect((await p.agent(`task remake ${arch} t3 --file=story.yaml --reason="the story has two paragraphs now"`)).err)
      .toContain("an agent's remake keeps the needs of t3; it may add a need, but only the person drops t2")
    expect(lead).toBeDefined()
  })

  test('a remade part of a task that needs t1 no longer waits for t1', async () => {
    const { p } = await started()
    p.write('t2.yaml', 'name: The Design\ntext: Write the design from the introduction.\ndirections: [tsd-writing]\n' +
      'workspace:\n  - { source: tsd, path: docs/tsd.md }\nneeds: [t1]\n')
    ok(await p.nanda('task open --file=t2.yaml'))
    const arch = await architectOn(p, 't2')
    p.write('parts.yaml', '- { name: Design body, text: Write the design body from the introduction. }\n')
    ok(await p.agent(`task split ${arch} t2 --file=parts.yaml`))
    expect(ok(await p.agent('task show t3')).out).toContain('needs: t1')
    p.write('body.yaml', 'name: Design body\ntext: Write the design body, in two parts.\n' +
      'directions: [tsd-writing]\nneeds: []\nworkspace:\n  - { source: tsd, path: docs/tsd.md }\n')
    // The fix (2026-11-07): the part waits for t1 through its task, and an agent's remake keeps that.
    expect((await p.agent(`task remake ${arch} t3 --file=body.yaml --reason="the body has two parts now"`)).err)
      .toContain("an agent's remake keeps the needs of t3; it may add a need, but only the person drops t1")
  })
})
