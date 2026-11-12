import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { codeStarted, evaluated, git, init, ok, project, reported, tokenIn } from './harness.js'

const TSD_TASK = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
const fresh = async (files) => {
  const p = project(files)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  return p
}

// One test for each fault that the proofs after round 5 found (thought-tests/proofs.md).

describe('planted faults: the checker brief', () => {
  test('a low checker reads the maker task as the task it checks, with no verify line', async () => {
    const { p } = await reported()
    const brief = ok(await p.agent('assignment show a3')).out
    expect(brief).toContain("TASK     the maker's task (you check it; you do not do it)")
    expect(brief).not.toContain('verify:')
    expect(brief).toContain('<where you looked in docs/tsd.md#introduction>')
  })

  test('an evidence refusal gives the command again, with the one field to correct', async () => {
    const { p, linter } = await reported()
    const review = await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | my scratch copy | no paths or hashes there" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids there"')
    expect(review.err).toContain('name the place in docs/tsd.md#introduction')
    expect(review.err).toContain(`correct the place and run the review again: work review ${linter} r1 accept ` +
      '--evidence="no-code-proof | <the place in docs/tsd.md#introduction where you looked> | no paths or hashes there" ' +
      '--evidence="no-ticket-ids | the introduction | no ticket ids there"')
    expect(review.err).not.toContain('do not try other commands')
  })
})

describe('generated runs: next has a way on', () => {
  // seed 10: a high agent delegated a part to a lead it did not assign, and the lead it did
  // assign saw a checker of its parent that it could not start, so nothing moved the part.
  test('next names only the caller\'s own lead, and a lead assigns its own checker', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK })
    const other = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    ok(await p.agent(`brief ${other}`))
    ok(await p.nanda('grant --act=change --on=t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('parts.yaml', '- { name: Design, text: Write the design., context: { section: design } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    ok(await p.agent(`assign ${arch} t2 --role=linter`))
    const lead = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=section-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nOne file per merchant per day.\n')
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#design`))
    const leadNext = ok(await p.agent(`next ${lead}`)).out
    expect(leadNext).toContain(`work assign ${lead} t2 --role=linter`)
    const archNext = ok(await p.agent(`next ${arch}`)).out
    expect(archNext).toContain('a4 (section-lead) runs t2')
    expect(archNext).not.toContain('a1 (section-lead) runs t2')
  })
})

describe('generated runs: a Reject of a task is shown', () => {
  // seed 138: the person's Reject of a task came after its latest result, and no view named it.
  test('waiting and next name a Reject of the task that came after its latest result', async () => {
    const { p, lead } = await reported()
    ok(await p.nanda('review t1 reject --point="the story needs the cost"'))
    // The evaluation comes first (2026-11-08); then the views name the Reject and its answers.
    expect(ok(await p.nanda('waiting')).out).toContain('t1 The Introduction waits for an evaluation')
    await evaluated(p, 't1')
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).toContain('v2.1 needs a change of tsd-writing')
    // t1 has a section, so it is one unit: the person's remake answers the point, not a split.
    expect(waiting).toContain('work task remake t1 --file=<task.yaml> --reason="<how the scope changed>" --review=v2.1')
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('v2.1 returns t1: "the story needs the cost"')
  })
})

describe('planted faults: views of a program', () => {
  test('assignment show of a program prints what it runs, with no crash', async () => {
    const { p, app, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'fix')
    writeFileSync(`${app}/fix.txt`, `fixed\n`)
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'fix')
    ok(await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD').slice(0, 12)}`))
    const show = ok(await p.agent('assignment show a3')).out
    expect(show).toContain('a3 · gate (program) on t1')
    expect(show).toContain('runs "test -f ok.txt" on report; checks suite-passes')
  })
})

