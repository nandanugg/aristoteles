// Round of 2026-11-07, attacker B: rules that did not change on 2026-11-07.
// Each test expects the CORRECT behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { CODE_DIRECTION, CODE_TASK, CODE_YAML, codeStarted, git, init, ok, project, reported, started, tokenIn, withWriter } from './harness.js'

const TSD_TASK = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
const tsd = (intro, design, failure = 'TODO') => `# TSD\n\n## Introduction\n\n${intro}\n\n## Design\n\n${design}\n\n## Failure\n\n${failure}\n`
const PARTS = '- { name: Design, text: Write the design., context: { region: design } }\n' +
  '- { name: Failure, text: Write the failure cases., context: { region: failure } }\n'
const UNTIL = '--until=2026-12-31T00:00:00Z'
const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the region" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the region"'

const fit = async (p, roles = ['architect', 'region-lead', 'writer', 'linter']) => {
  for (const role of roles) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
}
// A high architect on a task, with a change grant on the given ids.
const architectOn = async (p, task, on) => {
  ok(await p.nanda(`grant --act=change --on=${on} --to=architect ${UNTIL}`, 'grant'))
  const arch = tokenIn(ok(await p.nanda(`assign ${task} --role=architect`)).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}
// A commit on a branch of the code repo.
const commit = (p, app, file, text, message) => {
  p.write(`app/${file}`, text)
  git(app, 'add', '.')
  git(app, 'commit', '-q', '-m', message)
  return git(app, 'rev-parse', 'HEAD')
}

describe('B1 remake: an agent remakes a task with no rules', () => {
  test('a high agent remakes a part with directions: [] and its work passes with no checker', async () => {
    const p = project({ 'task.yaml': TSD_TASK, 'docs/tsd.md': tsd('TODO', 'TODO') })
    await init(p)
    await fit(p)
    ok(await p.nanda('task open --file=task.yaml'))
    const arch = await architectOn(p, 't1', 't1')
    p.write('parts.yaml', PARTS)
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    // The same part, with no directions (and no region): no rule applies to it.
    p.write('bare.yaml', 'name: Design\ntext: Write the design.\ndirections: []\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n')
    const remake = await p.agent(`task remake ${arch} t2 --file=bare.yaml --reason="the design is narrower"`)
    // The fix (2026-11-07): an agent's remake keeps the directions and the context of the task.
    expect(remake.err).toContain("an agent's remake keeps the directions, the context, and the workspace of t2; only the person changes them")
  })
})

describe('B2 directions: a change that says nothing new to the task answers the person\'s Reject', () => {
  test('agents answer the person\'s Reject of t1 with a standard for another region; t1 is Accepted again', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | docs/tsd.md#introduction | a reader can repeat the double export"`))
    expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
    const reject = ok(await p.nanda('review t1 reject --point="the introduction misses the impact on the merchant"')).out
    const vid = reject.match(/^(v\d+): reject/)[1]
    expect(ok(await p.agent('task show t1')).out).toContain('Returned')
    const arch = await architectOn(p, 't1', 'tsd-writing')
    // The criticism is evaluated first (2026-11-08), so the revise is judged on its words.
    ok(await p.agent(`evaluate ${arch} t1 --wrong="the introduction misses the impact" --why="no standard asks for it" ` +
      '--improve="a standard for the impact" --level=standard'))
    p.write('edit.yaml', 'add:\n  - id: failure-story\n    where: { region: failure }\n' +
      '    says: The failure cases say what the merchant sees.\n' +
      '    rules:\n      - { id: merchant-sees, says: "Each failure case says what the merchant sees", checkedBy: linter }\n')
    const revise = await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml --answers=${vid}`)
    // Correct: the draft says the same to t1 (region introduction), so it does not answer the point.
    expect(revise.code).toBe(1)
    expect(revise.err).toContain('says the same to t1 as before')
    expect(ok(await p.agent('task show t1')).out).not.toContain('Accepted')
  })
})

describe('B3 code: new work is compared by commit id, not by the work', () => {
  test('rejected work comes back with a new commit message and passes as new work', async () => {
    const { p, app, lead, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'fix')
    commit(p, app, 'key.txt', 'key = 2\n', 'fix the key')
    const sha1 = git(app, 'rev-parse', 'HEAD')
    ok(await p.agent(`report ${impl} --output=app@${sha1}`))
    ok(await p.agent(`review ${lead} r1 reject --point="the key is still wrong for two merchants" --breaks=suite-passes`))
    // The same work: the same tree, only a new message.
    git(app, 'commit', '--amend', '-q', '-m', 'fix the key again')
    const sha2 = git(app, 'rev-parse', 'HEAD')
    expect(git(app, 'rev-parse', `${sha2}^{tree}`)).toBe(git(app, 'rev-parse', `${sha1}^{tree}`))
    ok(await p.agent(`brief ${impl}`))
    const again = await p.agent(`report ${impl} --output=app@${sha2}`)
    // Correct: refused as the work of r1, which was rejected.
    expect(again.code).toBe(1)
    expect(again.err).toContain('r1')
  })

  test('an empty commit on main passes as new work', async () => {
    const { p, app, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'fix')
    git(app, 'commit', '-q', '--allow-empty', '-m', 'fix the key')
    const sha = git(app, 'rev-parse', 'HEAD')
    expect(git(app, 'rev-parse', `${sha}^{tree}`)).toBe(git(app, 'rev-parse', 'main^{tree}'))
    const r = await p.agent(`report ${impl} --output=app@${sha}`)
    // Correct: refused, the work is the same as main (untouched work).
    expect(r.code).toBe(1)
  })
})

describe('B4 task open: the starting point of a task file is dropped', () => {
  test('a code task opened with from: r1 shows no FROM, and its maker reports r1 as new work', async () => {
    const { p, app, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'fix')
    const sha = commit(p, app, 'key.txt', 'key = 2\n', 'fix the key')
    ok(await p.agent(`report ${impl} --output=app@${sha}`))
    p.write('task2.yaml', `${CODE_TASK}from: r1\n`)
    ok(await p.nanda('task open --file=task2.yaml'))
    const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const impl2 = tokenIn(ok(await p.agent(`assign ${lead2} t2 --role=implementer`)).out)
    const brief = ok(await p.agent(`brief ${impl2}`)).out
    const r = await p.agent(`report ${impl2} --output=app@${sha}`)
    // Correct: the starting point is not new work, and the brief names it.
    expect(r.err).toContain('is the starting point of t2')
    expect(brief).toContain('FROM')
  })
})

describe('B5 questions: a question to a finished assignment', () => {
  test('after the person finishes the lead, nobody can answer the writer\'s question, and t1 never closes it', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`raise ${writer} --reason="the facts file has no merchant name; I looked in docs/facts.md"`))
    ok(await p.nanda('finish a2'))
    const finish = await p.nanda('finish a1')
    if (finish.code !== 0) return // refused while q1 waits for a1: no dead end
    const lead2 = tokenIn(ok(await p.nanda('assign t1 --role=region-lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const byLead = await p.agent(`answer ${lead2} q1 --text="use the merchant id from the export log"`)
    const byPerson = await p.nanda('answer q1 --text="use the merchant id from the export log"')
    // Correct: someone who is open can answer q1 (it stops t1 until it is answered).
    expect(byLead.code === 0 || byPerson.code === 0).toBe(true)
  })
})

describe('B6 split: the parts of a task with a region', () => {
  test('a split of t1 (region introduction) makes parts that can never report', async () => {
    const p = project()
    await init(p)
    await fit(p)
    ok(await p.nanda('task open --file=task.yaml'))
    const arch = await architectOn(p, 't1', 't1')
    // The fix (2026-11-07): next offers a medium role for a task with a region, and a split
    // whose parts share the region is refused with a next step that works.
    const next = ok(await p.agent(`next ${arch}`)).out
    expect(next).not.toContain('split t1 first')
    expect(next).toContain('run t1 with a medium role')
    p.write('parts.yaml', '- { name: Problem, text: Write the problem. }\n- { name: Impact, text: Write the impact on the merchant. }\n')
    const split = await p.agent(`task split ${arch} t1 --file=parts.yaml`)
    expect(split.err).toContain('t1 has the region introduction, so it is one unit of work; it is not split')
    expect(split.err).toContain('run t1 with a medium role')
    ok(await p.agent(`assign ${arch} t1 --role=region-lead`))
  })
})

describe('B7 gate: a direction change removes the rule that the gate checks', () => {
  test('the report is stored, but the command says refused and the gate assignment stays open', async () => {
    const { p, app, impl } = await codeStarted()
    // The tech lead drafts the change, and the person accepts it.
    ok(await p.nanda('role fit tech-lead --answers=fit.yaml'))
    ok(await p.nanda(`grant --act=change --on=fixes,t1 --to=tech-lead ${UNTIL}`, 'grant'))
    const tech = tokenIn(ok(await p.nanda('assign t1 --role=tech-lead')).out)
    ok(await p.agent(`brief ${tech}`))
    p.write('edit.yaml', 'remove: [proven]\n')
    ok(await p.agent(`direction revise ${tech} fixes --file=edit.yaml`))
    ok(await p.nanda('review d2 accept --evidence="edit.yaml | proven goes"', 'accept'))
    git(app, 'checkout', '-q', '-b', 'fix')
    const sha = commit(p, app, 'key.txt', 'key = 2\n', 'fix the key')
    const r = await p.agent(`report ${impl} --output=app@${sha}`)
    expect(ok(await p.agent('log --last=3')).out).toContain(`report app@${sha}`)
    // The fix (2026-11-07): the report says that it is stored, and the gate, with no rule in
    // force, does not run.
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    expect(r.out).toContain('gate did not run on r1: no direction of t1 has its checks (suite-passes) now')
  })
})

describe('B8 waiver: the person waives', () => {
  // Decided 2026-11-07: the person accepts no result, so gives no waiver; the help lists no waive.
  test('the person\'s waive is refused with the true reason, and the person help lists no waive', async () => {
    const { p } = await reported()
    const r = await p.nanda('waive r1 --rules=no-ticket-ids --reason="urgent release" --until=2026-10-26T09:00:00Z')
    expect(r.err).toContain('Nanda accepts no result, so gives no waiver')
    const help = (await p.nanda('help')).out + (await p.nanda('help')).err
    expect(help).not.toContain('waive <r>')
  })
})

describe('B9 merge base: the base check fails open', () => {
  test('when the base of the workspace does not resolve, the base commit itself passes as new work', async () => {
    // As codeStarted, but the person's task file names base: trunk; the repo has only main.
    const p = project({ 'work.yaml': CODE_YAML, 'code-directions/fixes.yaml': CODE_DIRECTION,
      'task.yaml': CODE_TASK.replace('base: main', 'base: trunk'), 'app/ok.txt': 'ok\n' })
    const app = `${p.dir}/app`
    git(app, 'init', '-q', '-b', 'main')
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'base')
    await init(p)
    for (const role of ['lead', 'implementer']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    const open = await p.nanda('task open --file=task.yaml')
    if (open.code !== 0) return // refused: the base does not resolve
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=lead')).out)
    ok(await p.agent(`brief ${lead}`))
    const impl = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=implementer`)).out)
    ok(await p.agent(`brief ${impl}`))
    const base = git(app, 'rev-parse', 'main')
    const r = await p.agent(`report ${impl} --output=app@${base}`)
    // Correct: refused, the CLI cannot read the base trunk (and the commit is the starting work).
    expect(r.code).toBe(1)
  })
})
