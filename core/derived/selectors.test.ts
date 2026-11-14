// The selectors of the effects over the UI scenario stores (BUILD.md 3.7): they read RunState and
// AssignmentState, so the end of t1 (a remake) ends what the watcher does for it: C1 (close the
// terminal of an ended agent), C5 (no typing of an irrelevant send), S1 (the host's pane of a
// live run only). Under ruling 10.1 the wakes, the problem retries and the asks for words are
// steps of nextFor (core/effects/findings.test.ts).
import { beforeAll, describe, expect, test } from 'bun:test'
import type { Time } from '../../src/domain/ids.ts'
import type { Moment } from '../state/index.ts'
import {
  type Derived,
  derive,
  hostPanesOf,
  sendsPending,
  terminalsToClose,
  terminalsToStart,
  terminalsToWatch,
} from './index.ts'
import { momentOf, SCENARIOS } from './support.test.ts'

const LIVE = { live: true, ended: false, exit: null, lastOutput: 0 }
const derived = new Map<string, Derived>()
// The pump sees the host's pane and the lead's terminal; the clock is an hour after the acts.
const later = (m: Moment): Moment => ({
  ...m,
  at: new Date(Date.parse(m.at) + 3600000).toISOString() as Time,
  outside: { ...m.outside, terminals: { 'host-k0001': LIVE, 's-a2': LIVE } },
})
beforeAll(async () => {
  for (const [name, make] of SCENARIOS) {
    if (!['uiRun', 'uiRunRemade', 'relay'].includes(name)) continue
    const s = await make()
    derived.set(name, derive(later(momentOf(s.p.dir, s.at))))
  }
}, 240000)
// The ids as plain words, to compare with literals.
const plain = (x: unknown): unknown => x
const of = (name: string): Derived => {
  const d = derived.get(name)
  if (d === undefined) throw new Error(`no scenario ${name}`)
  return d
}

describe('the selectors of the effects', () => {
  test('HostPanes: the pane of the live run; RunState, not run.end (S1)', () => {
    expect(plain(hostPanesOf(of('uiRun')).map((h) => [h.run, h.session, h.pane]))).toEqual([
      ['h1', 'host-k0001', '%9'],
    ])
    // The remake keeps the run: its top task is t2 now, open, so the run is live.
    expect(plain(hostPanesOf(of('uiRunRemade')).map((h) => h.run))).toEqual(['h1'])
  })

  test('StartTerminals: no Ended agent starts (C1); one that briefed starts not again', () => {
    expect(terminalsToStart(of('uiRun'))).toEqual([])
    expect(terminalsToStart(of('uiRunRemade'))).toEqual([])
  })

  test("CloseEnded: the terminal of an agent that t1's end ended, once (C1)", () => {
    expect(terminalsToClose(of('uiRun'))).toEqual([])
    expect(plain(terminalsToClose(of('uiRunRemade')))).toEqual([
      { session: 's-a2', owner: { _tag: 'Agent', assignment: 'a2' } },
    ])
  })

  test('RetryFailures: the live run and its open agents; not an Ended agent (C1)', () => {
    const owners = (name: string) => terminalsToWatch(of(name)).map((t) => t.session)
    expect(plain(owners('uiRun'))).toEqual(['host-k0001', 's-a2'])
    expect(plain(owners('uiRunRemade'))).toEqual(['host-k0001'])
  })

  test('DeliverSends: the host sends to the lead; irrelevant after the lead ended (C5)', () => {
    // The one send of the scenario; its event number depends on the tree (ruling 10.1: the
    // host's work wait writes the start of its Sol).
    const sent = of('uiRun').moment.work.sends.map((s) => s.id)
    expect(sent.length).toBe(1)
    expect(plain(sendsPending(of('uiRun')))).toEqual([{ send: sent[0], to: 's-a2' }])
    expect(sendsPending(of('uiRunRemade'))).toEqual([])
  })
})
