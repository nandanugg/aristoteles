// The told steps and obligations (obligations.ts) on states built by hand: the six states of the
// contract, the alternation of an answerer, the owners, the state-aware projection.
import { describe, expect, test } from 'bun:test'
import { advance, openAsk } from '../../state/c16/reads.ts'
import {
  CLOSED,
  type Fix,
  type Maker,
  type Task,
  type WorkState,
  initState,
} from '../../state/c16/state.ts'
import {
  type Actor,
  type AskAbout,
  type AskKind,
  type Obligation,
  type Step,
  actorOf,
  keyOf,
} from '../../state/c16/types.ts'
import {
  discharges,
  dos,
  finalOf,
  obligations,
  owed,
  ownToldSteps,
  projectStep,
  toldSteps,
} from './obligations.ts'

const human: Actor = { _tag: 'Human' }
const host: Actor = { _tag: 'Host' }
const pipe: Actor = { _tag: 'Pipe' }
const harness: Actor = { _tag: 'Harness' }
const dev: Actor = { _tag: 'Role', name: 'dev' }
const maker = (id: string): Actor => ({ _tag: 'Maker', id })
const taskAbout = (id: string): AskAbout => ({ _tag: 'Task', id })
const fixAbout = (id: string): AskAbout => ({ _tag: 'Fix', id })

const base = (sections: ReadonlyArray<string> = ['a', 'b']): WorkState => ({
  ...initState({ name: 't', goal: 'g', sections, directions: [] }, new Map(), new Map(), 3),
  seq: 1,
})
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  name: id,
  goal: '',
  role: 'dev',
  parent: null,
  sections: [id === 't1' ? 'a' : 'b'],
  directions: [],
  generation: 0,
  state: 'Sent',
  tries: 0,
  maker: null,
  resultId: 0,
  checked: new Map(),
  pending: new Set(),
  caught: new Set(),
  taken: false,
  floor: 'Standard',
  at: 1,
  ...over,
})
const withTasks = (s: WorkState, ...ts: ReadonlyArray<Task>): WorkState => ({
  ...s,
  tasks: new Map(ts.map((t) => [t.id, t])),
})
const withMaker = (
  s: WorkState,
  id: string,
  taskId: string,
  over: Partial<Maker> = {},
): WorkState => {
  const m: Maker = {
    id,
    task: taskId,
    ended: false,
    claimed: false,
    brief: new Map(),
    revisions: 0,
    ...over,
  }
  return { ...s, makers: new Map([...s.makers, [id, m]]) }
}
const withFix = (s: WorkState, id: string, over: Partial<Fix>): WorkState => ({
  ...s,
  fixes: new Map([...s.fixes, [id, { ...CLOSED, ...over }]]),
})
// Opens an ask at the next seq.
const ask = (
  s: WorkState,
  kind: AskKind,
  from: Actor,
  to: Actor,
  about: AskAbout,
  question: Parameters<typeof openAsk>[2] = null,
): WorkState => advance(openAsk(s, { kind, from, to, about }, question).state)

const label = (x: Step): string =>
  `${x.act}:${x.ask ?? x.fix ?? x.task ?? x.maker ?? x.actor ?? ''}`
const told = (s: WorkState, a: Actor) => toldSteps(s, a).map(label)
const lines = (s: WorkState, a: Actor) => dos(s, a).map(label)
const owedOf = (s: WorkState, a: Actor) =>
  owed(s).filter((o) => o.owner === keyOf(a)).map((o) => o.ob._tag)
const obsOf = (s: WorkState, a: Actor): ReadonlyArray<Obligation> =>
  owed(s).filter((o) => o.owner === keyOf(a)).map((o) => o.ob)

// Every obligation has an owner who is told a step that discharges it, and the projection of the
// obligation is that step.
const everyOwned = (s: WorkState): void => {
  for (const o of owed(s)) {
    const a = actorOf(o.owner)
    const steps = toldSteps(s, a)
    expect(steps.some((x) => discharges(o.ob, a, x))).toBe(true)
    expect(steps).toContainEqual(projectStep(s, o.ob))
  }
}

