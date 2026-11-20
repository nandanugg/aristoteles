// The ITF reader on one stored trace.
import { describe, expect, test } from 'bun:test'
import { decode, picked, readTrace } from './itf.ts'
import { storeOf } from './model.ts'

const TRACE = `${import.meta.dir}/traces/coreTwo-0.itf.json.gz`

describe('decode', () => {
  test('bigints, sets, maps, variants, items and makers', () => {
    expect(decode({ '#bigint': '-1' })).toBe(-1)
    expect(decode({ '#set': [{ '#bigint': '2' }, { '#bigint': '1' }] })).toEqual([1, 2])
    const rule = { tag: 'ItemRule', value: { '#bigint': '1' } }
    expect(decode({ '#map': [[rule, { '#bigint': '0' }]] })).toEqual(new Map([['R1', 0]]))
    expect(decode({ tag: 'Host', value: { '#tup': [] } })).toBe('Host')
    expect(decode({ tag: 'ItemDirection', value: { '#tup': [] } })).toBe('D')
    expect(decode({ tag: 'Maker', value: { '#bigint': '1' } })).toBe('Maker(1)')
    // Some(empty set) is not a unit variant
    expect(picked(decode({ tag: 'Some', value: { '#set': [] } }))).toEqual([])
    expect(picked(decode({ tag: 'None', value: { '#tup': [] } }))).toBeNull()
  })
})

describe('a stored trace', () => {
  const trace = readTrace(TRACE)
  test('its states, instance, store and the steps taken', () => {
    expect(trace.instance).toBe('coreTwo')
    expect(trace.states.length).toBeGreaterThan(10)
    const first = storeOf(trace.states[0]!.store)
    expect([...first.tasks.keys()]).toEqual([0, 1])
    expect(first.tasks.get(0)?.state).toBe('Unsent')
    expect(trace.states[0]!.action).toBe('init')
    expect(trace.states[1]!.action).toBe('agentStep')
    const act = picked(trace.states[1]!.picks['act']) as { who: string }
    expect(act.who).toBe('Host')
  })
})
