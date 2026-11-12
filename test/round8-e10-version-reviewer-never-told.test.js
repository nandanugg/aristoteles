// Round 8, attacker E. Rule (round 7, C-V1): "a version is reviewed outside the tree of its
// suggester, and waiting names that assign"; DESIGN: every line says what to do next. waiting names
// any open assignment of the role as the reviewer (the words: reviewer = any open architect outside
// the suggester's tree), but next shows the review step only to an assignment whose task tree
// follows the direction (the words: own). An architect of another task tree is named as the
// reviewer, and nothing ever tells it to review.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, init, ok, project, tokenIn } from
  './harness.js'

const STYLE = `id: page-style
name: Page style
owner: Nanda
says: Pages read the same way.
standards:
  - id: short-lines
    says: Lines stay short.
    rules:
      - { id: line-length, says: "No line is longer than 100 characters", checkedBy: linter }
`
const T2 = 'name: Style pass\ntext: Make the lines of the style page short.\ndirections: [page-style]\n' +
  'workspace:\n  - { source: style, path: docs/style.md }\n'

describe('E10 approvedBy order [architect, Nanda]: waiting says the version waits for a2, and a2 is never told', () => {
  test('a1 (t1) suggests tsd-writing@2; a2 (architect of t2, page-style only) is named as the reviewer; its next has no review step', async () => {
    const direction = DIRECTION.replace('from: [Pathos, Logos]\n', 'from: [Pathos, Logos]\napprovedBy: { order: [architect, Nanda] }\n')
    const p = project({ 'directions/tsd-writing.yaml': direction, 'directions/page-style.yaml': STYLE, 't2.yaml': T2,
      'docs/style.md': '# Style\n\nok\n' })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    ok(await p.nanda('task open --file=t2.yaml'))
    const a1 = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${a1}`))
    const a2 = tokenIn(ok(await p.nanda('assign t2 --role=architect')).out)
    ok(await p.agent(`brief ${a2}`))
    p.write('edit.yaml', 'add:\n  - { id: units, says: Numbers have units. }\n')
    ok(await p.agent(`direction revise ${a1} tsd-writing --file=edit.yaml`))
    const waiting = ok(await p.nanda('waiting')).out
    const a2Next = ok(await p.agent(`next ${a2}`)).out
    // Correct: when waiting says that the version waits for a2, a2's next prints the review step
    // (a2 may review it: work direction review passes for it); else waiting prints the assign.
    // Today waiting says "tsd-writing@2 waits for the review of a2 (architect) before you approve
    // it", and a2's next prints only "make t2 Style pass".
    if (waiting.includes('waits for the review of a2 (architect)')) {
      expect(a2Next).toContain('work direction review')
    } else {
      expect(waiting).toMatch(/work assign t1 --role=architect/)
    }
  })
})
