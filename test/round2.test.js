import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { changeDirection, CODE_DIRECTION, CODE_TASK, CODE_YAML, git, init, INTRO_V1, INTRO_V2, ok, project, reported, started, TASK_WHOLE, tokenIn, withWriter } from './harness.js'

// One test for each finding of thought-test round 2 that the prototype closes. The id in
// each name is the finding's id in round2/FIXES.md.

describe('identity', () => {
  test('A2: an output never runs as code', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    const r = await p.agent(`report ${writer} --output="x;exit 0;.md#intro"`)
    expect(r.err).toContain('has characters outside')
  })

  test('A3: a draft review comes from outside the reviser tree, and not from a low role', async () => {
    const { p, lead } = await started()
    ok(await p.nanda('grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-10-26T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const child = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=region-lead`)).out)
    ok(await p.agent(`brief ${child}`))
    const inTree = await p.agent(`review ${child} d2 accept --evidence="edit.yaml | fine by me"`)
    expect(inTree.err)
      .toContain('d2 is your own draft, or a draft from above you; another actor reviews it')
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    const low = await p.agent(`review ${writer} d2 accept --evidence="edit.yaml | ok"`)
    expect(low.err)
      .toContain('a low role does not review drafts of directions')
  })

  test('A4: a raise to the person is settled only by the person', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`raise ${lead} --result=r1 --reason="only Nanda decides this"`))
    expect((await p.agent(`review ${lead} r1 accept --settles=v2 --reason="I decided"`)).err).toContain('may not settle')
    expect(ok(await p.nanda('review r1 accept --settles=v2 --reason="go on"')).out).toContain('v3: settles v2 on r1')
  })

  test('A4: a relayed answer waits for the person to ratify it', async () => {
    const { p, lead } = await started()
    ok(await p.agent(`ask ${lead} --text="May we skip the repeatable rule?" --to=owner`))
    const r = ok(await p.agent(`relay ${lead} Nanda answer q1 --quote="yes"`))
    expect(r.out).toMatch(/^e\d+: answer q1: "yes" waits until Nanda runs work ratify/)
    expect(ok(await p.agent('waiting --for=Nanda')).out).toContain('q1 for Nanda')
  })

  test('A5: a low assignment does not relay; the person gives no work to a low role', async () => {
    const { p, linter } = await reported()
    expect((await p.agent(`relay ${linter} Nanda reject r1 --quote="no"`)).err)
      .toContain('only the top agent (medium or high, with no parent) relays the person')
    expect((await p.nanda('assign t1 --role=linter')).err)
      .toContain('the person gives work to a medium or high role; linter is low, so a lead gives it its work')
  })

  test('A7: a person command refuses GIT_CONFIG variables', async () => {
    const { p } = await started()
    const r = await p.run('task open --file=task.yaml', { tty: true, env: { GIT_CONFIG_COUNT: '1' } })
    expect(r.err).toContain('GIT_CONFIG variables are set')
  })
})

