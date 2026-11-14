// Ruling 10.8: the page knows the person only by git user.name. It shows only that person's
// items, with no show-all fallback; a name that is no person of the dir sees no items, and one
// plain line that says which name to set (GET /api/person).
import { beforeAll, describe, expect, test } from 'bun:test'
import { type Derived, derive } from '../../core/derived/index.ts'
import { momentOf, SCENARIOS } from '../../core/derived/support.test.ts'
import { decisionsOf, personView } from './view.ts'

let d: Derived
beforeAll(async () => {
  const make = SCENARIOS.find(([name]) => name === 'uiRun')?.[1]
  if (make === undefined) throw new Error('no uiRun scenario')
  const s = await make()
  d = derive(momentOf(s.p.dir, s.at))
}, 120000)

describe('the person of the page (ruling 10.8)', () => {
  test('a person of the dir sees their own items', () => {
    const items = decisionsOf(d, 'Nanda')
    expect(items.length).toBeGreaterThan(0)
  })

  test('a name outside the people sees no items: no show-all fallback', () => {
    expect(decisionsOf(d, 'nandanugg')).toEqual([])
    expect(decisionsOf(d, '')).toEqual([])
  })

  test('one plain line says which name to set', () => {
    expect(personView(['Nanda'], 'Nanda')).toEqual({ name: 'Nanda', known: true, line: null })
    expect(personView(['Nanda'], 'nandanugg').line).toBe(
      'The page shows the items of the person that git names; git user.name is "nandanugg", ' +
        'and that is no person of this dir. Set it: git config user.name "Nanda"',
    )
    expect(personView(['Nanda', 'Budi'], '').line).toBe(
      'The page shows the items of the person that git names; git user.name is not set, and ' +
        'that is no person of this dir. Set your name, one of Nanda, Budi: ' +
        'git config user.name "<your name>"',
    )
  })
})
