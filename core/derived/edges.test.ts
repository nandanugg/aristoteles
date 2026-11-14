// The dependency edges (BUILD.md 4.3, R1): one test per edge. Each test gives the dependent's
// function a fabricated state of its dependency (an ended task, a run that is done, a decided
// target) and checks that the dependent is Ended, Irrelevant, Dropped or moved, with no new
// event. The records come from a scenario store; only the dependency state is made up.
import { beforeAll, describe, expect, test } from 'bun:test'
import type { Time } from '../../src/domain/ids.ts'
import type {
  AssignmentId,
  NonBlank,
  TaskState,
  EscalationId,
  EventRef,
  ProblemId,
  QuestionId,
  ResultId,
  ReviewId,
  RevisionId,
  RunId,
  TaskDraftId,
  TaskId,
  VersionId,
} from '../schema/index.ts'
import type { Moment } from '../state/index.ts'
import {
  answererNow,
  assignmentStateOf,
  type Derived,
  derive,
  escalationStateOf,
  forwardStateOf,
  hostOf,
  hostPanesOf,
  placementOf,
  problemStateOf,
  questionStateOf,
  type RevisionState,
  revisionStateOf,
  runStateOf,
  sendStateOf,
  taskDraftStateOf,
  terminalsToWatch,
} from './index.ts'
import { momentOf, SCENARIOS, type Scenario } from './support.test.ts'

const id = <A extends string>(s: string) => s as A
const scenarios = new Map<string, { readonly m: Moment; readonly d: Derived }>()
const of = (name: string) => {
  const s = scenarios.get(name)
  if (s === undefined) throw new Error(`no scenario ${name}`)
  return s
}
beforeAll(async () => {
  for (const [name, make] of SCENARIOS) {
    if (!['uiRun', 'relay', 'relayDecided', 'vetoed', 'escalated'].includes(name)) continue
    const s: Scenario = await make()
    const m = momentOf(s.p.dir, s.at)
    scenarios.set(name, { m, d: derive(m) })
  }
}, 240000)

const CLOSED: TaskState = { _tag: 'Closed' }
const REPLACED: TaskState = { _tag: 'Replaced', next: id<TaskId>('t2') }
const OPEN: TaskState = { _tag: 'InReview' }
const GIVEN = { _tag: 'GivenByPerson' } as const
const AT = id<Time>('2026-10-25T10:00:00.000Z')

// A Work with one more task (a part of t1, or a second draft of h1): the facts of an edge that
// the scenarios do not hold.
const withTask = (m: Moment, task: TaskId, serves: TaskId): Moment => {
  const t1 = m.work.tasks.get(id<TaskId>('t1'))
  if (t1 === undefined) throw new Error('no t1')
  const part = { ...t1, id: task, serves: { _tag: 'Serves' as const, task: serves } }
  return { ...m, work: { ...m.work, tasks: new Map([...m.work.tasks, [task, part]]) } }
}
const withDraft = (m: Moment, draft: TaskDraftId): Moment => {
  const td1 = m.work.taskDrafts.get(id<TaskDraftId>('td1'))
  if (td1 === undefined) throw new Error('no td1')
  const fresh = { ...td1, id: draft, opened: { _tag: 'NotOpened' as const } }
  return { ...m, work: { ...m.work, taskDrafts: new Map([...m.work.taskDrafts, [draft, fresh]]) } }
}

describe('task -> assignment (C1): an ended task ends its assignments', () => {
  test('a Closed task: the writer is Ended{TaskEnded}', () => {
    const { m } = of('uiRun')
    expect(assignmentStateOf(m, id('a3'), { task: CLOSED, parent: GIVEN })).toEqual({
      _tag: 'Ended',
      why: { _tag: 'TaskEnded', task: id('t1'), state: CLOSED },
    })
  })
  test('a Replaced task: the lead is Ended{TaskEnded}, with the replacement', () => {
    const { m } = of('uiRun')
    expect(assignmentStateOf(m, id('a2'), { task: REPLACED, parent: GIVEN })).toEqual({
      _tag: 'Ended',
      why: { _tag: 'TaskEnded', task: id('t1'), state: REPLACED },
    })
  })
  test('an open task: the writer works on its attempt', () => {
    const { m } = of('uiRun')
    const state = assignmentStateOf(m, id('a3'), { task: OPEN, parent: GIVEN })
    expect(state._tag).toBe('Working')
  })
})