describe('rules', () => {
  test('B1: evidence names the place in the result and says what was seen', async () => {
    const { p, linter } = await reported()
    expect((await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | x | x" --evidence="no-ticket-ids | x | x"`)).err)
      .toContain('name the place in docs/tsd.md#introduction')
    expect((await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | introduction | none" --evidence="no-ticket-ids | introduction | none"`)).err)
      .toContain('say what you saw, in a sentence')
  })

  test('B1: an unchanged result does not close a Reject', async () => {
    const { p, writer, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="two files is vague" --breaks=no-ticket-ids`))
    ok(await p.agent(`brief ${writer}`))
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).err).toContain('nothing changed since r1')
  })

  test('B2: a report is in the workspace of its task', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    expect((await p.agent(`report ${writer} --output=docs/facts.md#dedupe`)).err).toContain('the output of this task is docs/tsd.md#introduction')
    expect((await p.agent(`report ${writer} --output=../other/docs/tsd.md#introduction`)).err).toContain('is outside the project')
  })

  test('B3: a heading used twice is refused', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', `${INTRO_V2}\n## Introduction\n\nagain\n`)
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).err).toContain('2 times; make each heading unique')
  })

  test('B3: views show work that changed after it was reported', async () => {
    const { p } = await reported()
    p.write('docs/tsd.md', INTRO_V1)
    expect(ok(await p.agent('blockers r1')).out).toContain('r1 changed after it was reported; the maker reports it again')
    expect(ok(await p.agent('task tree t1')).out).toContain('(r1 changed after it was reported)')
  })

  test('B4: the ratify prompt shows the act and the words', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`ask ${lead} --text="May we skip the repeatable rule?" --to=owner`))
    const relayed = ok(await p.agent(`relay ${lead} Nanda answer q1 --quote="no, keep it"`))
    const id = relayed.out.match(/^(e\d+)/)[1]
    const r = ok(await p.nanda(`ratify ${id}`, 'ratify'))
    expect(r.out).toContain(`${id}: answer q1: "no, keep it"`)
    expect(r.out).toContain('their words: "no, keep it"')
  })

  test('B5: the tier maxAttempts is the default and the ceiling', async () => {
    const { p, lead } = await started()
    expect((await p.agent(`assign ${lead} t1 --role=writer --max-attempts=5`)).err).toContain('over the low limit of 3')
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    expect(ok(await p.agent(`brief ${writer}`)).out).toContain('attempt 1 of 3')
  })

  test('B5: an unknown limit key is refused at init', async () => {
    const { WORK_YAML } = await import('./harness.js')
    const p = project({ 'work.yaml': WORK_YAML.replace('attempts: 3 }', 'attempts: 3, resultSize: 9 }') })
    const init = await p.nanda('init')
    expect(init.err).toContain('limits.low.Assignment.resultSize is not a limit')
  })

  test('B6: an agent does not waive for long', async () => {
    const { p, lead } = await reported()
    expect((await p.agent(`waive ${lead} r1 --rules=no-code-proof --reason=urgent --until=2099-01-01T00:00:00Z`)).err)
      .toContain('at most 72 hours')
  })

  test('B7: a split part keeps the context of its task and works inside the project', async () => {
    const { p } = await started()
    ok(await p.nanda('grant --act=change --on=t1 --to=architect --until=2026-10-26T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // A task with a region keeps it: it is one unit of work, so it is not split (round 7).
    p.write('parts.yaml', '- { name: Part, text: Write it., context: { region: other } }\n')
    expect((await p.agent(`task split ${arch} t1 --file=parts.yaml`)).err).toContain('has the region introduction, so it is one unit of work')
    const whole = await started({ 'task.yaml': TASK_WHOLE })
    ok(await whole.p.nanda('grant --act=change --on=t1 --to=architect --until=2026-10-26T00:00:00Z', 'grant'))
    const arch2 = tokenIn(ok(await whole.p.nanda('assign t1 --role=architect')).out)
    ok(await whole.p.agent(`brief ${arch2}`))
    whole.p.write('parts.yaml', '- { name: Part, text: Write it., workspace: [{ source: x, path: /etc }] }\n')
    expect((await whole.p.agent(`task split ${arch2} t1 --file=parts.yaml`)).err).toContain('outside the project')
  })
})

describe('what agents see', () => {
  test('C2: a low checker reviews only the result in its brief', async () => {
    const { p, linter } = await reported()
    expect((await p.agent(`review ${linter} t1 reject --point="no"`)).err).toContain('your brief named r1; a low checker reviews only that result')
  })

  test('C3: config restore writes the stored work.yaml back', async () => {
    const { p, writer } = await withWriter()
    p.write('work.yaml', (await Bun.file(`${p.dir}/work.yaml`).text()).replace('You write one region under its heading.', 'You write.'))
    expect((await p.agent(`brief ${writer}`)).err).toContain('changed; the person restores it", then STOP')
    ok(await p.nanda('config restore', 'restore'))
    expect((await p.agent(`brief ${writer}`)).code).toBe(0)
  })

  test('C4: a medium claim lasts until finish, and a medium reads its brief again', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`review ${lead} r1 reject --point="too short for a reader"`))
    expect(ok(await p.agent(`brief ${lead}`)).out).toContain('work brief a1')
    ok(await p.agent(`assign ${lead} t1 --role=linter`))
  })

  test('C6: a grant needs a known act, a target, and an until in the future', async () => {
    const { p } = await started()
    expect((await p.nanda('grant --act=destroy --on=t1 --to=architect --until=2026-10-26T00:00:00Z', 'grant')).err)
      .toContain('--act is approve, review, or change')
    expect((await p.nanda('grant --act=change --on=t1 --to=architect --until=2020-01-01T00:00:00Z', 'grant')).err)
      .toContain('is in the past')
    expect(ok(await p.nanda('grant --act=approve --on=writer --to=region-lead --until=2026-10-26T00:00:00Z', 'grant')).out)
      .toContain('region-lead may approve writer')
  })

  test('C9: a refusal in an agent shell always has a next line', async () => {
    const { p } = await started()
    expect((await p.agent('blockers r99')).err).toContain('next: check the ids with work status or work log')
    expect((await p.agent('blockers r99')).err).toContain('there is no result r99')
  })

  test('L3: the answer to a question is in the asker\'s next brief', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`raise ${writer} --reason="the verify fails on correct text"`))
    ok(await p.agent(`answer ${lead} q1 --text="the verify is wrong; report the text as it is"`))
    const brief = ok(await p.agent(`brief ${writer}`)).out
    expect(brief).toContain('ANSWERS  q1 asked by a2: the verify fails on correct text')
    expect(brief).toContain('answer (a1): the verify is wrong; report the text as it is')
  })

  test('L1: assign prints the whole subagent prompt with the project folder', async () => {
    const { p, lead } = await started()
    const out = ok(await p.agent(`assign ${lead} t1 --role=writer`)).out
    expect(out).toContain('Start a Haiku subagent with this prompt, and nothing else:')
    expect(out).toContain('Use the work skill. In <project>, run: work brief a2.')
  })
})

