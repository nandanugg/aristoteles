import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Files, FilesLive } from '../services/outside.ts'
import { readStaffing, STAFFING, staffingOf } from './staffing.ts'

const role = {
  account: 'primary',
  cli: 'terminal',
  allowedModels: ['model-a', 'model-b'],
  model: 'model-a',
  persistent: true,
  concurrency: 2,
  subagentAllowance: 0,
  launch: 'agent --session {session}',
}
const clis = { terminal: { backgroundChildren: true } }
const accounts = { primary: { limits: { usage: '5 hours rolling', sessions: '2 slots' } } }

test('staffing is read from the project directory and keeps user-entered limits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'staffing-'))
  const first = join(root, 'first')
  const second = join(root, 'second')
  const input = { accounts, clis, roles: { reviewer: role } }
  try {
    const effect = Effect.gen(function* () {
      const files = yield* Files
      yield* files.write(join(first, STAFFING), Bun.YAML.stringify(input))
      expect<unknown>(yield* readStaffing(first)).toEqual(input)
      expect(yield* readStaffing(second)).toBeNull()
    })
    await Effect.runPromise(effect.pipe(Effect.provide(FilesLive)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a staffing binding needs a known account and an allowed effective model', () => {
  expect(() => staffingOf({ accounts, clis, roles: { reviewer: { ...role, account: 'other' } } }))
    .toThrow('unknown account')
  expect(() => staffingOf({ accounts, clis, roles: { reviewer: { ...role, model: 'other' } } }))
    .toThrow('one of its allowed models')
})
