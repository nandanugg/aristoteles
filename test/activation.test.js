import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { aLiveHost, acknowledge, bootstrapTmux, finishActivation, killBootstrap, launchDir, launchEnv, recordOf } from './activation-fixture.js'
import { createPump, createWatcher, startServer } from './code.js'
import { api, dbOf } from './outside.js'
import { ONBOARD_CONFIG, ok, onboardingProject } from './harness.js'

const fixture = async () => {
  const p = onboardingProject()
  p.write('draft.yaml', ONBOARD_CONFIG.replace('    icon: compass', '    pipeline: true\n    icon: compass'))
  p.write('CLAUDE.md', 'Approved instructions\n')
  ok(await p.agent('onboard config --file=draft.yaml'))
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`onboard accept-role ${role}`))
  }
  aLiveHost(p)
  return p
}

test('an inactive start marks the manifest and the bound launch collects after top open', async () => {
  const p = await fixture()
  try {
    ok(await p.nanda('onboard approve-roles', 'approve'))
    const record = recordOf(p)
    expect(readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8')).toContain('aristoteles-marker')
    expect((await p.nanda('top open --name=x --goal=y --sections=z')).err).toContain('not activated')
    expect((await p.run(`activation ack ${record.pending.launch}`, {
      env: { ARISTOTELES_LAUNCH_NONCE: 'wrong' },
    })).err).toContain('replaced')
    await finishActivation(p)
    const opened = ok(await p.nanda('top open --name=x --goal=y --sections=z')).out
    expect(opened).toContain('holds its token from activation')
    const collected = ok(await p.run(`wait --launch ${record.pending.launch} --seconds=1`, {
      env: launchEnv(p, record),
    })).out
    expect(collected).toMatch(/w\.host\.0\.[0-9a-f]+/)
    const token = collected.match(/w\.host\.0\.[0-9a-f]+/)[0]
    const wait = ok(await p.agent(`wait ${token}`)).out
    expect(wait).toContain('work send')
    expect(recordOf(p).retired).toBe(true)
    expect(existsSync(join(launchDir(p, record), 'secret'))).toBe(false)
    expect((await p.run(`activation ack ${record.pending.launch}`, { env: launchEnv(p, record) })).err)
      .toContain('replaced; exit')
    const status = ok(await p.run(`wait --launch ${record.pending.launch} --seconds=1`, {
      env: launchEnv(p, record),
    })).out
    expect(status).toContain('Bound to the top')
    expect(status).not.toContain(token)
    const db = new Database(join(p.dir, '.work/aristoteles.db'), { readonly: true })
    try {
      const events = db.query('SELECT event FROM event').all().map(({ event }) => event).join('\n')
      expect(events).not.toContain(launchEnv(p, record).ARISTOTELES_LAUNCH_NONCE)
      expect(events).not.toContain(token.split('.').at(-1))
    } finally {
      db.close()
    }
  } finally {
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('rollback restores a marker and preserves an edited instruction file', async () => {
  const p = await fixture()
  try {
    p.write('AGENTS.md', 'Second approved instruction\n')
    ok(await p.nanda('onboard approve-roles', 'approve'))
    const record = recordOf(p)
    p.write('AGENTS.md', 'The person edited this while inactive.\n')
    ok(await p.nanda('activation rollback'))
    expect(readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8')).toBe('Approved instructions\n')
    expect(readFileSync(join(p.dir, 'AGENTS.md'), 'utf8')).toBe('The person edited this while inactive.\n')
    expect((await p.nanda('top open --name=x --goal=y --sections=z')).code).toBe(1)
    expect(existsSync(join(launchDir(p, record), '..'))).toBe(false)
  } finally {
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('a lost launch reserves a new ID and rebind is cancelled when top open wins', async () => {
  const p = await fixture()
  try {
    ok(await p.nanda('onboard approve-roles', 'approve'))
    const first = recordOf(p)
    const firstEnv = launchEnv(p, first)
    killBootstrap(p)
    ok(await p.nanda('activation resume'))
    const replacement = recordOf(p)
    expect(replacement.pending.launch).not.toBe(first.pending.launch)
    expect((await p.run(`wait --launch ${first.pending.launch} --seconds=1`, {
      env: firstEnv,
    })).err).toContain('replaced')
    await acknowledge(p, replacement)
    ok(await p.nanda('activation resume'))
    killBootstrap(p)
    expect((await api(p, '/api/dash')).activation).toMatchObject({ phase: 'host lost', next: 'relaunch' })
    ok(await p.nanda('activation relaunch'))
    expect((await api(p, '/api/dash')).activation.phase).toBe('relaunching')
    const pending = recordOf(p)
    expect(pending.pending.kind).toBe('rebind')
    const pendingEnv = launchEnv(p, pending)
    const pendingWait = ok(await p.run(`wait --launch ${pending.pending.launch} --seconds=1`, {
      env: pendingEnv,
    })).out
    expect(pendingWait).not.toContain('w.host.')
    expect(recordOf(p).committed.launch).toBe(replacement.pending.launch)
    ok(await p.nanda('top open --name=x --goal=y --sections=z'))
    const cancelled = await p.run(`wait --launch ${pending.pending.launch} --seconds=1`, { env: pendingEnv })
    expect(cancelled.err).toContain('replaced; exit')
    expect(cancelled.out).not.toContain('w.host.')
    expect(recordOf(p).pending).toBeNull()
    ok(await p.nanda('activation resume'))
    expect(recordOf(p).committed.launch).toBe(replacement.pending.launch)
    expect(bootstrapTmux(p, 'has-session', '-t', `=boot-${pending.pending.launch}`).exitCode).not.toBe(0)
    expect(existsSync(launchDir(p, pending))).toBe(false)
    expect((await p.run(`wait --launch ${pending.pending.launch} --seconds=1`, { env: pendingEnv })).err)
      .toContain('replaced; exit')
  } finally {
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('recovery notes a committed rebind even when the top opened before its note', async () => {
  const p = await fixture()
  try {
    ok(await p.nanda('onboard approve-roles', 'approve'))
    const first = await finishActivation(p)
    const oldEnv = launchEnv(p, first)
    killBootstrap(p)
    ok(await p.nanda('activation relaunch'))
    await acknowledge(p)
    const before = recordOf(p)
    const env = launchEnv(p, before)
    p.write('CLAUDE.md', 'Edited after initial activation.\n')
    ok(await p.nanda('activation resume'))
    // Recreate the record at the interruption point. The append and private files are real.
    p.write('.work/onboarding/activation/record.json', JSON.stringify(before))
    ok(await p.nanda('top open --name=x --goal=y --sections=z'))
    ok(await p.nanda('activation resume'))
    expect(recordOf(p).committed.launch).toBe(before.pending.launch)
    expect(recordOf(p).pending).toBeNull()
    expect(existsSync(launchDir(p, first))).toBe(false)
    expect((await p.run(`wait --launch ${first.pending.launch} --seconds=1`, { env: oldEnv })).err)
      .toContain('replaced; exit')
    expect(ok(await p.run(`wait --launch ${before.pending.launch} --seconds=1`, { env })).out)
      .toMatch(/w\.host\.0\.[0-9a-f]+/)
    expect(readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8')).toBe('Edited after initial activation.\n')
  } finally {
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('concurrent resumes commit initial activation once and recover a missed record update', async () => {
  const p = await fixture()
  try {
    ok(await p.nanda('onboard approve-roles', 'approve'))
    await acknowledge(p)
    const before = recordOf(p)
    const replies = await Promise.all([p.nanda('activation resume'), p.nanda('activation resume')])
    for (const reply of replies) ok(reply)
    const db = new Database(join(p.dir, '.work/aristoteles.db'), { readonly: true })
    try {
      const events = db.query('SELECT event FROM event').all().map(({ event }) => event)
      expect(events.filter((event) => event.includes('"Activated"'))).toHaveLength(1)
    } finally {
      db.close()
    }
    p.write('.work/onboarding/activation/record.json', JSON.stringify(before))
    ok(await p.nanda('activation resume'))
    expect(recordOf(p).committed.launch).toBe(before.pending.launch)
    expect(recordOf(p).pending).toBeNull()
  } finally {
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('resume drops a reservation that never reached spawn and commits only fresh marked files', async () => {
  const p = await fixture()
  try {
    ok(await p.nanda('onboard approve-roles', 'approve'))
    const reserved = recordOf(p)
    killBootstrap(p)
    rmSync(launchDir(p, reserved), { recursive: true })
    expect((await api(p, '/api/dash')).activation.phase).toBe('activating')
    ok(await p.nanda('activation resume'))
    const replacement = recordOf(p)
    expect(replacement.pending.launch).not.toBe(reserved.pending.launch)
    expect(bootstrapTmux(p, 'has-session', '-t', `=boot-${reserved.pending.launch}`).exitCode).not.toBe(0)
    expect(statSync(launchDir(p, replacement)).mode & 0o777).toBe(0o700)
    expect(statSync(join(launchDir(p, replacement), 'nonce')).mode & 0o777).toBe(0o600)
    const approved = readFileSync(join(p.dir, 'CLAUDE.md'), 'utf8')
    await acknowledge(p)
    p.write('CLAUDE.md', 'Changed before commit.\n')
    expect((await p.nanda('activation resume')).code).not.toBe(0)
    expect(recordOf(p).committed).toBeNull()
    p.write('CLAUDE.md', approved)
    ok(await p.nanda('activation resume'))
    expect(recordOf(p).committed.launch).toBe(replacement.pending.launch)
  } finally {
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('a failed rebind append leaves the old credential selected and recovery discards the staged secret', async () => {
  const p = await fixture()
  try {
    ok(await p.nanda('onboard approve-roles', 'approve'))
    const first = await finishActivation(p)
    const oldSecret = readFileSync(join(launchDir(p, first), 'secret'), 'utf8')
    const oldEnv = launchEnv(p, first)
    killBootstrap(p)
    ok(await p.nanda('activation relaunch'))
    const pending = await acknowledge(p)
    const db = new Database(dbOf(p))
    try {
      db.run(`CREATE TRIGGER fail_rebind BEFORE INSERT ON event
        WHEN NEW.member = 'HostRebound' BEGIN SELECT RAISE(ABORT, 'fixture blocked rebind'); END`)
      const failed = await p.nanda('activation resume')
      expect(failed.code).not.toBe(0)
      expect(failed.err).toContain('fixture blocked rebind')
      const staged = readFileSync(join(launchDir(p, pending), 'secret'), 'utf8')
      expect(staged).not.toBe(oldSecret)
      expect(recordOf(p).committed.launch).toBe(first.pending.launch)
      expect(db.query("SELECT count(*) AS count FROM event WHERE member = 'HostRebound'").get().count).toBe(0)
      const wait = (record, env) => p.run(`wait --launch ${record.pending.launch} --seconds=0.01`, { env })
      expect(ok(await wait(pending, launchEnv(p, pending))).out).not.toContain(staged)
      expect(ok(await wait(first, oldEnv)).out).toContain(`w.host.0.${oldSecret}`)
    } finally {
      db.run('DROP TRIGGER IF EXISTS fail_rebind')
      db.close()
    }
    killBootstrap(p)
    ok(await p.nanda('activation resume'))
    expect(recordOf(p).pending).toBeNull()
    expect(existsSync(launchDir(p, pending))).toBe(false)
    expect(readFileSync(join(launchDir(p, first), 'secret'), 'utf8')).toBe(oldSecret)
  } finally {
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('pre-top, wrong binding and stale epoch requests do not retire the bootstrap credential', async () => {
  const p = await fixture()
  try {
    ok(await p.nanda('onboard approve-roles', 'approve'))
    const record = await finishActivation(p)
    const secretFile = join(launchDir(p, record), 'secret')
    const token = `w.host.0.${readFileSync(secretFile, 'utf8')}`
    expect((await p.agent(`wait ${token} --seconds=1`)).err).toContain('no top')
    expect(recordOf(p).retired).toBe(false)
    const open = ok(await p.nanda('top open --name=x --goal=y --sections=z'))
    expect(open.out).not.toContain(token)
    expect((await p.agent('wait w.host.0.wrong --seconds=1')).code).not.toBe(0)
    expect(recordOf(p).retired).toBe(false)
    const moved = ok(await p.run('run continue', {
      tty: true,
      env: { TMUX: '/tmp/fixture-host.sock,1,0', TMUX_PANE: '%3' },
    }))
    expect(moved.out).toContain('w.host.1.')
    const oldWait = await p.agent(`wait ${token} --seconds=1`)
    expect(oldWait.out).toContain("this terminal's token is old")
    expect(oldWait.out).toContain('STOP')
    expect(recordOf(p).retired).toBe(false)
    expect(existsSync(secretFile)).toBe(true)
    const stale = await p.run(`wait --launch ${record.pending.launch} --seconds=1`, {
      env: launchEnv(p, record),
    })
    expect(stale.err).toContain('replaced; exit')
    expect(stale.out).not.toContain(token)
  } finally {
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('dashboard, terminal websocket and watcher logs exclude bootstrap credentials', async () => {
  const p = await fixture()
  let server
  let ws
  let pump
  try {
    aLiveHost(p, 'while [ ! -f .fixture-output ]; do sleep 0.05; done; cat .fixture-output; sleep 60 # {session}')
    const start = ok(await p.nanda('onboard approve-roles', 'approve'))
    const activating = await api(p, '/api/dash')
    const record = await finishActivation(p)
    const launch = record.pending.launch
    const nonce = launchEnv(p, record).ARISTOTELES_LAUNCH_NONCE
    const secret = readFileSync(join(launchDir(p, record), 'secret'), 'utf8')
    const activated = await api(p, '/api/dash')
    const open = ok(await p.nanda('top open --name=x --goal=y --sections=z'))
    p.write('.fixture-output', `${nonce}\nw.host.0.${secret}\n`)
    const target = `=boot-${launch}`
    const end = Date.now() + 3000
    let screen = ''
    while (!screen.includes(secret) && Date.now() < end) {
      const pane = bootstrapTmux(p, 'list-panes', '-t', target, '-F', '#{pane_id}').stdout.toString().trim()
      screen = bootstrapTmux(p, 'capture-pane', '-p', '-J', '-t', pane).stdout.toString()
      if (!screen.includes(secret)) await Bun.sleep(20)
    }
    expect(screen).toContain(nonce)
    expect(screen).toContain(secret)
    const logs = []
    const env = { ARISTOTELES_DB: dbOf(p) }
    pump = createPump({ dir: p.dir })
    const watcher = createWatcher({ dir: p.dir, env, pump, log: (line) => logs.push(line) })
    server = startServer({ dir: p.dir, env, pump, watcher })
    const origin = `http://127.0.0.1:${server.port}`
    const dashResponse = await fetch(`${origin}/api/dash`)
    expect(dashResponse.ok).toBe(true)
    const dash = await dashResponse.json()
    expect(dash.host.card.session).toBe(`boot-${launch}`)
    ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { origin } })
    const frames = []
    const rejected = Promise.withResolvers()
    ws.onmessage = ({ data }) => {
      frames.push(data)
      if (JSON.parse(data).type === 'term.error') rejected.resolve(data)
    }
    ws.onopen = () => ws.send(JSON.stringify({ type: 'term.open', session: dash.host.card.session }))
    const reply = await Promise.race([rejected.promise, Bun.sleep(1500).then(() => '')])
    expect(reply).toContain('local tmux')
    expect(frames.some((frame) => JSON.parse(frame).type === 'term.data')).toBe(false)
    await watcher.tick()
    const publicText = JSON.stringify({ activating, activated, dash, frames, logs, start, open })
    expect(publicText).not.toContain(nonce)
    expect(publicText).not.toContain(secret)
  } finally {
    ws?.close()
    server?.stop()
    pump?.close()
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
})
