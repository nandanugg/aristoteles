// Round 8, attacker F: the commit checks of round 7 compare the words of the repo path, so a
// task that names the repo app as ./app passes them. Each test expects the CORRECT behaviour, so
// it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { CODE_TASK, codeStarted, git, ok, tokenIn } from
  './harness.js'

// A commit on a new branch from main; main stays checked out.
const commitOn = (p, app, branch, file, text) => {
  git(app, 'checkout', '-q', '-b', branch, 'main')
  p.write(`app/${file}`, text)
  git(app, 'add', '-A')
  git(app, 'commit', '-q', '-m', branch)
  const sha = git(app, 'rev-parse', 'HEAD').slice(0, 12)
  git(app, 'checkout', '-q', 'main')
  return sha
}
// t1 of codeStarted (workspace app, implementer a2), and t2 that names the same repo as ./app,
// with its lead a3 and its implementer a4, both briefed. undefined when the open of t2 is refused.
async function twoTasks() {
  const s = await codeStarted({ 'task2.yaml': CODE_TASK.replace('Fix the key', 'Fix the name').replace('path: app', 'path: ./app') })
  const open = await s.p.nanda('task open --file=task2.yaml')
  if (open.code !== 0) return { ...s, open }
  const lead2 = tokenIn(ok(await s.p.nanda('assign t2 --role=lead')).out)
  ok(await s.p.agent(`brief ${lead2}`))
  const impl2 = tokenIn(ok(await s.p.agent(`assign ${lead2} t2 --role=implementer`)).out)
  ok(await s.p.agent(`brief ${impl2}`))
  return { ...s, impl2 }
}

describe('F-G1 one repo, two paths: app and ./app', () => {
  test('t2 (./app) reports the commit of t1 as its own result, and it passes', async () => {
    const s = await twoTasks()
    if (s.open) {
      // One correct fix: one repo has one path, so the open of t2 is refused.
      expect(s.open.err).toContain('workspace ./app names app; write it as app')
      return
    }
    const { p, app, impl, impl2 } = s
    const one = commitOn(p, app, 'one', 'export.js', 'one file a day\n')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    const r = await p.agent(`report ${impl2} --output=./app@${one}`)
    // Correct: refused, as in round7-git D8; the commit is r1 of t1, with no work of t2 in it.
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/r1|t1/)
  }, 20000)

  test('t1 (app) and t2 (./app) change export.js at the same time, and both reports pass', async () => {
    const s = await twoTasks()
    if (s.open) {
      expect(s.open.err).toContain('workspace ./app names app; write it as app')
      return
    }
    const { p, app, impl, impl2 } = s
    ok(await p.agent(`report ${impl} --output=app@${commitOn(p, app, 'one', 'export.js', 'one file a day\n')}`))
    const r = await p.agent(`report ${impl2} --output=./app@${commitOn(p, app, 'two', 'export.js', 'a file named by the date\n')}`)
    // Correct: refused, as in open-items.test.js; work that changes the same files runs one after the other.
    expect(r.code).toBe(1)
    expect(r.err).toContain('changes export.js')
  }, 20000)
})
