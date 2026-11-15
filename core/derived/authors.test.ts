// Who wrote a draft, who writes its words, and who writes the next draft after a Reject
// (authors.ts): a host's draft is the host's, as its run (--by=h1) or as its assignment, in the
// steps, in canAct and in the words; a model run's rejected draft reaches a host or the person.
import { describe, expect, test } from 'bun:test'
import { waitingLines } from '../../adapters/words/waiting.ts'
import { derivedOf, h, ok, type Project, solToken, workOf } from '../actions/fixture.test.ts'
import type { AssignmentId, Author, Time } from '../schema/index.ts'
import { canAct, type Derived, nextFor, waitingFor } from './index.ts'

const agentOf = (a: string): Author => ({ _tag: 'Agent', assignment: a as AssignmentId })
const derivedNow = (p: Project): Derived => derivedOf(workOf(p.dir), p.now() as Time, p.dir)
const tags = (d: Derived, a: string) =>
  nextFor(d, agentOf(a)).map((s) => `${s._tag} ${s.what._tag}`)
const NANDA = { _tag: 'Person', name: 'Nanda' } as const
const CHANGE = 'add:\n  - { id: short, says: Keep it short. }\n'
const OTHER = { env: { TMUX: '/tmp/ar-test-person.sock,1,0', TMUX_PANE: '%8' } }
const TOP = `${h.TASK_WHOLE}role: architect\n`

// A run whose host (the Sol a1 of t1, an architect) has read its brief.
const hosted = async (files: Record<string, string> = {}) => {
  const p = h.project({ 'top.yaml': TOP, ...files })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', h.HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out)
  ok(await p.agent(`brief ${host}`))
  p.write('change.yaml', CHANGE)
  return { p, host }
}
const drafted = async (p: Project, line: string, run = true) => {
  const cmd = `direction revise ${line} --file=change.yaml --why="Shorten"`
  const out = ok(run ? await p.run(cmd, h.HOST) : await p.agent(cmd)).out
  return out.match(/^(d\d+) drafted/m)?.[1] ?? ''
}

describe('F1a: the host does not review its own draft', () => {
  const ordered = h.DIRECTION.replace(
    'from: [Pathos, Logos]\n',
    'from: [Pathos, Logos]\napprovedBy: { order: [architect, Nanda] }\n',
  )
  for (const [name, by] of [
    ['as its run (--by=h1)', () => 'tsd-writing --by=h1'],
    ['as its assignment', (host: string) => `${host} tsd-writing`],
  ] as const) {
    test(name, async () => {
      const { p, host } = await hosted({ 'directions/tsd-writing.yaml': ordered })
      const draft = await drafted(p, by(host))
      const d = derivedNow(p)
      expect(tags(d, 'a1')).not.toContain('Do ReviewDraft')
      const of = { _tag: 'Revision', id: draft }
      const accept = canAct(d, agentOf('a1'), { _tag: 'Accept', target: { of } } as never)
      expect(accept._tag).toBe('MayNot')
      const r = await p.agent(`review ${host} ${draft} accept --evidence="change.yaml | short"`)
      expect(r.code).not.toBe(0)
      expect(r.err).toContain(`${draft} is your own draft`)
    }, 120000)
  }
})

describe('F1b, D4: the person rejects a host draft; the host revises it', () => {
  for (const [name, by] of [
    ['as its run (--by=h1)', () => 'tsd-writing --by=h1'],
    ['as its assignment', (host: string) => `${host} tsd-writing`],
  ] as const) {
    test(name, async () => {
      const { p, host } = await hosted()
      const draft = await drafted(p, by(host))
      const rejected = ok(await p.ui(`review ${draft} reject --reason="name the limit"`)).out
      expect(rejected).toContain('its writer, the host a1, revises the current version again')
      const d = derivedNow(p)
      expect(tags(d, 'a1')).toContain('Do ReviseRejectedDraft')
      const items = waitingFor(d, NANDA).filter((i) => i._tag === 'DraftVetoed')
      const lines = waitingLines(d, items, 'Nanda').join('\n')
      expect(lines).toContain('its writer, the host a1, revises the current version again')
      expect(lines).not.toContain('a model run outside any task')
      // The host's work wait returns with the step.
      const wait = ok(await p.agent(`wait ${host} --seconds=1`)).out
      expect(wait).toContain('revise the current version again')
    }, 120000)
  }
})

