import { describe, expect, test } from 'bun:test'
import { HOST, TASK_WHOLE, init, ok, project, reported, solToken, tokenIn } from './harness.js'
import { canvas } from './outside.js'

// The canvas shows only what runs now (Nanda, 2026-11-11): an accepted task goes away with its
// work, review and decide cards; a card shows only while it runs. The panel keeps the history.

// The cards of the canvas (the server's /api/project). Each row: the task, and each work card
// with its review cards.
const cards = async (p, id = 't1') => (await canvas(p, id)).rows.map((r) =>
  [r.task.id, r.work.map((w) => [w.a, w.now.state, (w.now.reviews ?? []).map((v) => [v.by, v.decision])])])

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

  test('a card offers Resume only for live work: a finished lead has nothing to resume', async () => {
    const { p, lead } = await reported()
    const owner = async () => (await canvas(p, 't1')).rows[0].task.owner
    expect(await owner()).toMatchObject({ a: 'a1', resumable: true })
    ok(await p.agent(`finish ${lead} a2`))
    ok(await p.agent(`finish ${lead} a3`))
    ok(await p.agent(`finish ${lead}`))
    expect(await owner()).toMatchObject({ a: 'a1', resumable: false })
  })

})
