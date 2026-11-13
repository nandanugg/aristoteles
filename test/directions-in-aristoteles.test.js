// The directions live in aristoteles (Nanda, 2026-11-10): aristoteles.yaml names none, a model drafts
// each new direction (a high role, or a model run outside any task such as the skill that reads
// an app), and its owner accepts it. A task names only a direction that has a version.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, ok, project, tokenIn, WORK_YAML } from './harness.js'

const SEEN = '--evidence="d1, the whole direction | each standard says what the reader needs"'
const fresh = async (files) => {
  const p = project(files)
  ok(await p.nanda('init'))
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  return p
}

describe('a new direction', () => {
  test('a model run outside any task drafts it; the task waits for its version; the owner accepts it', async () => {
    const p = await fresh()
    expect((await p.nanda('task open --file=task.yaml')).err).toContain('no direction "tsd-writing" with a version')
    expect(ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess')).out)
      .toContain('d1 drafted: the new direction tsd-writing (TSD writing), by assess (a model run outside any task); it waits for the accept of Nanda.')
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).toContain('d1 drafted for tsd-writing by assess')
    expect(ok(await p.nanda('direction show d1')).out).toContain('d1 a draft of TSD writing (owner Nanda), a new direction · waits for the accept of Nanda')
    expect(ok(await p.nanda(`review d1 accept ${SEEN}`, 'accept')).out).toContain('d1 is official: tsd-writing@1.')
    expect(ok(await p.nanda('direction show tsd-writing')).out).toContain('made from d1, drafted by assess')
    ok(await p.nanda('task open --file=task.yaml'))
  })

  test('the person gives direction in words; a model drafts it', async () => {
    const p = await fresh()
    expect((await p.nanda('direction new --file=directions/tsd-writing.yaml')).err)
      .toContain('the person gives direction in words: work suggest --says=')
    expect((await p.agent('direction new --file=directions/tsd-writing.yaml')).err)
      .toContain('a model run outside any task names itself: --by=<its name in lower case>')
  })

  test('a suggestion for a new direction shows to the person until a draft answers it', async () => {
    const p = await fresh()
    ok(await p.nanda('suggest --says="a direction for TSD writing: the reader decides from the page alone"'))
    expect(ok(await p.nanda('waiting')).out).toContain('s1 asks for a new direction: "a direction for TSD writing: the reader decides from the page alone" (Nanda); a model drafts it\n' +
      '    work direction new --file=<direction.yaml> --by=<model> --answers=s1')
    expect(ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess --answers=s1')).out).toContain('answering s1')
    expect(ok(await p.nanda('waiting')).out).not.toContain('s1 asks for a new direction')
  })

  test('after the owner rejects the draft, the run writes another draft that answers the Reject', async () => {
    const p = await fresh()
    ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess'))
    expect(ok(await p.nanda('review d1 reject --reason="the intro standard has no rule for the order"')).out).toContain('d1 is ended')
    expect(ok(await p.nanda('waiting')).out).toContain('its writer assess, a model run outside any task, writes a new draft that answers it\n' +
      '    work direction new --file=<direction.yaml> --by=assess --answers=v1')
    expect((await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess --answers=v1')).err)
      .toContain('this draft proposes the same as d1')
    p.write('again.yaml', DIRECTION.replace('Tell the story first, in plain words.', 'Tell the story first, then the cause, in plain words.'))
    expect(ok(await p.agent('direction new --file=again.yaml --by=assess --answers=v1')).out).toContain('d2 drafted: the new direction tsd-writing')
    expect(ok(await p.nanda('direction show d2')).out).toContain('since d1, which v1 rejected:')
    ok(await p.nanda('review d2 accept --evidence="d2 | the intro standard now says the order"', 'accept'))
    expect((await p.agent('direction new --file=again.yaml --by=assess')).err).toContain('tsd-writing has a version; a high role revises it')
  })

  test('only the owner accepts the first version, also when approvedBy names a role', async () => {
    const p = await fresh({ 'directions/tsd-writing.yaml': DIRECTION.replace('from: [Pathos, Logos]\n', 'from: [Pathos, Logos]\napprovedBy: { order: [architect, Nanda] }\n') })
    ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess'))
    expect(ok(await p.nanda(`review d1 accept ${SEEN}`, 'accept')).out).toContain('d1 is official: tsd-writing@1.')
  })

  test('a high role drafts a new direction with its token; a revise of a direction with no version is refused', async () => {
    const p = await fresh()
    ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess'))
    ok(await p.nanda(`review d1 accept ${SEEN}`, 'accept'))
    ok(await p.nanda('task open --file=task.yaml'))
    const sol = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    p.write('other.yaml', DIRECTION.replaceAll('tsd-writing', 'hld-writing').replace('name: TSD writing', 'name: HLD writing')
      .replaceAll('no-code-proof', 'hld-no-code').replaceAll('no-ticket-ids', 'hld-no-ids').replaceAll('repeatable', 'hld-repeatable'))
    expect(ok(await p.agent(`direction new ${sol} --file=other.yaml`)).out).toContain('d2 drafted: the new direction hld-writing (HLD writing); it waits for the accept of Nanda.')
    p.write('edit.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    expect((await p.agent(`direction revise ${sol} hld-writing --file=edit.yaml`)).err).toContain('hld-writing has no version yet')
  })

  test('work guide prints how to write a direction, how to review one, and the words of a decision', async () => {
    const p = await fresh()
    expect(ok(await p.agent('guide writing')).out).toContain('## Write for contextual retrieval')
    expect(ok(await p.agent('guide direction-review')).out).toContain('6. **Negative parallelism.**')
    expect(ok(await p.agent('guide decision-words')).out).toContain('1. **No ids and no words of the tool.**')
    // Each limit of a tier has its action, so that no agent asks the person about a limit.
    const limits = ok(await p.agent('guide limits')).out
    for (const limit of ['Assignment.attempts', 'Assignment.briefChars', 'Review.rules', 'Result.size', 'maxStandards']) expect(limits).toContain(`### \`${limit}\``)
    expect(limits.replace(/\s+/g, ' ')).toContain('Do not ask the person about a limit')
    expect((await p.agent('guide other')).err).toContain('work guide <name>: the guides are decision-words, direction-review, limits, roles, writing')
  })

  test('aristoteles.yaml names no directions', async () => {
    const p = project({ 'aristoteles.yaml': `${WORK_YAML}directions: directions/*.yaml\n` })
    expect((await p.nanda('init')).err).toContain('directions are not files: each one lives in aristoteles')
  })
})
