import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { changeDirection, codeStarted, evaluated, git, init, INTRO_V1, INTRO_V2, ok, project, reported, started, TASK_WHOLE, tokenIn, withWriter } from './harness.js'

// One test for each round-4 finding that the prototype closes. The ids are those of
// round4/FIXES.md. Round 4 was the last round by the stop rule; DESIGN section 0 lists what
// stays open.

const architect = async (p, on = 'tsd-writing,t1') => {
  ok(await p.nanda(`grant --act=change --on=${on} --to=architect --until=2026-10-26T00:00:00Z`, 'grant'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}
const fresh = async (files) => {
  const p = project(files)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  return p
}

describe('work that must not stop', () => {
  test('FW-1: a forward still works after a direction version becomes official', async () => {
    const { p, lead } = await started()
    await changeDirection(p, 'add:\n  - { id: short, says: Keep it short. }\n', { flags: '--why="Correct the standard"' })
    expect(ok(await p.agent(`forward ${lead} Nanda comment t1 --quote="keep it short" --channel=chat`)).out).toContain("Nanda's comment recorded")
  })

  test('FW-2: after the parts are accepted, next joins; a second split is refused', async () => {
    const p = await fresh({ 'task.yaml': 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    const arch = await architect(p, 't1')
    p.write('parts.yaml', '- { name: Design, text: Write the design., context: { section: design } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    const writer = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nOne file per merchant per day.\n')
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#design`))
    const linter = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the design | no paths or hashes there" ` +
      '--evidence="no-ticket-ids | the design | no ticket ids there"'))
    ok(await p.agent(`review ${arch} r1 accept --evidence="docs/tsd.md, the section | the design says what the part asks"`))
    const next = ok(await p.agent(`next ${arch}`)).out
    expect(next).not.toContain('split t1 first')
    expect(next).toContain(`work assign ${arch} t1 --role=writer`)
    expect((await p.agent(`task split ${arch} t1 --file=parts.yaml`)).err).toContain('t1 already has parts')
  })

  test('FW-4: a join is not refused as untouched work', async () => {
    const p = await fresh({ 'task.yaml': 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    const arch = await architect(p, 't1')
    p.write('parts.yaml', '- { name: Design, text: Write the design., context: { section: design } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    const writer = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nOne file per merchant per day.\n')
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#design`))
    const linter = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the design | no paths or hashes there" ` +
      '--evidence="no-ticket-ids | the design | no ticket ids there"'))
    ok(await p.agent(`review ${arch} r1 accept --evidence="docs/tsd.md, the section | the design says what the part asks"`))
    // One maker writes a file at a time: the part's writer finishes before the joiner starts.
    ok(await p.agent(`finish ${arch} ${writer.split('.')[0]}`))
    const joiner = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${joiner}`))
    expect(ok(await p.agent(`report ${joiner} --output=docs/tsd.md`)).out).toContain('r2 reported on t1')
  })
})

describe('points close only the right way', () => {
  test('R4-1: a split answers only its own task\'s no-rule Reject', async () => {
    const { p, linter } = await reported({ 'task.yaml': TASK_WHOLE })
    ok(await p.agent(`review ${linter} r1 reject --point="cites a ticket" --breaks=no-ticket-ids`))
    const arch = await architect(p, 't1')
    p.write('parts.yaml', '- { name: Part, text: Write it. }\n')
    expect((await p.agent(`task split ${arch} t1 --file=parts.yaml --review=v2`)).err).toContain('names the rule no-ticket-ids')
  })

  test('R4-4: a direction change does not close a point that names a rule', async () => {
    const { p, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="cites a ticket" --breaks=no-ticket-ids`))
    p.write('edit.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    const arch = await architect(p)
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    expect((await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml --answers=v2 --why="Correct the standard"`)).err)
      .toContain('changed work with evidence answers it, not a direction change')
  })

  test('R4-3: a part with the person\'s open Reject is not closed', async () => {
    const p = await fresh({ 'task.yaml': 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    const arch = await architect(p, 't1')
    p.write('parts.yaml', '- { name: Design, text: Write the design., context: { section: design } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    const writer = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nOne file per merchant per day.\n')
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#design`))
    ok(await p.agent(`review ${arch} r1 accept --evidence="docs/tsd.md, the design | the section is there"`))
    ok(await p.nanda('review r1 reject --point="the design hides the double run"'))
    await evaluated(p, 't2')
    // Since the needs model, t1 needs t2, so the close is refused first as a change of scope;
    // and an agent's remake does not drop the person's open Reject either.
    expect((await p.agent(`task close ${arch} t2 --reason="the join writes it"`)).err).toContain('remake t1')
    p.write('narrow.yaml', 'name: The TSD again\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n')
    expect((await p.agent(`task remake ${arch} t1 --file=narrow.yaml --reason="smaller"`)).err).toContain("the person's open")
  })

  test('R4-11: a report equal to earlier rejected work is refused', async () => {
    const { p, writer, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="too vague" --breaks=no-ticket-ids`))
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2.replace('two files', 'two identical files'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).err).toContain('is the same as r1, which was rejected')
  })
})

describe('directions', () => {
  test('R4-6: two directions cannot gain the same rule id through two accepts', async () => {
    const style = 'id: style\nname: Style\nowner: Nanda\nsays: Plain words.\nstandards:\n  - id: plain\n    says: Use plain words.\n    rules: []\n'
    const p = await fresh({ 'directions/style.yaml': style })
    p.write('a.yaml', 'add:\n  - { id: units-a, says: Units., rules: [ { id: units, says: "Units are named", checkedBy: linter } ] }\n')
    p.write('b.yaml', 'add:\n  - { id: units-b, says: Units., rules: [ { id: units, says: "Units are named", checkedBy: linter } ] }\n')
    const a = await changeDirection(p, readFileSync(`${p.dir}/a.yaml`, 'utf8'), { accept: false })
    const b = await changeDirection(p, readFileSync(`${p.dir}/b.yaml`, 'utf8'), { accept: false, direction: 'style' })
    ok(await p.nanda(`review ${a.draft} accept --evidence="a.yaml | units"`, 'accept'))
    expect((await p.nanda(`review ${b.draft} accept --evidence="b.yaml | units"`, 'accept')).err).toContain('is already used by another direction')
  })

  test('R4-9: a revise refuses a checkedBy that names no role', async () => {
    const { p } = await started()
    p.write('edit.yaml', 'add:\n  - { id: odd, says: Odd., rules: [ { id: odd-rule, says: "Odd", checkedBy: lintr } ] }\n')
    expect((await p.agent(`direction revise ${await architect(p)} tsd-writing --file=edit.yaml`)).err).toContain('"lintr", which is not a role')
  })

  test('FW-9: direction revise with no file prints a template', async () => {
    const { p } = await started()
    expect((await p.agent(`direction revise ${await architect(p)} tsd-writing`)).err).toContain('replace:')
  })
})

describe('workspace and sections', () => {
  test('R4-7: a split part keeps its task\'s workspace base', async () => {
    const s = await codeStarted()
    s.p.write('parts.yaml', '- { name: Part, text: Fix it., workspace: [ { source: app, path: app } ] }\n')
    ok(await s.p.nanda('grant --act=change --on=t1 --to=lead --until=2026-10-26T00:00:00Z', 'grant'))
    expect((await s.p.nanda('task split t1 --file=parts.yaml')).err).toContain('with the same base')
  })

  test('R4-10: a task may not report a section that another task of its tree owns', async () => {
    const p = await fresh({ 'task.yaml': 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    const arch = await architect(p, 't1')
    // Since round 5 (R5-5), parts that share a file all own a section, so a part with no
    // section beside a part with one is refused at the split, before any report.
    p.write('parts.yaml', '- { name: Front, text: Write the front. }\n- { name: Design, text: Write the design., context: { section: design } }\n')
    expect((await p.agent(`task split ${arch} t1 --file=parts.yaml`)).err).toContain('and Front has no section; each part needs its own section of the file')
  })

  test('R4-13: a file in directions/ is not part of the store: work reads no direction file', async () => {
    const { p, writer } = await withWriter()
    p.write('directions/notes.yaml', 'x: 1\n')
    expect((await p.agent(`brief ${writer}`)).code).toBe(0)
  })
})

describe('advice', () => {
  test('R4-14: a low checker briefed before any report is told to stop', async () => {
    const { p, lead } = await withWriter()
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    expect(ok(await p.agent(`brief ${linter}`)).out).toContain('nothing is reported yet; STOP and tell your parent')
  })

  test('FW-5: next prints the change step next to the redo', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="cites a ticket" --breaks=no-ticket-ids`))
    ok(await p.agent(`review ${lead} r1 reject --point="the reader cannot see the cost"`))
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).toContain('needs a direction change first')
    expect(next).toContain('redo t1')
  })

  test('FW-6: after a direction change, a program checker is not assigned', async () => {
    const { p, app, lead, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'fix')
    writeFileSync(`${app}/fix.txt`, `fixed\n`)
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'fix')
    ok(await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD').slice(0, 12)}`))
    await changeDirection(p, 'add:\n  - { id: small, says: Keep fixes small. }\n',
      { flags: '--why="Correct the standard"', direction: 'fixes', role: 'tech-lead', on: 'fixes,t1', fit: true })
    // Since round 5 (R5-F6), the new standard has no rule for the gate to check, so the gate
    // does not run again; a role that decides accepts r1 under the new version.
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).not.toContain('--role=gate')
    expect(next).not.toContain('gate runs on the next report of t1')
    expect(next).toContain('decide r1')
    expect(INTRO_V1).toBeDefined()
  })
})