// The six states of the contract.
const fresh = (): WorkState => base()
const working = (): WorkState => {
  let s = withTasks(base(['a']), task('t1', { state: 'Working', maker: 'm1' }))
  s = withMaker(s, 'm1', 't1')
  s = ask(s, 'Execute', host, dev, taskAbout('t1'))
  return ask(s, 'Execute', dev, maker('m1'), taskAbout('t1'))
}
const inReview = (): WorkState => {
  let s = withTasks(base(['a']), task('t1', { state: 'InReview', maker: 'm1' }))
  s = withMaker(s, 'm1', 't1')
  s = ask(s, 'Execute', host, dev, taskAbout('t1'))
  return ask(s, 'Check', maker('m1'), dev, taskAbout('t1'))
}
const draftAtPerson = (): WorkState => {
  let s = withFix(withTasks(base(['a']), task('t1', { state: 'Raised' })), 't1', {
    stage: 'AtPerson',
    at: 4,
  })
  s = ask(s, 'Execute', host, dev, taskAbout('t1'))
  s = ask(s, 'Execute', dev, pipe, fixAbout('t1'))
  return ask(s, 'Decide', pipe, human, fixAbout('t1'))
}
const single = { title: 'which?', form: { _tag: 'Single' } } as const
const questionToPerson = (): WorkState =>
  ask(working(), 'Question', dev, human, { _tag: 'None' }, single)
const hostDown = (): WorkState => ({ ...fresh(), down: new Set([keyOf(host)]) })

describe('owed lists for the six states', () => {
  test('fresh: the host owes a task per uncovered section, nobody else', () => {
    const s = fresh()
    expect(owed(s).map((o) => [o.ob, o.owner])).toEqual([
      [{ _tag: 'SendOb', task: 'a' }, 'host'],
      [{ _tag: 'SendOb', task: 'b' }, 'host'],
    ])
    expect(lines(s, host)).toEqual(['Open:a', 'Open:b'])
    expect(lines(s, dev)).toEqual([])
    expect(lines(s, human)).toEqual([])
    everyOwned(s)
  })

  test('a host the wait does not find is told nothing', () => {
    expect(ownToldSteps({ ...fresh(), session: 1 }, host)).toEqual([])
  })

  test('working: the maker reads its brief, then reports; the role and host wait', () => {
    const s = working()
    expect(owed(s).map((o) => [o.ob._tag, o.owner, o.age])).toEqual([['AskOb', 'maker:m1', 2]])
    expect(lines(s, maker('m1'))).toEqual(['ReadBrief:2'])
    expect(lines(s, dev)).toEqual([])
    expect(lines(s, host)).toEqual([])
    everyOwned(s)
    const claimed = withMaker(s, 'm1', 't1', { claimed: true })
    expect(lines(claimed, maker('m1'))).toEqual(['Report:2'])
    everyOwned(claimed)
  })

  test('in review: the role owes the verdict', () => {
    const s = inReview()
    expect(owedOf(s, dev)).toEqual(['AskOb'])
    expect(owedOf(s, maker('m1'))).toEqual([])
    expect(lines(s, dev)).toEqual(['Review:2'])
    expect(lines(s, maker('m1'))).toEqual([])
    everyOwned(s)
  })

  test('a draft at the person: the person decides, the pipeline role waits', () => {
    const s = draftAtPerson()
    expect(owed(s).map((o) => [o.ob._tag, o.owner])).toEqual([['AskOb', 'human']])
    expect(lines(s, human)).toEqual(['Respond:3'])
    expect(lines(s, pipe)).toEqual([])
    expect(projectStep(s, obsOf(s, human)[0]!)).toMatchObject({ act: 'Respond', fix: 't1' })
    expect(finalOf(s)).toBe(true)
    everyOwned(s)
  })

  test('a question to the person: the person is told to answer it', () => {
    const s = questionToPerson()
    expect(owedOf(s, human)).toEqual(['AskOb'])
    expect(lines(s, human)).toEqual(['AnswerQuestion:3'])
    expect(owedOf(s, maker('m1'))).toEqual(['AskOb'])
    expect(finalOf(s)).toBe(false)
    everyOwned(s)
  })

  test('the host down: the person revives it; the host steps wait for the person', () => {
    const s = hostDown()
    expect(owed(s).map((o) => [o.ob._tag, o.owner])).toEqual([
      ['ReviveOb', 'human'],
      ['SendOb', 'host'],
      ['SendOb', 'host'],
    ])
    expect(lines(s, human)).toEqual(['Revive:host'])
    expect(finalOf(s)).toBe(true)
    everyOwned(s)
    const pipeDown = { ...fresh(), down: new Set([keyOf(pipe)]) }
    expect(lines(pipeDown, harness)).toEqual(['Revive:pipe'])
    expect(finalOf(pipeDown)).toBe(false)
    everyOwned(pipeDown)
  })
})