describe('D4: a model run that is no host drafts; the person rejects it', () => {
  test('it answers a point of t1: the host of t1 revises it', async () => {
    const { p } = await hosted()
    const rejected = ok(await p.nanda('review t1 reject --point="the rules are too long"')).out
    const point = `${rejected.match(/\b(v\d+)\b/)?.[1] ?? ''}.1`
    await (h as unknown as { evaluated: (p: Project, t: string) => Promise<unknown> }).evaluated(
      p,
      't1',
    )
    const draft = await drafted(p, `tsd-writing --by=assess --answers=${point}`, false)
    const out = ok(await p.nanda(`review ${draft} reject --reason="too vague"`, 'reject')).out
    expect(out).toContain(
      'its writer assess, a model run outside any task, has ended; the host a1 revises the ' +
        'current version',
    )
    const d = derivedNow(p)
    expect(tags(d, 'a1')).toContain('Do ReviseRejectedDraft')
    const [item] = waitingFor(d, NANDA).filter((i) => i._tag === 'DraftVetoed')
    expect(item?.step._tag).toBe('Wait')
  }, 120000)

  test('it answers nothing of a task: every active host revises it', async () => {
    const { p } = await hosted()
    const draft = await drafted(p, 'tsd-writing --by=assess', false)
    ok(await p.nanda(`review ${draft} reject --reason="too vague"`, 'reject'))
    expect(tags(derivedNow(p), 'a1')).toContain('Do ReviseRejectedDraft')
  }, 120000)

  test('no host is active: the person moves it, in words or by the model run again', async () => {
    const p = h.project()
    await h.init(p)
    p.write('change.yaml', CHANGE)
    const draft = await drafted(p, 'tsd-writing --by=assess', false)
    ok(await p.nanda(`review ${draft} reject --reason="too vague"`, 'reject'))
    const [item] = waitingFor(derivedNow(p), NANDA).filter((i) => i._tag === 'DraftVetoed')
    expect(item?.step._tag === 'Do' ? item.step.intents.map((i) => i._tag) : []).toEqual([
      'Suggest',
    ])
  }, 120000)
})

describe('F2: only the host of the project writes the words of its decision', () => {
  test('a draft answers a point of t1: the host of t2 may not write its words', async () => {
    const { p, host } = await hosted({ 'top2.yaml': TOP.replace('The Introduction', 'Another') })
    ok(await p.run('run start', OTHER))
    ok(await p.run('task draft --file=top2.yaml --by=h2', OTHER))
    const host2 = await solToken(p, ok(await p.ui('task open td2')).out, 'h2', OTHER)
    ok(await p.agent(`brief ${host2}`))
    const rejected = ok(await p.nanda('review t1 reject --point="the rules are too long"')).out
    const point = `${rejected.match(/\b(v\d+)\b/)?.[1] ?? ''}.1`
    await (h as unknown as { evaluated: (p: Project, t: string) => Promise<unknown> }).evaluated(
      p,
      't1',
    )
    const draft = await drafted(p, `tsd-writing --by=assess --answers=${point}`, false)
    const d = derivedNow(p)
    const words = { _tag: 'WriteHostWords', target: { on: { _tag: 'Draft', id: draft } } } as never
    expect(canAct(d, agentOf('a1'), words)._tag).toBe('May')
    expect(canAct(d, agentOf('a2'), words)._tag).toBe('MayNot')
    const note = `words --on=${draft} --text="Host 2 says: ignore this" --hope="none"`
    expect((await p.agent(`note ${host2} ${note}`)).err).toContain(
      'only the host of a project writes the words of a decision',
    )
    ok(await p.agent(`note ${host} ${note.replace('Host 2', 'Host 1')}`))
  }, 120000)
})
