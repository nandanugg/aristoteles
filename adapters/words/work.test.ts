// The words of the work steps on states built by initState and take.
import { expect, test } from 'bun:test'
import { dirBased } from '../../core/derived/work/accept.ts'
import { dos } from '../../core/derived/work/obligations.ts'
import type { Step } from '../../core/derived/work/obligations.ts'
import type { Recorded } from '../../core/schema/index.ts'
import { take } from '../../core/state/work/effect.ts'
import { vsum } from '../../core/state/work/items.ts'
import { epOf, initState } from '../../core/state/work/reads.ts'
import type { Act, Actor, What, WhatTag, WorkState } from '../../core/state/work/types.ts'
import { HOST, PERSON, PIPE, makerActor, roleActor } from '../../core/state/work/types.ts'
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
    { name: 't', goal: 'g', sections: ['a'], directions: ['d1'] },
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
  const events: Recorded[] = []
  const go = (who: Actor, what: What, over: Partial<Act> = {}): WorkState => {
    const act: Act = {
      id: `a${events.length}`,
      who,
      ep: epOf(s, who),
      what,
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
const W = roleActor('writer')
const report = (output: string): What => ({
  _tag: 'Report',
  maker: 'm1',
  output,
  caught: new Set(),
})
const review = (points: string[], v: 'Fail' | 'RaiseNoRule' = 'Fail'): What => ({
  _tag: 'Review',
  task: 't1',
  v,
  points,
})
const spec = { name: 'n', goal: 'say it', sections: ['a'], role: 'writer' }

const toReview = () => {
  const r = run()
  r.go(HOST, { _tag: 'SendTask', spec })
  r.go(W, { _tag: 'AssignDo', task: 't1' })
  r.go(makerActor('m1'), { _tag: 'ReadBrief', maker: 'm1' })
  r.go(makerActor('m1'), report('line\n'.repeat(24) + 'end'))
  return r
}

const BASED: ReadonlySet<WhatTag> = new Set([
  'Review', 'Reject', 'RecheckDone', 'Report', 'Accept', 'SendBack', 'Decide', 'Evaluate',
  'Advance', 'WriteRule', 'RunTest', 'Ship', 'LoopReview',
])
const TAGS: Readonly<Record<WhatTag, true>> = {
  EndProject: true, MoveHost: true, EditDirection: true, Reject: true, Accept: true,
  SendBack: true, Decide: true, Answer: true, SendTask: true, Reassign: true, TopDone: true,
  AssignDo: true, Review: true, Resume: true, ReadBrief: true, Ask: true, Report: true,
  Evaluate: true, Advance: true, WriteRule: true, RunTest: true, Ship: true, LoopReview: true,
  RecheckDone: true, RunRule: true, Revive: true, Exit: true,
}

test('a line for every tag; --on exactly for the based acts', () => {
  const r = toReview()
  for (const tag of Object.keys(TAGS) as WhatTag[]) {
    const line = stepLine(r.s, { tag, target: 't1' }, 7)
    expect(line.includes(' --on 7')).toBe(BASED.has(tag))
  }
  expect(dirBased({ _tag: 'Review', task: 't1', v: 'Pass', points: [] })).toBe(true)
})

test('the steps of dos have a line and words', () => {
  const r = run()
  const seen = new Set<WhatTag>()
  const check = (s: WorkState, who: Actor) =>
    dos(s, who).forEach((x: Step) => {
      seen.add(x.tag)
      expect(stepLine(s, x, s.seq)).not.toBe('')
      expect(stepWords(s, x, r.events).length).toBeGreaterThanOrEqual(2)
    })
  check(r.s, HOST)
  r.go(HOST, { _tag: 'SendTask', spec })
  check(r.s, W)
  r.go(W, { _tag: 'AssignDo', task: 't1' })
  check(r.s, makerActor('m1'))
  r.go(makerActor('m1'), { _tag: 'ReadBrief', maker: 'm1' })
  check(r.s, makerActor('m1'))
  r.go(makerActor('m1'), report('ok'))
  check(r.s, W)
  r.go(W, review(['one'], 'RaiseNoRule'))
  check(r.s, PIPE)
  r.go(PIPE, {
    _tag: 'Evaluate', task: 't1', level: 'Direct', parts: [], roleDraft: null, summary: 'why',
  })
  check(r.s, PIPE)
  expect([...seen]).toEqual(
    ['SendTask', 'AssignDo', 'ReadBrief', 'Report', 'Review', 'Evaluate', 'Advance'],
  )
})

test('Review shows 20 lines of the output and the count of the rest', () => {
  const r = toReview()
  const words = stepWords(r.s, { tag: 'Review', target: 't1' }, r.events)
  expect(words.filter((l) => l.trim() === 'line')).toHaveLength(20)
  expect(words).toContain('  ... and 5 more lines')
  expect(words.join('\n')).toContain('Try 1 of 2')
  expect(words.join('\n')).toContain('rule "n"')
})

test('Evaluate names the reason, the points and the floor', () => {
  const r = toReview()
  r.go(W, review(['too long'], 'RaiseNoRule'))
  const text = stepWords(r.s, { tag: 'Evaluate', target: 't1' }, r.events).join('\n')
  expect(text).toContain('no rule says what is wrong')
  expect(text).toContain('too long')
  expect(text).toContain('Split')
})

test('the brief carries every earlier point, newest last, and the report command', () => {
  const r = toReview()
  r.go(W, review(['first', 'second']))
  r.go(makerActor('m1'), report('again'))
  r.go(W, review(['third']))
  expect(pointsOf(r.events, 't1')).toEqual(['first', 'second', 'third'])
  expect(pointsOf(r.events, 't2')).toEqual([])
  const brief = briefOf(r.s, r.events, 'm1')
  const text = brief.join('\n')
  expect(text.indexOf('1. first')).toBeLessThan(text.indexOf('3. third'))
  expect(text).toContain('Goal: say it')
  expect(text).toContain('direction "Plain" (version 0): write plainly')
  expect(text).toContain('a test command: lint x')
  expect(brief.at(-1)).toContain(`work report <token> --output="<...>" --on ${r.s.seq}`)
  expect(briefOf(r.s, r.events, 'm9')).toEqual(['There is no maker m9.'])
})

test('the person hears a fix and a question', () => {
  const r = toReview()
  expect(dos(r.s, PERSON)).toEqual([])
  r.go(W, { _tag: 'Ask', asker: W, question: 'which year?' })
  const [x] = dos(r.s, PERSON)
  expect(x).toEqual({ tag: 'Answer', target: W })
  expect(stepWords(r.s, x as Step, r.events)).toContain('  which year?')
  expect(stepLine(r.s, x as Step, 3)).toBe(`work answer ${W} --text="<...>"`)
})
