import { describe, expect, test } from 'bun:test'
import { DIRECTION, init, INTRO_V2, ok, project, reported, started, tokenIn, WORK_YAML } from './harness.js'

const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'
const READ = '--evidence="docs/tsd.md, the introduction | it tells the problem"'

// The architect is the parent of the section lead: Nanda gives t1 to the architect, the
// architect gives it to a section lead, the lead runs the writer and the linter.
async function underArchitect(decide) {
  const p = project({ 'aristoteles.yaml': `${WORK_YAML}decide:\n  - { resultsOf: writer, by: ${decide} }\n` })
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  const lead = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=section-lead`)).out)
  ok(await p.agent(`brief ${lead}`))
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V2)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
  ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
  return { p, arch, lead }
}

describe('who decides: the second decider is the parent of the lead', () => {
  test('order [section-lead, architect]: after the lead accepts, some next names the architect\'s decide', async () => {
    const { p, arch, lead } = await underArchitect('{ order: [section-lead, architect] }')
    expect(ok(await p.agent('blockers r1')).out).toContain('no accept yet by architect')
    const steps = [ok(await p.agent(`next ${arch}`)).out, ok(await p.agent(`next ${lead}`)).out,
      ok(await p.nanda('waiting')).out].join('\n')
    expect(steps).toContain('decide r1')
  })

  test('and [section-lead, architect]: after the lead accepts, some next names the architect\'s decide', async () => {
    const { p, arch, lead } = await underArchitect('{ and: [section-lead, architect] }')
    expect(ok(await p.agent('blockers r1')).out).toContain('no accept yet by architect')
    const steps = [ok(await p.agent(`next ${arch}`)).out, ok(await p.agent(`next ${lead}`)).out,
      ok(await p.nanda('waiting')).out].join('\n')
    expect(steps).toContain('decide r1')
  })
})

describe('who decides: one accept counts once', () => {
  // The fix (2026-11-07): init refuses an entry that names a role two times.
  test('and [section-lead, section-lead]: init refuses it', async () => {
    const twice = `${WORK_YAML}decide:\n  - { resultsOf: writer, by: { and: [section-lead, section-lead] } }\n`
    const init = await project({ 'aristoteles.yaml': twice }).nanda('init')
    expect(init.err).toContain('names section-lead two times; each item needs its own accept')
  })
})

describe('approvedBy: the order of the draft reviews', () => {
  // The fix (2026-11-07): a draft review before its turn is refused, as a decide before its turn.
  test('order [architect, section-lead, Nanda]: a review before its turn is refused', async () => {
    const direction = DIRECTION.replace('from: [Pathos, Logos]\n',
      'from: [Pathos, Logos]\napprovedBy: { order: [architect, section-lead, Nanda] }\n')
    const { p, lead } = await started({ 'directions/tsd-writing.yaml': direction })
    // A first architect drafts the change; a second one reviews it (the reviser cannot).
    const reviser = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${reviser}`))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: units, says: Numbers have units. }\n')
    ok(await p.agent(`direction revise ${reviser} tsd-writing --file=edit.yaml --why="Correct the standard"`))
    const early = await p.agent(`review ${lead} d2 accept --evidence="edit.yaml | precise: it says what to check"`)
    expect(early.err).toContain('a1 (section-lead) reviews d2 after the accept of architect')
    ok(await p.agent(`review ${arch} d2 accept --evidence="edit.yaml | precise: it names the units"`))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('review d2')
    ok(await p.agent(`review ${lead} d2 accept --evidence="edit.yaml | precise: it says what to check"`))
    expect(ok(await p.nanda('review d2 accept --evidence="edit.yaml | the units"', 'accept')).out).toContain('d2 is official: tsd-writing@2')
  })

  // The fix (2026-11-07): the approve is the last accept, so init refuses a person before
  // another item of an order.
  test('order [Nanda, architect]: the draft of the direction is refused', async () => {
    const direction = DIRECTION.replace('from: [Pathos, Logos]\n',
      'from: [Pathos, Logos]\napprovedBy: { order: [Nanda, architect] }\n')
    const p = project({ 'directions/tsd-writing.yaml': direction })
    ok(await p.nanda('init'))
    const init = await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess')
    expect(init.err).toContain('names Nanda before another item of an order; the person approves last')
  })
})
