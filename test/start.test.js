// work start --detach (Nanda, 2026-11-13): the host starts the page from its own shell, and the
// page must outlive that shell. The test runs it with no tmux on the PATH, so that it touches no
// terminal and no tmux socket: the server says "no terminals", and serves the page.
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
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
  // A PATH with git and no tmux: on Linux, tmux and git are both in /usr/bin.
  const bin = mkdtempSync(join(tmpdir(), 'bin-'))
  symlinkSync(Bun.which('git') ?? '/usr/bin/git', join(bin, 'git'))
  const env = { ARISTOTELES_DB: join(dir, '..', 'aristoteles.db'), WORK_NO_OPEN: '1', HOME: process.env.HOME, PATH: bin }
  const lines = []
  expect(await workStartDetached(dir, { env, out: (l) => lines.push(l) })).toBe(true)
  const record = JSON.parse(readFileSync(recordOf(dir, env), 'utf8'))
  pids.push(record.pid)
  // Nanda, 2026-11-15: the address and the record hold no key.
  const url = `http://127.0.0.1:${record.port}/`
  expect(Object.keys(record).sort()).toEqual(['dir', 'pid', 'port'])
  expect(lines[0]).toBe(`the UI of ${dir}: ${url}`)
  expect(record.pid).not.toBe(process.pid)
  // The call returned, and the server still answers: it is no child that ends with its caller.
  expect(await (await fetch(`http://127.0.0.1:${record.port}/health`)).json()).toEqual({ dir })
  const again = []
  expect(await workStartDetached(dir, { env, out: (l) => again.push(l) })).toBe(true)
  expect(again).toEqual([`the UI of ${dir} runs already: ${url}`])
  expect(readFileSync(recordOf(dir, env).replace(/\.json$/, '.log'), 'utf8')).toContain('no terminals')
}, 30000)

// Nanda, 2026-11-15: a machine with no browser opener (a server over ssh) still starts the page;
// its address is the one that the start printed.
test('work start --detach starts the page on a machine with no browser opener', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'start-')), 'report-export')
  mkdirSync(dir)
  const bin = mkdtempSync(join(tmpdir(), 'bin-'))
  symlinkSync(Bun.which('git') ?? '/usr/bin/git', join(bin, 'git'))
  const env = { ARISTOTELES_DB: join(dir, '..', 'aristoteles.db'), HOME: process.env.HOME, PATH: bin }
  expect(await workStartDetached(dir, { env, out: () => {} })).toBe(true)
  const record = JSON.parse(readFileSync(recordOf(dir, env), 'utf8'))
  pids.push(record.pid)
  expect(await (await fetch(`http://127.0.0.1:${record.port}/health`)).json()).toEqual({ dir })
}, 30000)
