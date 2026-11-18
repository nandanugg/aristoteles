import { describe, expect, test } from 'bun:test'
import { init, INTRO_V1, INTRO_V2, ok, project, started, TASK_WHOLE, tokenIn, withWriter } from './harness.js'

// Each test drives the CLI as its users do: the person at a terminal, agents with tokens.
// The briefs and refusals are golden: the snapshot is the exact text that an agent reads.

describe('the Introduction: write, reject with a point, fix, accept', () => {
  test('each role reads its own brief, and the task ends Accepted', async () => {
    const { p, lead, writer } = await withWriter()
    expect(ok(await p.agent(`brief ${writer}`)).out).toMatchSnapshot('writer brief, attempt 1')
    p.write('docs/tsd.md', INTRO_V1)
    expect(ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).out).toContain('r1 reported')
    expect(ok(await p.agent(`next ${lead}`)).out).toContain(`work assign ${lead} t1 --role=linter`)
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    expect(ok(await p.agent(`brief ${linter}`)).out).toMatchSnapshot('linter brief on r1')
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))

    const second = ok(await p.agent(`brief ${writer}`)).out
    expect(second).toMatchSnapshot('writer brief, attempt 2')
    expect(second).toContain('v2.1 breaks no-ticket-ids: "the first line cites ABC-2964" (on r1, a3)')

    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r2 accept --evidence="no-code-proof | the introduction | no paths or hashes" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids here"'))
    expect(ok(await p.agent('blockers r2')).out).toContain('no evidence on r2 for repeatable (checked by section-lead)')
    const last = ok(await p.agent(`review ${lead} r2 accept --evidence="repeatable | the introduction | I can repeat the double export"`))
    expect(last.out).toContain('t1 is Accepted')
  })

  test('the medium brief lists the ready steps with the lead token filled in', async () => {
    const { p, lead } = await started()
    const brief = ok(await p.agent(`assignment show a1`)).out
    // The waiver is removed (the owner's ruling 10, 2026-11-12): the brief names no waive.
    expect(brief).not.toContain('waive')
    // The snapshot changed for ruling 10.1 (the stop line: hold work wait, nothing is typed) and
    // ruling 10.13 (one source of instructions: never fix the project's own copy).
    expect(brief).toMatchSnapshot('section-lead brief')
    expect(brief).toContain('work assign a1.<token> t1 --role=writer')
    expect(lead).toBe('a1.k0001')
  })
})

describe('identity: tokens and the terminal', () => {
  test('an agent with no terminal cannot act as the person', async () => {
    const { p } = await started()
    const r = await p.agent('assign t1 --role=writer')
    expect(r.code).toBe(1)
    expect(r.err).toMatchSnapshot('person command from an agent shell')
  })

  test('a bare id, or a wrong secret, is refused', async () => {
    const { p } = await withWriter()
    expect((await p.agent('brief a2')).err).toContain('a2 is an id; the command needs the token that assign printed')
    expect((await p.agent('brief a2.zzzzz')).err).toContain('the token of a2 is wrong')
  })

  test('the store keeps only a hash of each token', async () => {
    const { p, writer } = await withWriter()
    const db = await Bun.file(`${p.dir}/.work/aristoteles.db`).text()
    expect(db.includes(writer.split('.')[1])).toBe(false)
  })

})

describe('the claim of an attempt', () => {

  test('a report needs a brief in this attempt', async () => {
    const { p, writer } = await withWriter()
    const r = await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)
    // D10, I5: the next line is the real choice (read the brief), with no token in core's words.
    expect(r.err).toMatchSnapshot('report without a brief')
  })
})

