import { existsSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { CODE_TASK, codeStarted, git, init, INTRO_V2, ok, project, reported, tokenIn, withWriter } from './harness.js'

// The open items of round 6, closed on 2026-11-07 (Nanda: "do this open part").

// A commit on a new branch of the app repo, from a start (main by default); main stays checked out.
const commitOn = (p, app, branch, file, text, from = 'main') => {
  git(app, 'checkout', '-q', '-b', branch, from)
  p.write(`app/${file}`, text)
  git(app, 'add', '.')
  git(app, 'commit', '-q', '-m', branch)
  const sha = git(app, 'rev-parse', 'HEAD').slice(0, 12)
  git(app, 'checkout', '-q', 'main')
  return sha
}
// Two code tasks in one repo: t1 of codeStarted, and t2 with its own lead (a3).
const twoTasks = async (more = '') => {
  const s = await codeStarted({ 'task2.yaml': CODE_TASK.replace('Fix the key', 'Fix the name') + more })
  ok(await s.p.nanda('task open --file=task2.yaml'))
  const lead2 = tokenIn(ok(await s.p.nanda('assign t2 --role=lead')).out)
  ok(await s.p.agent(`brief ${lead2}`))
  return { ...s, lead2 }
}
const implementer = async (p, lead, task) => {
  const token = tokenIn(ok(await p.agent(`assign ${lead} ${task} --role=implementer`)).out)
  ok(await p.agent(`brief ${token}`))
  return token
}

describe('flags and words', () => {
  test('a flag that a command does not read is refused, with the flags that it reads', async () => {
    const { p, lead } = await reported()
    expect((await p.agent(`next ${lead} --verbose`)).err).toContain('work next has no flag --verbose; it reads no flags')
    const review = await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | ok" --evidence-note=x`)
    expect(review.err).toContain('work review accept has no flag --evidence-note; it reads --evidence, --reason, --settles')
  })

  test('the checker step says that the same assignment checks each new result', async () => {
    const { p, lead, writer, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="cites a ticket" --breaks=no-ticket-ids`))
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2.replace('two files', 'two files on one day'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('the same assignment checks each new result')
  })
})

describe('the person\'s answer reaches the maker', () => {
  test('the person\'s answer to the lead is in the next brief of the low maker', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`raise ${writer} --reason="which merchant is it?"`))
    ok(await p.agent(`ask ${lead} --text="The writer asks which merchant it is." --to=owner`))
    ok(await p.nanda('answer q2 --text="M-104"'))
    expect(ok(await p.agent(`brief ${writer}`)).out).toContain('M-104')
  })
})

describe('parts in one document file', () => {
  const WHOLE = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
  const start = async (files = {}) => {
    const p = project({ 'task.yaml': WHOLE, ...files })
    await init(p)
    for (const role of ['architect', 'region-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    return p
  }

  test('parts that share a file each need their own region', async () => {
    const p = await start()
    p.write('bare.yaml', '- { name: Story, text: Tell the story. }\n- { name: Cost, text: Say the cost. }\n')
    expect((await p.nanda('task split t1 --file=bare.yaml')).err)
      .toContain('the parts Story, Cost share docs/tsd.md, and Story, Cost have no region')
    p.write('parts.yaml', '- { name: Story, text: Tell the story., context: { region: story } }\n' +
      '- { name: Cost, text: Say the cost., context: { region: cost } }\n')
    ok(await p.nanda('task split t1 --file=parts.yaml'))
  })

  test('a part may name a region also when no standard of its directions has a region "when"', async () => {
    const plain = 'id: plain\nname: Plain\nowner: Nanda\nsays: Plain words.\nstandards:\n' +
      '  - id: short\n    says: Short.\n    rules:\n      - { id: short-lines, says: "Lines are short", checkedBy: linter }\n'
    const p = await start({ 'directions/plain.yaml': plain, 'task.yaml': WHOLE.replace('[tsd-writing]', '[plain]') })
    p.write('parts.yaml', '- { name: Story, text: Tell the story., context: { region: story } }\n' +
      '- { name: Cost, text: Say the cost., context: { region: cost } }\n')
    ok(await p.nanda('task split t1 --file=parts.yaml'))
  })
})

describe('work that changes the same files runs one after the other', () => {
  test('a commit is refused when another open task that does not wait for it changes the same file', async () => {
    const { p, app, impl, lead2 } = await twoTasks()
    const impl2 = await implementer(p, lead2, 't2')
    ok(await p.agent(`report ${impl} --output=app@${commitOn(p, app, 'one', 'export.js', 'one file a day\n')}`))
    const second = await p.agent(`report ${impl2} --output=app@${commitOn(p, app, 'two', 'export.js', 'a file named by the date\n')}`)
    expect(second.err).toContain('changes export.js, and so does r1 of t1 (Fix the key), which does not wait for t2')
    expect(second.err).toContain(`work raise ${impl2}`)
  }, 20000)

  test('two tasks that change different files run at the same time', async () => {
    const { p, app, impl, lead2 } = await twoTasks()
    const impl2 = await implementer(p, lead2, 't2')
    ok(await p.agent(`report ${impl} --output=app@${commitOn(p, app, 'one', 'export.js', 'one file a day\n')}`))
    ok(await p.agent(`report ${impl2} --output=app@${commitOn(p, app, 'two', 'name.js', 'a file named by the date\n')}`))
  }, 20000)

  test('a task that needs the other starts after it, and its commit on top of the other passes', async () => {
    const { p, app, lead, impl, lead2 } = await twoTasks('needs: [t1]\n')
    expect((await p.agent(`assign ${lead2} t2 --role=implementer`)).err).toContain('t2 needs t1')
    const one = commitOn(p, app, 'one', 'export.js', 'one file a day\n')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="app@${one} export.js | one file a day"`))
    const impl2 = await implementer(p, lead2, 't2')
    ok(await p.agent(`report ${impl2} --output=app@${commitOn(p, app, 'two', 'export.js', 'one file a day, named by the date\n', 'one')}`))
  }, 20000)

  test('a merge of the other commit into main does not hide that both change the same file', async () => {
    const { p, app, impl, lead2 } = await twoTasks()
    const impl2 = await implementer(p, lead2, 't2')
    const base = git(app, 'rev-parse', 'main')
    const one = commitOn(p, app, 'one', 'export.js', 'one file a day\n')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    git(app, 'merge', '-q', 'one')
    const second = await p.agent(`report ${impl2} --output=app@${commitOn(p, app, 'two', 'export.js', 'a file named by the date\n', base)}`)
    expect(second.err).toContain('changes export.js, and so does r1 of t1')
  }, 20000)
})

