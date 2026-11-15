// The derived states of onboarding (BUILD.md section 3, W1): a persistent agent, a drafted
// adjustment, a retired direction, an example, a direction of onboarding; and what waitingFor and
// nextFor make of them. The stores come from the harness (temp dirs); an event that a later
// wave's command writes is appended as the store appends any checked event.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Effect, Layer, Schema } from 'effect'
import {
  type AgentId,
  type AssignmentId,
  type Author,
  type DirectionId,
  type Event,
  Example,
  type EventRef,
  OnboardingDirection,
  type RevisionId,
  type Time,
} from '../schema/index.ts'
import { decodeRecorded } from '../../src/domain/events.ts'
import { Env, Store, StoreLive } from '../services/index.ts'
import {
  agentStateOf,
  derive,
  exampleStateOf,
  nextFor,
  onboardingStateOf,
  waitingFor,
} from './index.ts'
import { momentOf, ok, solToken, tokenIn } from './support.test.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harnessJs from '../../test/harness.js'

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}
interface Project {
  readonly dir: string
  readonly nanda: (line: string, typed?: string) => Promise<Ran>
  readonly agent: (line: string) => Promise<Ran>
  readonly ui: (line: string, typed?: string) => Promise<Ran>
  readonly run: (line: string, options: object) => Promise<Ran>
  readonly write: (path: string, text: string) => void
  readonly now: () => string
}
const h = harnessJs as {
  readonly project: (files?: Record<string, string>) => Project
  readonly init: (p: Project) => Promise<void>
  readonly started: () => Promise<{ readonly p: Project; readonly lead: string }>
  readonly HOST: object
  readonly TASK_WHOLE: string
}

// --- appended events ----------------------------------------------------------------------------

const append = (p: Project, author: Author, event: Event): Promise<EventRef> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* (yield* Store).open(p.dir, { create: false })
        const draft = { at: p.now() as Time, author, event }
        const seq = yield* opened.write(() => Effect.succeed({ draft, rows: [] }))
        return `e${seq}` as EventRef
      }),
    ).pipe(
      Effect.provide(
        StoreLive.pipe(
          Layer.provide(
            Layer.succeed(Env, { vars: { ARISTOTELES_DB: dbOf(p.dir) } }),
          ),
        ),
      ),
    ),
  )
const dbOf = (dir: string) => join(dir, '.work', 'aristoteles.db')
const NANDA: Author = { _tag: 'Person', name: 'Nanda', channel: 'ui' }
const HOST_RUN: Author = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' as Time }
const drafted = (adjustment: unknown) =>
  ({ _tag: 'Adjustment', create: { _tag: 'Drafted', adjustment } }) as Event
const accepted = (draft: EventRef, p: Project) => {
  const w = momentOf(p.dir, p.now() as Time).work
  const move = { _tag: 'Accepted', hashes: w.hashes, texts: w.texts }
  return { _tag: 'Adjustment', id: draft, move } as Event
}
const rejected = (draft: EventRef) =>
  ({ _tag: 'Adjustment', id: draft, move: { _tag: 'Rejected', reason: 'not now' } }) as Event
const derivedOf = (p: Project) => derive(momentOf(p.dir, p.now() as Time))

// A dir with a host run h1 whose top task t1 is open, with the architect a1 as its host.
const hosted = async () => {
  const p = h.project({ 'top.yaml': `${h.TASK_WHOLE}role: architect\n` })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', h.HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
  const host = await solToken(p as never, ok(await p.ui('task open td1')).out)
  ok(await p.agent(`brief ${host}`))
  return { p, host }
}
const PARTS =
  '- { name: Flags, text: Write the flags., context: { section: design } }\n' +
  '- { name: Handler, text: Write the handler., context: { section: introduction } }\n'

