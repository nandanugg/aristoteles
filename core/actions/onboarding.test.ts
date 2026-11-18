// The actions of onboarding (BUILD.md section 3, W1), each through dispatch on a harness store: a
// new direction carries its examples, and a company draft gets them from a model before its
// owner accepts it.
import { describe, expect, test } from 'bun:test'
import { Exit } from 'effect'
import type { Author, DirectionId, Event, RevisionId, Time } from '../schema/index.ts'
import {
  act,
  appendIn,
  derivedIn,
  dispatchIn,
  h,
  NANDA,
  ok,
  type Project,
  refused,
  workOf,
} from './fixture.test.ts'
import type { ActionInput } from './types.ts'

const HOST_RUN: Author = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' as Time }
// Nanda, 2026-11-15: a direction starts with examples (was: 3 cases): in each marked step of its
// flow, one that follows it and one that breaks it.
const OUTPUT = { file: 'docs/tsd.md', line: 3, excerpt: '## Introduction' }
const EXAMPLES = [
  { fit: 'Follows', output: OUTPUT },
  { fit: 'Breaks', output: { written: 'Introduction: see ABC-2964.' } },
]
const FLAGS_STEP = { from: 'writer', to: 'docs/tsd.md', says: 'adds a flag', uses: ['flags'] }
const FLAGS_FLOW = JSON.stringify({ flow: [{ ...FLAGS_STEP, examples: EXAMPLES }] })
const later = (p: Project, minutes = 1) =>
  new Date(Date.parse(p.now()) + minutes * 60000).toISOString() as Time
// One dispatch that must store its event, a minute after the last act; the clock of the CLI
// then moves past it. The Dispatched.
const stored = (p: Project, by: Author, input: ActionInput) => {
  const exit = dispatchIn(p.dir, by, input, later(p))
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
  p.wait(2)
  return exit.value
}

describe('the examples of a new direction (P10 rejected, onboarding 2026-11-14)', () => {
  // Nanda, 2026-11-15: a marked step of the flow has an output that follows and one that breaks.
  test('direction new stores its marked flow and its examples by step; a miss is refused', async () => {
    const p = h.project()
    ok(await p.nanda('init'))
    const marked = h.DIRECTION
    // The flow is read by its Schema: a marked step with one example only is refused.
    p.write('one-step.yaml', marked.replace(/ {6}- fit: Breaks\n {8}input: .*\n {8}output: \{ written: "Accept.*\n/, ''))
    expect((await p.agent('direction new --file=one-step.yaml --by=assess')).err).toContain(
      'the step has no example that breaks the direction',
    )
    p.write('ghost.yaml', marked.replace('uses: [facts-not-proof, no-code-proof]', 'uses: [ghost]'))
    expect((await p.agent('direction new --file=ghost.yaml --by=assess')).err).toContain(
      'ghost.yaml: flow step 5 uses "ghost", which is not tsd-writing or a standard or rule of it',
    )
    p.write('no-flow.yaml', marked.replace(/flow:\n( {2}.*\n)+/, ''))
    expect((await p.agent('direction new --file=no-flow.yaml --by=assess')).err).toContain(
      'no-flow.yaml: flow is required',
    )
    p.write('marked.yaml', marked)
    ok(await p.agent('direction new --file=marked.yaml --by=assess'))
    const draft = workOf(p.dir).drafts.get('d1' as RevisionId)
    // The examples are in the marked steps that they show.
    expect(draft?.flow.map((s) => (s.examples ?? []).map((e) => [e.fit, e.input !== undefined]))).toEqual([
      [],
      [],
      [],
      [['Follows', false], ['Breaks', false]],
      [['Follows', true], ['Breaks', true]],
    ] as never)
    expect(draft?.flow.map((s) => s.uses ?? [])).toEqual([
      [],
      [],
      [],
      ['tsd-writing', 'intro-story', 'repeatable'],
      ['facts-not-proof', 'no-code-proof'],
    ] as never)
  }, 60000)

  test('a model adds the flow and the examples of a company draft; then the owner accepts it', async () => {
    const { p } = await h.started()
    const source = {
      repo: 'company-repo',
      path: 'directions/flags',
      ref: { _tag: 'DefaultBranch' },
      commit: 'c'.repeat(40),
    }
    const folder = { name: 'Flags', says: 'Each change is flagged.', standards: [] }
    const imported = { direction: 'flags', source, folder, owner: 'Nanda', checkers: {} }
    const event = { _tag: 'Revision', create: { _tag: 'Imported', ...imported } }
    appendIn(p, { _tag: 'Refresh' }, event as unknown as Event)
    const d2 = 'd2' as RevisionId
    const accept: ActionInput = {
      _tag: 'Accept',
      target: { of: { _tag: 'Revision', id: d2 } },
      content: { reason: null },
    }
    // Nanda, 2026-11-15: an example is an output that follows or breaks it (was: 3 cases).
    expect(refused(act(derivedIn(p), NANDA, accept)).message).toBe(
      'd2 drafts the new direction Flags, and its flow marks no step; a direction starts with ' +
        'a flow whose marked steps each have an output that follows it and one that breaks it',
    )
    p.write('cases.yaml', FLAGS_FLOW)
    const file = 'cases.yaml'
    const add: ActionInput = { _tag: 'AddExamples', target: { draft: d2 }, content: { file } }
    expect(refused(act(derivedIn(p), NANDA, add)).message).toBe(
      'a model drafts the examples of a draft; the person says it in words',
    )
    stored(p, HOST_RUN, add)
    stored(p, NANDA, accept)
    const flags = workOf(p.dir).directions.get('flags' as DirectionId)
    expect(flags?._tag).toBe('Official')
    const flow = flags?._tag === 'Official' ? flags.versions[0].flow : []
    expect(flow).toEqual([{ ...FLAGS_STEP, examples: EXAMPLES }] as never)
  }, 60000)
})
