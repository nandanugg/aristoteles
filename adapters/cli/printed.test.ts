// The commands that the words print: cut into commands, and parsed into intents.
import { describe, expect, test } from 'bun:test'
import { commandsIn, intentOf } from './printed.ts'

describe('the commands that the words print', () => {
  test('a line is cut into its commands; a reject goes on with the review before it', () => {
    const line =
      '    work direction show d2; work review d2 accept [--reason="<a comment>"], or reject ' +
      '--reason="<why>"'
    expect(commandsIn(line)).toEqual([
      'work direction show d2',
      'work review d2 accept [--reason="<a comment>"]',
      'work review d2 reject --reason="<why>"',
    ])
  })

  test('each act command is the intent that the CLI builds; a read is none', () => {
    const words = (c: string) => c.split(' ')
    expect(intentOf(words('work assign t1 --role=architect'), '')).toEqual({
      _tag: 'Give',
      target: { task: 't1', role: 'architect' },
    } as never)
    expect(intentOf(words('work task split a1.k1 t1 --file=<parts.yaml> --review=v2'), 'a1'))
      .toEqual({ _tag: 'SplitTask', target: { task: 't1', answers: 'v2' } } as never)
    expect(intentOf(words('work direction show d2'), '')).toBeUndefined()
    expect(intentOf(words('work assign <task> --role=writer'), '')).toBeUndefined()
  })

})
