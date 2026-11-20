// What wait tells and what is owed (protocol.qnt: the told parts and the obligations): the steps
// of each actor, the obligations of the store, their owners and ages, what discharges them.
import {
  allDone,
  briefStale,
  depthOf,
  innermost,
  fixOf,
  hostFinds,
  liveMaker,
  pipeStage,
  subjectOf,
  testRule,
  uncovered,
} from '../../state/c16/reads.ts'
import type { Fix, Task, WorkState } from '../../state/c16/state.ts'
import {
  type Actor,
  type ActorKey,
  type Body,
  type Obligation,
  type OpenAsk,
  type Owed,
  type Step,
  actorOf,
  isMaker,
  isPersistent,
  keyOf,
} from '../../state/c16/types.ts'

type Tag = Body['_tag']

const HUMAN = keyOf({ _tag: 'Human' })
const HOST = keyOf({ _tag: 'Host' })
const PIPE = keyOf({ _tag: 'Pipe' })
const HARNESS = keyOf({ _tag: 'Harness' })
const roleKey = (name: string): ActorKey => keyOf({ _tag: 'Role', name })
const makerKey = (id: string): ActorKey => keyOf({ _tag: 'Maker', id })

const step = (act: Tag, over: Partial<Step> = {}): Step => ({
  act,
  ask: null,
  task: null,
  fix: null,
  maker: null,
  actor: null,
  ...over,
})

// --- reads ---------------------------------------------------------------------------------------

const subject = subjectOf
const asksOf = (s: WorkState): ReadonlyArray<OpenAsk> => [...s.asks.values()]
const hostAsk = (s: WorkState, task: string): OpenAsk | undefined =>
  asksOf(s).find((a) => a.kind === 'Execute' && a.from._tag === 'Host' && subject(a) === task)
const makerAsk = (s: WorkState, maker: string): OpenAsk | undefined =>
  asksOf(s).find((a) => a.kind === 'Execute' && keyOf(a.to) === makerKey(maker))
const acceptedFix = (s: WorkState): string | null =>
  [...s.fixes].filter(([, f]) => f.stage === 'Accepted').sort(([, f], [, g]) => f.at - g.at)[0]
    ?.[0] ?? null
const recheckDue = (s: WorkState, t: Task): boolean =>
  t.state === 'Done' && [...t.pending].some((x) => !testRule(s, x))
const runRuleDue = (s: WorkState, t: Task): boolean =>
  t.state === 'Done' && [...t.pending].some((x) => testRule(s, x))
const lastDone = (s: WorkState): number => Math.max(0, ...[...s.tasks.values()].map((t) => t.at))

// The task a live maker holds and is up for.
const makerTask = (s: WorkState, actor: Actor): Task | null => {
  if (!isMaker(actor)) return null
  const m = s.makers.get(actor.id)
  const t = m === undefined ? undefined : s.tasks.get(m.task)
  return m === undefined || t === undefined || m.ended || s.down.has(keyOf(actor)) ||
      t.state !== 'Working' || t.maker !== m.id
    ? null
    : t
}

const pipeAct = (f: Fix): Tag | null =>
  f.stage === 'Evaluating'
    ? 'Evaluate'
    : f.stage === 'AtPrinciple' || f.stage === 'AtDirection' || f.stage === 'AtStandard'
    ? 'Advance'
    : f.stage === 'AtRule'
    ? 'WriteRule'
    : f.stage === 'Testing'
    ? 'RunTest'
    : f.stage === 'Drafting'
    ? 'Ship'
    : f.stage === 'InLoop'
    ? 'LoopReview'
    : null
const PIPE_ACTS: ReadonlyArray<Tag> = [
  'Evaluate',
  'Advance',
  'WriteRule',
  'RunTest',
  'Ship',
  'LoopReview',
]

// --- the steps (one builder each, so a told step and a projected one are the same) ---------------

const makeStep = (s: WorkState, task: string): Step =>
  step('Open', { task, ask: hostAsk(s, task)?.id ?? null })
const readOrReport = (s: WorkState, id: string, t: Task): Step => {
  const m = s.makers.get(id)
  const read = m === undefined || !m.claimed || briefStale(s, m.brief, t)
  const ask = makerAsk(s, id)?.id ?? null
  return step(read ? 'ReadBrief' : 'Report', { maker: id, task: t.id, ask })
}
const resumeStep = (s: WorkState, id: string): Step =>
  step('Resume', {
    maker: id,
    task: s.makers.get(id)?.task ?? null,
    ask: makerAsk(s, id)?.id ?? null,
  })