describe('the projection of an AskOb depends on the state', () => {
  test('a host Execute is OpenMake for the role; a question is AnswerQuestion', () => {
    let s = withTasks(base(['a']), task('t1'))
    s = ask(s, 'Execute', host, dev, taskAbout('t1'))
    expect(told(s, dev)).toEqual(['Open:1'])
    expect(projectStep(s, { _tag: 'AskOb', ask: '1' })).toMatchObject({
      act: 'Open',
      task: 't1',
      ask: '1',
    })
    everyOwned(s)
    const q = ask(s, 'Question', host, pipe, { _tag: 'None' }, single)
    expect(projectStep(q, { _tag: 'AskOb', ask: '2' }).act).toBe('AnswerQuestion')
  })

  test('only the innermost ask of a subject is owed (ids shared by a task and its fix)', () => {
    const s = draftAtPerson()
    expect(obligations(s)).toEqual([{ _tag: 'AskOb', ask: '3' }])
  })

  test('a raise to the pipeline role is a PipeOb by the stage of its fix', () => {
    let s = withFix(withTasks(base(['a']), task('t1', { state: 'Raised' })), 't1', {
      stage: 'AtRule',
      at: 5,
    })
    s = ask(s, 'Execute', host, dev, taskAbout('t1'))
    s = ask(s, 'Execute', dev, pipe, fixAbout('t1'))
    expect(obligations(s)).toEqual([{ _tag: 'PipeOb', fix: 't1' }])
    expect(lines(s, pipe)).toEqual(['WriteRule:t1'])
    expect(projectStep(s, { _tag: 'PipeOb', fix: 't1' }).act).toBe('WriteRule')
    everyOwned(s)
    expect(owed(s)[0]!.age).toBe(5)
  })

  test('a down maker is a ResumeOb for its role', () => {
    let s = withTasks(base(['a']), task('t1', { state: 'Working', maker: 'm1' }))
  s = withMaker(s, 'm1', 't1')
    s = ask(s, 'Execute', host, dev, taskAbout('t1'))
    s = ask(s, 'Execute', dev, maker('m1'), taskAbout('t1'))
    s = { ...s, down: new Set([keyOf(maker('m1'))]) }
    expect(owed(s).map((o) => [o.ob._tag, o.owner])).toEqual([['ResumeOb', 'role:dev']])
    expect(lines(s, dev)).toEqual(['Resume:2'])
    expect(lines(s, maker('m1'))).toEqual([])
    everyOwned(s)
  })
})

