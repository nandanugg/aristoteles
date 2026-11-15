// Invariant P3 over the scenario stores: every command that work waiting and work next print
// parses to an intent that canAct allows.
import { describe, expect, test } from 'bun:test'
import { derive } from '../../core/derived/index.ts'
import { momentOf, SCENARIOS } from '../../core/derived/support.test.ts'
import { commandsIn, intentOf, printedCommands, printedViolations } from './printed.ts'

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

  test('in every scenario, canAct allows each printed command', async () => {
    let checked = 0
    for (const [name, make] of SCENARIOS) {
      const s = await make()
      const d = derive(momentOf(s.p.dir, s.at))
      const people = d.moment.work.config.people
      expect([name, printedViolations(d, people)]).toEqual([name, []])
      checked += printedCommands(d, people).length
    }
    expect(checked).toBeGreaterThan(10)
  }, 240000)
})
