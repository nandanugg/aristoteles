// The told steps and the obligations of work.qnt in TS: what each actor's wait prints, what
// must happen next, who owes it, and whether only the person is left to act.
import { briefOld, testRule } from '../../state/work/items.ts'
import {
  allDone,
  fx,
  hostFinds,
  liveMaker,
  pipeStage,
  uncovered,
} from '../../state/work/reads.ts'
import type { Actor, WhatTag, WorkState } from '../../state/work/types.ts'
import {
  HARNESS,
  HOST,
  PERSON,
  PIPE,
  free,
  isMakerActor,
  isPersistent,
  isRoleActor,
  makerActor,
  roleActor,
} from '../../state/work/types.ts'
import { recheckDue } from './accept.ts'

// target: the task, maker, fix or actor the step is about (null: none).
export type Step = { readonly tag: WhatTag; readonly target: string | null }
const step = (tag: WhatTag, target: string | null = null): Step => ({ tag, target })

export const pipeDo = (st: string, i: string): ReadonlyArray<Step> =>
  st === 'SEval'
    ? [step('Evaluate', i)]
    : st === 'SPrinciple' || st === 'SDirAssess' || st === 'SStdAssess'
    ? [step('Advance', i)]
    : st === 'SRuleAssess'
    ? [step('WriteRule', i)]
    : st === 'STest'
    ? [step('RunTest', i)]
    : st === 'SDraft'
    ? [step('Ship', i)]
    : st === 'SLoop'
    ? [step('LoopReview', i)]
    : []

export const makerDos = (s: WorkState, m: string): ReadonlyArray<Step> => {
  const mm = s.makers.get(m)
  const t = mm === undefined ? undefined : s.tasks.get(mm.task)
  if (mm === undefined || t === undefined || mm.ended || s.down.has(makerActor(m))) return []
  if (t.st !== 'Working' || t.maker !== m) return []
  return [step(!mm.claim || briefOld(s, mm.brief, t) ? 'ReadBrief' : 'Report', m)]
}

// The tags whose target is a fix (its age is the fix's); the rest are tasks, makers, actors.
const FIX_TAGS: ReadonlySet<WhatTag> = new Set([
  'Accept',
  'SendBack',
  'Decide',
  'Evaluate',
  'Advance',
  'WriteRule',
  'RunTest',
  'Ship',
  'LoopReview',
])
const ageOfTarget = (s: WorkState, fixTarget: boolean, target: string | null): number =>
  target === null ? 0 : fixTarget ? fx(s, target).at : s.tasks.get(target)?.at ?? 0
const makerAge = (s: WorkState, m: string | null): number =>
  m === null ? 0 : ageOfTarget(s, false, s.makers.get(m)?.task ?? null)
const stepAge = (s: WorkState, x: Step): number =>
  x.tag === 'ReadBrief' || x.tag === 'Report' || x.tag === 'Resume'
    ? makerAge(s, x.target)
    : ageOfTarget(s, FIX_TAGS.has(x.tag), x.target)

const byAge = (s: WorkState, xs: ReadonlyArray<Step>): ReadonlyArray<Step> =>
  xs
    .map((x, n) => ({ x, n, at: stepAge(s, x) }))
    .sort((p, q) => p.at - q.at || p.n - q.n)
    .map((p) => p.x)

const fixEntries = (s: WorkState): ReadonlyArray<[string, ReturnType<typeof fx>]> => [...s.fixes]

