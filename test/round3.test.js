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
    expect((await p.nanda('init')).err).toContain('tier is low, medium, or high (the person needs no role)')
  })

  // Every path by which an agent could act for the person, tried in one table.
  test('invariant: an agent cannot resolve the person\'s escalation, or accept for the person', async () => {
    const { p, lead } = await reported()
    const escalation = ok(await p.agent(`escalate ${lead} --result=r1 --reason="only Nanda decides this"`)).out.match(/^(v\d+)/)[1]
    expect((await p.agent(`resolve ${lead} ${escalation} --resolution="I decided it myself"`)).err).toContain('may not resolve')
    expect((await p.agent(`forward ${lead} Nanda accept r1 --evidence="repeatable | the introduction | a reviewer can repeat it" --quote="fine"`)).err)
      .toContain('Nanda approves directions and standards')
  })

  test('I-N6: the confirm of a forwarded accept shows the draft', async () => {
    const { p } = await started()
    const arch = await architect(p)
    p.write('edit.yaml', 'remove: [intro-story]\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const forwarded = ok(await p.agent(`forward ${arch} Nanda accept d2 --evidence="edit.yaml | the cleanup" --quote="yes, go ahead with the cleanup"`)).out
    const id = forwarded.match(/^(e\d+)/)[1]
    const r = ok(await p.nanda(`confirm ${id}`, 'confirm'))
    expect(r.out).toContain('- intro-story: Tell the story first, in plain words.')
  })

  test('I-N10: a split does not answer the person\'s Reject', async () => {
    const { p, lead } = await reported({ 'task.yaml': TASK_WHOLE })
    ok(await p.agent(`review ${lead} r1 accept --evidence="docs/tsd.md, the introduction | the story is told there"`))
    ok(await p.nanda('review r1 reject --point="the story does not say who was hurt"'))
    await evaluated(p, 't1')
    const arch = await architect(p, 't1')
    p.write('one.yaml', '- { name: Introduction again, text: Write the Introduction again. }\n')
    expect((await p.agent(`task split ${arch} t1 --file=one.yaml --review=v3`)).err).toContain("is the person's Reject; only that person's own split answers it")
  })
})

describe('directions', () => {
  test('I-N4: a revise refuses a second rule with an existing id', async () => {
    const { p } = await started()
    const arch = await architect(p)
    p.write('edit.yaml', 'add:\n  - id: twin\n    says: A twin.\n    rules: [ { id: repeatable, says: "The section has a first sentence", checkedBy: linter } ]\n')
    expect((await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`)).err).toContain('"repeatable" is already used')
  })

  test('I-N5: a medium does not accept a draft of a direction, even with a change grant', async () => {
    const { p, lead } = await started()
    ok(await p.nanda('grant --act=change --on=tsd-writing --to=section-lead --until=2026-10-26T00:00:00Z', 'grant'))
    p.write('edit.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const r = await p.agent(`review ${lead} d2 accept --evidence="edit.yaml | mine"`)
    // DESIGN: a medium role changes no direction. Its accept is recorded, but only a high role
    // with a Change act stands in for the owner, so the draft still waits for Nanda.
    expect(ok(r).out).toContain('v2: accept of d2; it waits for the accept of Nanda.')
    expect(ok(await p.nanda('direction show tsd-writing')).out).toContain('tsd-writing@1 TSD writing (owner Nanda) · current')
  })

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

  test('I-N11: a part may not report a section that a sibling part owns', async () => {
    const p = project({ 'task.yaml': 'name: The whole TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    const arch = await architect(p, 't1')
    // Since round 5 (R5-5), the split itself is refused: in one file, every part has a section.
    p.write('parts.yaml', '- { name: Intro, text: Write the intro., context: { section: introduction } }\n- { name: Design, text: Write the design. }\n')
    expect((await p.agent(`task split ${arch} t1 --file=parts.yaml`)).err).toContain('and Design has no section; each part needs its own section of the file')
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
  test('I-N2: a checkpoint stays in its own tree; resume names who saved it', async () => {
    const { p, lead } = await started()
    p.write('t2.yaml', 'name: The Design\ntext: Write the Design.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n')
    ok(await p.nanda('task open --file=t2.yaml'))
    expect((await p.agent(`checkpoint ${lead} t2 --next="close it"`)).err).toContain('t2 is outside the task tree of a1')
    ok(await p.agent(`checkpoint ${lead} t1 --next="assign the writer"`))
    expect(ok(await p.agent(`resume ${lead} t1`)).out).toContain('resume t1 from k1 (saved by a1)')
  })

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
    expect(ok(await p.agent('assignment show a3')).out).toContain('STOP after one review or one escalation.')
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
  test('I-N16: a forward names a real channel and a target in the tree; an impossible answer is refused at once', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`escalate ${writer} --reason="which merchant is it?"`))
    expect((await p.agent(`forward ${lead} Nanda comment t1 --quote="use the merchant name" --channel=terminal`)).err).toContain('--channel is chat or github')
    const r = await p.agent(`forward ${lead} Nanda answer q1 --quote="M-104"`)
    expect(r.err).toContain('Nanda could not answer q1 now')
    expect(r.err).toContain('--to=owner')
    expect((await p.agent(`forward ${lead} Nanda ask zzz --quote="why the ticket?"`)).err).toContain('"zzz" is not')
  })

  test('F-C6: a forwarded point shows the person\'s words', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    ok(await p.agent(`forward ${lead} Nanda reject r1 --point="no cost" --quote="the reader cannot see what it cost us"`))
    expect(ok(await p.agent('blockers r1')).out).toContain('Nanda (forwarded): "the reader cannot see what it cost us"')
  })
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

  test('N3: long answers are cut in briefs, and question show prints them in full', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`escalate ${writer} --reason="which merchant?"`))
    const long = 'M-104. '.repeat(60)
    ok(await p.agent(`answer ${lead} q1 --text="${long}"`))
    expect(ok(await p.agent(`brief ${writer}`)).out).toContain('(in full: work question show q1)')
    expect(ok(await p.agent('question show q1')).out).toContain(long.trim())
  })

  test('N11: the maker brief names the gate', async () => {
    const { p } = await codeStarted()
    expect(ok(await p.agent('assignment show a2')).out).toContain('gate: test -f ok.txt (runs on each report')
  })

  test('N15: waiting hides an escalation on an old result', async () => {
    const { p, lead, writer, linter } = await reported()
    ok(await p.agent(`escalate ${linter} --result=r1 --reason="is two files a cost?"`))
    expect(ok(await p.agent('waiting')).out).toContain('v2 escalated on r1')
    ok(await p.agent(`review ${lead} r1 reject --point="names no cost" --breaks=no-ticket-ids`))
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2.replace('two files', 'two files and a double export'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    expect(ok(await p.agent('waiting')).out).not.toContain('v2 escalated on r1')
  })

  test('N17: a high agent splits first', async () => {
    const p = project({ 'task.yaml': TASK_WHOLE })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    const arch = await architect(p, 't1')
    expect(ok(await p.agent(`next ${arch}`)).out).toContain(`split t1 first, then give each part to a medium role`)
  })
})
