// Round 8, attacker F: the file queue keys on the words of a workspace path, so a path that
// names the same file in another way gives a second maker the file while the first one holds it.
// Each test expects the CORRECT behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { INTRO_V2, TASK, WORK_YAML, ok, started, tokenIn } from
  './harness.js'

const WITH_DESIGN = INTRO_V2.replace('## Design\n\nTODO', '## Design\n\nOne file per merchant per day.')
const DESIGN_TASK = (path) => TASK.replace('The Introduction', 'The Design')
  .replace('Write the Introduction from the agreed facts.', 'Write the Design from the agreed facts.')
  .replace('section: introduction', 'section: design').replace('path: docs/tsd.md', `path: ${path}`)

describe('F-Q1 one maker for each file: a path that names docs/tsd.md in another way', () => {
  // The fix (2026-11-08): a workspace path is written in its one real form, so task open refuses
  // another way to write it; the file queue then compares one name.
  async function openOn(path, files = {}) {
    const { p, lead } = await started(files)
    const first = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${first}`))
    p.write('design.yaml', DESIGN_TASK(path))
    return p.nanda('task open --file=design.yaml')
  }
  test('a later task on ./docs/tsd.md gets its brief while a2 holds docs/tsd.md', async () => {
    expect((await openOn('./docs/tsd.md')).err).toContain('workspace ./docs/tsd.md names docs/tsd.md; write it as docs/tsd.md, so that one file has one name')
  })
  test('a later task on docs//tsd.md gets its brief while a2 holds docs/tsd.md', async () => {
    expect((await openOn('docs//tsd.md')).err).toContain('workspace docs//tsd.md names docs/tsd.md; write it as docs/tsd.md')
  })
  test('a later task on docs/./tsd.md gets its brief while a2 holds docs/tsd.md', async () => {
    expect((await openOn('docs/./tsd.md')).err).toContain('workspace docs/./tsd.md names docs/tsd.md; write it as docs/tsd.md')
  })

  test('a later task on a symlink to docs/tsd.md gets its brief while a2 holds docs/tsd.md', async () => {
    const { p, lead } = await started()
    symlinkSync(join(p.dir, 'docs/tsd.md'), join(p.dir, 'docs/design.md'))
    const first = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${first}`))
    p.write('design.yaml', DESIGN_TASK('docs/design.md'))
    // Correct: docs/design.md is docs/tsd.md, so task open names the real file.
    expect((await p.nanda('task open --file=design.yaml')).err)
      .toContain('workspace docs/design.md is docs/tsd.md on disk; name it docs/tsd.md, so that one file has one name')
  })

  test('a folder written docs/ (with a slash) does not wait for a maker of docs/tsd.md', async () => {
    const { p, lead } = await started()
    const first = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${first}`))
    p.write('docs.yaml', 'name: The docs\ntext: Tidy the docs.\ndirections: [tsd-writing]\nworkspace:\n  - { source: tsd, path: docs/ }\n')
    // Correct: docs/ is written docs; then its maker waits, as in test/file-queue.test.js.
    expect((await p.nanda('task open --file=docs.yaml')).err).toContain('workspace docs/ names docs; write it as docs')
  })
})

describe('F-Q2 one maker for each file: a task with no workspace', () => {
  test('the maker of a task with no workspace writes and reports docs/tsd.md while a2 holds it', async () => {
    const { p, lead } = await started()
    const first = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${first}`))
    p.write('design.yaml', 'name: The Design\ntext: Write the Design in docs/tsd.md.\ndirections: [tsd-writing]\ncontext: { section: design }\n')
    ok(await p.nanda('task open --file=design.yaml'))
    const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    // The fix (2026-11-08): a maker that writes a file needs the workspace of its task.
    expect((await p.agent(`assign ${lead2} t2 --role=writer`)).err)
      .toContain('t2 names no workspace, and writer writes <file>#<section>; the person opens the task with its workspace')
  })

  test('a maker whose output names no file reports a file of the project folder, with no workspace', async () => {
    // A note-taker: a maker whose output form names no file, so its assign is not refused.
    const NOTER = '  noter:\n    tier: low\n    description: Writes a note.\n    intro: You write one note.\n' +
      '    responsibilities:\n      - Write the note.\n    output: "<link>"\n    acts: [{ do: write one note }]\n'
    const yaml = WORK_YAML.replace('acts: [{ approve: [writer] }]', 'acts: [{ approve: [writer, noter] }]').replace('  linter:\n', `${NOTER}  linter:\n`)
    const { p, lead } = await started({ 'aristoteles.yaml': yaml })
    ok(await p.nanda('role fit noter --answers=fit.yaml'))
    p.write('note.yaml', 'name: A note\ntext: Write a note.\ndirections: [tsd-writing]\n')
    ok(await p.nanda('task open --file=note.yaml'))
    const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead2}`))
    const noter = tokenIn(ok(await p.agent(`assign ${lead2} t2 --role=noter`)).out)
    ok(await p.agent(`brief ${noter}`))
    p.write('docs/tsd.md', WITH_DESIGN)
    // Correct: docs/tsd.md is a file of the project folder, and t2 has no workspace for it.
    expect((await p.agent(`report ${noter} --output=docs/tsd.md#design`)).err).toContain('docs/tsd.md is not in the workspace of t2: none')
    expect(lead).toBeDefined()
  })
})
