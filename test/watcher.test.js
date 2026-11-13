// The watcher and the acts of the UI (plan/ui/BUILD.md parts 6 and 7), with real tmux terminals
// and the fake AI tool: the host is the AI CLI that the person triggered, in a pane of the
// person's own tmux server (Nanda, 2026-11-13); Open gives it the top task; a new
// Terra starts in its own terminal with a new token; a failed terminal is retried, then the host
// hears of it; a prompt goes to the host, and the host's send reaches the child; Stop is no failure.
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createPump } from './code.js'
import { startServer } from './code.js'
import { createWatcher } from './code.js'
import { INTRO_V2, TASK_WHOLE, git, init, ok, personPane, project, tokenIn } from './harness.js'

const FAKE = join(import.meta.dir, 'fake-agent.js')
const SETTINGS = `tiers:
  sol:
    launch: bun ${FAKE} start {session} {prompt}
    resume: bun ${FAKE} resumed {session} {prompt}
    prompts: ["Do you want to proceed?"]
  terra:
    launch: bun ${FAKE} start {session} {prompt}
    resume: bun ${FAKE} resumed {session} {prompt}
    errors: ["connection error"]
    prompts: ["Do you want to proceed?"]
`
const stops = []
afterEach(() => {
  while (stops.length) stops.pop()()
})
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await Bun.sleep(100)
  }
  throw new Error('timed out')
}