// Nanda, 2026-11-15: an example is an output of a marked step, real or written by the host.
const SPOT = { file: 'docs/tsd.md', line: 3, excerpt: '## Introduction' }
const CASE = { step: 1, fit: 'Follows', output: SPOT } as unknown as Example
const BREAKS = { step: 1, fit: 'Breaks', output: { written: 'Intro: see PR 42.' } } as unknown as Example
const FLOW = [{ from: 'writer', to: 'docs/tsd.md', says: 'writes', uses: ['tsd-writing'] }]
// The text of one file; any other file is not there.
const only = (file: string, text: string) => (f: string) => (f === file ? text : null)

// --- pure states --------------------------------------------------------------------------------

describe('exampleStateOf', () => {
  test('an example is Current while its file holds the excerpt, and Stale when it is gone', () => {
    const tsd = (text: string) => only('docs/tsd.md', text)
    expect(exampleStateOf(tsd('# TSD\n\n## Introduction\n'), CASE)).toEqual({ _tag: 'Current' })
    // The excerpt counts trimmed, and the line is only where the page points.
    const output = { ...SPOT, excerpt: '  ## Introduction  ', line: 99 }
    const spaced = { ...CASE, output } as unknown as Example
    expect(exampleStateOf(tsd('## Introduction'), spaced)).toEqual({ _tag: 'Current' })
    expect(exampleStateOf(tsd('# TSD\n\n## Design\n'), CASE)).toEqual({ _tag: 'Stale' })
    expect(exampleStateOf(() => null, CASE)).toEqual({ _tag: 'Stale' })
  })
  test('Stale when the excerpt of its input is gone, though its output holds', () => {
    const input = { file: 'CLAUDE.md', line: 4, excerpt: 'One idea a section.' }
    const checked = { ...CASE, input } as unknown as Example
    const texts: Record<string, string> = {
      'docs/tsd.md': '## Introduction\n',
      'CLAUDE.md': '# Rules\n\nOne idea a section.\n',
    }
    expect(exampleStateOf((f) => texts[f] ?? null, checked)).toEqual({ _tag: 'Current' })
    const moved: Record<string, string> = { ...texts, 'CLAUDE.md': '# Rules\n\nTwo ideas.\n' }
    expect(exampleStateOf((f) => moved[f] ?? null, checked)).toEqual({ _tag: 'Stale' })
  })
  test('the words of the host name no file, so they are never stale', () => {
    expect(exampleStateOf(() => null, BREAKS)).toEqual({ _tag: 'Current' })
  })
})

describe('Example', () => {
  test('an example reads and writes as it is: its step, its input, its output', () => {
    const example = { step: 2, fit: 'Breaks', input: SPOT, output: { written: 'Intro: see PR 42.' } }
    const read = Schema.decodeUnknownSync(Example)(example)
    expect(read).toEqual(example as never)
    expect(Schema.encodeSync(Example)(read)).toEqual(example as never)
  })
  test('the new shape is the only one: no step, no output, or blank words do not read', () => {
    const rung = { name: 'Instruction', ...SPOT }
    for (const old of [
      { fit: 'Follows', via: [rung], output: SPOT },
      { ...SPOT, fit: 'Follows' },
      { fit: 'Follows', output: SPOT },
      { step: 1, fit: 'Follows' },
      { step: 1, fit: 'Follows', output: { written: ' ' } },
    ]) {
      expect(() => Schema.decodeUnknownSync(Example)(old)).toThrow()
    }
  })
  test('a stored event of an older shape does not decode: the store refuses to read it', () => {
    const direction = { id: 'd', name: 'D', owner: 'Nanda', from: [], summary: 'S.', says: 'S.', standards: [] }
    const old = { _tag: 'Drafted', direction, cases: [{ ...SPOT, fit: 'Follows' }], answers: [], why: { _tag: 'NoneGiven' } }
    const row = { seq: 1, at: '2026-10-25T09:00:00.000Z', author: HOST_RUN, event: { _tag: 'Revision', create: old } }
    expect(() => decodeRecorded(row)).toThrow()
    const flow = [{ from: 'w', to: 'd', says: 's', uses: ['d'] }]
    const now = { ...old, direction: { ...direction, flow }, cases: undefined, examples: [CASE, BREAKS] }
    const { cases: _, ...current } = now
    expect(decodeRecorded({ ...row, event: { _tag: 'Revision', create: current } }).seq).toBe(1)
  })
})