describe('flows', () => {
  test('F-A1: the person releases and finishes an assignment by its id', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    expect(ok(await p.nanda('release a2')).out).toContain('a2 is released')
    expect(ok(await p.nanda('finish a2')).out).toContain('a2 is finished')
  })

  test('F-A5: a join that changes an accepted part is refused', async () => {
    const { p } = await started({ 'task.yaml': TASK_WHOLE })
    ok(await p.nanda('grant --act=change --on=t1 --to=architect --until=2026-10-26T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('parts.yaml', '- { name: Intro part, text: Write the introduction paragraph., context: { region: introduction } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    const writer = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids here"'))
    const lead = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=region-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | I can repeat the double export from it"`))
    // One maker writes a file at a time: the part's writer finishes before the joiner starts.
    ok(await p.agent(`finish ${arch} ${writer.split('.')[0]}`))
    const joiner = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=writer`)).out)
    const brief = ok(await p.agent(`brief ${joiner}`)).out
    expect(brief).toContain('NEEDS    t2 Intro part · Accepted (r1 docs/tsd.md#introduction)')
    expect(brief).toContain('--output=docs/tsd.md')
    p.write('docs/tsd.md', INTRO_V2.replace('two files', 'two files; see ABC-2964'))
    expect((await p.agent(`report ${joiner} --output=docs/tsd.md`)).err).toContain('docs/tsd.md changes the region introduction of t2 (Intro part) after r1 was accepted')
  })

  test('F-B4: direction show prints a draft and what it changes', async () => {
    const { p } = await started()
    await changeDirection(p, 'add:\n  - { id: short, says: Keep it short. }\n', { accept: false })
    const out = ok(await p.agent('direction show d2')).out
    expect(out).toContain('d2 a draft of TSD writing (owner Nanda), built on tsd-writing@1 · waits for the accept of Nanda')
    expect(out).toContain('+ short: Keep it short.')
  })

  test('F-B5: a recheck asks for a new result, and the same work may answer it', async () => {
    const { p, lead, writer, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids here"'))
    // A recheck reopens accepted work (with nothing changed outside, it would be a free try).
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    expect(ok(await p.agent(`recheck ${lead} r1 --reason="the facts file changed"`)).out).toContain('asks for a new result of t1')
    expect(ok(await p.agent('blockers r1')).out).toContain('asks for a new result: "the facts file changed"')
    ok(await p.agent(`brief ${writer}`))
    expect(ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).out).toContain('r2 reported')
  })

  test('F-B7: a replaced standard keeps its unchanged rules and their open points', async () => {
    const { p, writer, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="names the ticket" --breaks=no-ticket-ids`))
    p.write('edit.yaml', 'replace:\n  - id: facts-not-proof\n    with:\n      id: facts-not-proof\n' +
      '      says: The body states facts; the proof stays in the agreed facts.\n      rules:\n' +
      '        - { id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }\n' +
      '        - { id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", checkedBy: linter }\n' +
      '        - { id: no-urls, says: "No raw links in the body", checkedBy: linter }\n')
    await changeDirection(p, readFileSync(`${p.dir}/edit.yaml`, 'utf8'), { flags: '--why="no links"' })
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2.replace('two files', 'two identical files'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r2 accept --evidence="no-code-proof | the introduction | no paths or hashes" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids here" --evidence="no-urls | the introduction | no links in it"'))
    expect(ok(await p.agent('blockers r2')).out).not.toContain('v2.1')
  })
})

describe('code work in git', () => {
  test('F-A2: the gate runs on the reported commit, not on the checked-out branch', async () => {
    const p = project({ 'work.yaml': CODE_YAML, 'code-directions/fixes.yaml': CODE_DIRECTION, 'task.yaml': CODE_TASK, 'app/ok.txt': 'ok\n' })
    const app = `${p.dir}/app`
    git(app, 'init', '-q', '-b', 'main')
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'base')
    git(app, 'checkout', '-q', '-b', 'fix')
    git(app, 'rm', '-q', 'ok.txt')
    git(app, 'commit', '-q', '-m', 'a fix that breaks the suite')
    const broken = git(app, 'rev-parse', 'HEAD')
    git(app, 'checkout', '-q', 'main')
    await init(p)
    for (const role of ['lead', 'implementer']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=lead')).out)
    ok(await p.agent(`brief ${lead}`))
    const impl = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=implementer`)).out)
    const brief = ok(await p.agent(`brief ${impl}`)).out
    expect(brief).toContain('Commit the fix in app and report it as app@<commit>.')
    const report = ok(await p.agent(`report ${impl} --output=app@${broken.slice(0, 12)}`)).out
    expect(report).toContain('gate ran on r1: reject (exit 1')

    // F-A6: the CLI records the merge base with main as evidence. A new commit on main is work
    // that this task does not need, so resume asks for no recheck.
    expect(ok(await p.agent('result show r1')).out).toContain(`(made from app@${git(app, 'rev-parse', 'main').slice(0, 12)})`)
    ok(await p.agent(`checkpoint ${lead} t1 --next="wait for the gate"`))
    Bun.spawnSync(['sh', '-c', `echo more > ${app}/more.txt`])
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'main moves')
    const resumed = ok(await p.agent(`resume ${lead} t1`)).out
    expect(resumed).toContain('changed outside: nothing')
    expect(resumed).toContain('check again: nothing')
  }, 20000)
})
