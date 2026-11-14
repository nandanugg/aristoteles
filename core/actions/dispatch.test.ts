// dispatch (BUILD.md 3.1): one action in one store write, over the scenario stores of the harness.
// The A1-1 edge: an agent's accept of a draft that needs the owner's accept is stored, the draft
// waits for the owner's leaf, and the owner's accept makes the version.
import { describe, expect, test } from 'bun:test'
import { Exit } from 'effect'
import { waitingFor } from '../derived/index.ts'
import type { RevisionId, TaskId, Time } from '../schema/index.ts'
import {
  agent,
  derivedIn,
  dispatchIn,
  eventsOf,
  h,
  NANDA,
  ok,
  tokenIn,
  workOf,
} from './fixture.test.ts'

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error('the dispatch did not fail')
  const reason = exit.cause.reasons.find((r) => r._tag === 'Fail')
  return reason?._tag === 'Fail' ? (reason.error as { _tag: string; message: string }) : undefined
}
const later = (p: { now: () => string }, minutes = 1) =>
  new Date(Date.parse(p.now()) + minutes * 60000).toISOString() as Time

describe('dispatch', () => {
  test('an act writes its one event; the Work after it is the fold of the store', async () => {
    const { p, lead } = await h.started()
    const before = eventsOf(p.dir).length
    const input = {
      _tag: 'Note',
      target: { task: 't1' as TaskId },
      content: { kind: 'Finding', text: 'the facts name one merchant' },
    } as const
    const exit = dispatchIn(p.dir, agent(lead), input, later(p))
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
    const stored = eventsOf(p.dir)
    expect(stored.length).toBe(before + 1)
    expect(exit.value.seq).toBe(stored.at(-1)?.seq ?? -1)
    expect(stored.at(-1)?.event as unknown).toEqual({
      _tag: 'Note',
      create: { _tag: 'Finding', about: 't1', text: 'the facts name one merchant' },
    })
    expect(exit.value.work).toStrictEqual(workOf(p.dir))
  }, 60000)

  test('a refusal writes nothing; its choice is the actor own', async () => {
    const { p } = await h.started()
    const before = eventsOf(p.dir).length
    const input = { _tag: 'CloseTask', target: { task: 't1' }, content: { reason: ' ' } } as const
    const error = failure(dispatchIn(p.dir, NANDA, input as never, later(p)))
    expect(error?._tag).toBe('Refusal')
    expect(error?.message).toBe('a close needs a reason')
    expect(eventsOf(p.dir).length).toBe(before)
  }, 60000)

  test('an act that the state did already writes nothing (N9 through dispatch)', async () => {
    const { p, lead } = await h.started()
    ok(await p.agent(`finish ${lead}`))
    const before = eventsOf(p.dir).length
    const input = { _tag: 'Finish', target: { assignment: 'a1' }, content: {} } as const
    const exit = dispatchIn(p.dir, NANDA, input as never, later(p))
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
    expect(exit.value.seq).toBeNull()
    expect(eventsOf(p.dir).length).toBe(before)
  }, 60000)

  test('work init makes the store; a second init is refused with a Pick', async () => {
    const p = h.project()
    const input = { _tag: 'DefineWorkflow', target: {}, content: {} } as const
    const made = dispatchIn(p.dir, NANDA, input as never, later(p))
    if (!Exit.isSuccess(made)) throw new Error(String(made.cause))
    expect(eventsOf(p.dir).map((r) => r.event._tag)).toEqual(['Workflow'])
    const again = failure(dispatchIn(p.dir, NANDA, input as never, later(p, 2)))
    expect(again?.message).toBe('the store has a config; use work config apply')
  }, 60000)
})

describe('A1-1: the owner accept is a leaf of the deciders of a draft', () => {
  const COST =
    'add:\n  - { id: cost-first, says: "Say what the problem costs.", rules: [ { id: names-cost, ' +
    'says: "The introduction names the cost", checkedBy: linter } ] }\n'

  test('after a Reject, an agent accept is stored and the owner accept makes it', async () => {
    const approved = h.DIRECTION.replace(
      'from: [Pathos, Logos]\n',
      'from: [Pathos, Logos]\napprovedBy: { or: [section-lead, Nanda] }\n',
    )
    const { p, lead } = await (h.reported as (f: object) => ReturnType<typeof h.reported>)({
      'directions/tsd-writing.yaml': approved,
    })
    ok(await p.nanda('role fit architect --answers=fit.yaml'))
    const sol = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    p.write('cost.yaml', COST)
    ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml`))
    const other = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${other}`))
    ok(await p.agent(`review ${other} d2 reject --reason="the cost has no source in the facts"`))
    const d2 = 'd2' as RevisionId
    // The old engine refused the lead's accept; the new action stores it.
    const evidence = [{ rule: null, where: 'cost.yaml', what: 'the cost standard reads well' }]
    const accept = {
      _tag: 'Accept',
      target: { of: { _tag: 'Revision', id: d2 } },
      content: { evidence, reason: null },
    } as const
    const stored = dispatchIn(p.dir, agent(lead), accept as never, later(p))
    if (!Exit.isSuccess(stored)) throw new Error(String(stored.cause))
    expect(stored.value.seq).not.toBeNull()
    const d = derivedIn(p)
    const state = d.states.revisions.get(d2)
    expect(state).toEqual({
      _tag: 'Waiting',
      waitsFor: [
        { _tag: 'OwnerAccept', owner: { _tag: 'Human', name: 'Nanda' }, why: 'AfterReject' },
      ],
    })
    // The page and work waiting show the draft to the owner.
    const items = waitingFor(d, { _tag: 'Person', name: 'Nanda' } as never)
    expect(items.some((i) => i._tag === 'DraftForPerson')).toBe(true)
    expect(workOf(p.dir).directions.get('tsd-writing' as never)?._tag).toBe('Official')
    const versions = () => {
      const x = workOf(p.dir).directions.get('tsd-writing' as never)
      return x?._tag === 'Official' ? x.versions.length : 0
    }
    expect(versions()).toBe(1)
    const owner = {
      _tag: 'Accept',
      target: { of: { _tag: 'Revision', id: d2 } },
      content: { evidence: [], reason: null },
    } as const
    const made = dispatchIn(p.dir, NANDA, owner as never, later(p, 2))
    if (!Exit.isSuccess(made)) throw new Error(String(made.cause))
    expect(versions()).toBe(2)
    expect(derivedIn(p).states.revisions.get(d2)?._tag).toBe('Official')
  }, 90000)
})
