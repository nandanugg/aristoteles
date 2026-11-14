// waitingFor over the scenario stores (BUILD.md D9, 4.5): its page kinds equal the old decisions
// of the page, and its cli kinds name the ids of the old rows of `work waiting` (both pinned in
// waiting.pins.json at the switch, 2026-11-14), or a finding explains the difference.
import { beforeAll, describe, expect, test } from 'bun:test'
import type { Work } from '../schema/index.ts'
import { type Derived, derive, SURFACES, type WaitingItem, waitingFor } from './index.ts'
import { momentOf, pinned, SCENARIOS, type Scenario } from './support.test.ts'
import { idOf } from './waiting.ts'

const pin = pinned(`${import.meta.dir}/waiting.pins.json`)

interface Built {
  readonly s: Scenario
  readonly w: Work
  readonly d: Derived
}
const built: Array<Built> = []
beforeAll(async () => {
  for (const [, make] of SCENARIOS) {
    const s = await make()
    const m = momentOf(s.p.dir, s.at)
    built.push({ s, w: m.work, d: derive(m) })
  }
}, 240000)

const EVERYONE = { _tag: 'Everyone' } as const
// The first id of the old row of an item.
const rowId = (i: WaitingItem): string =>
  i._tag === 'Stop' || i._tag === 'OutsideNeed' ? i.task : idOf(i)

describe('the page decisions are the page kinds of waitingFor', () => {
  test('the same kind, id, task and hold as decisionsOf, or C3 and C6 explain it', () => {
    const seen: Array<string> = []
    for (const { s, w, d } of built) {
      const old = pin<ReadonlyArray<ReadonlyArray<string | null>>>(s, 'decisionsOf')
      const now = waitingFor(d, EVERYONE)
        .filter((i) => SURFACES[i._tag].page !== 'None')
        .map((i) => [
          SURFACES[i._tag].page,
          idOf(i),
          i.placement._tag === 'OnTask' ? i.placement.task : null,
          'hold' in i ? i.hold._tag : 'Shown',
        ])
      for (const x of old) {
        if (now.some((y) => JSON.stringify(y) === JSON.stringify(x))) continue
        // C3: a problem of an ended task is Irrelevant; C6: a relayed act that waits for nothing.
        const [kind, id] = x
        if (kind === 'System') {
          const p = w.problems.get(id as never)
          expect(w.tasks.get(p?.stopped ?? ('' as never))?.end._tag).not.toBe('NotEnded')
          seen.push(`${s.name}: C3: ${id}`)
        } else if (kind === 'Confirm') {
          expect(d.states.forwards.get(id as never)?._tag).toBe('Irrelevant')
          seen.push(`${s.name}: C6: ${id}`)
        } else expect([s.name, x]).toEqual([s.name, 'an old decision that is gone'])
      }
      for (const y of now) {
        expect([s.name, old.some((x) => JSON.stringify(x) === JSON.stringify(y)), y]).toEqual([
          s.name,
          true,
          y,
        ])
      }
    }
    expect(seen).toContain('uiRunRemade: C3: sp1')
  })
})

describe('the rows of work waiting are the cli kinds of waitingFor', () => {
  test('each old row names an item and each item an old row, or C2 explains it', () => {
    for (const { s, w, d } of built) {
      const rows = pin<ReadonlyArray<string>>(s, 'renderWaiting')
      const lines = rows.filter((l) => !l.startsWith(' '))
      const old = lines.filter((l) => !l.startsWith('nothing waits')).map((l) => l.split(' ')[0])
      const items = waitingFor(d, EVERYONE).filter((i) => SURFACES[i._tag].cli)
      // Ruling 10.6: the problems and the ends are rows now; the old list had none.
      const now = items.filter((i) => i._tag !== 'Problem' && i._tag !== 'RunEnd').map(rowId)
      for (const id of old) {
        if (now.includes(id ?? '')) continue
        // C2: a question of an ended task is Irrelevant (uiRunRemade's q1 to the host of t1).
        const q = w.questions.get(id as never)
        expect([s.name, id, q !== undefined && d.states.questions.get(q.id)?._tag]).toEqual([
          s.name,
          id,
          'Irrelevant',
        ])
      }
      for (const id of now) expect([s.name, id, old.includes(id)]).toEqual([s.name, id, true])
    }
  })
})

describe('one waiting list (ruling 10.6)', () => {
  test('work waiting shows the system problems and the ends, as the page does', () => {
    for (const { d } of built) {
      const page = waitingFor(d, EVERYONE).filter((i) => SURFACES[i._tag].page !== 'None')
      expect(page.every((i) => SURFACES[i._tag].cli)).toBe(true)
    }
    const ui = built.find((b) => b.s.name === 'uiRun')
    const kinds = waitingFor(ui?.d as Derived, EVERYONE).map((i) => i._tag)
    expect(kinds).toContain('Problem')
  })
})

describe('waitingFor for one person (B7)', () => {
  test('keeps only the items that wait for that person', () => {
    const ui = built.find((b) => b.s.name === 'uiRun')
    if (ui === undefined) throw new Error('no uiRun')
    const all = waitingFor(ui.d, EVERYONE)
    const nanda = waitingFor(ui.d, { _tag: 'Person', name: 'Nanda' })
    expect(nanda.length).toBeLessThan(all.length)
    expect(nanda.every((i) => i.for._tag === 'Person' && i.for.name === 'Nanda')).toBe(true)
    expect(waitingFor(ui.d, { _tag: 'Person', name: 'Someone' })).toEqual([])
  })
})
