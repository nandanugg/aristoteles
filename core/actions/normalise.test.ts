// The normalisation rules of BUILD.md 3.6 (N1..N12): what the state decides, an action never
// refuses. Each rule has one test over a scenario store of the harness (the CLI writes it).
import { describe, expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import { canAct } from '../derived/index.ts'
import type {
  AssignmentId,
  Event,
  EventRef,
  QuestionId,
  ResultId,
  RevisionId,
  TaskId,
  Time,
} from '../schema/index.ts'
import { openAnswers, whyOf } from './index.ts'
import type { ActionCall } from './types.ts'
import {
  act,
  agent,
  derivedIn,
  dispatchIn,
  eventsOf,
  events,
  h,
  NANDA,
  ok,
  refused,
  tokenIn,
  workOf,
} from './fixture.test.ts'

const NO_WHY = { reason: null, words: null }
const later = (p: { now: () => string }) =>
  new Date(Date.parse(p.now()) + 60000).toISOString() as Time
const only = (list: ReadonlyArray<Event>): Event => {
  expect(list).toHaveLength(1)
  return list[0] as Event
}
const created = (e: Event): Record<string, unknown> =>
  ('create' in e ? e.create : {}) as Record<string, unknown>

const fitAll = async (p: {
  nanda: (l: string) => Promise<{ code: number; out: string; err: string }>
}) => {
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
}

describe('N1 (I1): --answers that name a point of a closed task are dropped', () => {
  test('a revise answers no point of a closed task, and is not refused for it', async () => {
    const { p, lead } = await h.reported()
    const reject = ok(
      await p.agent(`review ${lead} r1 reject --point="the reader cannot see the cost"`),
    )
    const vid = /^(v\d+): reject/.exec(reject.out)?.[1] ?? ''
    ok(await p.nanda('task close t1 --reason="the export is out of scope"'))
    p.write('task2.yaml', h.TASK_WHOLE.replace('The Introduction', 'The Design'))
    ok(await p.nanda('task open --file=task2.yaml'))
    ok(await p.nanda('role fit architect --answers=fit.yaml'))
    const sol = tokenIn(ok(await p.nanda('assign t2 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    p.write('cost.yaml', 'says: The reader decides from the page alone, with what it costs.\n')
    const d = derivedIn(p)
    expect(openAnswers(d.moment.work, [vid as never])).toEqual([])
    const input = {
      _tag: 'ReviseDirection',
      target: { direction: 'tsd-writing' },
      content: { file: 'cost.yaml', answers: [vid], why: NO_WHY },
    } as const
    const made = created(only(events(act(d, agent(sol), input as never))))
    // The event keeps the ids as given; the fold and the checks drop the irrelevant one.
    expect(made.answers).toEqual([vid])
  }, 60000)
})

describe('N2 (I3): a need that was replaced is the task that replaced it', () => {
  test('needs: [t1] after t1 was remade as t2 is [t2]; a closed need is a Pick', async () => {
    const { p } = await h.started()
    p.write('again.yaml', h.TASK_WHOLE.replace('agreed facts.', 'agreed facts, with their cost.'))
    ok(await p.nanda('task remake t1 --file=again.yaml --reason="the text asks for the cost"'))
    p.write('next.yaml', `${h.TASK_WHOLE.replace('The Introduction', 'The Design')}needs: [t1]\n`)
    const input = { _tag: 'OpenTask', target: {}, content: { file: 'next.yaml' } } as const
    const opened = created(only(events(act(derivedIn(p), NANDA, input as never))))
    expect((opened.task as { needs: unknown }).needs).toEqual(['t2'])
    ok(await p.nanda('task close t2 --reason="out of scope"'))
    const r = refused(act(derivedIn(p), NANDA, input as never))
    expect(r.message).toBe('t1 is closed; a task does not need a closed task')
    expect(r.choice.kind).toBe('Pick')
  }, 60000)
})

describe('N3 (I4): the token anywhere in argv', () => {
  test('is the CLI adapter: an action call has an author and no token', () => {
    const call: ActionCall<'Note'> = {
      by: { _tag: 'Agent', assignment: 'a1' as AssignmentId },
      input: {
        _tag: 'Note',
        target: { task: 't1' as TaskId },
        content: { kind: 'Message', text: 'x' },
      },
    }
    expect(Object.keys(call).sort()).toEqual(['by', 'input'])
  })
})

describe('N4 (I4): --made-from of a git source is read from git', () => {
  test('a report drops the words for a git source and records its merge base', async () => {
    const { p, app, impl } = await h.codeStarted()
    h.git(app, 'checkout', '-q', '-b', 'fix')
    p.write('app/key.txt', 'fixed\n')
    h.git(app, 'add', '.')
    h.git(app, 'commit', '-q', '-m', 'fix')
    const commit = h.git(app, 'rev-parse', 'HEAD')
    const input = {
      _tag: 'Report',
      target: { assignment: 'a2' },
      content: { output: `app@${commit}`, madeFrom: ['app@0123456', 'facts@3'] },
    } as const
    const made = created(only(events(act(derivedIn(p), agent(impl), input as never))))
    const from = made.madeFrom as ReadonlyArray<{ _tag: string; name?: string }>
    expect(from.map((m) => [m._tag, m.name])).toEqual([
      ['Outside', 'facts'],
      ['Git', 'app'],
    ])
    // The same rule for a source that an agent reads: a git source's revision is git's.
    const read = { _tag: 'ReadSource', target: { name: 'app' }, content: { revision: 'abc' } }
    const lead = { _tag: 'Agent', assignment: 'a1' as AssignmentId } as const
    expect(events(act(derivedIn(p), lead, read as never))).toEqual([])
  }, 60000)
})

describe('N5 (I4): blank --why-words are none given', () => {
  test('a reason with blank words keeps the reason; blank words alone are no why', () => {
    const given = (x: { reason: string | null; words: string | null }) => {
      const exit = Effect.runSyncExit(whyOf(x))
      return Exit.isSuccess(exit) ? exit.value : undefined
    }
    expect(given({ reason: 'Shorten', words: '   ' })).toEqual({
      _tag: 'Given',
      reason: 'Shorten',
      words: null,
    })
    expect(given({ reason: null, words: ' ' })).toEqual({ _tag: 'NoneGiven' })
    expect(given({ reason: 'Shorten', words: 'two lines' })).toEqual({
      _tag: 'Given',
      reason: 'Shorten',
      words: 'two lines',
    })
  })
})

describe('N6 (I4): the person own name in --by is the person', () => {
  test('a model run named as a person of the work writes as that person', async () => {
    const { p } = await h.started()
    const run = { _tag: 'ModelRun', name: 'Nanda', at: p.now() as Time } as const
    const input = { _tag: 'FitRole', target: { role: 'linter' }, content: { answers: 'fit.yaml' } }
    const exit = dispatchIn(p.dir, run, input as never, later(p))
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause))
    expect(eventsOf(p.dir).at(-1)?.author).toEqual({
      _tag: 'Person',
      name: 'Nanda',
      channel: 'terminal',
    })
  }, 60000)
})

describe('N7 (I4): a part with an empty workspace keeps its task workspace', () => {
  test('the stored part has no workspace key', async () => {
    const p = h.project({ 'task.yaml': h.TASK_WHOLE })
    await h.init(p)
    await fitAll(p)
    ok(await p.nanda('task open --file=task.yaml'))
    p.write(
      'parts.yaml',
      '- { name: Intro, text: Write the intro., context: { section: introduction }, ' +
        'workspace: [] }\n' +
        '- { name: Design, text: Write the design., context: { section: design } }\n',
    )
    const input = {
      _tag: 'SplitTask',
      target: { task: 't1', answers: null },
      content: { file: 'parts.yaml' },
    } as const
    const e = only(events(act(derivedIn(p), NANDA, input as never)))
    const parts = ('move' in e ? (e.move as { parts: ReadonlyArray<object> }).parts : []) ?? []
    expect(parts.map((x) => 'workspace' in x)).toEqual([false, false])
    expect(parts.map((x) => (x as { name: string }).name)).toEqual(['Intro', 'Design'])
  }, 60000)
})

describe('N8 (I8): direction new on a direction with a version is a revise of it', () => {
  test('a high agent drafts the whole direction again: the event is its revise', async () => {
    const { p } = await h.started()
    ok(await p.nanda('role fit architect --answers=fit.yaml'))
    const sol = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    const more =
      '  - id: cost-first\n    says: Say what the problem costs.\n    rules:\n' +
      '      - { id: names-cost, says: "The introduction names the cost", checkedBy: linter }\n'
    p.write('again.yaml', `${h.DIRECTION}${more}`)
    const input = {
      _tag: 'DraftDirection',
      target: {},
      content: { file: 'again.yaml', answers: [], why: NO_WHY },
    } as const
    const e = only(events(act(derivedIn(p), agent(sol), input as never)))
    expect(e._tag).toBe('Revision')
    const made = created(e)
    expect(made._tag).toBe('Revised')
    expect(made.direction).toBe('tsd-writing')
    const edit = made.edit as { add?: ReadonlyArray<{ id: string }>; replace?: unknown }
    expect(edit.add?.map((s) => s.id)).toEqual(['cost-first'])
    expect(edit.replace).toBeUndefined()
    // A revise keeps who approves: a file that names other deciders is the person's to change.
    const other = h.DIRECTION.replace(
      'from: [Pathos, Logos]\n',
      'from: [Pathos, Logos]\napprovedBy: section-lead\n',
    )
    p.write('other.yaml', other)
    const otherInput = { ...input, content: { ...input.content, file: 'other.yaml' } }
    const changed = refused(act(derivedIn(p), agent(sol), otherInput as never))
    expect([changed.choice.kind, changed.message.includes('approvedBy')]).toEqual(['Write', true])
    // ruling 2026-11-14 (a host revises a direction): a model run outside any task drafts the
    // whole direction again too, and its event is the revise.
    const run = { _tag: 'ModelRun', name: 'assess', at: p.now() as Time } as const
    const byRun = created(only(events(act(derivedIn(p), run, input as never))))
    expect([byRun._tag, byRun.direction]).toEqual(['Revised', 'tsd-writing'])
  }, 60000)
})

describe('N9 (C1, I2): a finish of an ended assignment makes no event', () => {
  test('the lead of a closed task is Ended; its finish is no event, not a refusal', async () => {
    const { p } = await h.started()
    ok(await p.nanda('task close t1 --reason="out of scope"'))
    const d = derivedIn(p)
    expect(d.states.assignments.get('a1' as AssignmentId)?._tag).toBe('Ended')
    const input = { _tag: 'Finish', target: { assignment: 'a1' }, content: {} } as const
    expect(events(act(d, NANDA, input as never))).toEqual([])
  }, 60000)
})

describe('N10 (C6): a confirm of an irrelevant forward makes no event', () => {
  test('the person accepted the draft herself: the forward waits for nothing', async () => {
    const { p, lead } = await h.started()
    ok(await p.nanda('role fit architect --answers=fit.yaml'))
    const sol = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    p.write('cost.yaml', 'says: The reader decides from the page alone, with what it costs.\n')
    ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml`))
    const seen = '--evidence="cost.yaml | the new words of the direction read well"'
    const fwd = ok(await p.agent(`forward ${lead} Nanda accept d2 --quote="yes, take it" ${seen}`))
    const ref = /^(e\d+):/.exec(fwd.out)?.[1] ?? ''
    ok(await p.nanda(`review d2 accept ${seen}`, 'accept'))
    const d = derivedIn(p)
    expect(d.states.forwards.get(ref as EventRef)?._tag).toBe('Irrelevant')
    const input = { _tag: 'Confirm', target: { forward: ref }, content: {} } as const
    expect(events(act(d, NANDA, input as never))).toEqual([])
    expect(d.states.revisions.get('d2' as RevisionId)?._tag).toBe('Official')
  }, 60000)
})

describe('N11 (B6): a second escalation while one is open makes no event', () => {
  test('of a result, and of a task', async () => {
    const { p, linter, writer } = await h.reported()
    ok(await p.agent(`escalate ${linter} --result=r1 --reason="the rule reads two ways"`))
    const again = {
      _tag: 'EscalateResult',
      target: { result: 'r1' as ResultId },
      content: { reason: 'the rule still reads two ways' },
    } as const
    expect(events(act(derivedIn(p), agent(linter), again))).toEqual([])
    ok(await p.agent(`escalate ${writer} --reason="the facts do not say the cost"`))
    const task = { _tag: 'EscalateTask', target: { task: 't1' }, content: { reason: 'still' } }
    expect(events(act(derivedIn(p), agent(writer), task as never))).toEqual([])
  }, 60000)
})

describe('N12 (C2): an answer to an irrelevant question makes no event', () => {
  test('the question of a closed task is Irrelevant; its answer is no event', async () => {
    const { p, writer } = await h.reported()
    ok(await p.agent(`ask ${writer} --text="which merchant is it?"`))
    ok(await p.nanda('task close t1 --reason="out of scope"'))
    const d = derivedIn(p)
    expect(d.states.questions.get('q1' as QuestionId)?._tag).toBe('Irrelevant')
    const input = { _tag: 'Answer', target: { question: 'q1' }, content: { text: 'm1' } } as const
    expect(events(act(d, NANDA, input as never))).toEqual([])
    // canAct refuses the same answer: the rule runs before it (BUILD.md 3.6 step 1).
    expect(
      canAct(d, NANDA, { _tag: 'Answer', target: { question: 'q1' as QuestionId } })._tag,
    ).toBe('MayNot')
    expect(workOf(p.dir).questions.size).toBe(1)
  }, 60000)
})
