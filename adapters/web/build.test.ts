// P8, ruling 4: the server sends the build of its code (the git commit of the installed code) on
// each open of the socket, so that a page of another build reloads.
import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { h } from '../../core/actions/fixture.test.ts'
import { startServer } from './server.ts'

const done: Array<() => void> = []
afterAll(() => {
  for (const stop of done) stop()
})

test('the socket hears the build of the server first', async () => {
  const p = h.project()
  await h.init(p)
  const code = mkdtempSync(join(tmpdir(), 'ar-code-'))
  done.push(() => rmSync(code, { recursive: true, force: true }))
  const git = (...args: ReadonlyArray<string>) =>
    Bun.spawnSync(['git', '-C', code, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      env: process.env,
    })
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'one')
  const commit = git('rev-parse', 'HEAD').stdout.toString().trim()
  const env = { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db'), ARISTOTELES_CODE: code }
  const s = startServer({ dir: p.dir, env })
  done.push(() => s.stop())
  const origin = `http://127.0.0.1:${s.port}`
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { origin } } as never)
  const first = await new Promise<string>((heard, fail) => {
    ws.onmessage = (e) => heard(String(e.data))
    ws.onerror = fail
  })
  ws.close()
  expect(JSON.parse(first)).toEqual({ type: 'hello', build: commit })
}, 30000)

// P8 (live 2026-11-16): a server of an old build called a newer store damaged. When the build
// changes, it frees its port, lets a request in flight end, and calls restart with its port.
test('a change of the build stops the server after its requests, and restarts it', async () => {
  const p = h.project()
  await h.init(p)
  let build = 'one'
  const restarts: Array<number> = []
  let slowStarted = () => {}
  const started = new Promise<void>((ok) => {
    slowStarted = ok
  })
  const s = startServer({
    dir: p.dir,
    env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') },
    readBuild: () => build,
    buildMs: 20,
    restart: (port) => {
      restarts.push(port)
    },
    extend: {
      api: async (_req, url) => {
        if (url.pathname !== '/api/slow') return undefined
        slowStarted()
        await Bun.sleep(300)
        return new Response('done')
      },
    },
  })
  done.push(() => s.stop())
  const base = `http://127.0.0.1:${s.port}`
  expect(await (await fetch(`${base}/health`)).json()).toEqual({ dir: p.dir })
  await Bun.sleep(100)
  expect(restarts).toEqual([])
  const slow = fetch(`${base}/api/slow`, { headers: { origin: base } })
  await started
  build = 'two'
  await Bun.sleep(100)
  // The port is free, the request in flight goes on, and restart waits for it.
  await expect(fetch(`${base}/health`)).rejects.toThrow()
  expect(restarts).toEqual([])
  const res = await slow
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('done')
  await Bun.sleep(150)
  expect(restarts).toEqual([s.port])
}, 30000)
