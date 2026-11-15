// The actions of onboarding (BUILD.md section 3, W1), each through dispatch on a harness store: a
// new direction carries its examples, a company draft gets them from a model, an adjustment is
// drafted and accepted or rejected (a role adjustment writes aristoteles.yaml), the supervisor
// starts a persistent agent, and the assignments of one agent share its terminal.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Exit } from 'effect'
import type {
  AgentId,
  AssignmentId,
  Author,
  DirectionId,
  Event,
  EventRef,
  RevisionId,
  SessionId,
  Time,
} from '../schema/index.ts'
import {
  act,
  appendIn,
  derivedIn,
  dispatchIn,
  eventsOf,
  h,
  NANDA,
  ok,
  type Project,
  refused,
  solToken,
  tokenIn,
  workOf,
} from './fixture.test.ts'
import type { ActionInput } from './types.ts'

const HOST_RUN: Author = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' as Time }
const SUPERVISOR: Author = { _tag: 'Supervisor', name: 'Nanda' }
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
const refOf = (seq: number | null) => `e${seq}` as EventRef
const adjust = (adjustment: unknown): ActionInput =>
  ({ _tag: 'DraftAdjustment', target: {}, content: { adjustment } }) as ActionInput

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
      content: { evidence: [], reason: null },
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

describe('adjustments (ruling 14)', () => {
  const EDITOR =
    'model: sonnet\ndescription: Edits one section.\nintro: You edit one section.\n' +
    'responsibilities:\n  - Edit the section under its heading.\nacts: [{ approve: [writer] }, { assign: [writer] }]\n' +
    'persistence: { persistent: true, why: It edits the sections of the project. }\n' +
    'icon: pen-tool\n'
  const ADD_EDITOR = { _tag: 'AddRole', role: 'editor', file: 'editor.yaml' }

  test('a new role: drafted, accepted into the file; config apply finds no change', async () => {
    const { p } = await h.started()
    p.write('editor.yaml', EDITOR)
    const drafted = stored(p, HOST_RUN, adjust(ADD_EDITOR))
    const draft = refOf(drafted.seq)
    const accept: ActionInput = { _tag: 'AcceptAdjustment', target: { draft }, content: {} }
    stored(p, NANDA, accept)
    const file = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    expect(file).toContain('  editor:\n')
    const work = workOf(p.dir)
    expect(work.config.roles.editor?.kind).toBe('agent')
    expect(work.texts['aristoteles.yaml']).toBe(file)
    // The store holds the file as it is: a config apply finds no word of a role to change.
    ok(await p.nanda('config apply', 'apply'))
    const last = eventsOf(p.dir).at(-1)?.event
    expect(last?._tag === 'Workflow' && 'move' in last ? last.move.roles : undefined).toEqual({})
  }, 60000)

  test('a reject keeps its reason; the accept checks the work again', async () => {
    const { p } = await h.started()
    p.write('editor.yaml', EDITOR)
    const add = stored(p, HOST_RUN, adjust(ADD_EDITOR))
    stored(p, NANDA, { _tag: 'AcceptAdjustment', target: { draft: refOf(add.seq) }, content: {} })
    const setModel = stored(p, HOST_RUN, adjust({ _tag: 'SetModel', role: 'writer', model: 'sonnet' }))
    const reason = 'the writer stays a subagent'
    const reject: ActionInput = {
      _tag: 'RejectAdjustment',
      target: { draft: refOf(setModel.seq) },
      content: { reason },
    }
    stored(p, NANDA, reject)
    const state = derivedIn(p).states.adjustments.get(refOf(setModel.seq))
    expect(state?._tag === 'Rejected' ? state.reason : undefined).toBe(reason as never)
    const remove = stored(p, HOST_RUN, adjust({ _tag: 'RemoveRole', role: 'editor' }))
    ok(await p.nanda('role fit editor --answers=fit.yaml'))
    ok(await p.nanda('assign t1 --role=editor'))
    const accept: ActionInput = {
      _tag: 'AcceptAdjustment',
      target: { draft: refOf(remove.seq) },
      content: {},
    }
    expect(refused(act(derivedIn(p), NANDA, accept)).message).toBe('editor is in use: a2 plays it')
  }, 60000)
})

