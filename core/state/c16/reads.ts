// The shared reads of protocol.qnt (records, epochs, live maker, done, the ladder, the asks) and
// the allocation of ask occurrence ids (contract D1). Pure: no act's behaviour here.
import type { DraftItems, ItemKey, Level, Versions } from './data.ts'
import { CLOSED, type Fix, type Maker, type Stage, type Task, type WorkState } from './state.ts'
import {
  type Actor,
  type Ask,
  type AskAbout,
  type AskId,
  type AskKind,
  type OpenAsk,
  type QuestionBody,
  keyOf,
  pairKey,
} from './types.ts'

// Item scope follows the hierarchy and the sections of the task.
export const verOf = (v: Versions, x: ItemKey): number => v.get(x) ?? 0
export const applies = (s: WorkState, x: ItemKey, t: Task): boolean => {
  const r = s.items.get(x)
  if (r === undefined) return false
  if (r.kind === 'dir') return t.directions.includes(x.slice('dir:'.length))
  if (r.parent === null || !applies(s, r.parent, t)) return false
  if (r.kind === 'rule') return true
  return r.where === null || r.where.some((section) => t.sections.includes(section))
}
export const appliesTo = (s: WorkState, t: Task): ReadonlyArray<ItemKey> =>
  [...s.items.keys()].filter((x) => applies(s, x, t))
export const vsum = (s: WorkState): number => [...s.ver.values()].reduce((a, b) => a + b, 0)
export const staleItems = (s: WorkState, t: Task): ReadonlyArray<ItemKey> =>
  appliesTo(s, t).filter((x) => verOf(t.checked, x) < verOf(s.ver, x))
export const briefStale = (s: WorkState, brief: Versions, t: Task): boolean =>
  appliesTo(s, t).some((x) => verOf(brief, x) < verOf(s.ver, x))
export const testRule = (s: WorkState, x: ItemKey): boolean => s.items.get(x)?.form === 'mech'
export const recheckItems = (s: WorkState, t: Task): ReadonlyArray<ItemKey> =>
  [...t.pending].filter((item) => !testRule(s, item))
export const changedBy = (s: WorkState, draft: DraftItems): ReadonlySet<ItemKey> =>
  new Set([...draft].filter(([x, r]) =>
    r === null ? s.items.has(x) : JSON.stringify(s.items.get(x)) !== JSON.stringify(r)
  ).map(([x]) => x))

// --- the records ---------------------------------------------------------------------------------

export const taskOf = (s: WorkState, slot: string): Task => {
  const t = s.tasks.get(slot)
  if (t === undefined) throw new Error(`no task ${slot}`)
  return t
}
export const fixOf = (s: WorkState, id: string): Fix => s.fixes.get(id) ?? CLOSED
export const makerOf = (s: WorkState, id: string): Maker | undefined => s.makers.get(id)
export const isLive = (s: WorkState, id: string): boolean => s.makers.get(id)?.ended === false
export const epochOf = (s: WorkState, actor: Actor): number => s.ep.get(keyOf(actor)) ?? 0

// The task's maker while it lives.
export const liveMaker = (s: WorkState, slot: string): string | null => {
  const m = s.tasks.get(slot)?.maker ?? null
  return m !== null && isLive(s, m) ? m : null
}

// The sections of the top no root task owns yet: the host owes a task for them.
export const uncovered = (s: WorkState): ReadonlyArray<string> => {
  const owned = new Set(
    [...s.tasks.values()].filter((t) => t.parent === null).flatMap((t) => t.sections),
  )
  return s.top.sections.filter((x) => !owned.has(x))
}
// Every section is sent, every task done with nothing to recheck: a split task counts as done and
// its live parts (tasks of their own) count too (D5).
export const allDone = (s: WorkState): boolean =>
  s.tasks.size > 0 &&
  uncovered(s).length === 0 &&
  [...s.tasks.values()].every(
    (t) => (t.state === 'Done' || t.state === 'Split') && t.pending.size === 0,
  )

// The host's wait finds the top only through an assignment bound to the run's session.
export const hostFinds = (s: WorkState): boolean => s.top.hostSession === s.session

// --- the ladder (protocol.qnt): split < standard < direction < principle; a role's fit is off it

export const pipeStage = (st: Stage): boolean =>
  ['Evaluating', 'AtPrinciple', 'AtDirection', 'AtStandard', 'AtRule', 'Testing', 'Drafting',
    'InLoop'].includes(st)
