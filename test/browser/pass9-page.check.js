// The worker page uses real top-open placements, process observations, and scoped turns.
import { expect } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { aLiveHost, bootstrapTmux, finishActivation, killBootstrap, launchEnv } from '../activation-fixture.js'
import { createPump, createWatcher, startServer } from '../code.js'
import { ONBOARD_CONFIG, ok, onboardingProject } from '../harness.js'
import { dbOf, gitPerson } from '../outside.js'
import { workerTurn } from '../worker-fixture.js'

const p = onboardingProject({}, 'worker-demo')
let browser
let server
let pump
let watcher
const errors = []
const logs = []
const shots = process.env.PASS9_SCREENSHOTS
const shot = (page, name) => shots
  ? page.screenshot({ path: join(shots, name), animations: 'disabled' })
  : undefined
const tailOf = (socket, target) => Bun.spawnSync([
  'tmux', '-f', '/dev/null', '-L', socket, 'capture-pane', '-p', '-J', '-t', target,
]).stdout.toString()
const until = async (call) => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const result = await call()
    if (result) return result
    await Bun.sleep(40)
  }
  throw new Error('worker fixture timed out')
}
try {
  if (shots) mkdirSync(shots, { recursive: true })
  gitPerson(p)
  const config = Bun.YAML.parse(ONBOARD_CONFIG)
  config.roles.architect.pipeline = true
  for (const role of ['linter', 'writer']) config.roles[role].persistence.persistent = true
  p.write('draft.yaml', Bun.YAML.stringify(config))
  p.write('CLAUDE.md', 'Approved project instructions.\n')
  ok(await p.agent('onboard config --file=draft.yaml'))
  for (const role of Object.keys(config.roles)) ok(await p.nanda(`onboard accept-role ${role}`))
  aLiveHost(p, 'while [ ! -f .fixture-host-screen ]; do sleep 0.05; done; cat .fixture-host-screen; exec cat # {session}')
  const path = '.work/staffing.yaml'
  const staffing = Bun.YAML.parse(readFileSync(join(p.dir, path), 'utf8'))
  const host = staffing.roles.architect
  host.workerGroup = 'delivery'
  Object.assign(staffing.roles['section-lead'], {
    workerGroup: host.workerGroup, account: host.account, cli: host.cli, model: host.model,
    allowedModels: host.allowedModels, launch: host.launch, concurrency: 2, subagentAllowance: 1,
  })
  staffing.clis.fixture.backgroundChildren = true
  staffing.accounts.fixture.sessionLimit = 1
  staffing.accounts.review = { limits: {}, sessionLimit: 1 }
  staffing.roles.writer.account = 'review'
  staffing.roles.writer.launch = 'printf "local worker screen: %s\\n" "$ARISTOTELES_WORKER_CREDENTIAL"; exec cat # {session}'
  p.write(path, Bun.YAML.stringify(staffing))
  ok(await p.nanda('onboard approve-roles', 'approve'))
  const activation = await finishActivation(p)
  ok(await p.nanda('top open --name="Release notes" --goal="Document the release" --sections=Overview,Details'))
  const bootstrap = ok(await p.run(`wait --launch ${activation.pending.launch} --seconds=1`, {
    env: launchEnv(p, activation),
  })).out.match(/w\.host\.0\.[0-9a-f]+/)[0]
  const credential = ok(await p.agent(`wait ${bootstrap} --seconds=1`)).out.match(/g\.[a-f0-9.]+/)[0]
  p.write('.fixture-host-screen', `local host screen: ${bootstrap}\n`)

  const env = { ARISTOTELES_DB: dbOf(p) }
  pump = createPump({ dir: p.dir, socket: `ar-p9-page-${crypto.randomUUID()}` })
  watcher = createWatcher({ dir: p.dir, pump, env, log: (line) => logs.push(line) })
  server = startServer({ dir: p.dir, pump, watcher, env })
  const origin = new URL(server.url).origin
  const dash = async () => (await fetch(`${origin}/api/dash`)).json()
  const read = await until(async () => {
    await watcher.tick()
    const current = await dash()
    return current.workers.find((worker) => worker.label === 'writer')?.session?.attach ? current : null
  })
  const group = read.workers.find((worker) => worker.id === 'group:delivery')
  const writer = read.workers.find((worker) => worker.label === 'writer')
  const linter = read.workers.find((worker) => worker.label === 'linter')
  expect(group.identities.map(({ actor }) => actor).sort()).toEqual(['host', 'pipe', 'role:section-lead'])
  expect(read.host.card.session).toBe(group.session.id)
  expect(read.pipe.session).toBe(group.session.id)
  expect(read.columns.find((column) => column.role === 'section-lead').card.session).toBe(group.session.id)
  expect(linter).toMatchObject({ status: 'waiting for capacity', session: null,
    permits: { provider: { used: 1, limit: 1, charged: false },
      attempts: [{ actor: 'role:linter', used: 0, limit: 1 }],
      children: [{ actor: 'role:linter', used: 0, limit: 0 }], fixes: null, rechecks: null },
  })
  // Confirm the fixture really has credential-bearing local screens before checking the wire.
  const pane = bootstrapTmux(p, 'list-panes', '-t', `=${group.session.id}`, '-F', '#{pane_id}').stdout.toString().trim()
  await until(() => bootstrapTmux(p, 'capture-pane', '-p', '-J', '-t', pane).stdout.toString().includes(bootstrap))
  const writerTarget = `${pump.name}:=${writer.session.id}`
  const privateWorker = await until(() =>
    tailOf(pump.socket, writerTarget).match(/local worker screen: (g\.[a-f0-9.]+)/)?.[1])
  expect(pump.tail(writer.session.id)).toBe('')
  expect(pump.snapshot(writer.session.id)).toHaveLength(0)
  expect(pump.inputTarget(writer.session.id)).toEqual({ state: 'gone' })
  const alias = 'fixture-managed-alias'
  const [writerPane, writerSocket] = Bun.spawnSync([
    'tmux', '-L', pump.socket, 'display-message', '-p', '-t', writerTarget, '#{pane_id} #{socket_path}',
  ]).stdout.toString().trim().split(' ')
  pump.adopt(alias, writerSocket, writerPane)
  expect(pump.localOnly(alias)).toBe(true)
  expect(pump.tail(alias)).toBe('')
  expect(pump.snapshot(alias)).toHaveLength(0)

  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const frames = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('websocket', (ws) => ws.on('framereceived', ({ payload }) => frames.push(String(payload))))
  await page.goto(server.url)
  const workers = page.getByRole('region', { name: 'Workers' })
  const delivery = workers.getByRole('article', { name: 'Worker delivery' })
  await delivery.getByText('Idle', { exact: true }).waitFor()
  expect(await delivery.getByRole('list', { name: 'Identities' }).getByRole('listitem').count()).toBe(3)
  await workers.getByText('Waiting for capacity', { exact: true }).waitFor()
  expect(await workers.textContent()).toContain('The provider account has no free session slot.')
  expect(await workers.getByRole('article').count()).toBe(3)
  await shot(page, '01-workers-idle-and-capacity.png')

  ok(await p.agent(`worker wait ${credential} --seconds=1`))
  await delivery.getByText('Foreground occupied', { exact: true }).waitFor()
  expect(await delivery.textContent()).toContain('Host · Starting work on Overview')
  await shot(page, '02-worker-selected-turn.png')
  await page.getByRole('region', { name: 'section-lead' }).getByRole('button', { name: 'Worker delivery' }).click()
  const hostDialog = page.getByRole('dialog', { name: 'Terminal of delivery' })
  await hostDialog.waitFor()
  expect(await hostDialog.locator('code').textContent()).toContain(`attach-session -t '=${group.session.id}'`)
  expect(await page.locator('.xterm').count()).toBe(0)
  await shot(page, '03-local-bootstrap-terminal.png')
  await hostDialog.getByRole('button', { name: 'Close' }).click()
  await workers.getByRole('article', { name: 'Worker writer' }).getByRole('button', { name: 'Open in local tmux' }).click()
  const writerDialog = page.getByRole('dialog', { name: 'Terminal of writer' })
  expect(await writerDialog.locator('code').textContent()).toBe(
    `tmux -L '${pump.socket}' attach-session -t '${writerTarget}'`)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await writerDialog.getByRole('button', { name: 'Copy command' }).click()
  await writerDialog.getByRole('button', { name: 'Copied', exact: true }).waitFor()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await writerDialog.locator('code').textContent())
  await shot(page, '04-local-worker-terminal.png')
  await writerDialog.getByRole('button', { name: 'Close' }).click()
  // Local typing targets the exact window in the displayed command.
  const typed = 'local-key-fixture'
  expect(Bun.spawnSync(['tmux', '-L', pump.socket, 'send-keys', '-t', writerTarget, typed, 'Enter']).exitCode).toBe(0)
  await until(() => tailOf(pump.socket, writerTarget).includes(typed))

  const refused = await page.evaluate(async (sessions) => {
    const frames = []
    const socket = new WebSocket(`ws://${location.host}/ws`)
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('private terminal probe timed out')) }, 3000)
      socket.onopen = () => {
        for (const session of sessions) {
          socket.send(JSON.stringify({ type: 'term.open', session }))
          socket.send(JSON.stringify({ type: 'term.redraw', session }))
          socket.send(JSON.stringify({ type: 'term.key', session,
            instance: 'fixture', target: 'fixture', seq: 1, data: 'remote-key-fixture' }))
        }
      }
      socket.onmessage = ({ data }) => {
        frames.push(data)
        if (frames.filter((record) => JSON.parse(record).type === 'term.error').length === sessions.length) {
          clearTimeout(timer)
          socket.close()
          resolve(frames)
        }
      }
    })
  }, [group.session.id, writer.session.id, alias])
  const terminalMessages = refused.map((text) => JSON.parse(text)).filter(({ type }) => type.startsWith('term.'))
  expect(terminalMessages.map(({ type }) => type)).toEqual(['term.error', 'term.error', 'term.error'])
  expect(terminalMessages.every(({ error }) => error.includes('local tmux'))).toBe(true)
  expect(tailOf(pump.socket, writerTarget)).not.toContain('remote-key-fixture')
  const publicText = JSON.stringify({ read, latest: await dash(), frames, refused, logs })
  for (const secret of [bootstrap, credential, privateWorker, 'local worker screen:']) {
    if (publicText.includes(secret)) throw new Error('local terminal material escaped into a public observation')
  }

  for (const section of ['Overview', 'Details']) {
    const step = await workerTurn(p, credential, 'send')
    ok(await p.agent(`send ${step.token} --name=${section} --goal=Document --sections=${section} --role=section-lead ${step.args}`))
  }
  const assign = await workerTurn(p, credential, 'assign')
  const admitted = ok(await p.agent(`assign ${assign.token} t1 ${assign.args}`))
  expect(admitted.out).toContain('Reserved child-')
  const capacityReason = 'role:section-lead is waiting for child capacity (allowance 1).'
  await delivery.getByText(capacityReason, { exact: false }).waitFor()
  expect(await delivery.getByText('Waiting for capacity', { exact: true }).count()).toBe(1)
  expect(await delivery.getByRole('region', { name: 'Fix lane' }).textContent()).toContain('0 / 1')
  expect(await delivery.getByRole('region', { name: 'Recheck lane' }).textContent()).toContain('0 / 1')
  const scheduler = (await dash()).workers.find(({ id }) => id === group.id)
  expect(scheduler.permits.attempts).toEqual([{ actor: 'role:section-lead', used: 1, limit: 2 }])
  expect(scheduler.permits.children).toContainEqual({ actor: 'role:section-lead', used: 1, limit: 1 })
  expect(scheduler.waits).toContainEqual({
    actor: 'role:section-lead', step: 'Starting work on Details', reason: capacityReason,
  })
  await shot(page, '07-scheduler-child-capacity.png')

  expect(errors).toEqual([])
} finally {
  await browser?.close()
  server?.stop()
  watcher?.stop()
  pump?.killServer()
  killBootstrap(p)
  rmSync(dirname(p.dir), { recursive: true, force: true })
}
console.log('the pass 9 page check passed')
