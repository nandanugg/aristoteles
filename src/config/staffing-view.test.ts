import { describe, expect, test } from 'bun:test'
import { type Staffing, staffingOf } from './staffing.ts'
import { staffingPreview, staffingView } from './staffing-view.ts'

const base = (): Staffing =>
  staffingOf({
    clis: { claude: { backgroundChildren: true }, codex: { backgroundChildren: false } },
    accounts: {
      max: { limits: { '5h': '45 messages', weekly: '240 hours' } },
      team: { limits: {} },
    },
    roles: {
      host: {
        account: 'max', cli: 'claude', allowedModels: ['opus', 'sonnet'], model: 'opus',
        persistent: true, concurrency: 1, subagentAllowance: 2, launch: 'claude --session {session}',
      },
      writer: {
        account: 'max', cli: 'codex', allowedModels: ['gpt'], model: 'gpt',
        persistent: false, concurrency: 2, subagentAllowance: 1, launch: 'codex {session}',
      },
      pipe: {
        account: 'team', cli: 'claude', allowedModels: ['sonnet'], model: 'sonnet',
        persistent: true, concurrency: 1, subagentAllowance: 0, launch: 'claude {session}',
      },
    },
  })

describe('staffingView', () => {
  test('the arrangement: each role, its alternatives and its review mode, never claimed stronger', () => {
    const v = staffingView(base())
    expect(v.arrangement.map((r) => [r.role, r.review, r.alternatives])).toEqual([
      ['host', 'fresh subagent', ['sonnet']],
      ['pipe', 'self-review turns', []],
      ['writer', 'fresh subagent, worker waits', []],
    ])
    expect(v.arrangement.every((r) => !r.fit.known)).toBe(true)
  })

  test('consequences per limit, as typed, with the roles it counts and a session bound', () => {
    const v = staffingView(base())
    expect(v.consequences).toEqual([
      expect.objectContaining({ account: 'max', limit: '5h', typed: '45 messages',
        roles: ['host', 'writer'], peakSessions: 3 }),
      expect.objectContaining({ account: 'max', limit: 'weekly', typed: '240 hours',
        roles: ['host', 'writer'], peakSessions: 3 }),
    ])
    expect(v.consequences.every((c) => !c.workload.known && c.workload.why !== '')).toBe(true)
  })

  test('warnings: self-review, a foreground CLI, an account with no limits', () => {
    expect(staffingView(base()).warnings.map((w) => w.role)).toEqual(['pipe', 'writer', 'pipe'])
  })
})

describe('staffingPreview', () => {
  test('the change and both views, before it is applied', () => {
    const before = base()
    const after: Staffing = {
      ...before,
      accounts: { ...before.accounts, max: { limits: { '5h': '90 messages', weekly: '240 hours' } } },
      roles: { ...before.roles, pipe: { ...before.roles.pipe!, subagentAllowance: 1 } },
    }
    const p = staffingPreview(before, after)
    expect(p.changed).toEqual([
      'pipe.subagentAllowance: 0 -> 1',
      'pipe.review: self-review turns -> fresh subagent',
      'limit max.5h: 45 messages -> 90 messages',
    ])
    expect(p.before.warnings.length).toBe(3)
    expect(p.after.warnings.length).toBe(2)
  })
  test('no change: nothing listed', () => {
    expect(staffingPreview(base(), base()).changed).toEqual([])
  })
})
