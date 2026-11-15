// The selectors of the effects over the UI scenario stores (BUILD.md 3.7): they read RunState and
// AgentState. Only a persistent agent has a terminal (ruling 7), and it lives to the end of its
// project (ruling 9): the end of t1 (a remake) leaves the lead's agent Between, and only the end
// of the run closes its terminal (C1). C5: no typing of an irrelevant send; S1: the host's pane
// of a live run only. Under ruling 10.1 the wakes, the problem retries and the asks for words
// are steps of nextFor (core/effects/findings.test.ts).
import { beforeAll, describe, expect, test } from 'bun:test'
import type { SessionId, Time } from '../../src/domain/ids.ts'
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

const LIVE = { _tag: 'Live', lastOutput: 0 } as const
const derived = new Map<string, Derived>()
// The scenario gives the lead a2 the session s-a2 by hand (work session); here the supervisor has
// started the terminal of its agent p1 there (Agent.Started), as it does for a persistent role.
const withAgentTerminal = (m: Moment): Moment => {
  const agents = new Map(
    [...m.work.agents].map(([id, x]) => [
      id,
      { ...x, terminal: { _tag: 'Started' as const, session: 's-a2' as SessionId, at: m.at } },
    ]),
  )
  return { ...m, work: { ...m.work, agents } }
}
// The pump sees the host's pane and the lead's terminal; the clock is an hour after the acts.
const later = (m: Moment): Moment => ({
  ...withAgentTerminal(m),
  at: new Date(Date.parse(m.at) + 3600000).toISOString() as Time,
  outside: { ...m.outside, terminals: { 'host-k0001': LIVE, 's-a2': LIVE } },
})
// The same store after the person closed the run (its end, as work run close stores it).
const closed = (m: Moment): Moment => ({
  ...m,
  work: {
    ...m.work,
    runs: new Map(
      [...m.work.runs].map(([id, r]) => [id, { ...r, end: { _tag: 'Closed' as const, at: m.at } }]),
    ),
  },
})
beforeAll(async () => {
  for (const [name, make] of SCENARIOS) {
    if (!['uiRun', 'uiRunRemade', 'relay'].includes(name)) continue
    const s = await make()
    derived.set(name, derive(later(momentOf(s.p.dir, s.at))))
    if (name === 'uiRunRemade') {
      derived.set('uiRunClosed', derive(closed(later(momentOf(s.p.dir, s.at)))))
    }
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

  test('StartTerminals: a started agent starts not again; a Between one starts not (C1)', () => {
    expect(terminalsToStart(of('uiRun'))).toEqual([])
    expect(terminalsToStart(of('uiRunRemade'))).toEqual([])
    expect(terminalsToStart(of('uiRunClosed'))).toEqual([])
  })

  // Ruling 9, onboarding 2026-11-14: the end of t1 ends a2, not its agent p1, so nothing closes
  // (was: s-a2 closed with a2); the terminal of p1 closes when its run is Closed, once.
  test('CloseEnded: the terminal of an agent closes only when its run is Done or Closed', () => {
    expect(terminalsToClose(of('uiRun'))).toEqual([])
    expect(terminalsToClose(of('uiRunRemade'))).toEqual([])
    expect(plain(terminalsToClose(of('uiRunClosed')))).toEqual([
      { session: 's-a2', owner: { _tag: 'Agent', agent: 'p1' } },
    ])
  })

  // Ruling 9, onboarding 2026-11-14: a Between agent is watched too (an end of its process is
  // restarted), so s-a2 stays after the remake (was: not watched); an Ended agent is not.
  test('RetryFailures: the live run and its agents that are not Ended (C1)', () => {
    const owners = (name: string) => terminalsToWatch(of(name)).map((t) => t.session)
    expect(plain(owners('uiRun'))).toEqual(['host-k0001', 's-a2'])
    expect(plain(owners('uiRunRemade'))).toEqual(['host-k0001', 's-a2'])
    expect(plain(owners('uiRunClosed'))).toEqual([])
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
