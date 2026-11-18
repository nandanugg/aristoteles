// Round of 2026-11-07, attacker B: rules that did not change on 2026-11-07.
// Each test expects the CORRECT behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { CODE_DIRECTION, CODE_TASK, CODE_YAML, codeStarted, git, init, ok, project, reported, started, tokenIn, withWriter } from './harness.js'

const TSD_TASK = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
const tsd = (intro, design, failure = 'TODO') => `# TSD\n\n## Introduction\n\n${intro}\n\n## Design\n\n${design}\n\n## Failure\n\n${failure}\n`
const PARTS = '- { name: Design, text: Write the design., context: { section: design } }\n' +
  '- { name: Failure, text: Write the failure cases., context: { section: failure } }\n'
const UNTIL = '--until=2026-12-31T00:00:00Z'
const LINT = '--evidence="no-code-proof | docs/tsd.md#introduction | no paths or hashes in the section" ' +
  '--evidence="no-ticket-ids | docs/tsd.md#introduction | no ticket ids in the section"'

const fit = async (p, roles = ['architect', 'section-lead', 'writer', 'linter']) => {
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
})

describe('B2 directions: a change that says nothing new to the task answers the person\'s Reject', () => {
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
})

describe('B6 split: the parts of a task with a section', () => {
})

describe('B7 gate: a direction change removes the rule that the gate checks', () => {
})

describe('B8 waiver: the person waives', () => {
  // Decided 2026-11-07: the person accepts no result, so gives no waiver; the help lists no waive.
  test('the person\'s waive is refused with the true reason, and the person help lists no waive', async () => {
    const { p } = await reported()
    const r = await p.nanda('waive r1 --rules=no-ticket-ids --reason="urgent fix" --until=2026-10-26T09:00:00Z')
    // The waiver is removed (the owner's ruling 10, 2026-11-12): there is no waive.
    expect(r.err).toContain('there is no command "waive"')
    expect(r.code).toBe(2)
    const help = (await p.nanda('help')).out + (await p.nanda('help')).err
    expect(help).not.toContain('waive <r>')
  })
})

describe('B9 merge base: the base check fails open', () => {
  test('when the base of the workspace does not resolve, the base commit itself passes as new work', async () => {
    // As codeStarted, but the person's task file names base: trunk; the repo has only main.
    const p = project({ 'aristoteles.yaml': CODE_YAML, 'code-directions/fixes.yaml': CODE_DIRECTION,
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