describe('accepted code goes onto its base', () => {
  test('the top agent gets the step that puts the accepted commit on main', async () => {
    const { p, app, lead, impl } = await codeStarted()
    const one = commitOn(p, app, 'one', 'export.js', 'one file a day\n')
    ok(await p.agent(`report ${impl} --output=app@${one}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="app@${one} export.js | one file a day"`))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain(`put app@${one} on main: t1 is accepted, and its commit is not on main yet`)
    git(app, 'merge', '-q', 'one')
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('put app@')
  }, 20000)

  test('a finish removes the worktree of a code maker, and keeps its branch', async () => {
    const { p, app, lead, impl } = await codeStarted()
    const tree = `${p.dir}/.work/trees/a2`
    git(app, 'worktree', 'add', '-q', '-b', 'work/a2', tree, 'main')
    p.write('.work/trees/a2/export.js', 'one file a day\n')
    git(tree, 'add', '.')
    git(tree, 'commit', '-q', '-m', 'one file a day')
    ok(await p.agent(`report ${impl} --output=app@${git(tree, 'rev-parse', 'HEAD').slice(0, 12)}`))
    expect(ok(await p.agent(`finish ${lead} a2`)).out).toContain('its worktree is removed; its branch work/a2 stays.')
    expect(existsSync(tree)).toBe(false)
    expect(git(app, 'rev-parse', '--verify', 'work/a2')).not.toBe('')
  }, 20000)
})