describe('persistent agents and their one terminal (ruling 9)', () => {
  // A second persistent lead role, which the architect assigns, so that a run can hold two agents.
  const EDITOR_ROLE =
    '  editor:\n    model: sonnet\n    description: Edits one section.\n' +
    '    intro: You edit one section.\n    responsibilities:\n' +
    '      - Edit the section under its heading.\n    acts: [{ approve: [writer] }]\n' +
    '    persistence: { persistent: true, why: It edits the sections of the project. }\n' +
    '    icon: pen-tool\n'
  // A dir with a host run h1, its top task t1 split in two, and section-lead given on each part.
  const twoParts = async () => {
    const p = h.project({
      'aristoteles.yaml': `${h.WORK_YAML.replace('{ assign: [section-lead, writer, linter] }', '{ assign: [section-lead, writer, linter, editor] }')}${EDITOR_ROLE}`,
      'top.yaml': `${h.TASK_WHOLE}role: architect\n`,
    })
    await h.init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter', 'editor']) {
      ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    }
    ok(await p.run('run start', h.HOST))
    ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
    const host = await solToken(p, ok(await p.ui('task open td1')).out)
    ok(await p.agent(`brief ${host}`))
    p.write(
      'parts.yaml',
      '- { name: Flags, text: Write the flags., context: { section: design } }\n' +
        '- { name: Handler, text: Write the handler., context: { section: introduction } }\n',
    )
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    ok(await p.agent(`assign ${host} t2 --role=section-lead`))
    ok(await p.agent(`assign ${host} t3 --role=section-lead`))
    return { p, host }
  }
  const session = (a: string, id: string): ActionInput => ({
    _tag: 'StartSession',
    target: { assignment: a as AssignmentId },
    content: { session: id as SessionId, secret: null },
  })
  const startP1: ActionInput = {
    _tag: 'StartAgent',
    target: { agent: 'p1' as AgentId },
    content: { session: 's-lead' as SessionId },
  }

  test('the supervisor starts the agent once; its two assignments take its session', async () => {
    const { p } = await twoParts()
    stored(p, SUPERVISOR, startP1)
    expect(workOf(p.dir).agents.get('p1' as AgentId)?.terminal._tag).toBe('Started')
    expect(refused(act(derivedIn(p), SUPERVISOR, startP1)).message).toBe(
      'p1 has its terminal s-lead',
    )
    stored(p, SUPERVISOR, session('a2', 's-lead'))
    stored(p, SUPERVISOR, session('a3', 's-lead'))
    const work = workOf(p.dir)
    expect(work.sessions.get('a2' as AssignmentId)?.session).toBe('s-lead' as SessionId)
    expect(work.sessions.get('a3' as AssignmentId)?.session).toBe('s-lead' as SessionId)
  }, 60000)

  test('an assignment of no agent, or of another agent, is refused that session', async () => {
    const { p, host } = await twoParts()
    stored(p, SUPERVISOR, startP1)
    const lead = tokenIn(ok(await p.ui('session a2 --id=s-lead --token')).out)
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`assign ${lead} t2 --role=writer`))
    ok(await p.agent(`assign ${host} t2 --role=editor`))
    const work = workOf(p.dir)
    const runs = (a: string): unknown => work.assignments.get(a as AssignmentId)?.runs
    expect(runs('a4')).toEqual({ _tag: 'Subagent', model: 'haiku' })
    expect(runs('a5')).toEqual({ _tag: 'Agent', agent: 'p2' })
    const d = derivedIn(p)
    for (const a of ['a1', 'a4', 'a5']) {
      expect(refused(act(d, SUPERVISOR, session(a, 's-lead'))).message).toBe(
        'the session s-lead is in use',
      )
    }
  }, 60000)
})
