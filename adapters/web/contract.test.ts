// P5 T5: the page decodes the id of each decision once, at the fetch; a held decision and a hope
// off a draft have no place on the wire.
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { Decision } from './contract.ts'

const decode = Schema.decodeUnknownExit(Decision)
const base = { task: 't1', text: 'x', words: null, at: '2026-11-15T00:00:00.000Z', acts: [], waits: null }

describe('a decision on the wire', () => {
  test('a system problem names a problem, and decodes to its branded id', () => {
    const got = Schema.decodeUnknownSync(Decision)({ kind: 'system', id: 'sp1', stopped: 't1', ...base })
    expect(got).toMatchObject({ _tag: 'System', id: 'sp1' })
  })

  test('a system problem whose id is a draft does not decode', () => {
    expect(decode({ kind: 'system', id: 'd9', stopped: 't1', ...base })._tag).toBe('Failure')
  })

  test('the end names the top task that a reject reopens', () => {
    expect(decode({ kind: 'end', id: 'h1', ...base })._tag).toBe('Failure')
    expect(decode({ kind: 'end', id: 'h1', top: 't1', ...base })._tag).toBe('Success')
  })
})
