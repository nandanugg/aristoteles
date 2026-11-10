// Round 8, attacker F: the work of a commit is its git patch-id (round 7, D1). git patch-id
// drops all white space, and it prints nothing for a coloured diff, so the check refuses a real
// fix and passes rejected work. Each test expects the CORRECT behaviour, so it fails while the
// fault is there.
import { describe, expect, test } from 'bun:test'
import { CODE_DIRECTION, codeStarted, git, ok } from
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
// The fixes direction with a rule that the lead (the decider) checks.
const DIRECTION = `${CODE_DIRECTION}  - id: configured\n    says: The config says what the task asks.\n    rules:\n` +
  '      - { id: config-nested, says: "Each setting sits under its section in config.yaml", checkedBy: lead }\n'

describe('F-G2 the patch-id has no white space', () => {
  test('the redo that indents a YAML key, as the Reject asks, is refused as "nothing changed since r1"', async () => {
    const { p, app, lead, impl } = await codeStarted({ 'code-directions/fixes.yaml': DIRECTION })
    // r1: schedule is not under export, so export is empty.
    ok(await p.agent(`report ${impl} --output=app@${commitOn(p, app, 'one', 'config.yaml', 'export:\nschedule: daily\n')}`))
    ok(await p.agent(`review ${lead} r1 reject --point="schedule is not under export, so export is empty" --breaks=config-nested`))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('redo t1: give a new subagent the command of a2 (attempt 2 of 3)')
    ok(await p.agent(`brief ${impl}`))
    const two = commitOn(p, app, 'two', 'config.yaml', 'export:\n  schedule: daily\n')
    // Two different trees, and two different YAML documents.
    expect(git(app, 'rev-parse', `${two}^{tree}`)).not.toBe(git(app, 'rev-parse', 'one^{tree}'))
    const r = await p.agent(`report ${impl} --output=app@${two}`)
    // Correct: r2 is new work (the fix that v2.1 asks for), so it is reported.
    expect(r.err).toBe('')
    expect(r.out).toContain('r2 reported on t1')
  }, 20000)
})

describe('F-G3 a coloured diff has no patch-id', () => {
  test('with color.ui=always in the git config, rejected work cherry-picked onto a moved main passes as new work', async () => {
    const { p, app, lead, impl } = await codeStarted()
    // A common setting of the person's git config; the repo config stands for it here.
    git(app, 'config', 'color.ui', 'always')
    const one = commitOn(p, app, 'fix', 'key.txt', 'key = 2\n')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    ok(await p.agent(`review ${lead} r1 reject --point="the key is still wrong for two merchants" --breaks=suite-passes`))
    // Another task's work lands on main; the same change is cherry-picked onto the new main.
    p.write('app/other.txt', 'another task, merged\n')
    git(app, 'add', '-A')
    git(app, 'commit', '-q', '-m', 'another task')
    git(app, 'checkout', '-q', '-b', 'again', 'main')
    git(app, 'cherry-pick', one)
    const again = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    ok(await p.agent(`brief ${impl}`))
    const r = await p.agent(`report ${impl} --output=app@${again}`)
    // Correct: refused as the work of r1, which was rejected (round7-git D1), whatever the
    // colour setting of git.
    expect(r.code).toBe(1)
    expect(r.err).toContain('r1')
  }, 20000)
})
