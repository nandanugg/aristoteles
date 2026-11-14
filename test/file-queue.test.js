// One maker for each file at a time (Nanda, 2026-11-08): makers that write one file in the
// project folder take turns in the order of their assigns. The second assign is stored at once
// (it does not block the lead), and its maker starts when the maker before it finishes.
import { describe, expect, test } from 'bun:test'
import { CODE_TASK, INTRO_V2, TASK_WHOLE, codeStarted, ok, started, tokenIn } from './harness.js'

const PARTS = '- { name: Intro, text: Write the introduction., context: { section: introduction } }\n' +
  '- { name: Design, text: Write the design., context: { section: design } }\n'
const LINT = '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const WITH_DESIGN = INTRO_V2.replace('## Design\n\nTODO', '## Design\n\nOne file per merchant per day.')

// The person splits the TSD into two parts of one file; the lead gives each part to a writer.
async function twoWriters({ attempts = '' } = {}) {
  const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
  p.write('parts.yaml', PARTS)
  ok(await p.nanda('task split t1 --file=parts.yaml'))
  const first = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer${attempts}`)).out)
  const assign = ok(await p.agent(`assign ${lead} t3 --role=writer`)).out
  return { p, lead, first, second: tokenIn(assign), assign }
}
async function introReported(p, lead, first) {
  ok(await p.agent(`brief ${first}`))
  p.write('docs/tsd.md', INTRO_V2)
  ok(await p.agent(`report ${first} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  return linter
}

describe('one maker for each file at a time', () => {
  test('the second maker of a file is stored and waits; its brief is refused before its turn, so it cannot report', async () => {
    const { p, lead, second, assign } = await twoWriters()
    expect(assign).toContain('a3 waits for docs/tsd.md: a2 (t2 Intro) writes it first, and one maker writes a file at a time.')
    // Ruling 10.2: the turn passes when a2 is accepted or idle, not at its finish.
    expect(assign).toContain('Start a Haiku subagent at its turn (work next says when) with this prompt')
    const brief = await p.agent(`brief ${second}`)
    expect(brief.code).toBe(1)
    expect(brief.err).toContain('a3 waits for docs/tsd.md: a2 (t2 Intro) writes it first')
    expect(brief.err).toContain('STOP and do not change docs/tsd.md')
    p.write('docs/tsd.md', WITH_DESIGN)
    // A report needs a brief in this attempt, so a maker that waits cannot report.
    expect((await p.agent(`report ${second} --output=docs/tsd.md#design`)).err).toContain('you have no brief in this attempt')
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('a3 waits for docs/tsd.md: a2 (t2 Intro) writes it first')
    expect(ok(await p.nanda('waiting')).out).toContain('a3 (writer on t3) waits for docs/tsd.md: a2 (t2 Intro) writes it first')
  })

  // Ruling 10.2 (D14, I2): the turn is derived; a settled maker reserves no turn, so the accept of
  // t2 passes the file to a3 at once, with no finish step.
  test('the part of the first maker is accepted: the turn passes to the second maker at once', async () => {
    const { p, lead, first, second } = await twoWriters()
    const linter = await introReported(p, lead, first)
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).not.toContain('finish a2')
    expect(next).toContain('make t3: give a new subagent the command of a3')
    expect(ok(await p.agent(`brief ${second}`)).out).not.toContain('writes docs/tsd.md first')
    p.write('docs/tsd.md', WITH_DESIGN)
    expect(ok(await p.agent(`report ${second} --output=docs/tsd.md#design`)).out).toContain('reported on t3')
  })

  test('a redo keeps the turn: the first maker makes all its attempts before the second maker starts', async () => {
    const { p, lead, first, second } = await twoWriters()
    const linter = await introReported(p, lead, first)
    ok(await p.agent(`review ${linter} r1 reject --point="it names a ticket" --breaks=no-ticket-ids`))
    expect((await p.agent(`brief ${second}`)).err).toContain('a3 waits for docs/tsd.md')
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).toContain('redo t2: give a new subagent the command of a2')
    expect(next).toContain('a3 waits for docs/tsd.md')
    ok(await p.agent(`brief ${first}`))
    p.write('docs/tsd.md', INTRO_V2.replace('two files', 'two files on one day'))
    expect(ok(await p.agent(`report ${first} --output=docs/tsd.md#introduction`)).out).toContain('r2 reported on t2')
  })

  // Ruling 10.2 (D14): a maker with no attempts left holds no turn (its task waits for an
  // evaluation), so the file passes to a3 at once, with no finish step.
  test('a maker with no attempts left holds no file: the second maker starts at once', async () => {
    const { p, lead, first, second } = await twoWriters({ attempts: ' --max-attempts=1' })
    const linter = await introReported(p, lead, first)
    ok(await p.agent(`review ${linter} r1 reject --point="it names a ticket" --breaks=no-ticket-ids`))
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).not.toContain('finish a2')
    expect(next).toContain('make t3: give a new subagent the command of a3')
    ok(await p.agent(`brief ${second}`))
  })

  test('a maker of a folder waits for a maker of a file in that folder', async () => {
    const { p, lead } = await twoWriters()
    p.write('docs.yaml', 'name: The docs\ntext: Tidy the docs.\ndirections: [tsd-writing]\nworkspace:\n  - { source: tsd, path: docs }\n')
    ok(await p.nanda('task open --file=docs.yaml'))
    const lead2 = tokenIn(ok(await p.nanda('assign t4 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const tidy = tokenIn(ok(await p.agent(`assign ${lead2} t4 --role=writer`)).out)
    expect((await p.agent(`brief ${tidy}`)).err).toContain('waits for docs: a2 (t2 Intro) writes it first')
    expect(lead).toBeDefined()
  })

  test('code makers do not wait: each works in its own worktree, and the report checks the files', async () => {
    const { p } = await codeStarted({ 'task2.yaml': CODE_TASK.replace('Fix the key', 'Fix the name') })
    ok(await p.nanda('task open --file=task2.yaml'))
    const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const impl2 = tokenIn(ok(await p.agent(`assign ${lead2} t2 --role=implementer`)).out)
    expect(ok(await p.agent(`brief ${impl2}`)).out).toContain('your worktree:')
  }, 20000)
})