const reviewStep = (a: OpenAsk): Step => step('Review', { ask: a.id, task: subject(a) })
const respondStep = (a: OpenAsk): Step => step('Respond', { ask: a.id, fix: subject(a) })

// --- told ----------------------------------------------------------------------------------------

// An actor's own steps. A step names the act; its content (a verdict, a level) is the sender's.
export const ownToldSteps = (s: WorkState, actor: Actor): ReadonlyArray<Step> => {
  if (s.top.ended) return []
  const k = keyOf(actor)
  const tasks = [...s.tasks.values()]
  const mine = actor._tag === 'Role' ? tasks.filter((t) => t.role === actor.name) : []
  const hostOn = actor._tag === 'Host' && hostFinds(s)
  const maker = makerTask(s, actor)
  const accepted = acceptedFix(s)
  return [
    // open: the host sends the sections no task owns; the role makes a maker per task sent
    ...(hostOn ? uncovered(s).map((x) => step('Open', { task: x })) : []),
    ...mine.filter((t) => t.state === 'Sent').map((t) => makeStep(s, t.id)),
    // hear: the asker hears the answer
    ...[...s.answered.values()].filter((a) => keyOf(a.ask.from) === k).map((a) =>
      step('Hear', { ask: a.ask.id })
    ),
    // read, report: a maker that holds its working task
    ...(maker === null || !isMaker(actor) ? [] : [readOrReport(s, actor.id, maker)]),
    // resume: the role resumes a maker that exited
    ...mine.flatMap((t) => {
      const m = liveMaker(s, t.id)
      return m !== null && s.down.has(makerKey(m)) ? [resumeStep(s, m)] : []
    }),
    // review: the role's check asks
    ...(actor._tag === 'Role'
      ? asksOf(s).filter((a) => a.kind === 'Check' && keyOf(a.to) === k).map(reviewStep)
      : []),
    // the pipeline role's steps, by the stage of each fix
    ...(actor._tag === 'Pipe'
      ? [...s.fixes].flatMap(([id, f]) => {
        const act = pipeAct(f)
        return act === null ? [] : [step(act, { fix: id })]
      })
      : []),
    // decide: the person's replies
    ...(actor._tag === 'Human'
      ? asksOf(s).filter((a) => a.kind === 'Decide').map(respondStep)
      : []),
    ...(hostOn && accepted !== null ? [step('Reassign', { fix: accepted })] : []),
    ...(hostOn && allDone(s) && !s.top.done ? [step('TopDone')] : []),
    ...(actor._tag === 'Pipe'
      ? tasks.filter((t) => recheckDue(s, t)).map((t) => step('RecheckDone', { task: t.id }))
      : []),
    ...(actor._tag === 'Harness'
      ? tasks.filter((t) => runRuleDue(s, t)).map((t) => step('RunRule', { task: t.id }))
      : []),
    ...(actor._tag === 'Human' && s.down.has(HOST) ? [step('Revive', { actor: HOST })] : []),
    ...(actor._tag === 'Harness'
      ? [...s.down].filter((x) => x !== HOST && isPersistent(actorOf(x))).map((x) =>
        step('Revive', { actor: x })
      )
      : []),
    ...(actor._tag === 'Human' && s.top.done && allDone(s) ? [step('EndProject')] : []),
  ]
}

// What an actor is told: its own steps and the questions it owes an answer; an answerer that has
// just answered and has a step of its own is told only its own.
export const toldSteps = (s: WorkState, actor: Actor): ReadonlyArray<Step> => {
  if (s.top.ended) return []
  const own = ownToldSteps(s, actor)
  if (s.justAnswered.has(keyOf(actor)) && own.length > 0) return own
  const k = keyOf(actor)
  return [
    ...own,
    ...asksOf(s).filter((a) => a.kind === 'Question' && keyOf(a.to) === k).map((a) =>
      step('AnswerQuestion', { ask: a.id })
    ),
  ]
}

const stepAge = (s: WorkState, x: Step): number =>
  x.ask !== null
    ? s.asks.get(x.ask)?.at ?? s.answered.get(x.ask)?.at ?? 0
    : x.fix !== null
    ? fixOf(s, x.fix).at
    : x.act === 'TopDone' || x.act === 'EndProject'
    ? lastDone(s)
    : x.task !== null
    ? s.tasks.get(x.task)?.at ?? 0
    : 0

const oldestFirst = <T>(xs: ReadonlyArray<T>, age: (x: T) => number): ReadonlyArray<T> =>
  xs.map((x, n) => ({ x, n, at: age(x) })).sort((p, q) => p.at - q.at || p.n - q.n).map((p) => p.x)

