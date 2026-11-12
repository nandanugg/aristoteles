// The page in a real browser (plan/ui/BUILD.md part 3). The check runs in a process group of
// its own, because the browser tool can end the whole group of the process that started it.
import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

test('the page, read only, in a real browser', async () => {
  const child = spawn('bun', [join(import.meta.dir, 'browser', 'page.check.js')], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const code = await new Promise((done) => child.on('exit', done))
  expect({ code, out }).toEqual({ code: 0, out: 'the page check passed\n' })
}, 120000)