describe('parent -> settled child (C1, I2)', () => {
  test('an accepted task settles its assignment; it ends when its parent ends', () => {
    const { m } = of('uiRun')
    const accepted: TaskState = { _tag: 'Accepted' }
    const working = { _tag: 'Working', tries: { _tag: 'Reviews' } } as const
    const ended = { _tag: 'Ended', why: { _tag: 'Finished', when: AT } } as const
    const parent = (state: typeof working | typeof ended) =>
      ({ _tag: 'Parent', parent: id<AssignmentId>('a2'), state }) as const
    expect(assignmentStateOf(m, id('a3'), { task: accepted, parent: parent(working) })).toEqual({
      _tag: 'Settled',
      task: id('t1'),
    })
    expect(assignmentStateOf(m, id('a3'), { task: accepted, parent: parent(ended) })).toEqual({
      _tag: 'Ended',
      why: { _tag: 'ParentEnded', parent: id('a2') },
    })
  })
})

describe('assignment -> answerer (C1): a question goes up past an ended agent', () => {
  test('to the nearest assignment that is not Ended, else the owner of its task', () => {
    const { m } = of('uiRun')
    const ended = { _tag: 'Ended', why: { _tag: 'Finished', when: AT } } as const
    const working = { _tag: 'Working', tries: { _tag: 'Reviews' } } as const
    const states = (a2: typeof ended | typeof working) =>
      new Map<AssignmentId, typeof ended | typeof working>([
        [id('a1'), working],
        [id('a2'), a2],
        [id('a3'), ended],
      ])
    expect(answererNow(m, id('a3'), states(working))).toBe(id('a2'))
    expect(answererNow(m, id('a3'), states(ended))).toBe(id('a1'))
    const all = new Map([...states(ended)].map(([k]) => [k, ended] as const))
    expect(answererNow(m, id('a3'), all)).toEqual({ _tag: 'Human', name: 'Nanda' })
  })
})

describe('task -> question (C2)', () => {
  test('the task that it stops ended: the question is Irrelevant', () => {
    const { m } = of('uiRun')
    const answerer = id<AssignmentId>('a1')
    const q = id<QuestionId>('q1')
    expect(questionStateOf(m, q, { stops: REPLACED, answerer })).toEqual({
      _tag: 'Irrelevant',
      task: id('t1'),
    })
    expect(questionStateOf(m, q, { stops: CLOSED, answerer })._tag).toBe('Irrelevant')
    expect(questionStateOf(m, q, { stops: OPEN, answerer })).toEqual({ _tag: 'Open', answerer })
  })
})

describe('result and task -> escalation', () => {
  test('a later result, or the end of its task, makes an escalation Irrelevant', () => {
    const { m } = of('escalated')
    const e = [...m.work.reviews.values()].find((r) => r._tag === 'Escalate')
    if (e?._tag !== 'Escalate') throw new Error('no escalation')
    const answerer = { _tag: 'Human', name: 'Nanda' } as const
    const later = { _tag: 'Superseded', by: id<ResultId>('r2') } as const
    const inReview = { _tag: 'InReview' } as const
    expect(escalationStateOf(m, e.id, { result: later, task: OPEN, answerer })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'ResultSuperseded', by: id('r2') },
    })
    expect(escalationStateOf(m, e.id, { result: inReview, task: CLOSED, answerer })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'TaskEnded', task: id('t1') },
    })
    expect(escalationStateOf(m, e.id, { result: inReview, task: OPEN, answerer })._tag).toBe('Open')
  })
})

describe('task -> problem (C3)', () => {
  test('the stopped task ended: the problem is Irrelevant, and no retry selects it', () => {
    const { m } = of('uiRun')
    const sp = id<ProblemId>('sp1')
    expect(problemStateOf(m, sp, { stopped: REPLACED })).toEqual({
      _tag: 'Irrelevant',
      task: id('t1'),
    })
    expect(problemStateOf(m, sp, { stopped: OPEN })).toEqual({ _tag: 'Open' })
  })
})

