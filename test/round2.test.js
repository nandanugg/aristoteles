import { describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
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
    expect((await p.agent(`report ${writer} --output=../other/docs/tsd.md#introduction`)).err).toContain('is outside the dir')
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

  test('B5: the tier maxAttempts is the default and the ceiling', async () => {
    const { p, lead } = await started()
    expect((await p.agent(`assign ${lead} t1 --role=writer --max-attempts=5`)).err).toContain('over the limit of haiku, 3')
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    expect(ok(await p.agent(`brief ${writer}`)).out).toContain('attempt 1 of 3')
  })

  test('B5: an unknown limit key is refused at init', async () => {
    const { WORK_YAML } = await import('./harness.js')
    const p = project({ 'aristoteles.yaml': WORK_YAML.replace('attempts: 3 }', 'attempts: 3, resultSize: 9 }') })
    const init = await p.nanda('init')
    expect(init.err).toContain('models.haiku.limits.Assignment.resultSize is not a limit')
  })

})

describe('what agents see', () => {
  test('C2: a low checker reviews only the result in its brief', async () => {
    const { p, linter } = await reported()
    expect((await p.agent(`review ${linter} t1 reject --point="no"`)).err).toContain('your brief named r1; a checker of one unit reviews only that result')
  })

  test('C3: config restore writes the stored aristoteles.yaml back', async () => {
    const { p, writer } = await withWriter()
    p.write('aristoteles.yaml', (await Bun.file(`${p.dir}/aristoteles.yaml`).text()).replace('You write one section under its heading.', 'You write.'))
    // D10, I5: the next line is the real choice (escalate), in core's words (no token).
    expect((await p.agent(`brief ${writer}`)).err).toContain('next: escalate it: the person restores or applies aristoteles.yaml')
    ok(await p.nanda('config restore', 'restore'))
    expect((await p.agent(`brief ${writer}`)).code).toBe(0)
  })

  test('C4: a medium claim lasts until finish, and a medium reads its brief again', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`review ${lead} r1 reject --point="too short for a reader"`))
    expect(ok(await p.agent(`brief ${lead}`)).out).toContain('work brief a1')
    // P9: one linter checks t1 at a time, so the lead ends a3 before it assigns another.
    ok(await p.agent(`finish ${lead} a3`))
    ok(await p.agent(`assign ${lead} t1 --role=linter`))
  })

  test('C9: a refusal in an agent shell always has a next line', async () => {
    const { p } = await started()
    expect((await p.agent('blockers r99')).err).toContain('next: check the ids with work status or work log')
    expect((await p.agent('blockers r99')).err).toContain('there is no result r99')
  })

  test('L1: assign prints the whole subagent prompt with the project folder', async () => {
    const { p, lead } = await started()
    const out = ok(await p.agent(`assign ${lead} t1 --role=writer`)).out
    // Ruling 7, onboarding 2026-11-14: a disposable role starts as a subagent on the model of its tier (was: "Start a Haiku subagent").
    expect(out).toContain('Start a subagent on haiku with this prompt, and nothing else:')
    expect(out).toContain('Use the work skill. In <project>, run: work brief a2.')
  })
})

describe('flows', () => {
  test('F-A1: the person frees and finishes an assignment by its id', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    expect(ok(await p.nanda('free a2')).out).toContain('a2 is freed')
    expect(ok(await p.nanda('finish a2')).out).toContain('a2 is finished')
  })

  test('F-B4: direction show prints a draft and what it changes', async () => {
    const { p } = await started()
    await changeDirection(p, 'add:\n  - { id: short, says: Keep it short. }\n', { accept: false })
    const out = ok(await p.agent('direction show d2')).out
    expect(out).toContain('d2 a draft of TSD writing (owner Nanda), built on tsd-writing@1 · waits for the accept of Nanda')
    expect(out).toContain('+ short: Keep it short.')
  })

  test('F-B7: a replaced standard keeps its unchanged rules and their open points', async () => {
    const { p, writer, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="names the ticket" --breaks=no-ticket-ids`))
    p.write('edit.yaml', 'replace:\n  - id: facts-not-proof\n    with:\n      id: facts-not-proof\n' +
      '      says: The body states facts; the proof stays in the agreed facts.\n      rules:\n' +
      '        - { id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }\n' +
      '        - { id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", checkedBy: linter }\n' +
      '        - { id: no-urls, says: "No raw links in the body", checkedBy: linter }\n')
    await changeDirection(p, readFileSync(`${p.dir}/edit.yaml`, 'utf8'), { flags: '--why="Correct the rule"' })
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
})