// The steps of an actor's wait, oldest first.
export const dos = (s: WorkState, actor: Actor): ReadonlyArray<Step> =>
  oldestFirst(toldSteps(s, actor), (x) => stepAge(s, x))

// --- obligations ---------------------------------------------------------------------------------

// An open ask is a step owed by its `to`, the innermost open ask of a subject first: a Decide
// over a Check over an Execute (to a maker or the pipeline role) over the host's Execute.
const askObs = (s: WorkState, a: OpenAsk): ReadonlyArray<Obligation> => {
  if (a.kind === 'Question') return [{ _tag: 'AskOb', ask: a.id }]
  if (!innermost(s, a)) return []
  const about = subject(a)
  if (about === null) return []
  // the host's Execute, with the pipeline done (the fix accepted): the host's Reassign
  if (depthOf(a) === 0 && s.tasks.get(about)?.state !== 'Sent') return []
  if (a.to._tag === 'Pipe') {
    return pipeStage(fixOf(s, about).stage) ? [{ _tag: 'PipeOb', fix: about }] : []
  }
  if (a.kind === 'Execute' && a.to._tag === 'Maker' && s.down.has(keyOf(a.to)))
    return [{ _tag: 'ResumeOb', maker: a.to.id }]
  return [{ _tag: 'AskOb', ask: a.id }]
}

// Every branch owes rechecks, the pipeline and revives (the host and roles live as long as the
// project).
export const obligations = (s: WorkState): ReadonlyArray<Obligation> => {
  if (s.top.ended) return []
  const tasks = [...s.tasks.values()]
  return [
    ...[...s.down].filter((x) => isPersistent(actorOf(x))).map((x): Obligation => ({
      _tag: 'ReviveOb',
      actor: x,
    })),
    ...(allDone(s)
      ? [(s.top.done ? { _tag: 'EndOb' } : { _tag: 'TopDoneOb' }) satisfies Obligation]
      : []),
    ...(acceptedFix(s) !== null ? [{ _tag: 'ReassignOb' } as const] : []),
    ...uncovered(s).map((x): Obligation => ({ _tag: 'SendOb', task: x })),
    ...asksOf(s).flatMap((a) => askObs(s, a)),
    ...[...s.answered.keys()].map((x): Obligation => ({ _tag: 'HearOb', ask: x })),
    ...tasks.flatMap((t): ReadonlyArray<Obligation> => [
      ...(recheckDue(s, t) ? [{ _tag: 'RecheckOb', task: t.id } as const] : []),
      ...(runRuleDue(s, t) ? [{ _tag: 'RuleRunOb', task: t.id } as const] : []),
    ]),
  ]
}

const askOf = (s: WorkState, id: string): OpenAsk => {
  const a = s.asks.get(id)
  if (a === undefined) throw new Error(`no open ask ${id}`)
  return a
}

// Who owes it: the one told a step that discharges it.
const ownerOf = (s: WorkState, ob: Obligation): ActorKey => {
  switch (ob._tag) {
    case 'EndOb':
      return HUMAN
    case 'SendOb':
    case 'TopDoneOb':
    case 'ReassignOb':
      return HOST
    case 'AskOb':
      return keyOf(askOf(s, ob.ask).to)
    case 'HearOb':
      return keyOf((s.answered.get(ob.ask) ?? { ask: askOf(s, ob.ask) }).ask.from)
    case 'ResumeOb': {
      const task = s.tasks.get(s.makers.get(ob.maker)?.task ?? '')
      return task === undefined ? HARNESS : roleKey(task.role)
    }
    case 'PipeOb':
    case 'RecheckOb':
      return PIPE
    case 'ReviveOb':
      return ob.actor === HOST ? HUMAN : HARNESS
    case 'RuleRunOb':
      return HARNESS
  }
}

// The seq of the ask or state it waits on (0 when nothing records it).
const ageOf = (s: WorkState, ob: Obligation): number => {
  switch (ob._tag) {
    case 'AskOb':
      return askOf(s, ob.ask).at
    case 'HearOb':
      return s.answered.get(ob.ask)?.at ?? 0
    case 'ResumeOb':
      return stepAge(s, resumeStep(s, ob.maker))
    case 'PipeOb':
      return fixOf(s, ob.fix).at
    case 'ReassignOb': {
      const id = acceptedFix(s)
      return id === null ? 0 : fixOf(s, id).at
    }
    case 'RecheckOb':
    case 'RuleRunOb':
      return s.tasks.get(ob.task)?.at ?? 0
    case 'EndOb':
    case 'TopDoneOb':
      return lastDone(s)
    case 'SendOb':
    case 'ReviveOb':
      return 0
  }
}

