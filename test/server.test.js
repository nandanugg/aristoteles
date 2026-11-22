import { aLiveHost, finishActivation, killBootstrap } from './activation-fixture.js'
import { staffedFixture } from './staffing-fixture.js'
// The server of the UI, read only (plan/ui/BUILD.md part 2): every request needs the key of
// `work start`; the API reads the store with the replay and the reads of the engine; a websocket
// tells the page when the store changes.
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { startServer } from './code.js'
import {
  initiated,
  ok,
  ONBOARD_CONFIG,
  ONBOARD_DIRECTION,
  ONBOARD_NEW,
  ONBOARD_QUESTIONS,
  onboardingProject,
  project,
  withModels,
  WORK_YAML,
} from './harness.js'
import { gitPerson } from './outside.js'

const servers = []
afterEach(() => {
  while (servers.length) servers.pop().stop()
})
const serve = (p) => {
  const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') }, clock: () => '2026-10-25T12:00:00.000Z' })
  servers.push(s)
  const get = async (path) => {
    const res = await fetch(`http://127.0.0.1:${s.port}${path}`)
    return res.headers.get('content-type')?.includes('json') ? res.json() : res.text()
  }
  // An act of the onboarding pages: it needs the page's own origin.
  const onboard = async (body) => {
    const headers = { origin: `http://127.0.0.1:${s.port}`, 'content-type': 'application/json' }
    const res = await fetch(`http://127.0.0.1:${s.port}/api/onboarding`, { method: 'POST', headers, body: JSON.stringify(body) })
    return res.json()
  }
  const act = async (body) => {
    const headers = { origin: `http://127.0.0.1:${s.port}`, 'content-type': 'application/json' }
    const res = await fetch(`http://127.0.0.1:${s.port}/api/act`, { method: 'POST', headers, body: JSON.stringify(body) })
    return res.json()
  }
  return { s, get, onboard, act }
}
describe('the server, read only', () => {
  // Nanda, 2026-11-15: the address has no key, and the page needs no cookie (was: a key, and a
  // cookie for each request). A request that names another host in its Host header is refused,
  // so a page of a name that points to 127.0.0.1 (DNS rebinding) reads nothing.
  test('the address has no key; the page answers only a request that names this server', async () => {
    const { p } = await initiated()
    const { s } = serve(p)
    const base = `http://127.0.0.1:${s.port}`
    expect(s.url).toBe(`${base}/`)
    expect((await fetch(`${base}/api/dir`)).status).toBe(200)
    expect((await fetch(`${base}/api/dir`, { headers: { host: `localhost:${s.port}` } })).status).toBe(200)
    for (const host of [`rebind.example:${s.port}`, '127.0.0.1', `127.0.0.1:${s.port + 1}`]) {
      for (const path of ['/', '/app.js', '/api/dir', '/health', '/ws']) {
        expect([host, path, (await fetch(`${base}${path}`, { headers: { host } })).status]).toEqual([host, path, 403])
      }
    }
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ dir: p.dir })
  })

  // Nanda, 2026-11-15: the server listens on every interface (a personal project), so another
  // machine opens the page at a network address of this one; an act from that page is its own.
  test('the page answers at a network address of the machine, and takes its acts', async () => {
    const { p } = await initiated()
    const { s } = serve(p)
    const address = Object.values(networkInterfaces()).flat().find((a) => a?.family === 'IPv4' && !a.internal)?.address
    if (address === undefined) return // a machine with no network: nothing to reach
    const other = `http://${address}:${s.port}`
    expect((await fetch(`${other}/api/dir`)).status).toBe(200)
    const act = (origin) =>
      fetch(`${other}/api/act`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ act: 'none' }) })
    expect((await act(other)).status).toBe(400)
    expect((await act(`http://rebind.example:${s.port}`)).status).toBe(403)
  })

  // Nanda, 2026-11-15: the page has real paths; the server serves the page for each place, so a
  // reload of /t1/t1/diff opens the same place, and nothing else becomes the page.
  test('a place of the page is a path; the server serves the page for it, and only for it', async () => {
    const p = project()
    const { s } = serve(p)
    const base = `http://127.0.0.1:${s.port}`
    const index = await (await fetch(`${base}/`)).text()
    expect(index).toContain('<script type="module" src="/app.js">')
    for (const path of ['/h1', '/h1/', '/h1/t1', '/h1/t1/terminal', '/t1/t1/diff']) {
      const res = await fetch(`${base}${path}`)
      expect([path, res.status, res.headers.get('content-type'), await res.text()]).toEqual([path, 200, 'text/html; charset=utf-8', index])
    }
    for (const path of ['/favicon.ico', '/h1/t1/diff/more', '/vendor/none.js', '/api/none', '/api', '/ws/none']) {
      expect([path, (await fetch(`${base}${path}`)).status]).toEqual([path, 404])
    }
    expect((await fetch(`${base}/h1`, { method: 'POST' })).status).toBe(404)
  })

  // Nanda, 2026-11-15: it needs the origin of the page (was: and the key).
  test('a websocket tells the page about a new act; it needs the origin of the page', async () => {
    const { p } = await initiated()
    const { s } = serve(p)
    const refused = new WebSocket(`ws://127.0.0.1:${s.port}/ws`)
    const why = await new Promise((done) => {
      refused.onerror = () => done('error')
      refused.onopen = () => done('open')
    })
    expect(why).toBe('error')
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { origin: `http://127.0.0.1:${s.port}` } })
    await new Promise((done) => { ws.onopen = done })
    // P8: the first message of a socket is the server's build; then the changes.
    const message = new Promise((done) => { ws.onmessage = (m) => JSON.parse(m.data).type !== 'hello' && done(JSON.parse(m.data)) })
    p.write('aristoteles.yaml', WORK_YAML.replace('Writes one TSD section from its brief.', 'Writes one TSD section from its brief, in plain words.'))
    ok(await p.ui('config apply', 'apply'))
    expect(await message).toEqual({ type: 'changed' })
    ws.close()
  })

  test('a terminal of an agent never gets smaller than 40 x 10 from the page', async () => {
    const p = project()
    const sizes = []
    const pump = {
      onOutputs: [], onSizes: [], onAttach: [], status: () => ({}),
      snapshot: () => new Uint8Array(), input: () => {},
      resize: (sid, cols, rows) => sizes.push([sid, cols, rows]),
    }
    const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') }, pump })
    servers.push(s)
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { origin: `http://127.0.0.1:${s.port}` } })
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
    expect(await get('/api/dir')).toMatchObject({
      name: 'report-export',
      initialized: false,
      picks: [{ dir: 'report-export', project: null, path: '/' }],
    })
  })
})

