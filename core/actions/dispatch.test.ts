// dispatch (BUILD.md 3.1): one action in one store write, over the scenario stores of the harness.
// The owner's accept of a draft is the one decision: no other person and no model run makes the
// version.
import { describe, expect, test } from 'bun:test'
import { Exit } from 'effect'
import type { Author, RevisionId, Time } from '../schema/index.ts'
import { derivedIn, dispatchIn, eventsOf, h, NANDA, ok, workOf } from './fixture.test.ts'

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error('the dispatch did not fail')
  const reason = exit.cause.reasons.find((r) => r._tag === 'Fail')
  return reason?._tag === 'Fail' ? (reason.error as { _tag: string; message: string }) : undefined
}
const later = (p: { now: () => string }, minutes = 1) =>
  new Date(Date.parse(p.now()) + minutes * 60000).toISOString() as Time
const HOST_RUN: Author = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' as Time }

describe('dispatch', () => {
  test('an act writes its one event; the Work after it is the fold of the store', async () => {
    const { p } = await h.started()
    const before = eventsOf(p.dir).length
    const input = {
      _tag: 'ReadSource',
      target: { name: 'page' },
      content: { revision: 'r1' },
    } as const
    const exit = dispatchIn(p.dir, { _tag: 'System' }, input as never, later(p))
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
    const stored = eventsOf(p.dir)
    expect(stored.length).toBe(before + 1)
    expect(exit.value.seq).toBe(stored.at(-1)?.seq ?? -1)
    expect(stored.at(-1)?.event._tag).toBe('Source')
    expect(exit.value.work).toStrictEqual(workOf(p.dir))
  }, 60000)

  test('a refusal writes nothing; its choice is the actor own', async () => {
    const { p } = await h.started()
    const before = eventsOf(p.dir).length
    const input = {
      _tag: 'DraftDirection',
      target: {},
      content: { file: 'x.yaml', answers: [], why: { reason: null, words: null } },
    } as const
    const error = failure(dispatchIn(p.dir, NANDA, input as never, later(p)))
    expect(error?._tag).toBe('Refusal')
    expect(error?.message).toStartWith('a model drafts a direction')
    expect(eventsOf(p.dir).length).toBe(before)
  }, 60000)

  test('work init makes the store; a second init is refused with a Pick', async () => {
    const p = h.project()
    // Question 20, option A (onboarding 2026-11-14): work init starts a store with no direction.
    const input = { _tag: 'DefineWorkflow', target: {}, content: { directions: [] } } as const
    const made = dispatchIn(p.dir, NANDA, input as never, later(p))
    if (!Exit.isSuccess(made)) throw new Error(String(made.cause))
    expect(eventsOf(p.dir).map((r) => r.event._tag)).toEqual(['Workflow'])
    const again = failure(dispatchIn(p.dir, NANDA, input as never, later(p, 2)))
    expect(again?.message).toBe('the store has a config; use work config apply')
  }, 60000)
})

describe('the store start of onboarding (Question 20, option A)', () => {
  test('the start with two directions is one event in one store write', async () => {
    const p = h.project()
    const tsd = Bun.YAML.parse(h.DIRECTION) as Record<string, unknown>
    // Nanda, 2026-11-15: a direction has a flow with its governed steps marked; the cases live on its rules (pass 3b).
    const file = tsd
    const standards = (file.standards as ReadonlyArray<{ rules: ReadonlyArray<object> }>).map(
      (x) => ({ ...x, rules: x.rules.map((r) => ({ ...r, supersedes: [] })) }),
    )
    const local = { direction: { ...file, standards }, source: { _tag: 'Local' } }
    const flags = {
      direction: {
        id: 'feature-flags',
        name: 'Feature flags',
        owner: 'Nanda',
        from: [],
        // Nanda, 2026-11-15: a direction has a summary.
        summary: 'A critical change is flagged, so it can be turned off.',
        flow: file.flow,
        says: 'Each critical change is flagged.',
        standards: [],
      },
      source: {
        _tag: 'External',
        repo: 'company-repo',
        path: 'directions/feature-flags',
        ref: { _tag: 'DefaultBranch' },
        commit: 'c'.repeat(40),
      },
    }
    const input = { _tag: 'DefineWorkflow', target: {}, content: { directions: [local, flags] } }
    const made = dispatchIn(p.dir, NANDA, input as never, later(p))
    if (!Exit.isSuccess(made)) throw new Error(String(made.cause))
    expect(eventsOf(p.dir).map((r) => r.event._tag)).toEqual(['Workflow'])
    expect(made.value.seq).toBe(1)
    expect<unknown>(made.value.created).toEqual(['d1', 'tsd-writing@1', 'd2', 'feature-flags@1'])
    expect(made.value.work).toStrictEqual(workOf(p.dir))
    // The rows of the reader tables come with the one write: work search finds the directions.
    const found = ok(await p.nanda('search reader decides')).out
    expect(found).toContain('tsd-writing')
    expect(ok(await p.nanda('search critical change')).out).toContain('feature-flags')
  }, 60000)

  test('a refused start writes nothing', async () => {
    const p = h.project()
    const tsd = Bun.YAML.parse(h.DIRECTION) as Record<string, unknown>
    const stranger = { direction: { ...tsd, owner: 'Dewi' }, source: { _tag: 'Local' } }
    const input = { _tag: 'DefineWorkflow', target: {}, content: { directions: [stranger] } }
    const error = failure(dispatchIn(p.dir, NANDA, input as never, later(p)))
    expect(error?.message).toBe('the owner Dewi of tsd-writing is not in the people of aristoteles.yaml')
    // No event: the dir has no store to open.
    expect(() => eventsOf(p.dir)).toThrow()
  }, 60000)
})

describe('the owner accept makes the version of a draft', () => {
  test('no other person and no model run accepts it; the owner does', async () => {
    const { p } = await h.started()
    p.write('says.yaml', 'says: The reader understands, decides, and sees the cost first.\n')
    const revise = {
      _tag: 'ReviseDirection',
      target: { direction: 'tsd-writing' },
      content: { file: 'says.yaml', answers: [], why: { reason: null, words: null } },
    } as const
    const drafted = dispatchIn(p.dir, HOST_RUN, revise as never, later(p))
    if (!Exit.isSuccess(drafted)) throw new Error(String(drafted.cause))
    const d2 = String(drafted.value.created[0]) as RevisionId
    const accept = {
      _tag: 'Accept',
      target: { of: { _tag: 'Revision', id: d2 } },
      content: { reason: null },
    } as const
    const kai: Author = { _tag: 'Person', name: 'Kai', channel: 'terminal' }
    for (const [by, minutes] of [[HOST_RUN, 2], [kai, 3]] as const) {
      const refused = failure(dispatchIn(p.dir, by, accept as never, later(p, minutes)))
      expect(refused?.message).toBe(`${d2} is decided by its owner, Nanda`)
    }
    const versions = () => {
      const x = workOf(p.dir).directions.get('tsd-writing' as never)
      return x?._tag === 'Official' ? x.versions.length : 0
    }
    expect(versions()).toBe(1)
    expect(derivedIn(p).states.revisions.get(d2)?._tag).toBe('Waiting')
    const made = dispatchIn(p.dir, NANDA, accept as never, later(p, 4))
    if (!Exit.isSuccess(made)) throw new Error(String(made.cause))
    expect(versions()).toBe(2)
    expect(derivedIn(p).states.revisions.get(d2)?._tag).toBe('Official')
  }, 90000)
})
