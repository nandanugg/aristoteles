// The directions live in aristoteles (Nanda, 2026-11-10): aristoteles.yaml names none, a model run
// drafts each new direction (such as the skill that reads an app), and its owner accepts it.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, ok, project, WORK_YAML } from './harness.js'

// A new standard, as a list item of a direction file or of the add of a revise.
const COST = '  - id: cost-first\n    says: Say what the problem costs.\n    rules:\n' +
  '      - { id: names-cost, says: "The introduction names the cost", checkedBy: linter }\n'
const fresh = async (files) => {
  const p = project(files)
  ok(await p.nanda('init'))
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  return p
}

describe('a new direction', () => {
  test('a model run drafts it; the owner accepts it', async () => {
    const p = await fresh()
    expect(ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess')).out)
      .toContain('d1 drafted: the new direction tsd-writing (TSD writing), by assess (a model run); it waits for the accept of Nanda.')
    expect(ok(await p.nanda('direction show d1')).out).toContain('d1 a draft of TSD writing (owner Nanda), a new direction · waits for the accept of Nanda')
    expect(ok(await p.nanda('direction accept d1', 'accept')).out).toContain('d1 is official: tsd-writing@1.')
    expect(ok(await p.nanda('direction show tsd-writing')).out).toContain('made from d1, drafted by assess')
  })

  test('the person gives direction in words; a model drafts it', async () => {
    const p = await fresh()
    expect((await p.nanda('direction new --file=directions/tsd-writing.yaml')).err)
      .toContain('the person gives direction in words: work suggest --says=')
    expect((await p.agent('direction new --file=directions/tsd-writing.yaml')).err)
      .toContain('a model run outside any task names itself: --by=<its name in lower case>')
  })

  test('a suggestion for a new direction is answered by a draft', async () => {
    const p = await fresh()
    expect(ok(await p.nanda('suggest --says="a direction for TSD writing: the reader decides from the page alone"')).out)
      .toContain('next: no agent can draft it now; start a project in your AI CLI, and its host drafts it')
    expect(ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess --answers=s1')).out).toContain('answering s1')
  })

  test('the owner rejects a draft; the run writes another one', async () => {
    const p = await fresh()
    ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess'))
    expect(ok(await p.nanda('direction reject d1 --reason="the intro standard has no rule for the order"')).out).toContain('reject of d1')
    p.write('again.yaml', DIRECTION.replace('Tell the story first, in plain words.', 'Tell the story first, then the cause, in plain words.'))
    expect(ok(await p.agent('direction new --file=again.yaml --by=assess')).out).toContain('d2 drafted: the new direction tsd-writing')
    expect(ok(await p.nanda('direction accept d2', 'accept')).out).toContain('d2 is official: tsd-writing@1.')
  })

  test('a host revises a direction; the owner accepts it, and the version holds the change', async () => {
    const p = await fresh()
    ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess'))
    ok(await p.nanda('direction accept d1', 'accept'))
    p.write('edit.yaml', `add:\n${COST}`)
    expect((await p.agent('direction revise tsd-writing --file=edit.yaml')).err)
      .toContain('a model run outside any task names itself: --by=<its name in lower case>')
    expect(ok(await p.agent('direction revise tsd-writing --file=edit.yaml --by=host')).out)
      .toContain('d2 drafted, built on tsd-writing@1, by host (a model run); it waits for the accept of Nanda.')
    expect(ok(await p.nanda('direction accept d2', 'accept')).out).toContain('d2 is official: tsd-writing@2.')
    const now = ok(await p.nanda('direction show tsd-writing')).out
    expect(now).toContain('tsd-writing@2 TSD writing (owner Nanda) · current\nmade from d2, drafted by host')
    expect(now).toContain('+ cost-first: Say what the problem costs.')
  })

  test('only the owner accepts the first version, also when approvedBy names a role', async () => {
    const p = await fresh({ 'directions/tsd-writing.yaml': DIRECTION.replace('from: [Pathos, Logos]\n', 'from: [Pathos, Logos]\napprovedBy: { order: [architect, Nanda] }\n') })
    ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess'))
    expect(ok(await p.nanda('direction accept d1', 'accept')).out).toContain('d1 is official: tsd-writing@1.')
  })

  test('a revise of a direction with no version is refused', async () => {
    const p = await fresh()
    ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess'))
    p.write('edit.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    expect((await p.agent('direction revise tsd-writing --file=edit.yaml --by=host')).err).toContain('tsd-writing has no version yet')
  })

  test('work guide prints how to write a direction, how to review one, the roles and the limits', async () => {
    const p = await fresh()
    expect(ok(await p.agent('guide writing')).out).toContain('## Write for contextual retrieval')
    expect(ok(await p.agent('guide direction-review')).out).toContain('6. **Negative parallelism.**')
    // Each limit has its action, so that no agent asks the person about a limit.
    const limits = ok(await p.agent('guide limits')).out
    for (const limit of ['Assignment.attempts', 'Review.rules', 'maxStandards']) expect(limits).toContain(`### \`${limit}\``)
    expect(limits.replace(/\s+/g, ' ')).toContain('Do not ask the person about a limit')
    expect((await p.agent('guide other')).err).toContain('work guide <name>: the guides are direction-review, limits, roles, writing')
  })

  test('aristoteles.yaml names no directions', async () => {
    const p = project({ 'aristoteles.yaml': `${WORK_YAML}directions: directions/*.yaml\n` })
    expect((await p.nanda('init')).err).toContain('directions are not files: each one lives in aristoteles')
  })
})
