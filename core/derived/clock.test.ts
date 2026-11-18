// F4: the next clock edge (clock.ts) is the time of the reader of each state that the clock
// alone changes: the end of a hold for the host's words, the end of a permission.
import { expect, test } from 'bun:test'
import { derivedOf, h, ok, solToken, workOf } from '../actions/fixture.test.ts'
import type { RunId, RunState, Time } from '../schema/index.ts'
import { nextChangeAt, waitingFor } from './index.ts'
import { allItems } from './waiting.ts'

const plus = (at: string, ms: number) => new Date(Date.parse(at) + ms).toISOString() as Time

test('a hold ends at its until', async () => {
  const p = h.project({ 'top.yaml': `${h.TASK_WHOLE}role: architect\n` })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', h.HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out)
  ok(await p.agent(`brief ${host}`))
  // A draft that answers a point of t1 waits for the words of t1's host (P8).
  const rejected = ok(await p.nanda('review t1 reject --point="the rules are too long"')).out
  const point = `${rejected.match(/\b(v\d+)\b/)?.[1] ?? ''}.1`
  await (h as unknown as { evaluated: (p: unknown, t: string) => Promise<unknown> }).evaluated(p, 't1')
  p.write('change.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
  const why = `--why="Shorten" --answers=${point}`
  ok(await p.agent(`direction revise tsd-writing --file=change.yaml --by=assess ${why}`))
  const at = (when: Time) => derivedOf(workOf(p.dir), when, p.dir)
  const held = () => {
    const [item] = waitingFor(at(p.now() as Time), { _tag: 'Everyone' }).filter(
      (i) => i._tag === 'DraftForPerson',
    )
    return item?.hold._tag === 'HeldForHost' ? item.hold.until : null
  }
  const until = held()
  expect(until).not.toBeNull()
  expect(nextChangeAt(at(p.now() as Time))).toBe(until)
  // At the edge the hold has ended: the next edge is a later one (the end of a grant of 30 days
  // that the open of the task gave).
  const after = nextChangeAt(at(until as Time))
  expect(Date.parse(after ?? '')).toBeGreaterThan(Date.parse(until ?? ''))
}, 60000)

// A RunEnd hold counts from the time since which its run waits for the end (RunState), a stored
// time: it ends. It counted from now when the top task had no result, and so never ended.
test('the hold of the end of a project ends', async () => {
  const p = h.project({ 'top.yaml': `${h.TASK_WHOLE}role: architect\n` })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', h.HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out)
  ok(await p.agent(`brief ${host}`))
  const since = p.now() as Time
  const endAt = (at: Time) => {
    const d = derivedOf(workOf(p.dir), at, p.dir)
    const run = { _tag: 'AwaitingEndAccept', top: 't1', since } as unknown as RunState
    const runs = new Map(d.states.runs).set('h1' as RunId, run)
    const [end] = allItems({ ...d, states: { ...d.states, runs } }).filter(
      (i) => i._tag === 'RunEnd',
    )
    return end?._tag === 'RunEnd' ? end.hold : undefined
  }
  expect(endAt(plus(since, 60000))).toEqual({ _tag: 'HeldForHost', until: plus(since, 600000) })
  expect(endAt(plus(since, 600000))).toEqual({ _tag: 'Shown' })
}, 60000)
