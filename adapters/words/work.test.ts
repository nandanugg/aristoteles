// The words of the work steps on states built by initState and take.
import { expect, test } from 'bun:test'
import { dos } from '../../core/derived/c16/obligations.ts'
import type { Recorded } from '../../core/schema/index.ts'
import { take } from '../../core/state/c16/effect.ts'
import { epochOf, vsum } from '../../core/state/c16/reads.ts'
import { initState, type WorkState } from '../../core/state/c16/state.ts'
import type { Act, Actor, Body, Step } from '../../core/state/c16/types.ts'
const HOST = { _tag: 'Host' } as const
const PERSON = { _tag: 'Human' } as const
const PIPE = { _tag: 'Pipe' } as const
const makerActor = (id: string): Actor => ({ _tag: 'Maker', id })
const roleActor = (name: string): Actor => ({ _tag: 'Role', name })
import { briefOf, pointsOf, stepLine, stepWords } from './work.ts'

const rec = (over: object) => ({
  kind: 'dir' as const,
  parent: null,
  name: 'n',
  says: 's',
  where: null,
  test: null,
  ref: null,
  form: 'none' as const,
  examples: [],
  ...over,
})
const start = (): WorkState =>
  initState(
    { name: 't', goal: 'g', sections: ['a'], facts: {}, directions: ['d1'] },
    new Map([
      ['dir:d1', rec({ name: 'Plain', says: 'write plainly' })],
      ['std:s1', rec({ kind: 'std', parent: 'dir:d1', name: 'Short' })],
      ['rule:r1', rec({ kind: 'rule', parent: 'std:s1', form: 'mech', test: 'lint x' })],
    ]),
    new Map([['writer', { role: 'writer', words: 'w', model: 'm' }]]),
    2,
  )

// A run that keeps the acts as the events of a log.
const run = () => {
  let s = start()
  const events: Recorded[] = [{
    seq: 1, event: { _tag: 'Work', create: { _tag: 'Opened', top: s.top,
      items: [...s.items], cards: [...s.cards], maxTries: s.maxTries, tokens: [] } },
  } as never]
  const go = (who: Actor, body: Body, over: Partial<Act> = {}): WorkState => {
    const act: Act = {
      id: `a${events.length}`,
      who,
      ep: epochOf(s, who),
      body,
      seen: -1,
      seenVer: vsum(s),
      vers: s.ver,
      old: false,
      ...over,
    }
    s = take(s, act)
    const create = { _tag: 'Acted', act, token: null }
    events.push({ seq: events.length + 1, event: { _tag: 'Work', create } } as never)
    return s
  }
  return { go, events, get s() { return s } }
}
const find = (s: WorkState, kind: 'Execute' | 'Check') => [...s.asks.values()].find((a) =>
  a.kind === kind && (kind !== 'Execute' || a.to._tag === 'Maker'))!.id
const step = (act: Body['_tag'], task: string | null = null): Step =>
  ({ act, task, ask: null, fix: null, maker: null, actor: null })
const W = roleActor('writer')
const report = (s: WorkState, output: string): Body => ({
  _tag: 'Report',
  ask: find(s, 'Execute'),
  output,
  files: [],
  caught: new Set(),
})
const review = (s: WorkState, points: string[], verdict: 'Fail' | 'RaiseNoRule' = 'Fail'): Body => ({
  _tag: 'Review',
  ask: find(s, 'Check'),
  verdict,
  points,
})
const spec = { name: 'n', goal: 'say it', sections: ['a'], facts: {}, role: 'writer' }

const toReview = () => {
  const r = run()
  r.go(HOST, { _tag: 'Open', open: { _tag: 'OpenSend', spec } })
  r.go(W, { _tag: 'Open', open: { _tag: 'OpenMake', task: 't1' } })
  r.go(makerActor('m1'), { _tag: 'ReadBrief', maker: 'm1' })
  r.go(makerActor('m1'), report(r.s, 'line\n'.repeat(24) + 'end'))
  return r
}

