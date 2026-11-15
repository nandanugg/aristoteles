// P8, ruling 4: the server sends the build of its code (the git commit of the installed code) on
// each open of the socket, so that a page of another build reloads (test/browser/page.check.js).
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
