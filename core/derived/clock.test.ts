// F4: the next clock edge (clock.ts) is the time of the reader of each state that the clock
// alone changes: the end of a hold for the host's words, the end of a permission.
import { expect, test } from 'bun:test'
import { derivedOf, h, ok, solToken, workOf } from '../actions/fixture.test.ts'
import type { Time } from '../schema/index.ts'
import { nextChangeAt, waitingFor } from './index.ts'

const plus = (at: string, ms: number) => new Date(Date.parse(at) + ms).toISOString() as Time

test('a hold ends at its until; a permission ends 1 ms after its until', async () => {
  const p = h.project({ 'top.yaml': `${h.TASK_WHOLE}role: architect\n` })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', h.HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out)
  ok(await p.agent(`brief ${host}`))
  p.write('change.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
  ok(await p.agent('direction revise tsd-writing --file=change.yaml --by=assess --why="Shorten"'))
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

  // A permission that ends before the hold: its end is the next edge.
  const ends = plus(p.now(), 3 * 60000)
  ok(await p.nanda(`grant --act=change --on=t1 --to=architect --until=${ends}`, 'grant'))
  expect(nextChangeAt(at(p.now() as Time))).toBe(plus(ends, 1))
}, 60000)