describe('what was reviewed is what was reported', () => {
  test('a review of work that changed after the report is refused', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    p.write('docs/tsd.md', INTRO_V2)
    const r = await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | x | y" --evidence="no-ticket-ids | x | y"`)
    // D10, I5: the next line is the real choice (escalate), with no token in core's words.
    expect(r.err).toMatchSnapshot('review of changed work')
  })

  test('the output must have the form of the role, and the section must exist', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    expect((await p.agent(`report ${writer} --output=docs/tsd.md`)).err).toContain('the output of this task is docs/tsd.md#introduction')
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#design`)).err).toContain('the output of this task is docs/tsd.md#introduction')
    p.write('docs/tsd.md', '# TSD\n\n## Design\n\nTODO\n')
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).err).toContain('has no heading "introduction"')
  })

  test('a low checker gives evidence for each of its checks, and only for them', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    expect((await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | x | y"`)).err)
      .toContain('no --evidence for: no-ticket-ids')
    expect((await p.agent(`review ${linter} r1 accept --evidence="repeatable | x | y"`)).err)
      .toContain('repeatable is not in your checks')
    // Two parts are a line with no rule; the checks still need their own lines.
    expect((await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | x"`)).err)
      .toContain('no --evidence for: no-code-proof, no-ticket-ids')
    expect((await p.agent(`review ${linter} r1 accept --evidence="x"`)).err)
      .toContain('with no rule: --evidence="<where you read> | <what you saw there>"')
  })
})

describe('assign acts and trees', () => {
  test('a role assigns only the roles of its assign act', async () => {
    const { p, lead } = await started()
    const r = await p.agent(`assign ${lead} t1 --role=section-lead`)
    // I5, D10: the old generic next line ("run work next ... do its first step") is a real choice.
    expect(r.err).toMatchSnapshot('a lead assigns a role that it does not name')
    const { p: q, writer } = await withWriter()
    ok(await q.agent(`brief ${writer}`))
    expect((await q.agent(`assign ${writer} t1 --role=linter`)).err).toContain('writer assigns no role; linter is not one')
  })

  test('a refusal to an agent of one unit says to escalate, not to try other commands', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    const r = await p.agent(`assign ${writer} t1 --role=linter`)
    // I5, D10: the generic line is gone; a role that assigns nothing can only escalate.
    expect(r.err).toContain('next: escalate it: your role assigns no role')
    expect(r.err).not.toContain('give a role')
  })
})

describe('a mistake is evaluated (Nanda, 2026-11-08)', () => {
  test('a fault on the last try stops the task: the high role evaluates it, and the brief shows the evaluation', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="cites ABC-2964" --breaks=no-ticket-ids`))
    // No high role works on t1: the lead is told whom t1 waits for, and the person gets the assign.
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('t1 waits for an evaluation: a2 used its last try on a fault (ex1: r1, cites ABC-2964)')
    expect(ok(await p.nanda('waiting')).out).toContain('t1 The Introduction waits for an evaluation, and no role that splits works on it\n    work assign t1 --role=architect')
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    expect(ok(await p.agent(`next ${arch}`)).out).toContain(`work evaluate ${arch} ex1 --wrong=`)
    const e = ok(await p.agent(`evaluate ${arch} t1 --wrong="r1 cites the ticket ABC-2964" ` +
      '--why="the facts file names the ticket first, and the writer copies it" --improve="the facts file names the event, not the ticket" --level=task'))
    expect(e.out).toContain('ev1 evaluates t1 at the level task; it answers ex1.')
    // The evaluation alone does not reopen the work: the next maker needs other inputs.
    expect((await p.agent(`assign ${lead} t1 --role=writer`)).err).toContain('has the inputs that failed in the last try of a2')
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('ev1 asks for: "the facts file names the event, not the ticket"; remake it (its section is one unit, so it is not split)')
    expect(ok(await p.agent('evaluation show ev1')).out).toContain('why:     the facts file names the ticket first, and the writer copies it')
  })
})

describe('forwarded person acts', () => {
  const ready = async () => {
    const s = await withWriter()
    ok(await s.p.agent(`brief ${s.writer}`))
    s.p.write('docs/tsd.md', INTRO_V2)
    ok(await s.p.agent(`report ${s.writer} --output=docs/tsd.md#introduction`))
    return s
  }

})

