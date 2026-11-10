import { describe, expect, test } from 'bun:test'
import { DIRECTION, INTRO_V2, WORK_YAML, changeDirection, evaluated, ok, project, reported, started, tokenIn } from './harness.js'

// The rulings of 2026-11-07 (DESIGN.md section 11): the workflow writes who decides (Or, And,
// Order); the person reads a result at any time and criticises it after its deciders accept it;
// only a fault uses an attempt, and an approved change resets the attempts.

const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'
const READ = '--evidence="docs/tsd.md, the introduction | it tells the problem"'

describe('who decides, as the workflow writes it', () => {
  test('order: the architect decides a writer result only after the region lead accepts it', async () => {
    const order = `${WORK_YAML}decide:\n  - { resultsOf: writer, by: { order: [region-lead, architect] } }\n`
    const { p, lead, linter } = await reported({ 'work.yaml': order })
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    expect((await p.agent(`review ${arch} r1 accept ${READ}`)).err).toContain('architect decides this result after the accept of region-lead')
    expect(ok(await p.agent('blockers r1')).out).toContain('no accept yet by region-lead')
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    expect(ok(await p.agent('blockers r1')).out).toContain('no accept yet by architect')
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('decide r1')
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('decide r1')
    ok(await p.agent(`review ${arch} r1 accept ${READ}`))
    expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
  })

  test('a decide entry names only roles that approve the maker', async () => {
    const wrong = `${WORK_YAML}decide:\n  - { resultsOf: writer, by: { and: [region-lead, linter] } }\n`
    const p = project({ 'work.yaml': wrong })
    expect((await p.nanda('init')).err).toContain('linter has no Approve act on writer')
  })

  test('approvedBy: a new draft waits for the review of the architect, then the person accepts it', async () => {
    const direction = DIRECTION.replace('from: [Pathos, Logos]\n', 'from: [Pathos, Logos]\napprovedBy: { order: [architect, Nanda] }\n')
    const { p } = await started({ 'directions/tsd-writing.yaml': direction })
    // One architect drafts the change; a second one reviews it (the reviser cannot).
    const reviser = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${reviser}`))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: units, says: Numbers have units. }\n')
    ok(await p.agent(`direction revise ${reviser} tsd-writing --file=edit.yaml --why="name the units"`))
    const early = await p.nanda('review d2 accept --evidence="edit.yaml | name the units"', 'accept')
    expect(early.err).toContain('Nanda reviews d2 after the accept of architect')
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('review d2: a draft of TSD writing waits for your accept')
    ok(await p.agent(`review ${arch} d2 accept --evidence="edit.yaml | precise: it says what to check"`))
    expect(ok(await p.agent(`next ${arch}`)).out).not.toContain('review d2')
    ok(await p.nanda('review d2 accept --evidence="edit.yaml | name the units"', 'accept'))
    expect(ok(await p.agent('direction show tsd-writing')).out).toContain('Numbers have units.')
  })
})

describe('the person reads a result at any time, and criticises it after its deciders', () => {
  test('the CLI refuses the person\'s accept of a result, and a reject before the decider accepts', async () => {
    const { p, lead } = await reported()
    expect((await p.nanda(`review r1 accept ${READ}`)).err).toContain('Nanda approves directions and standards')
    expect((await p.nanda('review r1 reject --point="the story needs the cost"')).err)
      .toContain('this result waits for the accept of a role that decides it; criticise it after its deciders accept it')
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    ok(await p.nanda('review r1 reject --point="the story needs the cost"'))
  })

  // Nanda: "we can critique a task before or after it's done".
  test('the person criticises a task at any time, also before its deciders act', async () => {
    const { p } = await reported()
    ok(await p.nanda('review t1 reject --point="the task must also name the cost"'))
    expect(ok(await p.agent('task show t1')).out).toContain('Returned')
  })
})

describe('a criticism waits for its change', () => {
  test('while a draft waits for its accept, next names it instead of asking for another change', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    ok(await p.nanda('review r1 reject --point="the first paragraph does not say what happened"'))
    await evaluated(p, 't1')
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('v3.1 needs a direction change')
    await changeDirection(p, 'add:\n  - { id: first, says: The first paragraph says what happened. }\n', { accept: false })
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).toContain('d2 waits for the accept of Nanda')
    expect(next).not.toContain('--reason="v3.1 needs a direction change"')
  })
})

describe('only a fault uses an attempt', () => {
  test('a recheck uses no attempt; a fault uses the last one; an approved change resets them', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    // r1 is accepted; the recheck reopens it (a recheck of work that nothing changed would be a free try).
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    ok(await p.agent(`recheck ${lead} r1 --reason="the facts moved"`))
    expect(ok(await p.agent(`brief ${writer}`)).out).toContain('attempt 1 of 1')
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`review ${lead} r2 reject --point="a reviewer cannot repeat it" --breaks=repeatable`))
    expect((await p.agent(`brief ${writer}`)).err).toContain('t1 waits for an evaluation of the last try of a2')
    await evaluated(p, 't1')
    await changeDirection(p, 'add:\n  - { id: units, says: Numbers have units. }\n', { flags: '--why="name the units"' })
    const brief = ok(await p.agent(`brief ${writer}`)).out
    expect(brief).toContain('attempt 1 of 1')
    expect(brief).not.toContain('has used its 1 attempts')
  })
})
