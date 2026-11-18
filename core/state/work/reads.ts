// The reads of work.qnt that the effects, the store's check and the told steps share: CLOSED,
// the start state, tk/fx, epOf, liveMaker, allDone, hostFinds, the stage ladder.
import type {
  Actor,
  Fix,
  ItemKey,
  ItemRec,
  Level,
  Maker,
  RoleDraft,
  Stage,
  Task,
  Top,
  WorkState,
} from './types.ts'

const NONE: ReadonlySet<never> = new Set()

export const CLOSED: Fix = {
  stage: 'SClosed',
  entry: 'SClosed',
  level: 'Standard',
  kind: 'DDir',
  form: 'none',
  ruleTries: 0,
  items: NONE,
  real: NONE,
  draft: new Map(),
  roleDraft: null,
  roleOnly: false,
  base: new Map(),
  cardBase: 0,
  rev: 0,
  sentBack: NONE,
  needRevise: false,
  loops: 0,
  step: 0,
  wrote: NONE,
  climb: 'SRuleAssess',
  backs: 0,
  contradicted: false,
  fights: NONE,
  at: 0,
  summary: '',
}

// The person opened the top; the host holds it in session 0. cards: the persistent roles.
export const initState = (
  top: Pick<Top, 'name' | 'goal' | 'sections' | 'directions'>,
  items: ReadonlyMap<ItemKey, ItemRec>,
  cards: ReadonlyMap<string, RoleDraft>,
  maxTries: number,
): WorkState => ({
  top: { ...top, hostSession: 0, done: false, ended: false },
  session: 0,
  tasks: new Map(),
  makers: new Map(),
  fixes: new Map(),
  items,
  ver: new Map([...items.keys()].map((x) => [x, 0])),
  cards,
  card: new Map([...cards.keys()].map((r) => [r, 0])),
  fixDepth: new Map(),
  down: NONE,
  ep: new Map(),
  asks: new Map(),
  nextTask: 1,
  nextMaker: 1,
  maxTries,
  seq: 0,
})

export const tk = (s: WorkState, i: string): Task => {
  const t = s.tasks.get(i)
  if (t === undefined) throw new Error(`no task ${i}`)
  return t
}
// A task with no raise open has the closed fix.
export const fx = (s: WorkState, i: string): Fix => s.fixes.get(i) ?? CLOSED
export const mk = (s: WorkState, m: string): Maker | undefined => s.makers.get(m)
export const epOf = (s: WorkState, k: Actor): number => s.ep.get(k) ?? 0

// The task's maker while it lives.
export const liveMaker = (s: WorkState, i: string): string | null => {
  const m = s.tasks.get(i)?.maker ?? null
  return m !== null && s.makers.get(m)?.ended === false ? m : null
}

// The sections of the top no root task owns yet: the host owes a task for them.
export const uncovered = (s: WorkState): ReadonlyArray<string> => {
  const owned = new Set(
    [...s.tasks.values()].filter((t) => t.parent === null).flatMap((t) => t.sections),
  )
  return s.top.sections.filter((x) => !owned.has(x))
}
// Every section is sent, every task done (a split task by its parts) with nothing to recheck.
export const allDone = (s: WorkState): boolean =>
  s.tasks.size > 0 &&
  uncovered(s).length === 0 &&
  [...s.tasks.values()].every((t) => (t.st === 'Done' || t.st === 'Split') && t.pend.size === 0)

// The host's wait finds the top only through an assignment bound to the run's session.
export const hostFinds = (s: WorkState): boolean => s.top.hostSession === s.session

export const pipeStage = (st: Stage): boolean =>
  ['SEval', 'SPrinciple', 'SDirAssess', 'SStdAssess', 'SRuleAssess', 'STest', 'SDraft', 'SLoop']
    .includes(st)
export const nextStage = (st: Stage): Stage =>
  st === 'SPrinciple' ? 'SDirAssess' : st === 'SDirAssess' ? 'SStdAssess' : 'SRuleAssess'
export const entryOf = (l: Level): Stage =>
  l === 'Principle' ? 'SPrinciple' : l === 'Direct' ? 'SDirAssess' : 'SStdAssess'
export const depth = (l: Level): number =>
  l === 'Principle' ? 3 : l === 'Direct' ? 2 : l === 'Standard' ? 1 : 0
export const upStage = (st: Stage): Stage =>
  st === 'SRuleAssess'
    ? 'SStdAssess'
    : st === 'SStdAssess'
    ? 'SDirAssess'
    : st === 'SDirAssess'
    ? 'SPrinciple'
    : 'SAtPerson'
export const stageLevel = (st: Stage): Level =>
  st === 'SPrinciple' ? 'Principle' : st === 'SDirAssess' ? 'Direct' : 'Standard'
// The depth of the level a fix landed at (work.qnt fixAt).
export const fixAt = (f: Fix): number =>
  f.entry === 'SStdAssess' || f.entry === 'SRuleAssess' ? 1 : f.entry === 'SDirAssess' ? 2 : 3