// A dir with its roles fitted and the UI running: the server, the pump and the watcher.
const ui = async () => {
  const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
  p.write('aristoteles.yaml', SETTINGS + (await Bun.file(join(p.dir, 'aristoteles.yaml')).text()))
  git(p.dir, 'init', '-q')
  git(p.dir, 'config', 'user.name', 'Nanda')
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  p.realTime()
  const env = { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db'), PATH: process.env.PATH, HOME: process.env.HOME }
  // One fake clock for the pump and the watcher: the real time plus what later() adds, so that
  // a test moves past a quiet window instead of waiting for it.
  let skew = 0
  const clock = () => Date.now() + skew
  const later = (ms) => { skew += ms }
  const socket = `aristoteles-watch-${process.pid}-${Math.random().toString(36).slice(2, 7)}`
  const pump = createPump({ dir: p.dir, socket, clock })
  let readState = () => undefined
  const lines = []
  const watcher = createWatcher({
    dir: p.dir, env, pump, readState: () => readState(), log: (l) => lines.push(l),
    clock, timing: { enterPause: 20, readyPause: 20 },
  })
  watcher.stop()
  const server = startServer({ dir: p.dir, env, pump, watcher })
  readState = server.readState
  stops.push(() => { server.stop(); pump.killServer() })
  const cookie = `aristoteles-${server.port}=${server.key}`
  const origin = `http://127.0.0.1:${server.port}`
  const post = async (act, body = {}) => {
    // A new connection for each act: the server closes one that is idle for 10 s, and a reused
    // one can be closed under the request.
    const res = await fetch(`${origin}/api/act`, { method: 'POST', keepalive: false, headers: { cookie, origin, connection: 'close', 'content-type': 'application/json' }, body: JSON.stringify({ act, ...body }) })
    return { status: res.status, body: await res.json() }
  }
  const screen = (sid) => new TextDecoder().decode(pump.snapshot(sid))
  // The host: the AI CLI that the person triggered, in a pane of the person's own tmux server. It
  // starts its run there, and the watcher copies that pane.
  const joinHost = async () => {
    const person = personPane(`bun ${FAKE} start person-host 'You are the host'`)
    stops.push(() => person.kill())
    ok(await p.run('run start', { env: person.env }))
    await watcher.tick()
    return { host: server.readState().runs.get('h1').session, hostEnv: person.env }
  }
  return { p, pump, watcher, server, post, screen, lines, env, later, joinHost }
}

describe('the watcher and the acts of the UI', () => {
  test('the host in its own pane, Open, a new Terra in its own terminal, a prompt and the host\'s answer, a retry, and Stop', async () => {
    const { p, pump, watcher, server, post, screen, joinHost } = await ui()
    // An act needs the page's origin.
    const bad = await fetch(`http://127.0.0.1:${server.port}/api/act`, { method: 'POST', headers: { cookie: `aristoteles-${server.port}=${server.key}` }, body: '{"act":"accept-roles"}' })
    expect(bad.status).toBe(403)

    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input: You are the host'))

    // The host drafts the top task in its terminal; the person opens it in the UI.
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const opened = await post('open', { draft: 'td1' })
    expect(opened.body.out).toContain('a1 is the host of h1: the UI types into its session: work brief a1.')
    const hostToken = tokenIn(opened.body.out)
    await until(() => screen(host).includes(`you said: Use the work skill. Your command: work brief ${hostToken}`))

    // The host reads its brief and assigns a Terra: the watcher starts its terminal with a new token.
    ok(await p.run(`brief ${hostToken}`, { env: hostEnv }))
    ok(await p.run(`assign ${hostToken} t1 --role=section-lead`, { env: hostEnv }))
    await watcher.tick()
    const lead = await until(() => [...Object.keys(pump.status())].find((sid) => sid !== host))
    await until(() => screen(lead).includes('first input: Use the work skill. Your command: work brief a2.'))
    const leadToken = screen(lead).match(/work brief (a2\.[a-z0-9]+)/)[1]
    ok(await p.agent(`brief ${leadToken}`))

    // A prompt in the child goes to the host; the host's send reaches the child.
    pump.input(lead, 'ask\r')
    await until(() => screen(lead).includes('Do you want to proceed?'))
    await watcher.tick()
    await until(() => screen(host).includes('a2 waits at a prompt. Its screen shows «Do you want to proceed? (1 yes / 2 no)»'))
    ok(await p.agent(`send ${hostToken} a2 --text=1`))
    await watcher.tick()
    await until(() => screen(lead).includes('proceeding with 1'))

    // A failed child is retried with its resume command.
    pump.input(lead, 'fail\r')
    await until(() => pump.status()[lead]?.ended)
    await watcher.tick()
    await until(() => screen(lead).includes('fake agent resumed'))
    expect(pump.status()[lead].live).toBe(true)

    // Stop is no failure: the watcher does not start it again.
    expect((await post('stop', { session: lead })).status).toBe(200)
    await watcher.tick()
    expect(pump.status()[lead]).toBeUndefined()
    expect((await post('resume', { session: lead, tier: 'terra' })).status).toBe(200)
    await until(() => pump.status()[lead]?.live)
  }, 90000)

  test('the person\'s acts: settings, a system problem fixed, and Close', async () => {
    const { p, post, pump, screen, joinHost } = await ui()
    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input'))
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const hostToken = tokenIn((await post('open', { draft: 'td1' })).body.out)
    expect((await post('settings', { settings: { theme: 'dark', sound: true } })).status).toBe(200)
    expect(await Bun.file(join(p.dir, 'aristoteles.yaml')).text()).toContain('theme: dark')
    ok(await p.agent(`problem ${hostToken} t1 --says="the cluster is down"`))
    // Fixed makes the host try it again now; the decision goes when the host records the fix.
    expect((await post('fixed', { problem: 'sp1' })).body.out).toBe('sp1: the host tries it again now; the decision goes when the host records the fix.')
    await until(() => screen(host).includes('Try sp1 again now'))
    ok(await p.agent(`problem ${hostToken} sp1 --fixed`))
    expect((await post('fixed', { problem: 'sp1' })).body.error).toContain('sp1 is no open system problem')
    expect((await post('close', { run: 'h1', reason: 'not needed any more' })).status).toBe(200)
    expect(pump.status()[host]).toBeUndefined()
    expect(ok(await p.ui('run list')).out).toContain('h1 host · closed')
  }, 90000)

  test('an accept of a direction draft by the person wakes the host and each live agent', async () => {
    const { p, pump, post, screen, watcher, later, joinHost } = await ui()
    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input'))
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const hostToken = tokenIn((await post('open', { draft: 'td1' })).body.out)
    ok(await p.run(`brief ${hostToken}`, { env: hostEnv }))
    ok(await p.run(`assign ${hostToken} t1 --role=section-lead`, { env: hostEnv }))
    await watcher.tick()
    const lead = await until(() => [...Object.keys(pump.status())].find((sid) => sid !== host))
    p.write('cost.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs., rules: [ { id: names-cost, says: "The introduction names the cost", checkedBy: linter } ] }\n')
    const draft = ok(await p.agent(`direction revise ${hostToken} tsd-writing --file=cost.yaml`)).out.match(/(d\d+) drafted/)[1]
    // The person's accept needs no evidence and no comment.
    expect((await post('accept-draft', { draft })).status).toBe(200)
    // A wake waits until its terminal is quiet for a moment.
    const woken = (sid) => screen(sid).includes(`Nanda (accept of ${draft}) acted. Run work next`)
    const end = Date.now() + 30000
    while (!(woken(host) && woken(lead)) && Date.now() < end) {
      await watcher.tick()
      later(2000)
      await Bun.sleep(50)
    }
    expect(screen(host)).toContain(`Nanda (accept of ${draft}) acted. Run work next with your token, and do what it says.`)
    expect(screen(lead)).toContain(`Nanda (accept of ${draft}) acted. Run work next with your token, and do what it says.`)
  }, 90000)

  test('the answer of the host wakes the Terra that asked', async () => {
    const { p, pump, post, screen, watcher, later, joinHost } = await ui()
    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input'))
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const hostToken = tokenIn((await post('open', { draft: 'td1' })).body.out)
    ok(await p.run(`brief ${hostToken}`, { env: hostEnv }))
    ok(await p.run(`assign ${hostToken} t1 --role=section-lead`, { env: hostEnv }))
    await watcher.tick()
    const lead = await until(() => [...Object.keys(pump.status())].find((sid) => sid !== host))
    await until(() => screen(lead).includes('work brief a2.'))
    const leadToken = screen(lead).match(/work brief (a2\.[a-z0-9]+)/)[1]
    ok(await p.agent(`brief ${leadToken}`))
    ok(await p.agent(`ask ${leadToken} --text="Is the retry part of the export?" --to=owner`))
    ok(await p.agent(`answer ${hostToken} q1 --text="No: the retry is a task of its own."`))
    const end = Date.now() + 30000
    while (!screen(lead).includes('a1 (the answer to q1) acted.') && Date.now() < end) {
      await watcher.tick()
      later(2000)
      await Bun.sleep(50)
    }
    expect(screen(lead)).toContain('a1 (the answer to q1) acted. Run work next with your token, and do what it says.')
  }, 90000)

  test('the host\'s resolve of an escalation wakes the Terra that escalated', async () => {
    const { p, pump, post, screen, watcher, later, joinHost } = await ui()
    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input'))
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const hostToken = tokenIn((await post('open', { draft: 'td1' })).body.out)
    ok(await p.run(`brief ${hostToken}`, { env: hostEnv }))
    ok(await p.run(`assign ${hostToken} t1 --role=section-lead`, { env: hostEnv }))
    await watcher.tick()
    const lead = await until(() => [...Object.keys(pump.status())].find((sid) => sid !== host))
    await until(() => screen(lead).includes('work brief a2.'))
    const leadToken = screen(lead).match(/work brief (a2\.[a-z0-9]+)/)[1]
    ok(await p.agent(`brief ${leadToken}`))
    // The writer is a Luna: a subagent in the lead's terminal.
    const writer = tokenIn(ok(await p.agent(`assign ${leadToken} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const escalation = ok(await p.agent(`escalate ${leadToken} --result=r1 --reason="no rule covers the length of the section"`)).out.match(/^(v\d+)/)[1]
    ok(await p.agent(`resolve ${hostToken} ${escalation} --resolution="the length is fine"`))
    const woke = `a1 (resolve of r1, on the escalation ${escalation})`
    const end = Date.now() + 30000
    while (!screen(lead).includes(woke) && Date.now() < end) {
      await watcher.tick()
      later(2000)
      await Bun.sleep(50)
    }
    expect(screen(lead)).toContain(woke)
  }, 90000)

  test('the accept of a part wakes the Terra of the part that needs it', async () => {
    const { p, pump, post, screen, watcher, later, joinHost } = await ui()
    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input'))
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const hostToken = tokenIn((await post('open', { draft: 'td1' })).body.out)
    ok(await p.run(`brief ${hostToken}`, { env: hostEnv }))
    p.write('parts.yaml', '- { name: Part one, text: Write part one., context: { section: introduction } }\n' +
      '- { name: Part two, text: Write part two., context: { section: design }, after: [Part one] }\n')
    ok(await p.agent(`task split ${hostToken} t1 --file=parts.yaml`))
    ok(await p.agent(`assign ${hostToken} t2 --role=section-lead`))
    ok(await p.agent(`assign ${hostToken} t3 --role=section-lead`))
    await watcher.tick()
    const sessionOf = (a) => until(() => Object.keys(pump.status()).find((sid) => screen(sid).includes(`work brief ${a}.`)))
    const first = await sessionOf('a2')
    const second = await sessionOf('a3')
    const lead = screen(first).match(/work brief (a2\.[a-z0-9]+)/)[1]
    ok(await p.agent(`brief ${lead}`))
    // Part one is written and accepted; part two waited for it.
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes there" --evidence="no-ticket-ids | the introduction | no ticket ids there"`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reader can repeat the double export"`))
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('t2 is open')
    const end = Date.now() + 30000
    while (!screen(second).includes('(the accept of t2, which t3 needs) acted.') && Date.now() < end) {
      await watcher.tick()
      later(2000)
      await Bun.sleep(50)
    }
    expect(screen(second)).toContain('a2 (the accept of t2, which t3 needs) acted. Run work next with your token, and do what it says.')
  }, 90000)

  test('a quiet Terra whose work next changes wakes, also when no act names it: a file is free', async () => {
    const { p, pump, post, screen, watcher, later, joinHost } = await ui()
    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input'))
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const hostToken = tokenIn((await post('open', { draft: 'td1' })).body.out)
    ok(await p.run(`brief ${hostToken}`, { env: hostEnv }))
    // Two parts write one file, with no order: one maker writes a file at a time.
    p.write('parts.yaml', '- { name: Part one, text: Write part one., context: { section: introduction } }\n' +
      '- { name: Part two, text: Write part two., context: { section: design } }\n')
    ok(await p.agent(`task split ${hostToken} t1 --file=parts.yaml`))
    ok(await p.agent(`assign ${hostToken} t2 --role=section-lead`))
    ok(await p.agent(`assign ${hostToken} t3 --role=section-lead`))
    await watcher.tick()
    const sessionOf = (a) => until(() => Object.keys(pump.status()).find((sid) => screen(sid).includes(`work brief ${a}.`)))
    const first = await sessionOf('a2')
    const second = await sessionOf('a3')
    const lead1 = screen(first).match(/work brief (a2\.[a-z0-9]+)/)[1]
    const lead2 = screen(second).match(/work brief (a3\.[a-z0-9]+)/)[1]
    ok(await p.agent(`brief ${lead1}`))
    ok(await p.agent(`brief ${lead2}`))
    const writer = tokenIn(ok(await p.agent(`assign ${lead1} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`assign ${lead2} t3 --role=writer`))
    // The second lead goes quiet while its writer waits for the file: the watcher notes its work next.
    later(8500)
    await watcher.tick()
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`finish ${lead1} a4`))
    const end = Date.now() + 30000
    while (!screen(second).includes('Your next step changed while you waited.') && Date.now() < end) {
      await watcher.tick()
      later(2000)
      await Bun.sleep(50)
    }
    expect(screen(second)).toContain('Your next step changed while you waited. Run work next with your token, and do what it says.')
  }, 90000)

  test('a Stop holds through a restart; the host is the person\'s own terminal', async () => {
    const { p, pump, post, screen, watcher, server, env, joinHost } = await ui()
    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input'))
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const hostToken = tokenIn((await post('open', { draft: 'td1' })).body.out)
    ok(await p.run(`brief ${hostToken}`, { env: hostEnv }))
    ok(await p.run(`assign ${hostToken} t1 --role=section-lead`, { env: hostEnv }))
    await watcher.tick()
    const lead = await until(() => [...Object.keys(pump.status())].find((sid) => sid !== host))
    // The person stops the Terra before its brief, and the server starts again: a new watcher.
    expect((await post('stop', { session: lead })).status).toBe(200)
    const again = createWatcher({ dir: p.dir, env, pump, readState: server.readState })
    again.stop()
    await again.tick()
    expect(pump.status()[lead]).toBeUndefined()
    // The host is the person's own terminal: the page cannot stop it. A problem of the host that
    // the UI recorded ends with Fixed while the host runs.
    expect((await post('stop', { session: host })).body.error).toContain('the UI does not start, restart, or stop it')
    expect(pump.status()[host].live).toBe(true)
    ok(await p.ui('problem t1 --says="the host terminal failed 3 times"'))
    expect((await post('fixed', { problem: 'sp1' })).body.out).toBe('sp1: the host runs, and the problem is fixed.')
  }, 90000)

  test('the end of work closes its terminal: a Terra when it finishes, the host when the project is done', async () => {
    const { p, pump, post, screen, watcher, later, joinHost } = await ui()
    const { host, hostEnv } = await joinHost()
    await until(() => screen(host).includes('first input'))
    ok(await p.run('task draft --file=top.yaml --by=h1', { env: hostEnv }))
    const hostToken = tokenIn((await post('open', { draft: 'td1' })).body.out)
    ok(await p.run(`brief ${hostToken}`, { env: hostEnv }))
    ok(await p.run(`assign ${hostToken} t1 --role=section-lead`, { env: hostEnv }))
    await watcher.tick()
    const lead = await until(() => [...Object.keys(pump.status())].find((sid) => sid !== host))
    await until(() => screen(lead).includes('work brief a2.'))
    // A terminal closes when it is quiet, so the loop waits for that.
    const closes = async (sid) => {
      const end = Date.now() + 30000
      while (pump.status()[sid] && Date.now() < end) {
        await watcher.tick()
        later(2000)
        await Bun.sleep(50)
      }
      return !pump.status()[sid]
    }
    ok(await p.agent(`finish ${hostToken} a2`))
    expect(await closes(lead)).toBe(true)
    expect(pump.status()[host].live).toBe(true)
    // The host's writer and linter are Lunas, with no terminals. The top task is accepted, and
    // the host stays while the end waits for the person.
    const writer = tokenIn(ok(await p.agent(`assign ${hostToken} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${hostToken} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes there" --evidence="no-ticket-ids | the introduction | no ticket ids there"`))
    ok(await p.agent(`review ${hostToken} r1 accept --evidence="docs/tsd.md, the introduction | the section says what the task asks"`))
    ok(await p.agent(`note ${hostToken} words --on=h1 --text="The TSD is whole."`))
    ok(await p.agent(`finish ${hostToken} ${writer.split('.')[0]}`))
    later(8500)
    await watcher.tick()
    expect(pump.status()[host].live).toBe(true)
    expect((await post('end', { run: 'h1' })).status).toBe(200)
    expect(await closes(host)).toBe(true)
  }, 90000)
})