// The steps of an actor's wait, oldest first.
export const dos = (s: WorkState, k: Actor): ReadonlyArray<Step> => {
  if (s.top.ended) return []
  const tasks = [...s.tasks.values()]
  if (k === PERSON) {
    const drafts = fixEntries(s).filter(([, f]) => f.stage === 'SAtPerson')
    const decide = drafts.filter(([i]) => s.tasks.has(i))
    return byAge(s, [
      ...(s.top.done && allDone(s) ? [step('EndProject')] : []),
      ...drafts.map(([i]) => step('Accept', i)),
      ...drafts.map(([i]) => step('SendBack', i)),
      ...decide.map(([i]) => step('Decide', i)),
      ...(s.down.has(HOST) ? [step('Revive', HOST)] : []),
    ])
  }
  if (k === HOST) {
    if (!hostFinds(s)) return []
    return [
      ...(uncovered(s).length > 0 ? [step('SendTask')] : []),
      ...(fixEntries(s).some(([, f]) => f.stage === 'SAccepted') ? [step('Reassign')] : []),
      ...(allDone(s) && !s.top.done ? [step('TopDone')] : []),
    ]
  }
  if (isRoleActor(k)) {
    const mine = tasks.filter((t) => roleActor(t.role) === k)
    return byAge(s, [
      ...mine.filter((t) => t.st === 'Sent').map((t) => step('AssignDo', t.id)),
      ...mine.filter((t) => t.st === 'InReview').map((t) => step('Review', t.id)),
      ...mine.flatMap((t) => {
        const m = liveMaker(s, t.id)
        return m !== null && s.down.has(makerActor(m)) ? [step('Resume', m)] : []
      }),
    ])
  }
  if (k === PIPE) {
    return byAge(s, [
      ...fixEntries(s).flatMap(([i, f]) => (free(i) ? pipeDo(f.stage, i) : [])),
      ...tasks.flatMap((t) => [
        ...pipeDo(fx(s, t.id).stage, t.id),
        ...(recheckDue(s, t.id) ? [step('RecheckDone', t.id)] : []),
      ]),
    ])
  }
  if (k === HARNESS) {
    return byAge(s, [
      ...[PIPE, ...[...s.cards.keys()].map(roleActor)]
        .filter((p) => s.down.has(p))
        .map((p) => step('Revive', p)),
      ...tasks
        .filter((t) => t.st === 'Done' && [...t.pend].some((x) => testRule(s, x)))
        .map((t) => step('RunRule', t.id)),
    ])
  }
  return isMakerActor(k) ? byAge(s, makerDos(s, k.slice('maker:'.length))) : []
}

export type ObTag =
  | 'EndOb'
  | 'TopDoneOb'
  | 'SendOb'
  | 'AssignOb'
  | 'MakeOb'
  | 'ResumeOb'
  | 'ReviewOb'
  | 'PipeOb'
  | 'DraftOb'
  | 'DecideOb'
  | 'ReassignOb'
  | 'ReviveOb'
  | 'RecheckOb'
  | 'RuleRunOb'
// target: a task, a maker (MakeOb, ResumeOb), a fix (PipeOb, DraftOb, DecideOb), an actor
// (ReviveOb); null for SendOb (the host owes a task while sections are uncovered), EndOb,
// TopDoneOb and ReassignOb. MakeOb of a working task with no maker has a null target.
export type Ob = { readonly tag: ObTag; readonly target: string | null }
const ob = (tag: ObTag, target: string | null = null): Ob => ({ tag, target })

// A fix with no raised task owes the pipeline role, then the person, then the host.
const fixObs = (s: WorkState, i: string): ReadonlyArray<Ob> => {
  const st = fx(s, i).stage
  return pipeStage(st)
    ? [ob('PipeOb', i)]
    : st === 'SAtPerson'
    ? [ob('DraftOb', i)]
    : st === 'SAccepted'
    ? [ob('ReassignOb')]
    : []
}

export const obligationsOf = (s: WorkState): ReadonlyArray<Ob> => {
  if (s.top.ended) return []
  const out: Ob[] = [
    ...[...s.down].filter(isPersistent).map((p) => ob('ReviveOb', p)),
    ...[...s.fixes.keys()].filter(free).flatMap((i) => fixObs(s, i)),
    ...(uncovered(s).length > 0 ? [ob('SendOb')] : []),
    ...(allDone(s) ? [ob(s.top.done ? 'EndOb' : 'TopDoneOb')] : []),
  ]
  for (const t of s.tasks.values()) {
    if (t.st === 'Sent') out.push(ob('AssignOb', t.id))
    else if (t.st === 'Working') {
      const down = t.maker !== null && s.down.has(makerActor(t.maker))
      out.push(down ? ob('ResumeOb', t.maker) : ob('MakeOb', t.maker))
    } else if (t.st === 'InReview') out.push(ob('ReviewOb', t.id))
    else if (t.st === 'Raised') out.push(...fixObs(s, t.id))
    else if (t.st === 'Done') {
      if ([...t.pend].some((x) => !testRule(s, x))) out.push(ob('RecheckOb', t.id))
      if ([...t.pend].some((x) => testRule(s, x))) out.push(ob('RuleRunOb', t.id))
    }
  }
  const seen = new Set<string>()
  return out.filter((o) => {
    const key = `${o.tag}:${o.target}`
    return seen.has(key) ? false : (seen.add(key), true)
  })
}

