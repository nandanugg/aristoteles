// The person's acts of the work model on the page (POST /api/act with a What), and the forwards
// of the host: a stale basis, an old build, a resend, an answer, confirm and drop.
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { eventsOf, h } from '../../core/actions/fixture.test.ts'
import { foldWork } from '../../core/state/work/fold.ts'
import { startServer } from './server.ts'

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
const tokens = (out: string): Record<string, string> =>
  Object.fromEntries([...out.matchAll(/^ {2}(\S+): (w\.\S+)$/gm)].map((m) => [m[1], m[2]]))

const servers: Array<{ readonly stop: () => void }> = []
afterEach(() => {
  while (servers.length > 0) servers.pop()?.stop()
})

// A top with the task t1 in review (its maker m1 reported once, rid 0); the person is Nanda.
const reviewed = async () => {
  const { p } = await h.initiated({ 'aristoteles.yaml': PIPED })
  h.git(p.dir, 'init', '-q')
  h.git(p.dir, 'config', 'user.name', 'Nanda')
  const t = tokens(h.ok(await p.nanda('top open --name=TSD --goal=g --sections=introduction')).out)
  const state = () => foldWork(eventsOf(p.dir))
  const seq = () => state()?.state.seq ?? -1
  const send = `send ${t.host} --name=Intro --goal=g --sections=introduction --role=section-lead`
  h.ok(await p.agent(send))
  const assigned = h.ok(await p.agent(`assign ${t['role:section-lead']} t1`)).out
  const maker = assigned.match(/(w\.maker:\S+)/)?.[1]
  h.ok(await p.agent(`brief ${maker}`))
  const before = seq()
  p.write('docs/tsd.md', 'The export ran twice.\n')
  h.ok(await p.agent(`report ${maker} --output=intro --files=docs/tsd.md --on ${before}`))
  const s = startServer({
    dir: p.dir,
    env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') },
    clock: () => p.now(),
    readBuild: () => 'b1',
  })
  servers.push(s)
  const post = async (body: unknown) => {
    const headers = { origin: `http://127.0.0.1:${s.port}`, 'content-type': 'application/json' }
    const res = await fetch(`http://127.0.0.1:${s.port}/api/act`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    return res.json() as Promise<Record<string, unknown>>
  }
  return { p, t, maker, before, seq, state, post }
}

const reject = { _tag: 'Reject', task: 't1', points: ['say it once'] }
const acted = (dir: string) =>
  eventsOf(dir).filter((r) => r.event._tag === 'Work' && r.event.create._tag === 'Acted')

describe('the acts of the person on the page', () => {
  test('a stale basis is refused as basis, an old build as build', async () => {
    const { p, before, seq, post } = await reviewed()
    const stale = await post({ act: reject, on: before, build: 'b1' })
    expect(stale).toMatchObject({ refused: 'basis' })
    expect(String(stale.words)).toContain('built on a state that moved')
    const old = await post({ act: reject, on: seq(), build: 'b0' })
    expect(old).toMatchObject({ refused: 'build' })
    expect(acted(p.dir).some((r) => JSON.stringify(r.event).includes('say it once'))).toBe(false)
  }, 120000)

  test('the same post twice is one act', async () => {
    const { p, seq, post } = await reviewed()
    const on = seq()
    const first = await post({ act: reject, on, build: 'b1' })
    expect(first).toMatchObject({ ok: true })
    const count = acted(p.dir).length
    expect(await post({ act: reject, on, build: 'b1' })).toEqual(first)
    expect(acted(p.dir).length).toBe(count)
  }, 120000)

  test('the person answers an open question; a terminal act is not the page', async () => {
    const { p, maker, state, post } = await reviewed()
    h.ok(await p.agent(`ask ${maker} --text="which file?"`))
    expect(state()?.state.asks.has('maker:m1')).toBe(true)
    const answer = { _tag: 'Answer', asker: 'maker:m1', answer: 'docs/tsd.md' }
    expect(await post({ act: answer, on: null, build: 'b1' })).toMatchObject({ ok: true })
    expect(state()?.state.asks.has('maker:m1')).toBe(false)
    const revive = await post({ act: { _tag: 'Revive', who: 'host' }, on: null, build: 'b1' })
    expect(revive).toMatchObject({ refused: 'terminal' })
  }, 120000)
})

describe('the forwards of the host', () => {
  test('forward -> pending -> confirm: the act is the person, a stale one is refused', async () => {
    const { p, t, before, seq, state, post } = await reviewed()
    const words = (on: number) =>
      `forward ${t.host} reject t1 --points="say it once" --quote="redo it" --on ${on}`
    h.ok(await p.agent(words(before)))
    const [stale] = state()?.forwards ?? []
    expect(stale?.id).toMatch(/^f\d+$/)
    expect(stale).toMatchObject({ quote: 'redo it', on: before })
    expect(await post({ confirm: stale?.id, build: 'b1' })).toMatchObject({ refused: 'basis' })
    expect(state()?.forwards.length).toBe(1)
    expect(await post({ drop: stale?.id })).toMatchObject({ ok: true })
    h.ok(await p.agent(words(seq())))
    const [fresh] = state()?.forwards ?? []
    expect(await post({ confirm: fresh?.id, build: 'b1' })).toMatchObject({ ok: true })
    expect(state()?.forwards).toEqual([])
    const last = acted(p.dir).at(-1)
    expect(last?.author).toMatchObject({ _tag: 'Person', name: 'Nanda' })
    expect(last?.event).toMatchObject({ create: { act: { who: 'person' } } })
    expect(await post({ confirm: fresh?.id, build: 'b1' })).toMatchObject({ refused: 'refused' })
  }, 120000)

  test('an act that is not the person is refused; a drop spends the forward', async () => {
    const { p, t, state, post } = await reviewed()
    const lead = t['role:section-lead']
    const send = await p.agent(`forward ${t.host} send --name=x --quote=q`)
    expect(send.code).not.toBe(0)
    expect(send.err).toContain('work forward <token>')
    expect((await p.agent(`forward ${lead} end --quote=q`)).err).toContain('only the host forwards')
    expect((await p.agent(`forward ${t.host} end`)).err).toContain('--quote')
    h.ok(await p.agent(`forward ${t.host} end --quote="that is all"`))
    const [pending] = state()?.forwards ?? []
    expect(pending?.what).toEqual({ _tag: 'EndProject' })
    expect(await post({ drop: pending?.id })).toMatchObject({ ok: true })
    expect(state()?.forwards).toEqual([])
    expect(await post({ drop: pending?.id })).toMatchObject({ refused: 'refused' })
  }, 120000)
})
