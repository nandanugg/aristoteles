import { describe, expect, test } from 'bun:test'
import { init, ok, project, tokenIn } from './harness.js'
import { diffOf } from './outside.js'

// The Diff of a parent (Nanda, 2026-11-11): every file that its tree touched, from the first
// text to the latest text, in time. The live demo's parent got a writer of its own after its
// parts were accepted; its Diff was empty, because it ran in tree order.

const tsd = (intro, design) => `# TSD\n\n## Introduction\n\n${intro}\n\n## Design\n\n${design}\n`
const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`

describe('the Diff of a parent', () => {
  test('a writer of the parent that starts after its part: the Diff runs from the first text', async () => {
    const p = project({
      'task.yaml': 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n',
      'docs/tsd.md': tsd('TODO', 'TODO'),
      'parts.yaml': '- { name: Design, text: Write the design., context: { section: design } }\n',
    })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    ok(await p.nanda('grant --act=change --on=t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    // The part writes the design, and it is accepted.
    const designer = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${designer}`))
    p.write('docs/tsd.md', tsd('TODO', 'One file a day for each merchant.'))
    ok(await p.agent(`report ${designer} --output=docs/tsd.md#design`))
    const linter = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the design')}`))
    ok(await p.agent(`review ${arch} r1 accept --evidence="docs/tsd.md, the design | the section says what the part asks"`))
    ok(await p.agent(`finish ${arch} ${designer.split('.')[0]}`))
    // Then the parent's own writer starts, from the text with the design, and writes the rest.
    const writer = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', tsd('The export ran twice for one merchant.', 'One file a day for each merchant.'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md`))
    // The Diff of the panel of t1 (the server's /api/diff).
    const diff = await diffOf(p, 't1', 'docs/tsd.md')
    expect(diff).toContain('+One file a day for each merchant.')
    expect(diff).toContain('+The export ran twice for one merchant.')
    expect(diff.split('\n').filter((l) => l === '-TODO')).toHaveLength(2)
  })
})