// The onboarding pages (BUILD.md 1g; rulings 1 to 6, 11, 15, onboarding 2026-11-14): before any
// store, the page reads the onboarding files and writes the person's acts into them through the
// module of the files; approve all roles starts the store with the accepted result only.
const ROLES = ['architect', 'section-lead', 'writer', 'linter']
const has = (p, path) => existsSync(join(p.dir, path))
// The host's config draft and its draft of the direction that it found; the page acts as Nanda.
async function onboarding() {
  const p = onboardingProject()
  gitPerson(p)
  p.write('draft.yaml', ONBOARD_CONFIG)
  ok(await p.agent('onboard config --file=draft.yaml'))
  ok(await p.agent('onboard found tsd-writing'))
  p.write('tsd.yaml', ONBOARD_DIRECTION)
  ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
  return p
}

describe('the onboarding pages', () => {
  // Nanda, 2026-11-15: before the store, the config draft holds the settings: the role cards
  // read the models of the draft, and the page offers its names for the model of a role.
  test('before the store, role cards read local staffing without editing it', async () => {
    const p = onboardingProject()
    gitPerson(p)
    p.write('draft.yaml', withModels(ONBOARD_CONFIG, { haiku: { launch: 'small --session-id {session}' } }))
    ok(await p.agent('onboard config --file=draft.yaml'))
    const { get } = serve(p)
    const view = await get('/api/onboarding')
    const writer = view.roles.find((r) => r.role === 'writer')
    expect([writer.model, writer.launch]).toEqual(['haiku', 'small --session-id {session}'])
    expect(view.models).toEqual([])
  })

  test('GET /api/onboarding gives the directions page and the agents page from the files', async () => {
    const p = await onboarding()
    ok(await p.agent('onboard found code-proof'))
    const { get } = serve(p)
    expect((await get('/api/dir')).onboarding).toBe(true)
    const view = await get('/api/onboarding')
    expect(view.stage).toBe('files')
    expect(view.directions.map((d) => [d.id, d.name, d.state, d.origin])).toEqual([
      ['code-proof', 'code-proof', 'loading', 'found in the project by the host'],
      ['tsd-writing', 'TSD writing', 'ready', 'found in the project by the host'],
    ])
    const tsd = view.directions[1]
    expect(tsd.draft.standards[0].rules[0]).toEqual({ id: 'no-code-proof', says: 'No file paths with line numbers, no commit hashes in the body', checkedBy: 'linter' })
    // Nanda, 2026-11-15: the marked steps of the flow carry the ids that apply there.
    expect(tsd.draft.flow.map((f) => f.uses)).toEqual([
      [], [], [], ['tsd-writing', 'intro-story', 'repeatable'], ['facts-not-proof', 'no-code-proof'],
    ])
    // Ruling 4: each example in its step, a real sample with its place and whether its excerpt is
    // in its file now, the host's words as they are (Nanda, 2026-11-15).
    expect(tsd.draft.flow.map((f) => f.examples.length)).toEqual([0, 0, 0, 2, 2])
    const sample = (x) => (x === null || 'written' in x ? x : (({ around: _, ...s }) => s)(x))
    const examples = tsd.draft.flow.flatMap((f) => f.examples)
    expect(examples.map((e) => ({ ...e, input: sample(e.input), output: sample(e.output) }))).toEqual([
      { fit: 'Follows', input: null, output: { file: 'docs/tsd.md', line: 3, excerpt: '## Introduction', current: true } },
      { fit: 'Breaks', input: null, output: { written: '## Introduction and design, in one section' } },
      {
        fit: 'Follows', input: { file: 'docs/tsd.md', line: 5, excerpt: 'TODO', current: true },
        output: { written: 'Reject: the Introduction holds no words yet' },
      },
      {
        fit: 'Breaks', input: { file: 'docs/tsd.md', line: 5, excerpt: 'TODO', current: true },
        output: { written: 'Accept: the section says one thing' },
      },
    ])
    // A step names its place as one value: its file with a line, or none.
    expect(tsd.draft.flow.map((f) => f.place)).toEqual([
      null,
      { file: 'CLAUDE.md', line: 3 },
      { file: '.claude/skills/writer/SKILL.md', line: 3 },
      { file: 'docs/template.md', line: 3 },
      null,
    ])
    // Nanda, 2026-11-15: each real sample carries the code around it (3 lines above and below, as
    // far as the file goes), its own line marked; a TODO in two places is the one nearest its line.
    expect(examples[0].output.around.map((l) => `${l.line}${l.mark ? '*' : ''}`).join(' ')).toBe('1 2 3* 4 5 6')
    expect(examples[2].input.around.map((l) => `${l.line}${l.mark ? '*' : ''}`).join(' ')).toBe('2 3 4 5* 6 7 8')
    const text = readFileSync(join(p.dir, 'docs/tsd.md'), 'utf8')
    p.write('docs/tsd.md', text.replaceAll('TODO', 'Done'))
    expect((await get('/api/onboarding')).directions[1].draft.flow.flatMap((f) => f.examples)[2].input.current).toBe(false)
    p.write('docs/tsd.md', text)
    // Nanda, 2026-11-15: the words against the last draft; a first draft has none, so every line
    // comes: the summary, the words, each standard with each rule and its checker.
    expect(tsd.draft.diff.direction).toBe('The first draft: every line is new')
    expect(tsd.draft.diff.lines.every((l) => l.startsWith('+'))).toBe(true)
    expect(tsd.draft.diff.lines).toContain('+  Rule no-code-proof (checked by linter): No file paths with line numbers, no commit hashes in the body')
    // A draft over it keeps the last one, and the diff shows what changed.
    p.write('again.yaml', ONBOARD_DIRECTION.replace('says: Tell the story first, in plain words.', 'says: Tell the story first.'))
    ok(await p.agent('onboard draft tsd-writing --file=again.yaml'))
    const again = (await get('/api/onboarding')).directions[1].draft.diff
    expect(again.direction).toBe('The last draft → this draft')
    expect(again.lines.filter((l) => !l.startsWith(' '))).toEqual([
      '-Standard intro-story: Tell the story first, in plain words.',
      '+Standard intro-story: Tell the story first.',
    ])
    // Ruling 11: the roles that the project has come first; the model is the role's own; the role
    // of the top task has no toggle (ruling 15).
    expect(view.roles.map((r) => [r.role, r.model, r.found, r.toggle, r.state])).toEqual([
      ['linter', 'haiku', '.claude/agents/linter.md', false, 'waiting'],
      ['architect', 'opus', null, false, 'waiting'],
      ['section-lead', 'sonnet', null, false, 'waiting'],
      ['writer', 'haiku', null, false, 'waiting'],
    ])
    expect(view.roles[1]).toMatchObject({
      icon: 'compass', summary: 'Keeps the TSD on its directions.', launch: null,
      persistence: { persistent: true, why: 'Chosen in staffing.' },
    })
  })

  test('each act of the page writes the files through the module, and stores nothing', async () => {
    const p = await onboarding()
    const { get, onboard } = serve(p)
    // Ruling 5: a new direction has the id new-1 until its first draft names it.
    expect(await onboard({ act: 'add-direction', principle: 'A section says one thing' })).toEqual({ out: 'new-1: a new direction; it shows Loading until the host drafts it.' })
    expect(Bun.YAML.parse(readFileSync(join(p.dir, '.work/assess/new-1.yaml'), 'utf8')).asked).toEqual({ _tag: 'New', principle: 'A section says one thing', example: null })
    p.write('one.yaml', ONBOARD_NEW)
    ok(await p.agent('onboard draft new-1 --file=one.yaml'))
    p.write('q.yaml', ONBOARD_QUESTIONS)
    ok(await p.agent('onboard ask one-thing --file=q.yaml'))
    const asked = (await get('/api/onboarding')).directions.find((d) => d.id === 'one-thing')
    expect(asked).toMatchObject({ state: 'question', principle: 'A section says one thing' })
    expect(asked.open).toEqual([{
      says: 'Does a section of facts count as one thing?',
      // Nanda, 2026-11-15: the example of a question carries the code around it too.
      example: {
        fit: 'Follows',
        input: null,
        output: {
          file: 'docs/facts.md', line: 3, excerpt: '## Dedupe', current: true,
          around: [
            { line: 1, text: '# Facts', mark: false }, { line: 2, text: '', mark: false }, { line: 3, text: '## Dedupe', mark: true },
            { line: 4, text: '', mark: false }, { line: 5, text: 'The export ran twice for one merchant.', mark: false },
          ],
        },
      },
      options: ['each fact is one thing', 'the facts together are one thing'],
    }])
    // Nanda, 2026-11-15: a reply names the direction and what each answer chose.
    expect((await onboard({ act: 'answer', direction: 'one-thing', options: ['B'] })).out).toBe(
      'the answers of One thing per section (one-thing) decide its next draft: B ("the facts together are one thing") to "Does a section of facts count as one thing?"; the host drafts it again.',
    )
    expect((await get('/api/onboarding')).directions.find((d) => d.id === 'one-thing').state).toBe('loading')
    // Ruling 2: Revise sends the words to the host; Remove keeps nothing.
    expect((await onboard({ act: 'revise', direction: 'tsd-writing', words: 'name the reader' })).out).toBe('tsd-writing: the host drafts it again from your words.')
    expect((await get('/api/onboarding')).directions.find((d) => d.id === 'tsd-writing')).toMatchObject({ state: 'loading', why: 'revise', words: 'name the reader' })
    // Nanda, 2026-11-15: a refusal on the page brings its next line, as the terminal shows it.
    expect(await onboard({ act: 'accept', direction: 'tsd-writing' })).toEqual({
      error: 'a Revise of tsd-writing waits for the host',
      next: 'work onboard status shows what waits',
    })
    expect((await onboard({ act: 'remove', direction: 'one-thing' })).out).toBe('one-thing is removed; nothing keeps it.')
    expect(has(p, '.work/assess/one-thing.yaml')).toBe(false)
    ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
    expect((await onboard({ act: 'approve-all-directions' })).error).toContain('reviewed revisions')
    const reviewed = (await get('/api/onboarding')).directions.map(({ id, revision }) => ({ id, revision }))
    expect((await onboard({ act: 'approve-all-directions', reviewed })).out).toBe('accepted: tsd-writing.')
    // Ruling 7, P11: the toggle writes the persistence with a true reason; the role of the top
    // task has none (ruling 15).
    expect((await onboard({ act: 'persistence', role: 'writer', persistent: true })).error)
      .toContain('edit .work/staffing.yaml')
    expect(Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.draft.yaml'), 'utf8'))
      .roles.writer.persistence).toBeUndefined()
    expect((await onboard({ act: 'revise-role', role: 'linter', words: 'check the headings too' })).out).toBe('linter: the host writes it again from your words.')
    expect((await get('/api/onboarding')).roles[0]).toMatchObject({ role: 'linter', request: 'check the headings too' })
    expect((await onboard({ act: 'accept-role', role: 'writer' })).out).toBe('writer is accepted.')
    expect((await get('/api/onboarding')).roles.find((r) => r.role === 'writer').state).toBe('accepted')
    expect(has(p, '.work/aristoteles.db')).toBe(false)
  })

  test('approve all roles starts the store and deletes the files; a refusal writes aristoteles.yaml back', async () => {
    const p = await onboarding()
    p.write('aristoteles.yaml', 'theme: dark\n')
    const { get, onboard, act, s } = serve(p)
    const approve = async () => {
      const origin = `http://127.0.0.1:${s.port}`
      const approval = await get('/api/activation/approval')
      return (await fetch(`${origin}/api/activation`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', entries: approval.entries }),
      })).json()
    }
    ok(await p.nanda('onboard approve-directions', 'approve'))
    for (const role of ROLES) ok(await p.nanda(`onboard accept-role ${role}`))
    // The host drops the linter from the config draft, which checks two rules of tsd-writing: the
    // page names what blocks the start and who fixes it, and the store refuses (O1).
    p.write('draft2.yaml', ONBOARD_CONFIG.replace(/  linter:\n[\s\S]*$/, '').replaceAll(', linter]', ']'))
    ok(await p.agent('onboard config --file=draft2.yaml'))
    // The assign acts of the architect and the lead named the linter, so their cards changed too.
    for (const role of ['architect', 'section-lead']) ok(await p.nanda(`onboard accept-role ${role}`))
    const blocked = 'rule no-code-proof of tsd-writing is checked by linter, which is not an accepted role'
    expect((await get('/api/onboarding')).start).toEqual({
      state: 'blocked',
      says: blocked,
      fix: 'the host drafts tsd-writing again (work onboard draft tsd-writing --file=<direction.yaml>), then the person accepts it',
    })
    expect((await approve()).error).toBe(`the store cannot start: ${blocked}`)
    expect(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')).toBe('theme: dark\n')
    for (const path of ['.work/assess/tsd-writing.yaml', 'aristoteles.draft.yaml']) expect(has(p, path)).toBe(true)
    expect(has(p, '.work/onboarding.lock')).toBe(false)
    expect((await get('/api/dir')).initialized).toBe(false)
    // The host writes the linter again; the person accepts it, and the start stores the result.
    p.write('linter.yaml', 'description: Checks one section against the rules in its checks.\nintro: For each rule in your checks, say where you looked and what you saw.\n' +
      'responsibilities:\n  - Give one --evidence line for each rule in your checks.\n  - Reject with one --point for each rule that the section breaks.\n' +
      'acts: [{ review: [writer] }]\nicon: shield-check\nsummary: Checks one section.\n')
    ok(await p.agent('onboard role linter --file=linter.yaml'))
    ok(await p.nanda('onboard accept-role linter'))
    p.write('.work/staffing.yaml', staffedFixture(ONBOARD_CONFIG).staffing)
    aLiveHost(p)
    try {
      expect((await approve()).out).toContain('Bootstrap host started')
      expect((await get('/api/dash')).activation.phase).toBe('activating')
      await finishActivation(p)
      expect((await get('/api/dash')).activation.phase).toBe('active')
    } finally {
      killBootstrap(p)
    }
    for (const path of ['.work/assess', 'aristoteles.draft.yaml', '.work/onboarding.lock']) expect(has(p, path)).toBe(false)
    // The models table of the draft is a settings block: it comes first, then the file's own.
    const written = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    expect(Bun.YAML.parse(written).models).toBeUndefined()
    expect(Bun.YAML.parse(written).theme).toBe('dark')
    expect(await get('/api/dir')).toMatchObject({ initialized: true, onboarding: false })
    // After the start, the same view reads the store (the gear), and onboarding is over.
    const view = await get('/api/onboarding')
    expect(view.stage).toBe('store')
    expect(view.directions.map((d) => [d.id, d.state, d.origin, d.draft.flow.flatMap((f) => f.examples).length])).toEqual([['tsd-writing', 'current', 'tsd-writing@1, owner Nanda', 4]])
    // Nanda, 2026-11-15: in the gear, a version against the one before it; the first has none.
    expect(view.directions[0].draft.diff.direction).toBe('tsd-writing@1, the first version: every line is new')
    expect(view.roles.map((r) => [r.role, r.state, r.toggle])).toEqual(ROLES.map((r) => [r, 'current', false]))
    expect((await onboard({ act: 'add-direction', principle: 'one more' })).error).toBe('the store of this dir has started, so onboarding is over; a change now is an adjustment')
    expect((await act({ act: 'suggest' })).error).toBe('there is no act "suggest"')
    // BUILD.md 1c: the store start replaced the page act accept-roles.
    expect((await act({ act: 'accept-roles' })).error).toBe('there is no act "accept-roles"')
  })

  test('the server sends changed when the host writes an onboarding file', async () => {
    const p = onboardingProject()
    const { s } = serve(p)
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { origin: `http://127.0.0.1:${s.port}` } })
    await new Promise((done) => { ws.onopen = done })
    const next = () => new Promise((done) => { ws.onmessage = (m) => JSON.parse(m.data).type !== 'hello' && done(JSON.parse(m.data)) })
    // The first draft makes .work/assess/; a later file in it is seen too.
    let message = next()
    p.write('draft.yaml', ONBOARD_CONFIG)
    ok(await p.agent('onboard config --file=draft.yaml'))
    expect(await message).toEqual({ type: 'changed' })
    await Bun.sleep(100)
    message = next()
    ok(await p.agent('onboard found tsd-writing'))
    expect(await message).toEqual({ type: 'changed' })
    ws.close()
  })
})