describe('R4-12: a code join', () => {
  // Two parts commit on their own branches; the join is one commit that contains both.
  const partCommit = async (p, app, lead, part, branch, file) => {
    const impl = tokenIn(ok(await p.agent(`assign ${lead} ${part} --role=implementer`)).out)
    ok(await p.agent(`brief ${impl}`))
    git(app, 'checkout', '-q', 'main')
    git(app, 'checkout', '-q', '-b', branch)
    writeFileSync(`${app}/${file}`, `${branch}\n`)
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', branch)
    const out = ok(await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD').slice(0, 12)}`)).out
    expect(out).toContain('gate ran on')
    // The lead decides the implementer's result.
    ok(await p.agent(`review ${lead} ${out.match(/^(r\d+) reported/)[1]} accept --evidence="the files in app at the reported commit | the gate passed and the fix is small"`))
    return git(app, 'rev-parse', 'HEAD')
  }

  test('the join form is app@<commit>, and the join contains the commit of each part', async () => {
    const { p, app, lead, impl } = await codeStarted()
    p.write('parts.yaml', '- { name: Key, text: Fix the key. }\n- { name: Name, text: Fix the name. }\n')
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    await partCommit(p, app, lead, 't2', 'key', 'key.txt')
    await partCommit(p, app, lead, 't3', 'name', 'name.txt')
    expect(ok(await p.agent('assignment show a2')).out).toContain('--output=app@<commit>')
    // A join that has only one part's commit is refused; with both, it is reported.
    git(app, 'checkout', '-q', 'key')
    git(app, 'checkout', '-q', '-b', 'join-one')
    writeFileSync(`${app}/join.txt`, `joined\n`)
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'join one')
    const one = await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD').slice(0, 12)}`)
    expect(one.err).toContain('does not contain')
    git(app, 'merge', '-q', '--no-edit', 'name')
    expect(ok(await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD').slice(0, 12)}`)).out).toContain('reported on t1')
  }, 60000)
})

describe('live code run: the findings of run 2 (proofs.md section 3)', () => {
  // Findings 1 and 4: two code makers shared one git working tree, and "a new branch" named no start.
  test('a code maker gets its own worktree and branch, and a commit made there is reported', async () => {
    const { p, app, impl } = await codeStarted()
    const brief = ok(await p.agent(`assignment show ${impl.split('.')[0]}`)).out
    // The output names the project folder <project>.
    expect(brief).toContain('your worktree: <project>/.work/trees/a2, branch work/a2 from main; make and commit the change only there')
    expect(brief).toContain('make it once, if it is not there: git -C app worktree add -b work/a2 <project>/.work/trees/a2 main')
    const tree = `${p.dir}/.work/trees/a2`
    git(app, 'worktree', 'add', '-q', '-b', 'work/a2', tree, 'main')
    writeFileSync(`${tree}/fix.txt`, `fixed\n`)
    git(tree, 'add', '.')
    git(tree, 'commit', '-q', '-m', 'fix')
    expect(git(app, 'branch', '--show-current')).toBe('main')
    const out = ok(await p.agent(`report ${impl} --output=app@${git(tree, 'rev-parse', 'HEAD').slice(0, 12)}`)).out
    expect(out).toContain('reported on t1')
    expect(out).toContain('gate ran on')
  })

  // Findings 2 and 5: the maker of a task that needs others saw the parts' fixes in its text, and
  // the brief did not say that a squash is refused.
  // The accepted case is in "model checks" below; here the parts are still open (section 4, F2).
  test('the NEEDS lines say that the needs are not accepted yet, and that the maker waits', async () => {
    const { p, impl } = await codeStarted()
    p.write('parts.yaml', '- { name: Key, text: Fix the key. }\n- { name: Name, text: Fix the name. }\n')
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    const brief = ok(await p.agent(`assignment show ${impl.split('.')[0]}`)).out
    expect(brief).toContain('Not all of them are accepted yet. Do not report until each one is; STOP and tell your parent.')
    expect(brief).not.toContain('Their work is done')
  })

  // Finding 6: the tech lead read the store with sqlite3 to see its checkers' evidence.
  test('work result show prints each review with its evidence', async () => {
    const { p, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ` +
      '--evidence="no-code-proof | docs/tsd.md#introduction, all lines | there are no paths and no hashes" ' +
      '--evidence="no-ticket-ids | docs/tsd.md#introduction, all lines | there is no ticket id in the text"'))
    const show = ok(await p.agent('result show r1')).out
    expect(show).toContain('r1 on t1 by a2 (writer): docs/tsd.md#introduction')
    expect(show).toContain('v2 accept by a3 (linter)')
    expect(show).toContain('  no-ticket-ids | docs/tsd.md#introduction, all lines | there is no ticket id in the text')
    expect(show).toContain('r1 (docs/tsd.md#introduction) is stopped by:')
  })

  // Finding 9: a point with no rule went to the person only in chat, so the record said Accepted.
  test('a point with no rule is escalated on the result, and the result waits for the person', async () => {
    const { p, app, lead, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'fix')
    writeFileSync(`${app}/fix.txt`, `fixed\n`)
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'fix')
    ok(await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD').slice(0, 12)}`))
    expect(ok(await p.agent(`brief ${lead}`)).out).toContain(`first escalate it with work escalate ${lead} --result=r1 --reason="<the point>"`)
    ok(await p.agent(`escalate ${lead} --result=r1 --reason="a comment in fix.txt is out of date, and no rule covers it"`))
    expect(ok(await p.nanda('waiting')).out).toContain('a comment in fix.txt is out of date')
    const accept = ok(await p.agent(`review ${lead} r1 accept --evidence="the files in app at the reported commit | the gate passed and the fix is small"`)).out
    expect(accept).toContain('r1 still has 1 blocker(s)')
  })
})

describe('model checks: the two links of a task (proofs.md section 4)', () => {
  const commit = (app, branch, from, file, text) => {
    git(app, 'checkout', '-q', from)
    git(app, 'checkout', '-q', '-B', branch)
    writeFileSync(`${app}/${file}`, `${text}\n`)
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', text)
    return git(app, 'rev-parse', 'HEAD').slice(0, 12)
  }
  const reportedId = (r) => ok(r).out.match(/(r\d+) reported/)[1]
  // t1 needs t2 (key) and t3 (name); the lead decides each result; t1 merges both.
  async function acceptedTree() {
    const { p, app, lead, impl } = await codeStarted()
    p.write('parts.yaml', '- { name: Key, text: Fix the key. }\n- { name: Name, text: Fix the name. }\n')
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    const parts = {}
    for (const [t, branch] of [['t2', 'key'], ['t3', 'name']]) {
      const maker = tokenIn(ok(await p.agent(`assign ${lead} ${t} --role=implementer`)).out)
      ok(await p.agent(`brief ${maker}`))
      const sha = commit(app, branch, 'main', `${branch}.txt`, branch)
      const rid = reportedId(await p.agent(`report ${maker} --output=app@${sha}`))
      ok(await p.agent(`review ${lead} ${rid} accept --evidence="the files in app at the reported commit | the gate passed"`))
      parts[t] = { maker, rid, sha }
    }
    const brief = ok(await p.agent(`assignment show ${impl.split('.')[0]}`)).out
    git(app, 'checkout', '-q', 'key')
    git(app, 'checkout', '-q', '-b', 'join')
    git(app, 'merge', '-q', '--no-edit', 'name')
    const rid = reportedId(await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD').slice(0, 12)}`))
    ok(await p.agent(`review ${lead} ${rid} accept --evidence="the files in app at the reported commit | both parts are merged"`))
    return { p, app, lead, impl, parts, join: rid, brief }
  }

  // F1: a need got a new accepted result, and the task that needs it stayed Accepted on old work.
  test('a newer result of a need makes the result old, and its maker reports again with it', async () => {
    const { p, app, lead, impl, parts, join, brief } = await acceptedTree()
    expect(brief).toContain('Their work is done. Merge their accepted commits with git merge (a squash or a copy is refused)')
    ok(await p.agent(`recheck ${lead} ${parts.t2.rid} --reason="the key must also hold the currency"`))
    ok(await p.agent(`brief ${parts.t2.maker}`))
    const sha = commit(app, 'key', 'key', 'key.txt', 'key-with-currency')
    const r4 = reportedId(await p.agent(`report ${parts.t2.maker} --output=app@${sha}`))
    ok(await p.agent(`review ${lead} ${r4} accept --evidence="the files in app at the reported commit | the key holds the currency"`))
    const show = ok(await p.agent('task show t1')).out
    expect(show).toContain('t1 Fix the key · In review')
    expect(show).toContain(`${join} was made before ${r4} of t2 (Key); the maker reports again with that work`)
    expect(ok(await p.agent(`next ${lead}`)).out).toContain(`work recheck ${lead} ${join} --reason="${r4} of t2 is newer; use it"`)
    ok(await p.agent(`recheck ${lead} ${join} --reason="${r4} of t2 is newer; use it"`))
    ok(await p.agent(`brief ${impl}`))
    git(app, 'checkout', '-q', 'join')
    git(app, 'merge', '-q', '--no-edit', 'key')
    const again = reportedId(await p.agent(`report ${impl} --output=app@${git(app, 'rev-parse', 'HEAD').slice(0, 12)}`))
    ok(await p.agent(`review ${lead} ${again} accept --evidence="the files in app at the reported commit | the merge has the new key"`))
    expect(ok(await p.agent('task show t1')).out).toContain('t1 Fix the key · Accepted')
  }, 60000)

  // F3: a need of another tree; next and waiting named nothing while it was open.
  test('a need in another tree shows in next and in waiting', async () => {
    const { p } = await codeStarted()
    p.write('other.yaml', 'name: Use the key\ntext: Use the fixed key.\ndirections: [fixes]\nneeds: [t1]\n' +
      'workspace:\n  - { source: app, path: app, base: main }\n')
    ok(await p.nanda('task open --file=other.yaml'))
    const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    expect(ok(await p.agent(`next ${lead2}`)).out).toContain('t2 waits for t1 Fix the key (Open), which is outside your task tree')
    expect(ok(await p.nanda('waiting')).out).toContain('t2 Use the key waits for t1 Fix the key (Open), of another task tree')
  }, 60000)

  // After a remake, old work is a starting point that the split names; the result is new work.
  test('a part starts from earlier work: its maker starts there, and its result is new work', async () => {
    const { p, app, parts } = await acceptedTree()
    p.write('narrow.yaml', 'name: Fix the key for one merchant\ntext: Fix the key for merchant M-104 only.\n' +
      'directions: [fixes]\nworkspace:\n  - { source: app, path: app, base: main }\n')
    ok(await p.nanda('task remake t1 --file=narrow.yaml --reason="the fix is for one merchant only"'))
    p.write('narrow-parts.yaml', `- { name: Key, text: Fix the key for M-104 only., from: ${parts.t2.rid} }\n`)
    ok(await p.nanda('task split t4 --file=narrow-parts.yaml'))
    const lead = tokenIn(ok(await p.nanda('assign t4 --role=lead')).out)
    ok(await p.agent(`brief ${lead}`))
    const maker = tokenIn(ok(await p.agent(`assign ${lead} t5 --role=implementer`)).out)
    const id = maker.split('.')[0]
    const brief = ok(await p.agent(`brief ${maker}`)).out
    expect(brief).toContain(`FROM     ${parts.t2.rid} of t2 Key: app@${parts.t2.sha}`)
    expect(brief).toContain(`git -C app worktree add -b work/${id} <project>/.work/trees/${id} ${parts.t2.sha}`)
    expect((await p.agent(`report ${maker} --output=app@${parts.t2.sha}`)).err).toContain(`is the starting point of t5 (${parts.t2.rid}); a report is new work`)
    const fromMain = commit(app, 'other', 'main', 'other.txt', 'other')
    expect((await p.agent(`report ${maker} --output=app@${fromMain}`)).err).toContain(`does not start from ${parts.t2.rid}`)
    const onTop = commit(app, 'm104', 'key', 'key.txt', 'key-for-m104')
    expect(ok(await p.agent(`report ${maker} --output=app@${onTop}`)).out).toContain('reported on t5')
  }, 60000)
})

// The abstraction says that a revision comes from the system of its source. For a git source
// (a workspace with a base) the CLI reads it from git; nobody types it.
describe('revisions come from git', () => {
  test('a typed base of a git source is refused, git gives the base, a new main asks for no recheck, and a low agent records no source', async () => {
    const { p, app, lead, impl } = await codeStarted()
    expect((await p.agent(`source ${impl} page@v4`)).err).toContain('a low role records no source')
    const base = git(app, 'rev-parse', 'main').slice(0, 12)
    git(app, 'checkout', '-q', '-b', 'fix')
    writeFileSync(`${app}/fix.txt`, `fixed\n`)
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'fix')
    const fix = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    writeFileSync(`${app}/more.txt`, `more\n`)
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'main moves')
    const moved = git(app, 'rev-parse', 'main').slice(0, 12)
    // The maker says that its fix is built on the new main; git says that it is not.
    const typed = await p.agent(`report ${impl} --output=app@${fix} --made-from=app@${moved}`)
    expect(typed.err).toContain(`--made-from=app@${moved}: app is a git source, and the CLI reads its revision from git`)
    ok(await p.agent(`report ${impl} --output=app@${fix}`))
    expect(ok(await p.agent('result show r1')).out).toContain(`(made from app@${base})`)
    // Main moved after the base of the fix, by work that the fix does not need: no recheck.
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('work recheck')
    // Nobody records a git source by hand; a lead records a source outside git.
    expect((await p.agent(`source ${lead} app@${base}`)).err).toContain('app is a git source: the CLI reads the base of each commit from git, and a new commit on it asks for no recheck')
    expect(ok(await p.agent(`source ${lead} page@v4`)).out).toContain('page is at v4.')
  }, 60000)
})