const PIPE_TAGS: ReadonlyArray<WhatTag> = [
  'Evaluate',
  'Advance',
  'WriteRule',
  'RunTest',
  'Ship',
  'LoopReview',
]
const DRAFT_TAGS: ReadonlyArray<WhatTag> = ['Accept', 'SendBack', 'Decide']

export const discharges = (o: Ob, k: Actor, x: Step): boolean => {
  const same = x.target === o.target
  switch (o.tag) {
    case 'EndOb':
      return x.tag === 'EndProject'
    case 'TopDoneOb':
      return x.tag === 'TopDone'
    case 'SendOb':
      return x.tag === 'SendTask'
    case 'AssignOb':
      return x.tag === 'AssignDo' && same
    case 'MakeOb':
      return (
        o.target !== null &&
        k === makerActor(o.target) &&
        (x.tag === 'ReadBrief' || x.tag === 'Report') &&
        same
      )
    case 'ResumeOb':
      return x.tag === 'Resume' && same
    case 'ReviewOb':
      return x.tag === 'Review' && same
    case 'PipeOb':
      return k === PIPE && PIPE_TAGS.includes(x.tag) && same
    case 'DraftOb':
      return DRAFT_TAGS.includes(x.tag) && same
    case 'DecideOb':
      return x.tag === 'Decide' && same
    case 'ReassignOb':
      return x.tag === 'Reassign'
    case 'ReviveOb':
      return x.tag === 'Revive' && same
    case 'RecheckOb':
      return x.tag === 'RecheckDone' && same
    case 'RuleRunOb':
      return x.tag === 'RunRule' && same
  }
}

export const isPersonOb = (o: Ob): boolean =>
  o.tag === 'EndOb' ||
  o.tag === 'DraftOb' ||
  o.tag === 'DecideOb' ||
  (o.tag === 'ReviveOb' && o.target === HOST)

const roleOfTask = (s: WorkState, i: string | null): Actor => {
  const r = i === null ? undefined : s.tasks.get(i)?.role
  return r === undefined ? HARNESS : roleActor(r)
}

// Who must act. A working task with no maker is owed by nobody the model names: the harness.
export const ownerOf = (s: WorkState, o: Ob): Actor => {
  if (isPersonOb(o)) return PERSON
  switch (o.tag) {
    case 'SendOb':
    case 'TopDoneOb':
    case 'ReassignOb':
      return HOST
    case 'AssignOb':
    case 'ReviewOb':
      return roleOfTask(s, o.target)
    case 'ResumeOb':
      return roleOfTask(s, o.target === null ? null : s.makers.get(o.target)?.task ?? null)
    case 'MakeOb':
      return o.target === null ? HARNESS : makerActor(o.target)
    case 'PipeOb':
    case 'RecheckOb':
      return PIPE
    default:
      return HARNESS
  }
}

// The seq of the task or fix it is about (0 when it has none).
export const ageOf = (s: WorkState, o: Ob): number => {
  switch (o.tag) {
    case 'PipeOb':
    case 'DraftOb':
    case 'DecideOb':
      return ageOfTarget(s, true, o.target)
    case 'MakeOb':
    case 'ResumeOb':
      return makerAge(s, o.target)
    case 'AssignOb':
    case 'ReviewOb':
    case 'RecheckOb':
    case 'RuleRunOb':
      return ageOfTarget(s, false, o.target)
    default:
      return 0
  }
}

const actorsOf = (s: WorkState): ReadonlyArray<Actor> => [
  PERSON,
  HARNESS,
  HOST,
  PIPE,
  ...[...s.cards.keys()].map(roleActor),
  ...[...s.makers.keys()].map(makerActor),
]

export const toldAny = (s: WorkState, o: Ob): ReadonlyArray<Actor> =>
  actorsOf(s).filter((k) => dos(s, k).some((x) => discharges(o, k, x)))

// Waits on the person: theirs to do, or a host step whose exit is recorded (they start it).
export const waitsOnPerson = (s: WorkState, o: Ob): boolean =>
  isPersonOb(o) || (s.down.has(HOST) && toldAny(s, o).includes(HOST))

// Final: the project ended, or what is owed is owed by the person only.
export const finalOf = (s: WorkState): boolean => {
  if (s.top.ended) return true
  const obs = obligationsOf(s)
  return obs.length > 0 && obs.every((o) => waitsOnPerson(s, o))
}
