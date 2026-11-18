// Every item that waits for the person has a mover and a place on the page (P1, 2026-11-15): the
// page shows it with the acts that move it, each one an intent that passed canAct; what no open
// task shows is in the inbox of the dir. The CLI reads the same items.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DIRECTION,
  HOST,
  INTRO_V1,
  TASK_WHOLE,
  WORK_YAML,
  agentToken,
  git,
  init,
  ok,
  project,
  solToken,
  started,
  tokenIn,
} from './harness.js'
import { act, api, gitPerson, panel } from './outside.js'

const ROLES = ['architect', 'section-lead', 'writer', 'linter']
const inbox = async (p) => (await api(p, '/api/dir')).inbox
const card = async (p, task, kind) => (await panel(p, task)).decisions.find((d) => d.kind === kind)
const fitAll = async (p) => {
  for (const role of ROLES) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
}
// A dir with a host run h1 whose top task t1 is open; the architect a1 is its host.
const hosted = async (files = {}) => {
  const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n`, ...files })
  gitPerson(p)
  await init(p)
  await fitAll(p)
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out)
  ok(await p.agent(`brief ${host}`))
  return { p, host }
}

describe('BriefOver: a brief over its limit with no high role above it', () => {
  test('shows on its task: suggest shorter words, or remake at a terminal (t1 has a section: one unit, B1)', async () => {
    const small = WORK_YAML.replace('briefChars: 6000', 'briefChars: 900')
    const p = project({ 'aristoteles.yaml': small })
    gitPerson(p)
    await init(p)
    for (const role of ['section-lead', 'writer']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda('task open --file=task.yaml'))
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead}`))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    const over = await card(p, 't1', 'step')
    expect(over).toMatchObject({ title: 'A brief over its limit' })
    expect(over.acts).toEqual([
      { _tag: 'Suggest', about: { _tag: 'Direction', direction: 'tsd-writing' }, name: 'TSD writing' },
      { _tag: 'AtTerminal', line: 'work task remake t1 --file=<task.yaml> --reason="<why>"' },
    ])
    const said = await act(p, 'suggest', {
      about: { _tag: 'Direction', direction: 'tsd-writing' },
      says: 'Keep the directions short',
    })
    expect(said.out).toContain('s1: a suggestion')
    // No high role works on t1: the suggestion shows with the assign of one.
    const y = (await panel(p, 't1')).decisions.find((d) => d.id === 's1')
    expect(y.acts).toEqual([{ _tag: 'Give', task: 't1', role: 'architect' }])
  })

})

describe('D3: a suggestion reaches an actor', () => {

  test('the roles, with no run: an open high agent drafts the adjustment', async () => {
    const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
    gitPerson(p)
    await init(p)
    await fitAll(p)
    ok(await p.nanda('task open --file=top.yaml'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    const s = ok(await p.ui('suggest roles --says="The linter checks headings too"')).out
    expect(s).toContain('next: a1 (architect) drafts it')
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('s1 suggests about the roles')
  })

  test('with no agent: the inbox shows it with the assign of a high role on an open task', async () => {
    const p = project()
    gitPerson(p)
    await init(p)
    await fitAll(p)
    ok(await p.nanda('task open --file=task.yaml'))
    const s = ok(await p.ui('suggest --says="Write a direction for the API docs"')).out
    expect(s).toContain('next: no agent can draft it now; give a role that directs work, and it drafts it: work assign t1 --role=architect')
    expect((await inbox(p)).find((d) => d.id === 's1').acts).toEqual([{ _tag: 'Give', task: 't1', role: 'architect' }])
  })
})

describe('F3: a decision with no task, and one of a task that ended', () => {
  const modelDraft = async (p) => {
    p.write('change.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    ok(await p.agent('direction revise tsd-writing --file=change.yaml --by=assess --why="Shorten"'))
  }
  test('no project yet: the draft is in the inbox of the dir', async () => {
    const p = project()
    gitPerson(p)
    await init(p)
    await modelDraft(p)
    expect((await inbox(p)).map((d) => [d.kind, d.id, d.task])).toEqual([['direction', 'd2', null]])
  })

  test('the only project is closed: the draft is in the inbox, and the project has no badge', async () => {
    const p = project()
    gitPerson(p)
    await init(p)
    ok(await p.nanda('task open --file=task.yaml'))
    ok(await p.nanda('task close t1 --reason="Not needed"'))
    await modelDraft(p)
    const dir = await api(p, '/api/dir')
    expect(dir.inbox.map((d) => d.id)).toEqual(['d2'])
    expect(dir.projects.map((x) => [x.id, x.badge])).toEqual([['t1', false]])
  })
})
