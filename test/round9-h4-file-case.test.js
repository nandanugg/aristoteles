// Round 9, attacker H: "a workspace path names a file in one way: its real name on disk, with no
// ./, //, end slash, link, or other case" (DESIGN section 11, round 8). task open checks the case
// only of a path that exists. On a disk that ignores case (the default on macOS), two tasks that
// name docs/export.md and docs/Export.md before the file exists name one file in two ways: the
// file queue and the section checks compare the words, so two makers hold the file at once, and a
// report changes the other task's reported section. The test expects the CORRECT behaviour, so it
// fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { init, ok, project, TASK, tokenIn } from
  './harness.js'

const ON = (path, name, section) => TASK.replace('The Introduction', name).replace('path: docs/tsd.md', `path: ${path}`)
  .replace('section: introduction', `section: ${section}`).replace('verify: "work-lint docs/tsd.md"', 'verify: "true"')

describe('H4 one file, two names that differ in case', () => {
  test('t1 on docs/export.md and t2 on docs/Export.md: both makers write the file at once, and r2 changes the section of r1', async () => {
    const p = project({ 'a.yaml': ON('docs/export.md', 'Intro', 'introduction'), 'b.yaml': ON('docs/Export.md', 'Design', 'design') })
    // The disk of this test ignores case: the harness file docs/tsd.md is also DOCS/TSD.MD.
    expect(existsSync(join(p.dir, 'DOCS/TSD.MD'))).toBe(true)
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=a.yaml'))
    const open = await p.nanda('task open --file=b.yaml')
    // One correct fix: one file has one name, so the second name is refused at the open.
    if (open.code !== 0) {
      expect(open.err).toContain('docs/export.md')
      return
    }
    const lead1 = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    const lead2 = tokenIn(ok(await p.nanda('assign t2 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead1}`))
    ok(await p.agent(`brief ${lead2}`))
    const first = tokenIn(ok(await p.agent(`assign ${lead1} t1 --role=writer`)).out)
    const second = tokenIn(ok(await p.agent(`assign ${lead2} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${first}`))
    // Another correct fix: the queue knows that it is one file, so the second maker waits.
    const brief = await p.agent(`brief ${second}`)
    expect(brief.code).toBe(1)
    expect(brief.err).toContain('waits for')
    // What happens instead: both write, and the second report undoes the introduction of r1.
    p.write('docs/export.md', '# Export\n\n## Introduction\n\nThe export ran twice.\n\n## Design\n\nTODO\n')
    ok(await p.agent(`report ${first} --output=docs/export.md#introduction`))
    p.write('docs/Export.md', '# Export\n\n## Introduction\n\nTODO\n\n## Design\n\nOne file a day.\n')
    expect((await p.agent(`report ${second} --output=docs/Export.md#design`)).code).toBe(1)
  }, 20000)
})