describe('onboardingStateOf', () => {
  const question = (answer: object) => ({
    says: 'Is the facts file the source?',
    example: CASE,
    options: ['yes', 'no'],
    answer,
  })
  const file = (more: object) =>
    Schema.decodeUnknownSync(OnboardingDirection)({
      id: 'tsd-writing',
      asked: { _tag: 'Found' },
      draft: {
        _tag: 'Drafted',
        name: 'TSD writing',
        from: ['Pathos'],
        content: { summary: 'S.', flow: FLOW, says: 'The reader decides.', standards: [] },
        examples: [CASE, BREAKS],
      },
      questions: [],
      request: { _tag: 'None' },
      accepted: { _tag: 'Waiting' },
      ...more,
    })
  test('Loading while the host drafts, revises, or reads the submitted answers', () => {
    const drafting = file({ draft: { _tag: 'Drafting' } })
    expect(onboardingStateOf(drafting)).toEqual({ _tag: 'Loading' })
    const revise = file({ request: { _tag: 'Revise', words: 'name the cost' } })
    expect(onboardingStateOf(revise)).toEqual({ _tag: 'Loading' })
    const answered = file({ questions: [question({ _tag: 'Chosen', option: 'A' })] })
    expect(onboardingStateOf(answered)).toEqual({ _tag: 'Loading' })
  })
  test('Question while a question is open, with the open ones', () => {
    const open = question({ _tag: 'Open' })
    const asked = file({ questions: [question({ _tag: 'Chosen', option: 'B' }), open] })
    const state = onboardingStateOf(asked)
    expect(state._tag).toBe('Question')
    expect(state._tag === 'Question' ? state.open.map((q) => q.answer._tag) : []).toEqual(['Open'])
  })
  test('Ready when the draft waits for the person, and Accepted after the accept', () => {
    expect(onboardingStateOf(file({}))).toEqual({ _tag: 'Ready' })
    expect(onboardingStateOf(file({ accepted: { _tag: 'Accepted' } }))).toEqual({
      _tag: 'Accepted',
    })
  })
  test('Loading for a file that the reader reset: the host drafts it again', () => {
    expect(onboardingStateOf(file({ draft: { _tag: 'Reset' } }))).toEqual({ _tag: 'Loading' })
  })
})

// --- states of a store --------------------------------------------------------------------------

describe('AgentState', () => {
  test('OnAssignment with two open assignments, Between with none, then Ended', async () => {
    const { p, host } = await hosted()
    p.write('parts.yaml', PARTS)
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    ok(await p.agent(`assign ${host} t2 --role=section-lead`))
    ok(await p.agent(`assign ${host} t3 --role=section-lead`))
    const p1 = 'p1' as AgentId
    const on = derivedOf(p).states.agents.get(p1)
    expect<unknown>(on).toEqual({ _tag: 'OnAssignment', assignments: ['a2', 'a3'] })
    ok(await p.agent(`finish ${host} a2`))
    ok(await p.agent(`finish ${host} a3`))
    const d = derivedOf(p)
    expect(d.states.agents.get(p1)).toEqual({ _tag: 'Between' })
    // Its run ends: the dependency is given, with no store (R1).
    const at = p.now() as Time
    const ended = agentStateOf(d.moment, p1, {
      run: { _tag: 'Closed', at },
      assignments: d.states.assignments,
    })
    expect(ended).toEqual({ _tag: 'Ended', at })
  }, 60000)
})

