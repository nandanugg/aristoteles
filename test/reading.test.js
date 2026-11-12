// What the UI reads (Nanda, 2026-11-11): the files of each result (the diff is by file), the text
// of an in-place maker's files before any work (so a part shows only its own work), and the words
// of what each task does now (a task card "only says what it's currently doing right now").
import { describe, expect, test } from 'bun:test'
import { INTRO_V1, INTRO_V2, codeStarted, git, ok, tokenIn, withWriter } from './harness.js'
import { panel, tables } from './outside.js'

// The words of a task, as its panel gives them (the server's /api/task) at noon.
const words = async (p, id) => (await panel(p, id, '2026-10-25T12:00:00.000Z')).words

describe('what the UI reads', () => {
  test('a task says what it does now, from the assign to the accept', async () => {
    const { p, lead, writer } = await withWriter()
    expect(await words(p, 't1')).toBe('works (attempt 1 of 3)')
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    expect(await words(p, 't1')).toBe('in review')
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
    expect(await words(p, 't1')).toBe('works (attempt 2 of 3)')
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r2 accept --evidence="no-code-proof | the introduction | no paths or hashes" ` +
      '--evidence="no-ticket-ids | the introduction | no ticket ids here"'))
    expect(await words(p, 't1')).toBe('in review')
    ok(await p.agent(`review ${lead} r2 accept --evidence="repeatable | the introduction | I can repeat the double export"`))
    expect(await words(p, 't1')).toBe('accepted')
  })

  test('a section result names its file; the text before the first brief is kept', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const db = tables(p)
    expect(db.query('SELECT result, file FROM result_file').all()).toEqual([{ result: 'r1', file: 'docs/tsd.md' }])
    expect(db.query('SELECT task, file, text FROM task_before').all())
      .toEqual([{ task: 't1', file: 'docs/tsd.md', text: '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nTODO\n' }])
    db.close()
  })

  test('a commit result names the files of its diff against its base, in the path of its repo', async () => {
    const { p, app, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'fix', 'main')
    p.write('app/key.js', 'export const key = 1\n')
    p.write('app/lib/name.js', 'export const name = "a"\n')
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'fix')
    const sha = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    ok(await p.agent(`report ${impl} --output=app@${sha}`))
    const db = tables(p)
    expect(db.query('SELECT file FROM result_file ORDER BY file').all().map((r) => r.file)).toEqual(['app/key.js', 'app/lib/name.js'])
    // A maker of commits has its own branch, so the store keeps no text for it.
    expect(db.query('SELECT COUNT(*) AS n FROM task_before').get().n).toBe(0)
    db.close()
  })
})