describe('programs run on each report', () => {
  // Ruling 7, onboarding 2026-11-14: a program has an icon (and no persistence).
  const GATE = '  gate:\n    kind: program\n    run: "grep -q merchant {workspace.path}"\n    on: report\n' +
    '    checks: [no-code-proof]\n    acts: [{ review: [writer] }]\n    icon: terminal\n'
  test('a passing gate records its evidence; a failing gate rejects', async () => {
    const { WORK_YAML } = await import('./harness.js')
    const { DIRECTION } = await import('./harness.js')
    const gated = DIRECTION.replace('commit hashes in the body", checkedBy: linter', 'commit hashes in the body", checkedBy: gate')
    const { p, writer } = await withWriter({ 'aristoteles.yaml': WORK_YAML + GATE, 'directions/tsd-writing.yaml': gated })
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    expect(ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).out).toContain('gate ran on r1: accept')
    expect(ok(await p.agent('blockers r1')).out).not.toContain('no-code-proof')
    p.write('docs/tsd.md', INTRO_V1.replace('merchant', 'client'))
    ok(await p.agent(`brief ${writer}`))
    expect(ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).out).toContain('gate ran on r2: reject (exit 1')
    expect(ok(await p.agent('blockers r2')).out).toContain('breaks no-code-proof: "grep -q merchant {workspace.path} on docs/tsd.md#introduction: exit 1')
  })

  test('a program checks only rules that name it', async () => {
    const { WORK_YAML } = await import('./harness.js')
    const p = project({ 'aristoteles.yaml': WORK_YAML + GATE })
    ok(await p.nanda('init'))
    expect((await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess')).err)
      .toContain('checks no-code-proof, but that rule is not checkedBy gate')
  })
})

describe('limits and config', () => {
  // Ruling 10.9: a brief over its limit is a state of the assignment, not a refusal of the assign;
  // the agent waits, and the level above (here the owner) shortens or remakes (t1 has a section: one unit, B1).
  test('a brief over the limit of its model prints only that the agent waits', async () => {
    const { WORK_YAML } = await import('./harness.js')
    // Ruling 2026-11-14 (brief limits leave room for the guide): its own small limit.
    const small = WORK_YAML.replace('briefChars: 6000', 'briefChars: 900')
    const p = project({ 'aristoteles.yaml': small })
    await init(p)
    for (const role of ['section-lead', 'writer']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead}`))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    const brief = ok(await p.agent(`brief ${writer}`)).out
    expect(brief).toContain('the limit of haiku is 900. Nanda shortens the directions of t1, or remakes t1.')
    expect(brief).not.toContain('RULES')
    expect(ok(await p.nanda('waiting')).out).toContain('shorten the directions of t1, or remake t1')
  })

  test('a hand edit of aristoteles.yaml stops every write until the person applies it', async () => {
    const { WORK_YAML } = await import('./harness.js')
    const { p, writer } = await withWriter()
    p.write('aristoteles.yaml', WORK_YAML.replace('Writes one TSD section from its brief.', 'Writes one section.'))
    expect((await p.agent(`brief ${writer}`)).err).toContain('aristoteles.yaml changed since the stored config')
    expect(ok(await p.nanda('config apply', 'apply')).out).toContain('applied: writer')
    expect((await p.agent(`brief ${writer}`)).code).toBe(0)
    expect((await p.nanda('assign t1 --role=writer')).err).toContain('writer has no fit record for its current words')
  })

  test('role fit refuses vague words', async () => {
    const { WORK_YAML } = await import('./harness.js')
    const p = project({ 'aristoteles.yaml': WORK_YAML.replace('Give one --evidence line', 'Ensure one --evidence line') })
    await init(p)
    expect((await p.nanda('role fit linter --answers=fit.yaml')).err).toContain('uses the vague verb "ensure"')
  })

  test('role fit finds each form of a vague verb, and only as a whole word', async () => {
    const { WORK_YAML } = await import('./harness.js')
    const vague = project({ 'aristoteles.yaml': WORK_YAML.replace('Give one --evidence line', 'Looked at; give one --evidence line') })
    await init(vague)
    expect((await vague.nanda('role fit linter --answers=fit.yaml')).err).toContain('uses the vague verb "looked at"')
    // "handler" and "management" are other words than the verbs handle and manage.
    const exact = project({ 'aristoteles.yaml': WORK_YAML.replace('Give one --evidence line', 'Give the handler of the management report one --evidence line') })
    await init(exact)
    expect(ok(await exact.nanda('role fit linter --answers=fit.yaml')).out).toBe('linter fits; recorded.')
  })
})
