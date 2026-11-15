// The session of a launch command is a UUID (Nanda, 2026-11-15: Claude Code refused s-<token>).
import { describe, expect, test } from 'bun:test'
import { cliSession, fill } from './lines.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('the session of a command', () => {
  test('an id that is no UUID maps to the same UUID each time', () => {
    const one = cliSession('s-aj3zfuu3xs8uftc5zqmg55d5xi')
    expect(one).toMatch(UUID)
    expect(cliSession('s-aj3zfuu3xs8uftc5zqmg55d5xi')).toBe(one)
    expect(cliSession('s-other')).not.toBe(one)
  })
  test('a UUID stays as it is', () => {
    const id = '6f1c2b1e-1111-4aaa-8bbb-123456789abc'
    expect(cliSession(id)).toBe(id)
  })
  test('a launch and its resume name one session', () => {
    const launch = fill('tool --session-id {session}', { session: 's-x' })
    const resume = fill('tool --resume {session}', { session: 's-x' })
    expect(launch.split(' ')[2]).toBe(resume.split(' ')[2])
    expect(launch.split(' ')[2]).toMatch(UUID)
  })
})
