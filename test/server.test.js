// The server of the UI, read only (plan/ui/BUILD.md part 2): every request needs the key of
// `work start`; the API reads the store with the replay and the reads of the engine; a websocket
// tells the page when the store changes.
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { startServer } from './code.js'
import { HOST, INTRO_V1, ok, project, tokenIn, withWriter } from './harness.js'

const servers = []
afterEach(() => {
  while (servers.length) servers.pop().stop()
})
const serve = (p) => {
  const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') }, clock: () => '2026-10-25T12:00:00.000Z' })
  servers.push(s)
  const cookie = `aristoteles-${s.port}=${s.key}`
  const get = async (path) => {
    const res = await fetch(`http://127.0.0.1:${s.port}${path}`, { headers: { cookie } })
    return res.headers.get('content-type')?.includes('json') ? res.json() : res.text()
  }
  return { s, cookie, get }
}
// The writer reported r1, and the linter rejected it on the rule no-ticket-ids.
const rejected = async () => {
  const { p, lead, writer } = await withWriter()
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V1)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
  return { p, lead, writer, linter }
}

describe('the server, read only', () => {
  test('every request needs the key; the address of work start sets it as a cookie', async () => {
    const { p } = await rejected()
    const { s } = serve(p)
    const base = `http://127.0.0.1:${s.port}`
    expect((await fetch(`${base}/api/dir`)).status).toBe(403)
    expect((await fetch(`${base}/?key=wrong`, { redirect: 'manual' })).status).toBe(403)
    const first = await fetch(s.url, { redirect: 'manual' })
    expect(first.status).toBe(302)
    expect(first.headers.get('set-cookie')).toBe(`aristoteles-${s.port}=${s.key}; HttpOnly; SameSite=Strict; Path=/`)
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ dir: p.dir })
    expect(s.url).toStartWith('http://127.0.0.1:')
  })

  test('the dir lists its projects; a top task opened at a terminal is a project too', async () => {
    const { p } = await rejected()
    ok(await p.run('run start', HOST))
    const { get } = serve(p)
    const dir = await get('/api/dir')
    expect(dir).toMatchObject({ name: 'report-export', path: p.dir, theme: 'light', sound: false, initialized: true })
    expect(dir.projects.map((x) => [x.id, x.kind, x.title, x.state])).toEqual([
      ['h1', 'host', 'a new project', 'talks'], ['t1', 'task', 'The Introduction', 'works']])
  })

  test('the canvas: the task card says what it does now; the work and its reviews are cards of their own', async () => {
    const { p } = await rejected()
    const { get } = serve(p)
    const view = await get('/api/project/t1')
    expect(view.rows).toHaveLength(1)
    const [row] = view.rows
    expect(row.task).toMatchObject({ id: 't1', name: 'The Introduction', words: 'works', attempt: { now: 2, max: 3 },
      owner: { a: 'a1', role: 'section-lead', tier: 'terra', session: null, inside: null } })
    // Only the latest attempt (Nanda, 2026-11-11): r1 was rejected and the writer has tries
    // left, so its work card is attempt 2, in work, with no review yet.
    expect(row.work).toEqual([{
      a: 'a2', role: 'writer', tier: 'luna', attempt: { now: 2, max: 3 }, session: null, inside: 'a1',
      result: null, output: null, state: 'works', files: 0, reviews: [],
    }])
  })

  test('the panel: the words, the reviews with their evidence, the time line, the directions, and the files', async () => {
    const { p } = await rejected()
    const { get } = serve(p)
    const panel = await get('/api/task/t1')
    expect(panel).toMatchObject({ id: 't1', name: 'The Introduction', text: 'Write the Introduction from the agreed facts.', top: true })
    expect(panel.results[0]).toMatchObject({ id: 'r1', by: 'a2', output: 'docs/tsd.md#introduction' })
    expect(panel.results[0].reviews[0]).toMatchObject({ id: 'v2.1', by: 'a3', decision: 'Reject', breaks: 'no-ticket-ids' })
    expect(panel.timeline.map((x) => x.line.replace(/^e\d+ \S+ /, ''))).toEqual([
      'Nanda (terminal) task.open -> t1',
      'Nanda (terminal) assign section-lead on t1 -> a1',
      'a1 (agent) brief',
      'a1 (agent) assign writer on t1 -> a2',
      'a2 (agent) brief',
      'a2 (agent) report docs/tsd.md#introduction -> r1',
      'a1 (agent) assign linter on t1 -> a3',
      'a3 (agent) brief',
      'a3 (agent) review r1 reject: "the first line cites ABC-2964" breaks no-ticket-ids -> v2',
    ])
    expect(panel.directions.map((d) => [d.id, d.version, d.standards.map((s) => s.id)])).toEqual([['tsd-writing', 'tsd-writing@1', ['facts-not-proof', 'intro-story']]])
    expect(panel.files).toEqual([{ file: 'docs/tsd.md', added: 1, removed: 1 }])
    const { diff } = await get('/api/diff/t1?file=docs/tsd.md')
    expect(diff).toContain('--- a/docs/tsd.md')
    expect(diff).toContain('-TODO')
    expect(diff).toContain('+ABC-2964: the export ran twice for one merchant.')
  })

  test('a websocket tells the page about a new act; it needs the key and the origin of the page', async () => {
    const { p, lead } = await rejected()
    const { s, cookie } = serve(p)
    const refused = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { cookie } })
    const why = await new Promise((done) => {
      refused.onerror = () => done('error')
      refused.onopen = () => done('open')
    })
    expect(why).toBe('error')
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { cookie, origin: `http://127.0.0.1:${s.port}` } })
    await new Promise((done) => { ws.onopen = done })
    const message = new Promise((done) => { ws.onmessage = (m) => done(JSON.parse(m.data)) })
    ok(await p.agent(`next ${lead}`))
    ok(await p.ui('suggest --says="one rule for each check"'))
    expect(await message).toEqual({ type: 'changed' })
    ws.close()
  })

  test('a terminal of an agent never gets smaller than 40 x 10 from the page', async () => {
    const p = project()
    const sizes = []
    const pump = {
      onOutputs: [], onSizes: [], status: () => ({}), snapshot: () => new Uint8Array(), input: () => {},
      resize: (sid, cols, rows) => sizes.push([sid, cols, rows]),
    }
    const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') }, pump })
    servers.push(s)
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { cookie: `aristoteles-${s.port}=${s.key}`, origin: `http://127.0.0.1:${s.port}` } })
    await new Promise((done) => { ws.onopen = done })
    ws.send(JSON.stringify({ type: 'term.resize', session: 's-1', cols: 74, rows: 5 }))
    ws.send(JSON.stringify({ type: 'term.resize', session: 's-1', cols: 120, rows: 40 }))
    const end = Date.now() + 5000
    while (sizes.length < 2 && Date.now() < end) await Bun.sleep(20)
    expect(sizes).toEqual([['s-1', 74, 10], ['s-1', 120, 40]])
    ws.close()
  })

  test('a dir with no store yet says so', async () => {
    const p = project()
    const { get } = serve(p)
    expect(await get('/api/dir')).toMatchObject({ name: 'report-export', initialized: false, projects: [] })
  })
})