// Everything owed, oldest first.
export const owed = (s: WorkState): ReadonlyArray<Owed> =>
  oldestFirst(
    obligations(s).map((ob): Owed => ({ ob, owner: ownerOf(s, ob), age: ageOf(s, ob) })),
    (o) => o.age,
  )

// The step an obligation asks for. An AskOb alone does not say which act follows: the kind of the
// ask and the state do.
export const projectStep = (s: WorkState, ob: Obligation): Step => {
  switch (ob._tag) {
    case 'EndOb':
      return step('EndProject')
    case 'TopDoneOb':
      return step('TopDone')
    case 'SendOb':
      return step('Open', { task: ob.task })
    case 'ReassignOb':
      return step('Reassign', { fix: acceptedFix(s) })
    case 'HearOb':
      return step('Hear', { ask: ob.ask })
    case 'ResumeOb':
      return resumeStep(s, ob.maker)
    case 'PipeOb': {
      const act = pipeAct(fixOf(s, ob.fix))
      if (act === null) throw new Error(`fix ${ob.fix} is not at a pipeline stage`)
      return step(act, { fix: ob.fix })
    }
    case 'ReviveOb':
      return step('Revive', { actor: ob.actor })
    case 'RecheckOb':
      return step('RecheckDone', { task: ob.task })
    case 'RuleRunOb':
      return step('RunRule', { task: ob.task })
    case 'AskOb': {
      const a = askOf(s, ob.ask)
      const about = subject(a)
      if (a.kind === 'Question') return step('AnswerQuestion', { ask: a.id })
      if (a.kind === 'Decide') return respondStep(a)
      if (a.kind === 'Check') return reviewStep(a)
      const task = about === null ? undefined : s.tasks.get(about)
      if (a.from._tag === 'Host' && about !== null) return makeStep(s, about)
      if (a.to._tag === 'Maker' && task !== undefined) return readOrReport(s, a.to.id, task)
      throw new Error(`no step for ask ${a.id}`)
    }
  }
}

// Does `step`, taken by `actor`, discharge the obligation? Only the acts named for it do.
export const discharges = (ob: Obligation, actor: Actor, x: Step): boolean => {
  switch (ob._tag) {
    case 'EndOb':
      return x.act === 'EndProject'
    case 'TopDoneOb':
      return x.act === 'TopDone'
    case 'SendOb':
      return x.act === 'Open' && x.ask === null && x.task === ob.task
    case 'AskOb':
      return x.ask === ob.ask && x.act !== 'Hear'
    case 'HearOb':
      return x.act === 'Hear' && x.ask === ob.ask
    case 'ResumeOb':
      return x.act === 'Resume' && x.maker === ob.maker
    case 'PipeOb':
      return actor._tag === 'Pipe' && PIPE_ACTS.includes(x.act) && x.fix === ob.fix
    case 'ReassignOb':
      return x.act === 'Reassign'
    case 'ReviveOb':
      return x.act === 'Revive' && x.actor === ob.actor
    case 'RecheckOb':
      return x.act === 'RecheckDone' && x.task === ob.task
    case 'RuleRunOb':
      return x.act === 'RunRule' && x.task === ob.task
  }
}

const actorsOf = (s: WorkState): ReadonlyArray<Actor> => [
  { _tag: 'Human' },
  { _tag: 'Harness' },
  { _tag: 'Host' },
  { _tag: 'Pipe' },
  ...[...new Set([...s.cards.keys(), ...[...s.tasks.values()].map((t) => t.role)])].map(
    (name): Actor => ({ _tag: 'Role', name }),
  ),
  ...[...s.makers.keys()].map((id): Actor => ({ _tag: 'Maker', id })),
]

const toldAny = (s: WorkState, ob: Obligation): ReadonlyArray<ActorKey> =>
  actorsOf(s).filter((a) => toldSteps(s, a).some((x) => discharges(ob, a, x))).map(keyOf)

// Final: the project ended, or what is owed is owed by the person only (a step of the host whose
// exit is recorded waits for the person, who starts it again: Revive Host).
export const finalOf = (s: WorkState): boolean => {
  if (s.top.ended) return true
  const obs = obligations(s)
  return obs.length > 0 && obs.every((ob) =>
    ownerOf(s, ob) === HUMAN || (s.down.has(HOST) && toldAny(s, ob).includes(HOST))
  )
}