test('basis is present on the commands that require it', () => {
  const r = toReview()
  for (const act of [
    'Review', 'RecheckDone', 'Report', 'Respond', 'Evaluate', 'Advance', 'WriteRule', 'RunTest',
    'Ship', 'LoopReview',
  ] as const) expect(stepLine(r.s, step(act, 't1'), 7)).toContain(' --on 7')
  expect(stepLine(r.s, step('Hear'), 7)).not.toContain('--on')
})

test('the steps of dos have a line and words', () => {
  const r = run()
  const seen = new Set<Body['_tag']>()
  const check = (s: WorkState, who: Actor) =>
    dos(s, who).forEach((x: Step) => {
      seen.add(x.act)
      expect(stepLine(s, x, s.seq)).not.toBe('')
      expect(stepWords(s, x, r.events).length).toBeGreaterThanOrEqual(1)
    })
  check(r.s, HOST)
  r.go(HOST, { _tag: 'Open', open: { _tag: 'OpenSend', spec } })
  check(r.s, W)
  r.go(W, { _tag: 'Open', open: { _tag: 'OpenMake', task: 't1' } })
  check(r.s, makerActor('m1'))
  r.go(makerActor('m1'), { _tag: 'ReadBrief', maker: 'm1' })
  check(r.s, makerActor('m1'))
  r.go(makerActor('m1'), report(r.s, 'ok'))
  check(r.s, W)
  r.go(W, review(r.s, ['one'], 'RaiseNoRule'))
  check(r.s, PIPE)
  r.go(PIPE, {
    _tag: 'Evaluate', fix: 't1', level: 'Direct', parts: [], roleDraft: null, summary: 'why',
  })
  check(r.s, PIPE)
  expect([...seen]).toEqual(
    ['Open', 'ReadBrief', 'Report', 'Review', 'Evaluate', 'Advance'],
  )
})

test('Review shows 20 lines of the output and the count of the rest', () => {
  const r = toReview()
  const words = stepWords(r.s, step('Review', 't1'), r.events)
  expect(words.filter((l) => l.trim() === 'line')).toHaveLength(20)
  expect(words).toContain('  ... and 5 more lines')
  expect(words.join('\n')).toContain('Try 1 of 2')
  expect(words.join('\n')).toContain('rule "n"')
})

test('Evaluate names the reason, the points and the floor', () => {
  const r = toReview()
  r.go(W, review(r.s, ['too long'], 'RaiseNoRule'))
  const text = stepWords(r.s, step('Evaluate', 't1'), r.events).join('\n')
  expect(text).toContain('no rule says what is wrong')
  expect(text).toContain('too long')
  expect(text).toContain('Split')
})

test('the brief carries every earlier point, newest last, and the report command', () => {
  const r = toReview()
  r.go(W, review(r.s, ['first', 'second']))
  r.go(makerActor('m1'), report(r.s, 'again'))
  r.go(W, review(r.s, ['third']))
  expect(pointsOf(r.events, 't1')).toEqual(['first', 'second', 'third'])
  expect(pointsOf(r.events, 't2')).toEqual([])
  const brief = briefOf(r.s, r.events, 'm1')
  const text = brief.join('\n')
  expect(text.indexOf('1. first')).toBeLessThan(text.indexOf('3. third'))
  expect(text).toContain('Goal: say it')
  expect(text).toContain('direction "Plain" (version 0): write plainly')
  expect(text).toContain('a test command: lint x')
  expect(brief.at(-1)).toContain(`--output="<...>" --on ${r.s.seq}`)
  expect(briefOf(r.s, r.events, 'm9')).toEqual(['There is no maker m9.'])
})

test('the person hears a fix and a question', () => {
  const r = toReview()
  expect(dos(r.s, PERSON)).toEqual([])
  r.go(W, { _tag: 'Open', open: { _tag: 'OpenQuestion', to: PERSON,
    question: { title: 'which year?', form: { _tag: 'Single' } } } })
  const [x] = dos(r.s, PERSON)
  expect(x?.act).toBe('AnswerQuestion')
  expect(stepWords(r.s, x!, r.events).join(' ')).toContain('which year?')
  expect(stepLine(r.s, x!, 3)).toContain(`work answer <token> ${x?.ask}`)
})