describe('adjustments', () => {
  const RETIRE = { _tag: 'RetireDirection', direction: 'tsd-writing' }
  test('Waiting, Accepted, Rejected, Replaced; Retired; who they wait for', async () => {
    const { p } = await h.started()
    const setTier = (tier: string) => ({ _tag: 'SetTier', role: 'writer', tier })
    const first = await append(p, HOST_RUN, drafted(setTier('medium')))
    const second = await append(p, HOST_RUN, drafted(setTier('high')))
    const retire = await append(p, HOST_RUN, drafted(RETIRE))
    const accept = await append(p, NANDA, accepted(retire, p))
    const lead = { _tag: 'Agent', assignment: 'a1' } as Author
    const remove = await append(p, lead, drafted({ _tag: 'RemoveRole', role: 'linter' }))
    const reject = await append(p, NANDA, rejected(remove))
    const d = derivedOf(p)
    expect(d.states.adjustments.get(first)).toEqual({ _tag: 'Replaced', by: second })
    expect(d.states.adjustments.get(second)).toEqual({ _tag: 'Waiting' })
    expect(d.states.adjustments.get(retire)).toEqual({ _tag: 'Accepted', by: accept })
    expect<unknown>(d.states.adjustments.get(remove)).toEqual({
      _tag: 'Rejected',
      by: reject,
      reason: 'not now',
    })
    expect(d.states.directions.get('tsd-writing' as DirectionId)).toEqual({
      _tag: 'Retired',
      by: accept,
    })
    // The person sees a waiting adjustment at once; a rejected one waits for its drafter.
    const items = waitingFor(d, { _tag: 'Everyone' })
    const waiting = items.filter((i) => i._tag === 'Adjustment')
    expect(waiting.map((i) => [i.draft, i.for, i.hold])).toEqual([
      [second, { _tag: 'Person', name: 'Nanda' }, { _tag: 'Shown' }],
    ] as never)
    const stepOf = waiting[0]?.step
    expect(stepOf?._tag === 'Do' ? stepOf.intents.map((i) => i._tag) : []).toEqual([
      'AcceptAdjustment',
      'RejectAdjustment',
    ])
    const again = items.filter((i) => i._tag === 'AdjustmentRejected')
    expect(again.map((i) => [i.draft, i.for])).toEqual([
      [remove, { _tag: 'Assignment', assignment: 'a1' as AssignmentId }],
    ] as never)
  }, 60000)
})

