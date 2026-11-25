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
const clis = { terminal: { backgroundChildren: true, canPark: false } }
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

// Pass 9 decision 1: worker groups, the session limit per account, the CLI's park capability.
test('a worker group joins persistent roles that share launch settings and capacity', () => {
  const roles = { a: { ...role, workerGroup: 'g' }, b: { ...role, workerGroup: 'g' } }
  expect(staffingOf({ accounts, clis, roles }).roles.a?.workerGroup).toBe('g')
  expect(() => staffingOf({ accounts, clis, roles: { ...roles, b: { ...roles.b, model: 'model-b' } } }))
    .toThrow('workerGroup g: roles.b.model differs from roles.a.model')
  expect(() => staffingOf({ accounts, clis, roles: { ...roles, b: { ...roles.b, subagentAllowance: 1 } } }))
    .toThrow('workerGroup g: roles.b.subagentAllowance differs from roles.a.subagentAllowance')
  expect(() => staffingOf({ accounts, clis, roles: { ...roles, b: { ...roles.b, concurrency: 3 } } }))
    .toThrow('workerGroup g: roles.b.concurrency differs from roles.a.concurrency')
  expect(() => staffingOf({ accounts, clis, roles: { a: { ...role, persistent: false, workerGroup: 'g' } } }))
    .toThrow('only a persistent role runs on a worker')
})

test('the session limit is a positive count; a CLI states whether it can park', () => {
  const limited = { primary: { ...accounts.primary, sessionLimit: 2 } }
  expect(staffingOf({ accounts: limited, clis, roles: { reviewer: role } }).accounts.primary?.sessionLimit).toBe(2 as never)
  expect(() => staffingOf({ accounts: { primary: { ...accounts.primary, sessionLimit: 0 } }, clis, roles: {} }))
    .toThrow()
  expect(() => staffingOf({ accounts, clis: { terminal: { backgroundChildren: true } }, roles: {} })).toThrow()
})
