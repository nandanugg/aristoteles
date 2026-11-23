// The directions live in aristoteles (Nanda, 2026-11-10): aristoteles.yaml names none, a model run
// drafts each new direction (such as the skill that reads an app), and its owner accepts it.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, ok, project, started, WORK_YAML } from './harness.js'

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

  test('the person does not draft; a model drafts it', async () => {
    const p = await fresh()
    expect((await p.nanda('direction new --file=directions/tsd-writing.yaml')).err)
      .toContain('a model drafts a direction; the person accepts or rejects the draft')
    expect((await p.agent('direction new --file=directions/tsd-writing.yaml')).err)
      .toContain('a model run outside any task names itself: --by=<its name in lower case>')
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

  test('revises validate the folded replacement, inherited flow, and superseded rules', async () => {
    const { p } = await started()
    const file = Bun.YAML.parse(DIRECTION)
    const revise = async (edit) => {
      p.write('edit.yaml', Bun.YAML.stringify(edit))
      return p.agent('direction revise tsd-writing --file=edit.yaml --by=host')
    }
    const step = { ...file.flow.at(-1), uses: ['facts-not-proof'] }
    const standard = structuredClone(file.standards[0])
    standard.rules[0].says += '.'
    standard.rules[0].evidence.cases = standard.rules[0].evidence.cases.filter((e) => e.fit === 'Follows')
    const replace = [{ id: standard.id, with: standard }]
    expect((await revise({ flow: [step], replace })).err).toContain('flow step 1: the rules it uses have no case that breaks')
    expect((await revise({ replace })).err).toContain('flow step 5: the rules it uses have no case that breaks')
    expect((await revise({ remove: [standard.id] })).err).toContain('flow step 5 uses "facts-not-proof"')
    expect((await revise({ add: [{ id: 'new-facts', says: 'Facts only.', rules: [
      { id: 'new-facts-rule', says: 'Keep to facts.', supersedes: ['no-code-proof'], evidence: file.standards[0].rules[0].evidence },
    ] }] })).err).toContain('flow step 5 uses "no-code-proof"')
    expect((await revise({ replace: [{ id: standard.id, with: { ...standard, rules: [
      { ...standard.rules[0], evidence: { cases: 'not an array' } },
    ] } }] })).err).toContain('evidence')
    // The same replacement is valid once both fits are actually present in the parsed evidence.
    standard.rules[0].evidence = file.standards[0].rules[0].evidence
    expect(ok(await revise({ flow: [step], replace })).out).toContain('d2 drafted')
  })

  test('accepting cases changes the current evidence while preserving numbered snapshots', async () => {
    const { p } = await started()
    const original = '## Introduction and design, in one section'
    const revised = 'A concrete example of two topics in one section'
    const newest = 'A different example of mixed topics'
    const file = Bun.YAML.parse(DIRECTION)
    const standard = file.standards.find(({ id }) => id === 'intro-story')
    const sample = standard.rules.find(({ id }) => id === 'repeatable').evidence.cases.find(({ fit }) => fit === 'Breaks')
    const revise = async (name, edit) => {
      p.write(name, Bun.YAML.stringify(edit))
      return ok(await p.agent(`direction revise tsd-writing --file=${name} --by=host`)).out
    }
    const show = async (id) => ok(await p.nanda(`direction show ${id}`)).out

    await revise('old-pending.yaml', { says: 'A proposed governance change.' })
    sample.output.written = revised
    await revise('cases.yaml', { replace: [{ id: standard.id, with: standard }] })
    expect(await show('d3')).toContain(revised)
    expect(await show('tsd-writing')).toContain(original)
    expect(ok(await p.nanda('direction accept d3', 'accept')).out).toContain('Updated rule evidence for tsd-writing@1.')
    expect((await p.nanda('direction accept d2', 'accept')).err).toContain("before tsd-writing@1's latest evidence was accepted")
    expect(await show('tsd-writing')).toContain(revised)
    expect(await show('tsd-writing@1')).toContain(original)
    expect((await p.nanda('direction show tsd-writing@2')).err).toContain('has no version 2')

    // The whole-file entry point detects case-only edits too.
    sample.output.written = newest
    p.write('whole.yaml', Bun.YAML.stringify(file))
    expect(ok(await p.agent('direction new --file=whole.yaml --by=host')).out).toContain('d4 drafted')
    expect(await show('d4')).toContain(newest)
    expect(ok(await p.nanda('direction accept d4', 'accept')).out).toContain('Updated rule evidence for tsd-writing@1.')
    expect(await show('d3')).toContain(revised)
    expect(await show('tsd-writing')).toContain(newest)

    // A later change to governance still makes version 2 and carries the current cases forward.
    await revise('governance.yaml', { says: 'Updated direction words.' })
    expect(ok(await p.nanda('direction accept d5', 'accept')).out).toContain('tsd-writing@2')
    expect(await show('tsd-writing@2')).toContain(newest)
    expect(await show('tsd-writing@1')).toContain(original)
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