export const nextStage = (st: Stage): Stage =>
  st === 'AtPrinciple' ? 'AtDirection' : st === 'AtDirection' ? 'AtStandard' : 'AtRule'
export const entryOf = (l: Level): Stage =>
  l === 'Principle' ? 'AtPrinciple' : l === 'Direct' ? 'AtDirection' : 'AtStandard'
export const depth = (l: Level): number =>
  l === 'Principle' ? 3 : l === 'Direct' ? 2 : l === 'Standard' ? 1 : 0
export const upStage = (st: Stage): Stage =>
  st === 'AtRule'
    ? 'AtStandard'
    : st === 'AtStandard'
    ? 'AtDirection'
    : st === 'AtDirection'
    ? 'AtPrinciple'
    : 'AtPerson'
export const stageLevel = (st: Stage): Level =>
  st === 'AtPrinciple' ? 'Principle' : st === 'AtDirection' ? 'Direct' : 'Standard'
// The depth of the level a fix landed at (1 standard, 2 direction, 3 principle).
export const fixAt = (f: Fix): number =>
  f.entry === 'AtStandard' || f.entry === 'AtRule' ? 1 : f.entry === 'AtDirection' ? 2 : 3

// --- the asks ------------------------------------------------------------------------------------

// Occurrence ids (D1): the creating act's seq; the n-th ask the same act creates (n >= 1) is
// `<seq>.<n>`. seq grows with every act, so an id is never reused.
export const askIdAt = (seq: number, n: number): AskId => (n === 0 ? `${seq}` : `${seq}.${n}`)

export interface AskSpec {
  readonly kind: AskKind
  readonly from: Actor
  readonly to: Actor
  readonly about: AskAbout
}

// Opens an ask with the next id of the current act; the body rides with a question.
export const openAsk = (
  s: WorkState,
  spec: AskSpec,
  question: QuestionBody | null = null,
): { readonly state: WorkState; readonly ask: OpenAsk } => {
  const ask: OpenAsk = { ...spec, id: askIdAt(s.seq, s.created), at: s.seq, question }
  return {
    state: { ...s, asks: new Map(s.asks).set(ask.id, ask), created: s.created + 1 },
    ask,
  }
}
export const closeAsk = (s: WorkState, id: AskId): WorkState => {
  if (!s.asks.has(id)) return s
  const asks = new Map(s.asks)
  asks.delete(id)
  return { ...s, asks }
}
// The next act: seq moves and the id discriminator restarts.
export const advance = (s: WorkState): WorkState => ({ ...s, seq: s.seq + 1, created: 0 })

const sameAbout = (a: AskAbout, b: AskAbout): boolean =>
  a._tag === b._tag && (a._tag === 'None' || a.id === (b as { id: string }).id)
export const asksAbout = (s: WorkState, about: AskAbout): ReadonlyArray<OpenAsk> =>
  [...s.asks.values()].filter((a) => sameAbout(a.about, about))
// The open ask of that kind, parties and subject, if any (the model's one per tuple).
export const findAsk = (s: WorkState, spec: AskSpec): OpenAsk | undefined =>
  [...s.asks.values()].find((a) =>
    a.kind === spec.kind && keyOf(a.from) === keyOf(spec.from) && keyOf(a.to) === keyOf(spec.to) &&
    sameAbout(a.about, spec.about)
  )

// A Decide over a Check over an Execute (a maker's or the pipe's) over the host's Execute.
export const depthOf = (a: OpenAsk): number =>
  a.kind === 'Decide' ? 3 : a.kind === 'Check' ? 2 : a.from._tag === 'Host' ? 0 : 1
// The task or fix an ask is about, in one namespace (a raise's fix has its task's id, as the
// model's slots): a Decide on a fix outranks the Execute on its task.
export const subjectOf = (a: Ask): string | null => (a.about._tag === 'None' ? null : a.about.id)
// No deeper non-question ask about the same subject: the ask its `to` can act on now.
export const innermost = (s: WorkState, a: OpenAsk): boolean =>
  ![...s.asks.values()].some((o) =>
    o.kind !== 'Question' && subjectOf(o) === subjectOf(a) && depthOf(o) > depthOf(a)
  )
export const askCountOf = (s: WorkState, from: Actor, to: Actor): number =>
  s.askCount.get(pairKey(from, to)) ?? 0
