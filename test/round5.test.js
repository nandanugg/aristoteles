import { describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { changeDirection, evaluated, init, INTRO_V2, ok, project, reported, started, TASK_WHOLE, tokenIn, withWriter, WORK_YAML } from './harness.js'

// One test for each round-5 finding that the prototype closes. The ids are those of
// thought-tests/round-5.md (R5-n from the invariant attacker, R5-Fn from the flows walker).

const TSD_TASK = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
const tsd = (intro, design) => `# TSD\n\n## Introduction\n\n${intro}\n\n## Design\n\n${design}\n`
const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`

const fresh = async (files) => {
  const p = project(files)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  return p
}
const architect = async (p, on = 't1') => {
  ok(await p.nanda(`grant --act=change --on=${on} --to=architect --until=2026-10-26T00:00:00Z`, 'grant'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}
// A writer of the part reports its section with this file text, and a linter accepts it.
const partDone = async (p, arch, part, section, text) => {
  const writer = tokenIn(ok(await p.agent(`assign ${arch} ${part} --role=writer`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', text)
  const result = ok(await p.agent(`report ${writer} --output=docs/tsd.md#${section}`)).out.match(/^(r\d+) reported/)[1]
  const linter = tokenIn(ok(await p.agent(`assign ${arch} ${part} --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} ${result} accept ${LINT(`the ${section}`)}`))
  ok(await p.agent(`review ${arch} ${result} accept --evidence="docs/tsd.md, the section | the section says what the part asks"`))
  // One maker writes a file at a time: the part is accepted, so its writer finishes.
  ok(await p.agent(`finish ${arch} ${writer.split('.')[0]}`))
  return result
}
const DESIGN_PART = '- { name: Design, text: Write the design., context: { section: design } }\n'

describe('the record and the rule ids', () => {
})

describe('work that must not stop', () => {
})

describe('points close only the right way', () => {
})

describe('a rule passes only with what it needs', () => {
  test('R5-3: after a standard changes, a bare accept does not stand in for its checkers', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the introduction')}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    await changeDirection(p, 'replace:\n  - id: intro-story\n    with:\n      id: intro-story\n      where: { section: introduction }\n' +
      '      says: Tell the story first, in plain words, and say who paid for the mistake.\n      rules:\n' +
      '        - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: section-lead }\n',
    { flags: '--why="Correct the standard"' })
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="docs/tsd.md, the section | the text is still fine"`))
    expect(ok(await p.agent('task show t1')).out).not.toContain('Accepted')
    // The lead checks the rule of the changed standard again; the linter's rules did not change.
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can still repeat it"`))
    expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
  })

  test('R5-6: untouched work is refused for a section form', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK })
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead}`))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#design`)).err).toContain('the same as before any work')

  })

})

describe('no dead ends', () => {
  test('R5-9: a Reject of a task names no rule, also through a forward', async () => {
    const { p, lead } = await withWriter()
    const forwarded = await p.agent(`forward ${lead} Nanda reject t1 --quote="no ticket ids in this task, ever" ` +
      '--point="no ticket ids in this task" --breaks=no-ticket-ids --channel=chat')
    expect(forwarded.err).toContain('a Reject of a task names no rule')
    expect((await p.nanda('review t1 reject --point="no ticket ids" --breaks=no-ticket-ids')).err).toContain('a Reject of a task names no rule')
  })

  test('R5-10: an official draft that takes a rule off the task answers the points on that rule', async () => {
    const { p, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="cites a ticket" --breaks=no-ticket-ids`))
    await changeDirection(p, 'replace:\n  - id: facts-not-proof\n    with:\n      id: facts-not-proof\n      says: The body states facts.\n      rules:\n' +
      '        - { id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }\n',
    { flags: '--answers=v2.1 --why="Correct the rule"' })
    // r1 stays rejected; the point is answered, so the next result does not carry it.
    const blockers = ok(await p.agent('blockers r1')).out
    expect(blockers).toContain('tsd-writing@2 answered it (no-ticket-ids left the task)')
    expect(blockers).not.toContain('breaks no-ticket-ids')
    expect(ok(await p.nanda('waiting')).out).not.toContain('v2.1')
  })

  test('R5-F3: waiting shows that the person\'s own split can answer their point', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    ok(await p.nanda('review r1 reject --point="the story needs the cost"'))
    await evaluated(p, 't1', 'task')
    // t1 has a section, so it is one unit: the person's own remake answers the point (a split is refused).
    expect(ok(await p.nanda('waiting')).out).toContain('work task remake t1 --file=<task.yaml> --reason="<how the scope changed>" --review=v3.1')
  })

  test('R5-F7: a maker with no attempts left takes no claim', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`review ${lead} r1 reject --point="the story has no cost"`))
    // The last try ended on a fault: the brief is refused until the task is evaluated (2026-11-08).
    const brief = await p.agent(`brief ${writer}`)
    expect(brief.err).toContain('t1 waits for an evaluation of the last try of a2')
    expect(brief.err).toContain('STOP and tell your parent')
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('claimed since')
  })

  test('R5-F8: next says what to do when the parent lost the token of its child', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`free ${lead} a2`))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain(`Only if you lost that token: work finish ${lead} a2, then work assign ${lead} t1 --role=writer (a new maker; when its latest try has a fault, the task waits for an evaluation first)`)
  })

  test('R5-F9: waiting names a task that no open assignment works on', async () => {
    const p = await fresh()
    expect(ok(await p.nanda('waiting')).out).toContain('t1 The Introduction is Open, and no open assignment works on it')
  })

  test('R5-F10: an accepted result names its output', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the introduction')}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    expect(ok(await p.agent('blockers r1')).out).toContain('r1 (docs/tsd.md#introduction) has no blockers')
  })
})

describe('the record and the words', () => {
  test('R5-F11: a missing token and a missing file say what is missing', async () => {
    const { p } = await started()
    expect((await p.nanda('next')).err).toContain('this command needs your assignment token')
    expect((await p.nanda('task open --file=nope.yaml')).err).toContain('there is no file nope.yaml')
  })
})
