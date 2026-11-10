// Round 7, attacker D: regions, flags, and briefs. Each test expects the CORRECT behaviour,
// so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { init, INTRO_V2, ok, project, reported, tokenIn, withWriter } from './harness.js'

const WHOLE = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
const start = async (files = {}) => {
  const p = project({ 'task.yaml': WHOLE, ...files })
  await init(p)
  for (const role of ['architect', 'region-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  return p
}
// The person gives a part to a region lead, the lead gives it to a writer; both read their briefs.
const writerOn = async (p, task) => {
  const lead = tokenIn(ok(await p.nanda(`assign ${task} --role=region-lead`)).out)
  ok(await p.agent(`brief ${lead}`))
  const writer = tokenIn(ok(await p.agent(`assign ${lead} ${task} --role=writer`)).out)
  ok(await p.agent(`brief ${writer}`))
  return { lead, writer }
}

describe('D4 parts that share a file each need their own region: a region inside another', () => {
  test('a part whose region is a sub-heading of another part\'s region changes that part\'s reported work', async () => {
    const tsd = (design, details) => `# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\n${design}\n\n### Design details\n\n${details}\n`
    const p = await start({ 'docs/tsd.md': tsd('TODO', 'TODO') })
    p.write('parts.yaml', '- { name: Design, text: Write the design., context: { region: design } }\n' +
      '- { name: Details, text: Write the design details., context: { region: design-details } }\n')
    const split = await p.nanda('task split t1 --file=parts.yaml')
    // The fix (2026-11-07): a region inside another part's region is refused at the split.
    expect(split.err).toContain('lies inside the region design')
  })
})

describe('D5 a task with a region is not split', () => {
  test('a split of t1 (region introduction) into one part is accepted', async () => {
    const p = project()
    await init(p)
    for (const role of ['architect', 'region-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    p.write('parts.yaml', '- { name: Problem, text: Write the problem. }\n')
    const split = await p.nanda('task split t1 --file=parts.yaml')
    // Correct: refused; t1 and its part would share the region introduction.
    expect(split.code).toBe(1)
  })
})

describe('D6 a command refuses a flag that it does not read', () => {
  test('a decider\'s accept with a --point stores the accept and drops the point', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ` +
      '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the region" ' +
      '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the region"'))
    const r = await p.agent(`review ${lead} r1 accept --evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export" ` +
      '--point="the impact on the merchant is missing"')
    // Correct: an accept does not read --point, so it is refused before it stores anything.
    expect(r.code).toBe(1)
    expect(r.err).toContain('--point')
  })

  test('a direction revise with --reason (it reads --why) is stored, and the reason is dropped', async () => {
    const { p } = await reported()
    p.write('edit.yaml', 'add:\n  - id: impact\n    says: Say the impact.\n    rules:\n' +
      '      - { id: merchant-impact, says: "The region says what the merchant sees", checkedBy: linter }\n')
    const r = await p.nanda('direction revise tsd-writing --file=edit.yaml --reason="the merchant impact was missing"')
    // Correct: refused before it stores anything; revise reads --answers and --why.
    expect(r.code).toBe(1)
    expect(r.err).toContain('--reason')
  })

  test('a misspelled flag (--max_attempts) is taken as a word and dropped', async () => {
    const { p, lead } = await withWriter()
    const r = await p.agent(`assign ${lead} t1 --role=linter --max_attempts=1`)
    // Correct: refused, as work assign has no flag --max_attempts.
    expect(r.code).toBe(1)
  })
})

describe('D7 the person\'s answer reaches the low maker', () => {
  test('after a new lead, the new writer\'s brief does not show the person\'s answer about its task', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`raise ${writer} --reason="which merchant is it?"`))
    ok(await p.agent(`ask ${lead} --text="The writer asks which merchant it is." --to=owner`))
    ok(await p.nanda('answer q2 --text="M-104"'))
    ok(await p.agent(`answer ${lead} q1 --text="see the owner's answer"`))
    // The lead's subagent stops; the person finishes it and gives t1 to a new lead.
    ok(await p.nanda('finish a2'))
    ok(await p.nanda('finish a1'))
    const lead2 = tokenIn(ok(await p.nanda('assign t1 --role=region-lead')).out)
    expect(ok(await p.agent(`brief ${lead2}`)).out).toContain('M-104')
    const writer2 = tokenIn(ok(await p.agent(`assign ${lead2} t1 --role=writer`)).out)
    // Correct: the writer of t1 reads the person's answer about t1, as the first writer did.
    expect(ok(await p.agent(`brief ${writer2}`)).out).toContain('M-104')
  })
})
