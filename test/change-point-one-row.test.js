// Live, 2026-11-16: a point that an open draft answered still showed as needing a change, and
// each point showed once for each direction of its task. A point needs one change.
import { describe, expect, test } from 'bun:test'
import { ok, ONBOARD_NEW, reported, TASK, tokenIn } from './harness.js'

const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
const POINTS = '--point="no cost" --point="no merchant name"'
const changeRows = (out) => out.split('\n').filter((l) => l.includes('a change of'))

// The person rejects r1 with two points, and evaluates the stop at a level.
const rejected = async (files, level) => {
  const s = await reported(files)
  ok(await s.p.agent(`review ${s.lead} r1 accept ${REPEATABLE}`))
  const out = ok(await s.p.nanda(`review r1 reject ${POINTS}`)).out
  const v = out.match(/^(v\d+): reject/)[1]
  ok(await s.p.nanda('evaluate t1 --wrong="r1 names no cost" --why="no standard asks for it" ' +
    `--improve="a rule for the cost" --level=${level}`))
  return { ...s, v }
}

// t1 follows two directions; a change of either answers a point.
const TWO = {
  'directions/one-thing.yaml': ONBOARD_NEW.replace('name: One', 'owner: Nanda\nname: One'),
  'task.yaml': TASK.replace('[tsd-writing]', '[tsd-writing, one-thing]'),
}

describe('a change point', () => {
  test('a draft that answers the review answers each of its points', async () => {
    const { p, v } = await rejected(TWO, 'standard')
    expect(changeRows(ok(await p.agent('waiting --for=Nanda')).out)).toHaveLength(1)
    ok(await p.nanda('grant --act=change --on=tsd-writing,t1 --to=architect ' +
      '--until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('cost.yaml', 'add:\n  - id: cost\n    where: { section: introduction }\n' +
      '    says: The introduction names the cost.\n    rules:\n' +
      '      - { id: says-cost, says: "The introduction names the cost", checkedBy: linter }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=cost.yaml --answers=${v} ` +
      '--why="Correct the standard"'))
    const out = ok(await p.agent('waiting --for=Nanda')).out
    expect(changeRows(out).filter((l) => l.includes(`${v}.`))).toEqual([])
  }, 30000)

  test('a point of a task with two directions shows once', async () => {
    const { p, v } = await rejected(TWO, 'standard')
    expect(changeRows(ok(await p.agent('waiting --for=Nanda')).out)).toEqual([
      `${v}.1, ${v}.2 need a change of a direction of t1 (tsd-writing, one-thing); ` +
        'a role that directs drafts it, or you suggest it',
    ])
  }, 30000)

  test('a point evaluated at the level task needs no direction change', async () => {
    const { p } = await rejected(TWO, 'task')
    expect(changeRows(ok(await p.agent('waiting --for=Nanda')).out)).toEqual([])
  }, 30000)
})
