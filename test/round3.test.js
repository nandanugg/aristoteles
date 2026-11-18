import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { changeDirection, codeStarted, evaluated, git, init, INTRO_V1, INTRO_V2, ok, project, reported, started, TASK_WHOLE, tokenIn, withWriter, WORK_YAML } from './harness.js'

// One test for each finding of thought-test round 3 that the prototype closes. The id in
// each name is the finding's id in round3/FIXES.md.

const architect = async (p, on = 'tsd-writing,t1') => {
  ok(await p.nanda(`grant --act=change --on=${on} --to=architect --until=2026-10-26T00:00:00Z`, 'grant'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}

describe('the person, and only the person', () => {
  test('I-N1: no role is played by the person', async () => {
    const p = project({ 'aristoteles.yaml': `${WORK_YAML}  nanda:\n    tier: person\n    description: x\n    intro: x\n    responsibilities: [x]\n    acts: [{ review: [writer] }]\n` })
    expect((await p.nanda('init')).err).toContain('roles.nanda: model names an entry of the models table (haiku, sonnet, opus)')
  })

})

describe('directions', () => {
  test('I-N19: an official version lives in aristoteles, no file changes, and work goes on', async () => {
    const { p, writer } = await withWriter()
    const { out } = await changeDirection(p, 'add:\n  - { id: short, says: Keep it short. }\n', { flags: '--why="Correct the standard"' })
    expect(out).toContain('is official: tsd-writing@2.')
    expect(ok(await p.nanda('direction show tsd-writing')).out).toContain('short: Keep it short.')
    expect(await Bun.file(`${p.dir}/directions/tsd-writing.yaml`).text()).not.toContain('Keep it short.')
    expect((await p.agent(`brief ${writer}`)).code).toBe(0)
  })

  test('N2: after a direction change, next checks the unchanged result again; it does not redo it', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids here"'))
    const { out } = await changeDirection(p, 'add:\n  - id: cost\n    says: Say the cost.\n    rules: [ { id: names-cost, says: "The introduction names the cost", checkedBy: linter } ]\n', { flags: '--why="Correct the standard"' })
    expect(out).toContain('now under an old version: r1 (t1)')
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).toContain('check r1 again under the new version')
    expect(next).toContain(`check r1: give a new subagent the command of a3`)
    expect(next).not.toContain('redo t1')
  })

  // N7 (a rule for the joined page through a reserved join key) went with the join key on
  // 2026-10-28: the whole page is decided by the decider of its task (Part 5, Questions 2 and 6).
})

describe('real work only', () => {
  test('I-N8: untouched work is not a report', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).err).toContain('is the same as before any work on t1')
  })

  test('I-N8: a commit already on the base is not a report', async () => {
    const { p, app, impl } = await codeStarted()
    expect((await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'main').slice(0, 12)}`)).err).toContain('is already on main')
  })

  test('I-N7: a commit of a repo inside the workspace is refused', async () => {
    const { p, app, impl } = await codeStarted()
    git(app, 'init', '-q', `${app}/fake`)
    writeFileSync(`${app}/fake/ok.txt`, `hi\n`)
    git(`${app}/fake`, 'add', '.')
    git(`${app}/fake`, 'commit', '-q', '-m', 'fake')
    const sha = git(`${app}/fake`, 'rev-parse', 'HEAD').slice(0, 12)
    expect((await p.agent(`report ${impl} --output=app/fake@${sha}`)).err).toContain('is not in the workspace of t1')
  })

  test('I-N12: punctuation is not evidence', async () => {
    const { p, linter } = await reported()
    expect((await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | introduction | - - -" --evidence="no-ticket-ids | introduction | . . ."`)).err)
      .toContain('in a sentence of words')
  })

  test('I-N15: a gate that cannot run records a reject, and the report stands', async () => {
    const { CODE_YAML } = await import('./harness.js')
    const s = await codeStarted({ 'aristoteles.yaml': CODE_YAML.replace('run: "test -f ok.txt"', 'run: "no-such-gate-program"') })
    git(s.app, 'checkout', '-q', '-b', 'fix')
    writeFileSync(`${s.app}/fix.txt`, `fixed\n`)
    git(s.app, 'add', '.')
    git(s.app, 'commit', '-q', '-m', 'fix')
    const report = ok(await s.p.agent(`report ${s.impl} --output=app@${git(s.app, 'rev-parse', 'HEAD').slice(0, 12)}`)).out
    expect(report).toContain('gate ran on r1: reject (could not run')
    expect(ok(await s.p.agent('blockers r1')).out).toContain('breaks suite-passes')
  })
})

describe('claims and trees', () => {
  test('I-N13: a low checker reviews the result its brief named; a newer one means escalate', async () => {
    const { p, writer, linter } = await reported()
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2.replace('two files', 'two identical files'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const r = await p.agent(`review ${linter} r2 accept --evidence="no-code-proof | the introduction | no paths or hashes" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids here"')
    expect(r.err).toContain('your brief named r1')
    // D10, I5: the choice is the old next line's, in core's words (no token).
    expect(r.err).toContain('next: escalate with --result=r1')
  })

  test('I-N14: a low agent whose unit is done is told to stop', async () => {
    const { p, writer } = await reported()
    const r = await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)
    expect(r.err).toContain('your unit is done')
    expect(r.err).toContain('STOP: your parent continues')
  })

  test('I-N18: a parent with open children does not finish', async () => {
    const { p, lead } = await withWriter()
    // Ruling 10.3 (I2): the parent waits for a child that works; it is told no finish to run.
    expect((await p.agent(`finish ${lead}`)).err).toContain('a1 has open children: a2 (on t1); they still work on open tasks')
    ok(await p.nanda('finish a2'))
    expect(ok(await p.agent(`finish ${lead}`)).out).toBe('a1 is finished.')
  })

  test('L4 and L1: a low checker sees only that its review is recorded; STOP names its act', async () => {
    const { p, linter } = await reported()
    // Ruling 9, onboarding 2026-11-14: the stop line also tells a persistent agent its next wait.
    expect(ok(await p.agent('assignment show a3')).out).toContain(
      'STOP after one review or one escalation.',
    )
    const r = ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids here"')).out
    expect(r).toBe('v2: your review of r1 is recorded.\nSTOP: your parent continues.')
  })

  test('L5: next of a finished assignment says so', async () => {
    const { p, lead } = await started()
    ok(await p.nanda('finish a1'))
    expect(ok(await p.agent(`next ${lead}`)).out).toBe('a1 is finished; there is nothing more for it.')
  })
})

describe('forward', () => {
})

describe('advice', () => {
  test('I-N17: a point with no rule is a change step at once, not a redo', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`review ${lead} r1 reject --point="the section never says who was hurt"`))
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).toContain('v2.1 needs a direction change')
    expect(next).not.toContain('redo t1')
    expect(ok(await p.agent('waiting --for=Nanda')).out).toContain('v2.1 needs a change of tsd-writing')
  })

  test('N11: the maker brief names the gate', async () => {
    const { p } = await codeStarted()
    expect(ok(await p.agent('assignment show a2')).out).toContain('gate: test -f ok.txt (runs on each report')
  })

})