describe('task -> decision placement (d15)', () => {
  test('Replaced: the placement follows Replaced.next to the open task', () => {
    const { m } = of('uiRun')
    const tasks = new Map<TaskId, TaskState>([
      [id('t1'), REPLACED],
      [id('t2'), OPEN],
    ])
    expect(placementOf(m, id('t1'), { tasks })).toEqual({ _tag: 'OnTask', task: id('t2') })
  })
  test('Closed: the nearest open parent; a tree with no open task is the whole dir', () => {
    const m = withTask(of('uiRun').m, id('t9'), id('t1'))
    const open = new Map<TaskId, TaskState>([
      [id('t1'), OPEN],
      [id('t9'), CLOSED],
    ])
    expect(placementOf(m, id('t9'), { tasks: open })).toEqual({ _tag: 'OnTask', task: id('t1') })
    const none = new Map<TaskId, TaskState>([
      [id('t1'), CLOSED],
      [id('t9'), CLOSED],
    ])
    expect(placementOf(m, id('t9'), { tasks: none })).toEqual({ _tag: 'DirWide' })
  })
})

describe('run -> host, host watch, task draft (S1, S3)', () => {
  test('the top task ended: the run is Closed, its drafts Dropped, its host unwatched', () => {
    const { m, d } = of('uiRun')
    const run = id<RunId>('h1')
    const closed = runStateOf(m, run, { top: { _tag: 'TopTask', task: id('t1'), state: CLOSED } })
    expect(closed._tag).toBe('Closed')
    const draft = id<TaskDraftId>('td2')
    const two = withDraft(m, draft)
    expect(taskDraftStateOf(two, draft, { run: closed })).toEqual({ _tag: 'Dropped' })
    expect(taskDraftStateOf(two, draft, { run: { _tag: 'Talking' } })).toEqual({ _tag: 'Waiting' })
    const live = { ...d, moment: { ...m, outside: { ...m.outside, terminals: TERMINALS } } }
    expect(hostPanesOf(live).map((h) => h.run)).toEqual([run])
    expect(terminalsToWatch(live).some((t) => t.owner._tag === 'Run')).toBe(true)
    const ended: Derived = { ...live, states: { ...d.states, runs: new Map([[run, closed]]) } }
    expect(hostPanesOf(ended)).toEqual([])
    expect(terminalsToWatch(ended).some((t) => t.owner._tag === 'Run')).toBe(false)
    const placement = { _tag: 'OnTask', task: id<TaskId>('t1') } as const
    expect(hostOf(m, placement, ended.states)).toEqual({ _tag: 'NoHost' })
    expect(hostOf(m, placement, d.states)._tag).toBe('Host')
  })
})
const TERMINALS = {
  'host-k0001': { live: true, ended: false, exit: null, lastOutput: 0 },
  's-a2': { live: true, ended: false, exit: null, lastOutput: 0 },
}

describe('version -> draft (S6)', () => {
  test('a new current version makes a draft Outdated, before Vetoed', () => {
    const { m } = of('vetoed')
    const draft = id<RevisionId>('d2')
    const now = { _tag: 'Official', current: id<VersionId>('tsd-writing@1') } as const
    const newer = { _tag: 'Official', current: id<VersionId>('tsd-writing@2') } as const
    expect(revisionStateOf(m, draft, { direction: now })._tag).toBe('Vetoed')
    expect(revisionStateOf(m, draft, { direction: newer })).toEqual({
      _tag: 'Outdated',
      current: id('tsd-writing@2'),
    })
  })
})

