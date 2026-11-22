import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

test('the onboarding review steps, in a real browser', async () => {
  const child = spawn('bun', [join(import.meta.dir, 'browser', 'onboarding.check.js')], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (data) => { out += data })
  child.stderr.on('data', (data) => { out += data })
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  expect({ code, out }).toEqual({ code: 0, out: 'the onboarding check passed\n' })
}, 90000)
