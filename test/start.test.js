// work start --detach (Nanda, 2026-11-13): the host starts the page from its own shell, and the
// page must outlive that shell. The test runs it with no tmux on the PATH, so that it touches no
// terminal and no tmux socket: the server says "no terminals", and serves the page.
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordOf, workStartDetached } from './code.js'

const pids = []
afterEach(() => {
  while (pids.length) {
    try {
      process.kill(pids.pop())
    } catch {}
  }
})

test('work start --detach runs the page as a process of its own, and a second start finds it', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'start-')), 'report-export')
  mkdirSync(dir)
  const env = { ARISTOTELES_DB: join(dir, '..', 'aristoteles.db'), WORK_NO_OPEN: '1', HOME: process.env.HOME, PATH: '/usr/bin:/bin' }
  const lines = []
  expect(await workStartDetached(dir, { env, out: (l) => lines.push(l) })).toBe(true)
  const record = JSON.parse(readFileSync(recordOf(dir, env), 'utf8'))
  pids.push(record.pid)
  const url = `http://127.0.0.1:${record.port}/?key=${record.key}`
  expect(lines[0]).toBe(`the UI of ${dir}: ${url}`)
  expect(record.pid).not.toBe(process.pid)
  // The call returned, and the server still answers: it is no child that ends with its caller.
  expect(await (await fetch(`http://127.0.0.1:${record.port}/health`)).json()).toEqual({ dir })
  const again = []
  expect(await workStartDetached(dir, { env, out: (l) => again.push(l) })).toBe(true)
  expect(again).toEqual([`the UI of ${dir} runs already: ${url}`])
  expect(readFileSync(recordOf(dir, env).replace(/\.json$/, '.log'), 'utf8')).toContain('no terminals')
}, 30000)
