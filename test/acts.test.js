// The CLI acts of the UI (plan/ui/BUILD.md part 4, Nanda 2026-11-11). A project starts with a talk:
// the host (a Sol in a run) drafts the top task, and the person opens it. Only four kinds of
// decision reach the person: a system problem, a direction problem, the end of a project, and a
// relayed act that waits for a confirm; the host handles the rest, and writes its words about
// each decision before the person sees it.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOST, INTRO_V2, TASK_WHOLE, agentToken, init, ok, project, solToken, started, tokenIn } from './harness.js'
import { act, canvas, gitPerson, panel, tables } from './outside.js'

// The decisions that the person sees on the panel of a task (the server's /api/task), at the time
// of the last act. At LATE, hostWaitMinutes (10 by default) passed since every act of these
// tests, so every decision shows: also one that still waits for the host's words.
const LATE = '2026-10-25T11:00:00.000Z'
const decisions = async (p, at) => (await panel(p, 't1', at)).decisions
const summary = (list) => list.map((i) => [i.kind, i.id, i.task])

// A dir with a host run h1 whose top task t1 is open, with the architect a1 as its host.
const hosted = async () => {
  const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
  gitPerson(p)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const opened = ok(await p.ui('task open td1')).out
  const host = await solToken(p, opened) // ruling 10.1
  ok(await p.agent(`brief ${host}`))
  return { p, host, opened }
}

describe('the acts of the UI', () => {

  // Owner, 2026-11-15: the host asks the person only with --to=owner (the page shows it).

})

// The sixth decision (rulings 13 and 14, onboarding 2026-11-14): a model drafts an adjustment of a
// role or a direction, and the person accepts it on the page, or rejects it with a reason.
describe('an adjustment on the page', () => {
  const drafted = (out) => out.match(/^(e\d+): an adjustment: /)[1]

  test('the person accepts an adjustment, or rejects it with a reason', async () => {
    const { p } = await started()
    gitPerson(p)
    const model = drafted(ok(await p.agent('adjust model writer --model=sonnet --by=host')).out)
    const [item] = await decisions(p)
    expect(item).toMatchObject({ kind: 'adjustment', id: model, task: null })
    expect(item.text).toBe(
      'An adjustment, drafted by host, a model run outside any task, waits for your decision: writer runs on sonnet.',
    )
    expect(item.adjustment).toEqual({ _tag: 'SetModel', role: 'writer', model: 'sonnet' })
    expect(await act(p, 'accept-adjustment', { draft: model })).toEqual({ out: `${model} accepted.` })
    expect(Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')).roles.writer.model).toBe('sonnet')
    expect(await decisions(p)).toEqual([])
    const back = drafted(ok(await p.agent('adjust model writer --model=haiku --by=host')).out)
    expect((await act(p, 'reject-adjustment', { draft: back, reason: '' })).error).toBeDefined()
    expect(await act(p, 'reject-adjustment', { draft: back, reason: 'keep the writer on sonnet' })).toEqual({ out: `${back} rejected.` })
    expect(await decisions(p)).toEqual([])
    expect(ok(await p.nanda(`adjust show ${back}`)).out).toContain('rejected (')
  })
})