describe('done tasks, the end, the accepted fix', () => {
  test('rechecks go to the pipeline role, test rules to the harness', () => {
    const items = new Map([
      ['rule:r1', { kind: 'rule', form: 'Mech' }],
      ['rule:r2', { kind: 'rule', form: 'Ref' }],
    ])
    const s0 = withTasks(
      base(['a']),
      task('t1', { state: 'Done', pending: new Set(['rule:r2']), at: 6 }),
    )
    const s = { ...s0, items: items as unknown as WorkState['items'] }
    expect(obligations(s)).toEqual([{ _tag: 'RecheckOb', task: 't1' }])
    expect(lines(s, pipe)).toEqual(['RecheckDone:t1'])
    everyOwned(s)
  })

  test('all done: the host owes TopDone, then the person EndProject', () => {
    const s = withTasks(base(['a']), task('t1', { state: 'Done', at: 7 }))
    expect(obligations(s)).toEqual([{ _tag: 'TopDoneOb' }])
    expect(lines(s, host)).toEqual(['TopDone:'])
    everyOwned(s)
    const d = { ...s, top: { ...s.top, done: true } }
    expect(obligations(d)).toEqual([{ _tag: 'EndOb' }])
    expect(lines(d, human)).toEqual(['EndProject:'])
    expect(owed(d)[0]!.age).toBe(7)
    expect(finalOf(d)).toBe(true)
    everyOwned(d)
    const ended = { ...d, top: { ...d.top, ended: true } }
    expect(obligations(ended)).toEqual([])
    expect(toldSteps(ended, human)).toEqual([])
    expect(finalOf(ended)).toBe(true)
  })

  test('an accepted fix owes Reassign to the host', () => {
    let s = withFix(withTasks(base(['a']), task('t1', { state: 'Raised' })), 't1', {
      stage: 'Accepted',
      at: 8,
    })
    s = ask(s, 'Execute', host, dev, taskAbout('t1'))
    expect(obligations(s)).toEqual([{ _tag: 'ReassignOb' }])
    expect(lines(s, host)).toEqual(['Reassign:t1'])
    everyOwned(s)
  })
})

describe('oldest first, and the answerer alternation', () => {
  test('dos and owed list the oldest first', () => {
    let s = withTasks(
      base(['a', 'b']),
      task('t1', { state: 'InReview', maker: 'm1' }),
      task('t2', { state: 'InReview', maker: 'm2' }),
    )
    s = withMaker(withMaker(s, 'm1', 't1'), 'm2', 't2')
    s = ask(s, 'Check', maker('m2'), dev, taskAbout('t2'))
    s = ask(s, 'Check', maker('m1'), dev, taskAbout('t1'))
    expect(lines(s, dev)).toEqual(['Review:1', 'Review:2'])
    expect(owed(s).map((o) => o.age)).toEqual([1, 2])
    everyOwned(s)
  })

  // F1.11: the role has its own steps (make a maker, hear an answer) and two questions to answer.
  const crowded = (): WorkState => {
    let s = withTasks(base(['a']), task('t1'))
    s = ask(s, 'Execute', host, dev, taskAbout('t1'))
    s = ask(s, 'Question', host, dev, { _tag: 'None' }, single)
    s = ask(s, 'Question', pipe, dev, { _tag: 'None' }, single)
    const spec = { kind: 'Question', from: dev, to: human, about: { _tag: 'None' } } as const
    const q = openAsk(s, spec, single)
    const answered = {
      ask: q.ask,
      answer: { _tag: 'Single', text: 'x' } as const,
      at: 9,
    }
    return { ...q.state, asks: new Map([...s.asks]), answered: new Map([[q.ask.id, answered]]) }
  }

  test('not just answered: own steps and the questions, oldest first', () => {
    const s = crowded()
    expect(told(s, dev)).toEqual(['Open:1', 'Hear:4', 'AnswerQuestion:2', 'AnswerQuestion:3'])
    expect(lines(s, dev)).toEqual(['Open:1', 'AnswerQuestion:2', 'AnswerQuestion:3', 'Hear:4'])
  })

  test('just answered with own steps: only the own steps, Hear included', () => {
    const s = { ...crowded(), justAnswered: new Set([keyOf(dev)]) }
    expect(told(s, dev)).toEqual(['Open:1', 'Hear:4'])
    expect(owed(s).map((o) => o.ob._tag).sort()).toEqual(['AskOb', 'AskOb', 'AskOb', 'HearOb'])
  })

  test('just answered with no own step: it answers again', () => {
    const s0 = crowded()
    const s = {
      ...s0,
      justAnswered: new Set([keyOf(dev)]),
      tasks: new Map(),
      answered: new Map(),
    }
    expect(told(s, dev)).toEqual(['AnswerQuestion:2', 'AnswerQuestion:3'])
  })
})
