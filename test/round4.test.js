import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { changeDirection, codeStarted, evaluated, git, init, INTRO_V1, INTRO_V2, markedOf, ok, project, reported, started, TASK_WHOLE, tokenIn, withWriter } from './harness.js'

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

})

describe('points close only the right way', () => {
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
    // Nanda, 2026-11-15: a direction has a summary.
    const style = 'id: style\nname: Style\nowner: Nanda\nsummary: Plain words.\nsays: Plain words.\nstandards:\n  - id: plain\n    says: Use plain words.\n    rules: []\n' +
      markedOf('style')
    const p = await fresh({ 'directions/style.yaml': style })
    p.write('a.yaml', 'add:\n  - { id: units-a, says: Units., rules: [ { id: units, says: "Units are named", checkedBy: linter } ] }\n')
    p.write('b.yaml', 'add:\n  - { id: units-b, says: Units., rules: [ { id: units, says: "Units are named", checkedBy: linter } ] }\n')
    const a = await changeDirection(p, readFileSync(`${p.dir}/a.yaml`, 'utf8'), { accept: false })
    const b = await changeDirection(p, readFileSync(`${p.dir}/b.yaml`, 'utf8'), { accept: false, direction: 'style' })
    ok(await p.nanda(`review ${a.draft} accept --evidence="a.yaml | units"`, 'accept'))
    expect((await p.nanda(`review ${b.draft} accept --evidence="b.yaml | units"`, 'accept')).err).toContain('is already used by another direction')
  })

})

describe('workspace and sections', () => {
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
    expect(ok(await p.agent(`brief ${linter}`)).out).toContain('nothing is reported yet. Run work escalate')
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
    // Live, 2026-11-15: an accept counts only under the versions now, so the lead whose brief is
    // older reads it again first, then decides r1.
    const stale = ok(await p.agent(`next ${lead}`)).out
    expect(stale).toContain('read your brief again first')
    ok(await p.agent(`brief ${lead}`))
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).not.toContain('--role=gate')
    expect(next).not.toContain('gate runs on the next report of t1')
    expect(next).toContain('decide r1')
    expect(INTRO_V1).toBeDefined()
  })
})