describe('what reaches the host from no project', () => {
  test('a suggestion about the roles: the person sees it, the host drafts it', async () => {
    const { p, host } = await hosted()
    const about = { _tag: 'Roles' }
    const says = 'a role reads the facts first'
    const suggestion = { _tag: 'Suggestion', create: { _tag: 'Suggestion', about, says } }
    await append(p, NANDA, suggestion as Event)
    const d = derivedOf(p)
    const item = waitingFor(d, { _tag: 'Person', name: 'Nanda' }).find(
      (i) => i._tag === 'Suggestion',
    )
    expect(item?._tag === 'Suggestion' ? item.about : undefined).toEqual({ _tag: 'Roles' })
    const a1 = { _tag: 'Agent', assignment: tokenIn(`work brief ${host}`).split('.')[0] } as Author
    const steps = nextFor(d, a1).filter((s) => s.what._tag === 'AnswerRolesSuggestion')
    expect(steps.map((s) => (s._tag === 'Do' ? s.intents.map((i) => i._tag) : []))).toEqual([
      ['DraftAdjustment'],
    ])
    // The words of the step: the person's words, and the changes that an adjustment can make.
    expect(ok(await p.agent(`next ${host}`)).out).toContain(
      [
        's1 suggests about the roles: "a role reads the facts first" (Nanda); answer it with the ' +
          'adjustment that it asks for, one change at a time',
        `  work adjust ${host} add-role <role> --file=<role.yaml>, or remove-role <role>, or ` +
          'tier <role> --tier=<low|medium|high>, or persistence <role> ' +
          '--persistent=<true|false> --why="<one line>"',
      ].join('\n'),
    )
    // Once a model drafts a role adjustment after the words, they wait no more.
    await append(p, HOST_RUN, drafted({ _tag: 'SetTier', role: 'writer', tier: 'medium' }))
    const later = derivedOf(p)
    expect(nextFor(later, a1).some((s) => s.what._tag === 'AnswerRolesSuggestion')).toBe(false)
  }, 60000)

  test('a company draft with no examples: the person rejects only, the host adds them', async () => {
    const { p, host } = await hosted()
    const source = {
      repo: 'company-repo',
      path: 'directions/flags',
      ref: { _tag: 'DefaultBranch' },
      commit: 'c'.repeat(40),
    }
    const folder = { name: 'Flags', says: 'Each change is flagged.', standards: [] }
    const imported = { direction: 'flags', source, folder, owner: 'Nanda', checkers: {} }
    const event = { _tag: 'Revision', create: { _tag: 'Imported', ...imported } }
    await append(p, { _tag: 'Refresh' }, event as unknown as Event)
    const d = derivedOf(p)
    const draft = [...d.moment.work.drafts.values()].find((x) => x.of === 'flags')
    if (draft === undefined) throw new Error('no draft of flags')
    const person = waitingFor(d, { _tag: 'Person', name: 'Nanda' }).find(
      (i) => i._tag === 'DraftForPerson' && i.draft === draft.id,
    )
    const step = person?.step
    expect(step?._tag === 'Do' ? step.intents.map((i) => i._tag) : []).toEqual(['Reject'])
    const a1 = { _tag: 'Agent', assignment: tokenIn(`work brief ${host}`).split('.')[0] } as Author
    const adds = nextFor(d, a1).filter((s) => s.what._tag === 'AddExamples')
    expect(adds.map((s) => (s._tag === 'Do' ? s.intents : []))).toEqual([
      [{ _tag: 'AddExamples', target: { draft: draft.id as RevisionId } }],
    ] as never)
    // The words of the step: what the draft misses, and what an example is (ruling 4).
    // Nanda, 2026-11-15: an example is an output of a marked step (was: 3 cases, as ladders).
    expect(ok(await p.agent(`next ${host}`)).out).toContain(
      [
        `${draft.id} drafts the new direction "Flags", and its flow marks no step that the ` +
          'direction governs; write its flow in this project, each step that it governs with ' +
          'uses, and examples: for each marked step an output that follows the direction and ' +
          'one that breaks it, with its input for a step that checks or decides; a real place ' +
          'of the project (file, line, a short excerpt in the file) when it has one, else the ' +
          'output in your words (written)',
        `  work direction examples ${host} ${draft.id} --file=<flow and examples.yaml>`,
      ].join('\n'),
    )
    // With a flow that marks a step, and one that follows and one that breaks there, the accept
    // is the person's again, and the host has no step.
    const flow = [{ from: 'writer', to: 'flags.ts', says: 'adds a flag', uses: ['flags'] }]
    const move = { _tag: 'ExamplesAdded', flow, examples: [CASE, BREAKS] }
    const added = { _tag: 'Revision', id: draft.id, move } as unknown as Event
    await append(p, HOST_RUN, added)
    const after = derivedOf(p)
    const again = waitingFor(after, { _tag: 'Person', name: 'Nanda' }).find(
      (i) => i._tag === 'DraftForPerson' && i.draft === draft.id,
    )?.step
    expect(again?._tag === 'Do' ? again.intents.map((i) => i._tag) : []).toEqual([
      'Accept',
      'Reject',
    ])
    expect(nextFor(after, a1).some((s) => s.what._tag === 'AddExamples')).toBe(false)
  }, 60000)
})
