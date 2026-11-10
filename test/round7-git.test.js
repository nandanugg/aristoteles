// Round 7, attacker D: CLI and git. Each test expects the CORRECT behaviour, so it fails
// while the fault is there.
import { describe, expect, test } from 'bun:test'
import { CODE_DIRECTION, CODE_TASK, CODE_YAML, codeStarted, git, init, ok, project, tokenIn } from './harness.js'

// A commit on a new branch from a start (main by default); main stays checked out.
const commitOn = (p, app, branch, file, text, from = 'main') => {
  git(app, 'checkout', '-q', '-b', branch, from)
  p.write(`app/${file}`, text)
  git(app, 'add', '-A')
  git(app, 'commit', '-q', '-m', branch)
  const sha = git(app, 'rev-parse', 'HEAD').slice(0, 12)
  git(app, 'checkout', '-q', 'main')
  return sha
}
// Another task's work lands on main (as the top agent's step says to do).
const mainMoves = (p, app) => {
  p.write('app/other.txt', 'another task, merged\n')
  git(app, 'add', '-A')
  git(app, 'commit', '-q', '-m', 'another task')
}
const implementer = async (p, lead, task) => {
  const token = tokenIn(ok(await p.agent(`assign ${lead} ${task} --role=implementer`)).out)
  ok(await p.agent(`brief ${token}`))
  return token
}
// t1 of codeStarted, and t2 with its own lead (a3); undefined when the person's open of t2 is refused.
const twoTasks = async (task2) => {
  const s = await codeStarted({ 'task2.yaml': task2 })
  git(s.app, 'config', 'diff.renames', 'true')
  if ((await s.p.nanda('task open --file=task2.yaml')).code !== 0) return undefined
  const lead2 = tokenIn(ok(await s.p.nanda('assign t2 --role=lead')).out)
  ok(await s.p.agent(`brief ${lead2}`))
  return { ...s, lead2 }
}
// The code project of codeStarted with its own task file; undefined when the person's open is refused.
const codeWith = async (taskFile) => {
  const p = project({ 'work.yaml': CODE_YAML, 'code-directions/fixes.yaml': CODE_DIRECTION, 'task.yaml': taskFile, 'app/ok.txt': 'ok\n' })
  const app = `${p.dir}/app`
  git(app, 'init', '-q', '-b', 'main')
  git(app, 'add', '.')
  git(app, 'commit', '-q', '-m', 'base')
  await init(p)
  for (const role of ['lead', 'implementer']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  if ((await p.nanda('task open --file=task.yaml')).code !== 0) return undefined
  const lead = tokenIn(ok(await p.nanda('assign t1 --role=lead')).out)
  ok(await p.agent(`brief ${lead}`))
  const impl = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=implementer`)).out)
  ok(await p.agent(`brief ${impl}`))
  return { p, app, lead, impl }
}

describe('D1 the digest of a commit is its tree: a rebase makes old work look new', () => {
  test('rejected work, rebased onto a main that moved, passes as new work', async () => {
    const { p, app, lead, impl } = await codeStarted()
    const one = commitOn(p, app, 'fix', 'key.txt', 'key = 2\n')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    ok(await p.agent(`review ${lead} r1 reject --point="the key is still wrong for two merchants" --breaks=suite-passes`))
    mainMoves(p, app)
    // The same change, on the new main: git cherry-pick makes a new commit with the same diff.
    git(app, 'checkout', '-q', '-b', 'again', 'main')
    git(app, 'cherry-pick', one)
    const again = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    expect(git(app, 'diff', `${one}^`, one)).toBe(git(app, 'diff', `${again}^`, again))
    ok(await p.agent(`brief ${impl}`))
    const r = await p.agent(`report ${impl} --output=app@${again}`)
    // Correct: refused as the work of r1, which was rejected.
    expect(r.code).toBe(1)
    expect(r.err).toContain('r1')
  }, 20000)

  test('the starting point, merged with a main that moved, passes as new work', async () => {
    const { p, app, impl } = await codeStarted({ 'task2.yaml': `${CODE_TASK}from: r1\n` })
    const one = commitOn(p, app, 'fix', 'key.txt', 'key = 2\n')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    ok(await p.nanda('task open --file=task2.yaml'))
    const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const impl2 = await implementer(p, lead2, 't2')
    mainMoves(p, app)
    // No work of its own: only a merge of the starting point with main.
    git(app, 'checkout', '-q', '-b', 'start', one)
    git(app, 'merge', '-q', '--no-edit', 'main')
    const merged = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    expect(git(app, 'diff', '--name-only', 'main', merged)).toBe('key.txt')
    const r = await p.agent(`report ${impl2} --output=app@${merged}`)
    // Correct: refused, the commit adds nothing to the starting point r1.
    expect(r.code).toBe(1)
  }, 20000)
})

describe('D2 work that changes the same files: a rename hides the file', () => {
  test('t1 renames export.js, t2 edits export.js; both run at the same time', async () => {
    const { p, app, impl, lead2 } = await twoTasks(CODE_TASK.replace('Fix the key', 'Fix the name'))
    p.write('app/export.js', 'export one file a day\nfor each merchant\nwith a header\n')
    git(app, 'add', '-A')
    git(app, 'commit', '-q', '-m', 'export')
    const impl2 = await implementer(p, lead2, 't2')
    // t1 moves export.js to report.js (git sees a rename).
    git(app, 'checkout', '-q', '-b', 'one', 'main')
    git(app, 'mv', 'export.js', 'report.js')
    git(app, 'commit', '-q', '-m', 'move export to report')
    const one = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    expect(git(app, 'diff', '--name-only', '--no-renames', 'main', one)).toContain('export.js')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    const two = commitOn(p, app, 'two', 'export.js', 'export one file a day\nfor each merchant\nwith a dated header\n')
    const r = await p.agent(`report ${impl2} --output=app@${two}`)
    // Correct: refused, t1 changes export.js too (it removes it).
    expect(r.code).toBe(1)
    expect(r.err).toContain('export.js')
  }, 20000)

  test('two tasks that name one repo with two source names run at the same time on one file', async () => {
    const task2 = CODE_TASK.replace('Fix the key', 'Fix the name').replace('source: app', 'source: web')
    const s = await twoTasks(task2)
    if (!s) return // refused at task open: one repo has one source name
    const { p, app, impl, lead2 } = s
    const impl2 = await implementer(p, lead2, 't2')
    ok(await p.agent(`report ${impl} --output=app@${commitOn(p, app, 'one', 'export.js', 'one file a day\n')}`))
    const r = await p.agent(`report ${impl2} --output=app@${commitOn(p, app, 'two', 'export.js', 'a file named by the date\n')}`)
    // Correct: refused as in open-items.test.js; the repo is the same folder app.
    expect(r.code).toBe(1)
    expect(r.err).toContain('changes export.js')
  }, 20000)
})

describe('D3 a code workspace with no base: no commit check runs', () => {
  test('a maker reports the commit that the repo was at before any work, and it passes', async () => {
    const s = await codeWith(CODE_TASK.replace(', base: main', ''))
    if (!s) return // refused at task open: a commit output needs a base
    const head = git(s.app, 'rev-parse', 'HEAD').slice(0, 12)
    const r = await s.p.agent(`report ${s.impl} --output=app@${head}`)
    // Correct: refused as untouched work (DESIGN 8: a report equal to the output at the first
    // brief is refused), or the task with no base is refused at task open.
    expect(r.code).toBe(1)
  }, 20000)

  // The high role with a change grant on the task: its remake drops the base, and the checks go.
  test('an agent\'s remake drops the base; the base commit then passes as new work', async () => {
    const p = project({ 'work.yaml': CODE_YAML, 'code-directions/fixes.yaml': CODE_DIRECTION, 'task.yaml': CODE_TASK, 'app/ok.txt': 'ok\n' })
    const app = `${p.dir}/app`
    git(app, 'init', '-q', '-b', 'main')
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'base')
    await init(p)
    for (const role of ['tech-lead', 'lead', 'implementer']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    ok(await p.nanda('grant --act=change --on=t1 --to=tech-lead --until=2026-12-31T00:00:00Z', 'grant'))
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=tech-lead')).out)
    ok(await p.agent(`brief ${lead}`))
    p.write('bare.yaml', CODE_TASK.replace(', base: main', ''))
    const remake = await p.agent(`task remake ${lead} t1 --file=bare.yaml --reason="the fix is smaller"`)
    // The fix (2026-11-07): an agent's remake keeps the workspace and its base.
    expect(remake.err).toContain("an agent's remake keeps the directions, the context, and the workspace of t1")
  }, 20000)
})

describe('D8 a report is new work: another task\'s commit', () => {
  test('t2\'s maker reports the commit of t1 as its own result, and it passes', async () => {
    const { p, app, impl, lead2 } = await twoTasks(CODE_TASK.replace('Fix the key', 'Fix the name'))
    const impl2 = await implementer(p, lead2, 't2')
    const one = commitOn(p, app, 'one', 'export.js', 'one file a day\n')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    const r = await p.agent(`report ${impl2} --output=app@${one}`)
    // Correct: refused; the commit is r1 of t1, with no work of t2 in it (its tree is r1's).
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/r1|t1/)
  }, 20000)
})

describe('D9 a commit with no merge base: the base checks pass by default', () => {
  test('an orphan commit with the same files as main passes as new work', async () => {
    const { p, app, impl } = await codeStarted()
    git(app, 'checkout', '-q', '--orphan', 'lonely')
    git(app, 'commit', '-q', '-m', 'the same files, with no history')
    const lonely = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    expect(git(app, 'rev-parse', `${lonely}^{tree}`)).toBe(git(app, 'rev-parse', 'main^{tree}'))
    const r = await p.agent(`report ${impl} --output=app@${lonely}`)
    // Correct: refused; the commit has the files of main (or: it has no base in main to check).
    expect(r.code).toBe(1)
  }, 20000)

  test('an orphan commit skips the check of work that changes the same files', async () => {
    const { p, app, impl, lead2 } = await twoTasks(CODE_TASK.replace('Fix the key', 'Fix the name'))
    const impl2 = await implementer(p, lead2, 't2')
    ok(await p.agent(`report ${impl} --output=app@${commitOn(p, app, 'one', 'export.js', 'one file a day\n')}`))
    git(app, 'checkout', '-q', '--orphan', 'lonely')
    p.write('app/export.js', 'a file named by the date\n')
    git(app, 'add', '-A')
    git(app, 'commit', '-q', '-m', 'export by date, with no history')
    const lonely = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    const r = await p.agent(`report ${impl2} --output=app@${lonely}`)
    // Correct: refused; it changes export.js as r1 of t1 does (or it has no base in main).
    expect(r.code).toBe(1)
  }, 20000)
})
