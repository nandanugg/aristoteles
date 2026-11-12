// The argument parse: the words, the flags in order, and the words that look like a flag.
import { describe, expect, test } from 'bun:test'
import { ACT_OF, FLAGS, knownFlags, parseArgs, SWITCHES, TOKEN_AFTER_ACT, USAGE, withoutName } from './args.ts'
import { makeDir, runNew } from './fixture.ts'

describe('parseArgs', () => {
  test('splits words, flags and broken words, in order', () => {
    const args = parseArgs(['review', 'r1', 'reject', '--point=a', '--breaks=x', '--max_attempts=1', '-v'])
    expect(args.positional).toEqual(['review', 'r1', 'reject', '-v'])
    expect(args.flags).toEqual([
      ['point', 'a'],
      ['breaks', 'x'],
    ])
    expect(args.broken).toEqual(['--max_attempts=1'])
  })

  test('a flag with no value is true, with an empty value is empty', () => {
    const args = parseArgs(['--dry-run', '--text='])
    expect(args.one('dry-run')).toBe(true)
    expect(args.one('text')).toBe('')
  })

  test('the value may hold an equals sign and a newline', () => {
    const args = parseArgs(['--reason=a=b\nc'])
    expect(args.one('reason')).toBe('a=b\nc')
  })

  test('one gives the last value, all gives every value', () => {
    const args = parseArgs(['--evidence=a', '--point=p', '--evidence=b'])
    expect(args.one('evidence')).toBe('b')
    expect(args.all('evidence')).toEqual(['a', 'b'])
    expect(args.one('missing')).toBeUndefined()
    expect(args.all('missing')).toEqual([])
  })

  test('a flag name is lower-case letters and dashes only', () => {
    expect(parseArgs(['--Reason=x', '--r1=x', '--a_b']).broken).toEqual(['--Reason=x', '--r1=x', '--a_b'])
  })

  test('withoutName takes the command off the front and keeps the flags', () => {
    const args = withoutName(parseArgs(['task', 'open', '--file=x']))
    expect(args.positional).toEqual(['open'])
    expect(args.one('file')).toBe('x')
  })
})

describe('the tables of the old CLI', () => {
  test('the act word of each command that has several acts', () => {
    expect(ACT_OF.task?.(['split', 't1'])).toBe('split')
    expect(ACT_OF.review?.(['a1.k', 'r1', 'accept'])).toBe('accept')
    expect(ACT_OF.review?.(['r1'])).toBeUndefined()
    expect(ACT_OF.forward?.(['a1.k', 'x', 'reject'])).toBe('reject')
    expect(ACT_OF.forward?.(['a1.k', 'x', 'resolve'])).toBe('resolve')
  })

  test('the flags that a command reads, by act', () => {
    expect(knownFlags('assign', undefined)).toEqual(['dry-run', 'max-attempts', 'role'])
    expect(knownFlags('task', 'show')).toEqual([])
    expect(knownFlags('task', 'nope')).toBeUndefined()
    expect(knownFlags('task', undefined)).toBeUndefined()
    expect(knownFlags('status', undefined)).toBeUndefined()
    expect(knownFlags('constructor', undefined)).toBeUndefined()
    expect(Object.hasOwn(FLAGS, 'status')).toBe(false)
  })

  test('only a switch stands alone, and the token sits after the act word of five commands', () => {
    expect(SWITCHES).toEqual(['dry-run', 'token', 'fixed'])
    expect(TOKEN_AFTER_ACT).toEqual(['task', 'direction', 'role', 'evaluation', 'run'])
  })
})

describe('the usage text', () => {
  test('work help and work with no words print the usage', async () => {
    const dir = makeDir()
    for (const argv of [[], ['help'], ['help', 'status']]) {
      const result = await runNew(dir, argv)
      expect(result.code).toBe(0)
      expect(result.out).toBe(USAGE.join('\n'))
    }
  })
})
