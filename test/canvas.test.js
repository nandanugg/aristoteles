import { describe, expect, test } from 'bun:test'
import { HOST, TASK_WHOLE, init, ok, project, reported, tokenIn } from './harness.js'
import { canvas } from './outside.js'

// The canvas shows only what runs now (Nanda, 2026-11-11): an accepted task goes away with its
// work, review and decide cards; a card shows only while it runs. The panel keeps the history.

// The cards of the canvas (the server's /api/project). Each row: the task, and each work card
// with its review cards.
const cards = async (p, id = 't1') => (await canvas(p, id)).rows.map((r) =>
  [r.task.id, r.work.map((w) => [w.a, w.state, w.reviews.map((v) => [v.by, v.decision])])])

const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`

describe('the canvas shows only what runs now', () => {
  test('a checker shows while it reviews; its done accept goes; the accepted task goes with its cards', async () => {
    const { p, lead, linter } = await reported()
    expect(await cards(p)).toEqual([['t1', [['a2', 'in review', [['a3 linter', 'reviews'], ['architect or section-lead', 'waits']]]]]])
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the introduction')}`))
    expect(await cards(p)).toEqual([['t1', [['a2', 'in review', [['architect or section-lead', 'waits']]]]]])
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    expect(await cards(p)).toEqual([])
    expect((await canvas(p, 't1')).state).toBe('done')
  })

  test('an accepted part goes; its parent and the part that still runs stay', async () => {
    const tsd = (design) => `# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\n${design}\n\n## Failure\n\nTODO\n`
    const p = project({
      'task.yaml': 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n',
      'docs/tsd.md': tsd('TODO'),
      'parts.yaml': '- { name: Design, text: Write the design., context: { section: design } }\n' +
        '- { name: Failure, text: Write the failure cases., context: { section: failure } }\n',
    })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    ok(await p.nanda('grant --act=change --on=t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    expect((await cards(p)).map(([t]) => t)).toEqual(['t1', 't2', 't3'])
    // The Design part is written, checked and accepted.
    const writer = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', tsd('One file a day for each merchant.'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#design`))
    const linter = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the design')}`))
    ok(await p.agent(`review ${arch} r1 accept --evidence="docs/tsd.md, the design | the section says what the part asks"`))
    expect((await cards(p)).map(([t]) => t)).toEqual(['t1', 't3'])
  })

  test('a card offers Resume only for live work: a finished lead has nothing to resume', async () => {
    const { p, lead } = await reported()
    const owner = async () => (await canvas(p, 't1')).rows[0].task.owner
    expect(await owner()).toMatchObject({ a: 'a1', resumable: true })
    ok(await p.agent(`finish ${lead} a2`))
    ok(await p.agent(`finish ${lead} a3`))
    ok(await p.agent(`finish ${lead}`))
    expect(await owner()).toMatchObject({ a: 'a1', resumable: false })
  })

  test('when every lead finished, the host of the open run owns the task: it acts on the end', async () => {
    const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.run('run start', HOST))
    ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
    const host = tokenIn(ok(await p.ui('task open td1')).out)
    ok(await p.agent(`brief ${host}`))
    ok(await p.agent(`assign ${host} t1 --role=section-lead`))
    const owner = async () => (await canvas(p, 'h1')).rows[0].task.owner
    expect(await owner()).toMatchObject({ a: 'a2', tier: 'terra', resumable: true })
    ok(await p.agent(`finish ${host} a2`))
    // The host's own pane is the person's: the page has no Resume for it.
    expect(await owner()).toMatchObject({ a: 'a1', tier: 'sol', session: expect.stringMatching(/^host-/), resumable: false })
    // The host's own assignment ends too; its run is still open, so its terminal stays live work.
    ok(await p.agent(`finish ${host}`))
    expect(await owner()).toMatchObject({ a: 'a1', session: expect.stringMatching(/^host-/), resumable: false })
  })
})