describe('forward -> its target (C6): one test per irrelevant rule', () => {
  const ref = (m: Moment) => {
    const f = [...m.work.forwards.keys()][0]
    if (f === undefined) throw new Error('no forward')
    return f
  }
  const waiting: RevisionState = {
    _tag: 'Waiting',
    waitsFor: [{ _tag: 'Human', name: 'Nanda' }],
  }
  const state = (m: Moment, target: Parameters<typeof forwardStateOf>[2]['target']) =>
    forwardStateOf(m, ref(m), { target })
  test('an answer whose question is Answered, or Irrelevant', () => {
    const { m } = of('relay')
    const q = id<QuestionId>('q1')
    const answered = {
      _tag: 'Answered',
      answer: 'yes' as NonBlank,
      by: { _tag: 'Human', name: 'Nanda' },
      when: AT,
    } as const
    expect(state(m, { _tag: 'Question', question: q, state: answered })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'QuestionAnswered', question: q },
    })
    expect(
      state(m, { _tag: 'Question', question: q, state: { _tag: 'Irrelevant', task: id('t1') } }),
    ).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'QuestionIrrelevant', question: q },
    })
  })
  test('an accept of a draft that is decided, or that its person accepted already', () => {
    const { m } = of('relay')
    const draft = id<RevisionId>('d2')
    const official = { _tag: 'Official', version: id<VersionId>('tsd-writing@2') } as const
    expect(state(m, { _tag: 'Revision', draft, state: official })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'DraftDecided', draft },
    })
    expect(state(m, { _tag: 'Revision', draft, state: waiting })).toEqual({ _tag: 'Waiting' })
    const decided = of('relayDecided').m
    expect(state(decided, { _tag: 'Revision', draft, state: waiting })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'PersonAccepted', draft },
    })
  })
  test('an accept of a result that is superseded, accepted, or whose task ended', () => {
    const { m } = of('relay')
    const result = id<ResultId>('r1')
    const r = (s: Parameters<typeof state>[1]) => state(m, s)
    const later = { _tag: 'Superseded', by: id<ResultId>('r2') } as const
    const inReview = { _tag: 'InReview' } as const
    expect(r({ _tag: 'Result', result, state: later, task: OPEN })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'ResultNotCurrent', result },
    })
    expect(r({ _tag: 'Result', result, state: inReview, task: CLOSED })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'ResultNotCurrent', result },
    })
    expect(r({ _tag: 'Result', result, state: { _tag: 'Accepted' }, task: OPEN })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'ResultAccepted', result },
    })
    expect(r({ _tag: 'Result', result, state: inReview, task: OPEN })).toEqual({ _tag: 'Waiting' })
  })
  test('a resolve whose escalation is Resolved or Irrelevant', () => {
    const { m } = of('relay')
    const escalation = id<EscalationId>('v9')
    const resolved = { _tag: 'Resolved', by: id<ReviewId>('v10') } as const
    expect(state(m, { _tag: 'Escalation', escalation, state: resolved })).toEqual({
      _tag: 'Irrelevant',
      why: { _tag: 'EscalationClosed', escalation },
    })
    const ended = { _tag: 'TaskEnded', task: id<TaskId>('t1') } as const
    const irrelevant = { _tag: 'Irrelevant', why: ended } as const
    expect(state(m, { _tag: 'Escalation', escalation, state: irrelevant })._tag).toBe('Irrelevant')
  })
})

describe('owner and decision -> send (C5)', () => {
  const sendOf = (m: Moment): EventRef => {
    const s = m.work.sends[0]
    if (s === undefined) throw new Error('no send')
    return s.id
  }
  test('the owner of its terminal Ended, or its run Done: the send is Irrelevant', () => {
    const { m } = of('uiRun')
    const send = sendOf(m)
    const ended = { _tag: 'Ended', why: { _tag: 'Finished', when: AT } } as const
    const nothing = { _tag: 'Nothing' } as const
    expect(
      sendStateOf(m, send, {
        target: { owner: { _tag: 'Agent', assignment: id('a2'), state: ended }, about: nothing },
      }),
    ).toEqual({ _tag: 'Irrelevant', why: { _tag: 'OwnerEnded', assignment: id('a2') } })
    const done = { _tag: 'Done', at: AT } as const
    expect(
      sendStateOf(m, send, {
        target: { owner: { _tag: 'Host', run: id('h1'), state: done }, about: nothing },
      }),
    ).toEqual({ _tag: 'Irrelevant', why: { _tag: 'RunEnded', run: id('h1') } })
    const working = { _tag: 'Working', tries: { _tag: 'Reviews' } } as const
    expect(
      sendStateOf(m, send, {
        target: { owner: { _tag: 'Agent', assignment: id('a2'), state: working }, about: nothing },
      }),
    ).toEqual({ _tag: 'Pending' })
  })
  test('what it is about is decided: a fixed problem, an opened draft that is not', () => {
    const { m } = of('uiRun')
    const send = sendOf(m)
    const owner = { _tag: 'NoOwner' } as const
    const fixed = { _tag: 'Fixed', by: { _tag: 'Human', name: 'Nanda' }, at: AT } as const
    const problem = id<ProblemId>('sp1')
    expect(
      sendStateOf(m, send, {
        target: { owner, about: { _tag: 'Problem', problem, state: fixed } },
      }),
    ).toEqual({ _tag: 'Irrelevant', why: { _tag: 'ProblemNotOpen', problem } })
    const draft = id<TaskDraftId>('td1')
    expect(
      sendStateOf(m, send, {
        target: { owner, about: { _tag: 'TaskDraft', draft, state: { _tag: 'Dropped' } } },
      }),
    ).toEqual({ _tag: 'Irrelevant', why: { _tag: 'DraftNotOpened', draft } })
  })
})
