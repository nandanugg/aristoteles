// The TS core's state, projected onto what the model's state holds (model.ts Cmp), and the world
// the model's small instances map to: slots become task ids, the model's Maker(n) the store's
// maker ids, items the keys below, the ask set (kind, from, to, about) with occurrence ids
// dropped (the model has none).
import { initState, type Fix, type WorkState } from '../../../state/c16/state.ts'
import { fixOf } from '../../../state/c16/reads.ts'
import {
  type Actor,
  type OpenAsk,
  type Step,
  actorOf,
  isMaker,
} from '../../../state/c16/types.ts'
import type { ItemKey, ItemRec, Versions } from '../../../state/work/types.ts'
import { dos } from '../obligations.ts'
import { type CFix, type Cmp, type CTask, type Vers, ITEMS, canonical } from './model.ts'

// --- the world -----------------------------------------------------------------------------------

export const ROLE = 'dev'
// The model's items, as keys. std:1b is the one the model has no name for: the standard that only
// the second task's sections meet, so the model's rule 1 (task 1 alone) applies to that task alone.
export const KEY: { readonly [item: string]: ItemKey } = {
  D: 'dir:d',
  S0: 'std:0',
  S1: 'std:1',
  R0: 'rule:0',
  R1: 'rule:1',
}
const NAME: ReadonlyMap<ItemKey, string> = new Map(Object.entries(KEY).map(([n, k]) => [k, n]))
export const nameOf = (k: ItemKey): string | undefined => NAME.get(k)
const SECTIONS = 2 // OPTIONS.sections: the sections a task of the top owns
export const sectionsOf = (slot: number): ReadonlyArray<string> =>
  ['a', 'b'].slice(0, SECTIONS).map((x) => `s${slot}${x}`)

const rec = (over: Partial<ItemRec>): ItemRec => ({
  kind: 'dir',
  parent: null,
  name: 'n',
  says: 'v0',
  where: null,
  test: null,
  ref: null,
  form: 'none',
  examples: [],
  ...over,
})

export const initial = (slots: ReadonlyArray<number>): WorkState =>
  initState(
    { name: 'top', goal: 'g', sections: slots.flatMap(sectionsOf), directions: ['d'] },
    new Map<ItemKey, ItemRec>([
      ['dir:d', rec({})],
      ['std:0', rec({ kind: 'std', parent: 'dir:d', where: sectionsOf(0) })],
      ['std:1', rec({ kind: 'std', parent: 'dir:d' })],
      ['std:1b', rec({ kind: 'std', parent: 'dir:d', where: sectionsOf(1) })],
      ['rule:0', rec({ kind: 'rule', parent: 'std:0', form: 'ref', ref: 'f#a:1-2' })],
      ['rule:1', rec({ kind: 'rule', parent: 'std:1b', form: 'ref', ref: 'f#a:1-2' })],
    ]),
    new Map([[ROLE, { role: ROLE, words: 'w', model: 'm' }]]),
    2, // OPTIONS.maxTries
  )

// What the replay knows besides the state: which task is a slot's now, which maker.
export interface Ctx {
  readonly slots: ReadonlyArray<number>
  readonly slotTask: ReadonlyMap<number, string>
  readonly slotMaker: ReadonlyMap<number, string>
  // The other parts of a split: the model's single successor is the first part, these are left out
  // of the comparison (see canonState).
  readonly ignored: ReadonlySet<string>
}
export const start = (slots: ReadonlyArray<number>): Ctx => ({
  slots,
  slotTask: new Map(),
  slotMaker: new Map(),
  ignored: new Set(),
})
const slotOfSection = (x: string): number => Number(/^s(\d+)/.exec(x)?.[1])
// After an act: a new root task is the slot of its sections', a new maker the one of its task.
export const advance = (c: Ctx, before: WorkState, after: WorkState): Ctx => {
  const slotTask = new Map(c.slotTask)
  for (const [id, t] of after.tasks) {
    if (before.tasks.has(id) || t.parent !== null) continue
    slotTask.set(slotOfSection(t.sections[0] ?? ''), id)
  }
  const ignored = new Set(c.ignored)
  for (const [id, t] of after.tasks) {
    if (before.tasks.has(id) || t.parent === null) continue
    const slot = slotOfTask(c, t.parent)
    if (slot !== undefined && slotTask.get(slot) === t.parent) slotTask.set(slot, id)
    else ignored.add(id)
  }
  const slotMaker = new Map(c.slotMaker)
  for (const [id, y] of after.makers) {
    const slot = [...slotTask].find(([, task]) => task === y.task)?.[0]
    if (!before.makers.has(id) && slot !== undefined) slotMaker.set(slot, id)
  }
  return { ...c, slotTask, slotMaker, ignored }
}

// --- names ---------------------------------------------------------------------------------------

export const slotOfTask = (c: Ctx, id: string): number | undefined =>
  [...c.slotTask].find(([, task]) => task === id)?.[0]
// The model's name of a task id or fix id (a fix is named by its task; the edit by 2).
const aboutNo = (c: Ctx, id: string): number | string =>
  id === 'edit' ? 2 : slotOfTask(c, id) ?? `?${id}`
const makerName = (c: Ctx, id: string): string => {
  const slot = [...c.slotMaker].find(([, maker]) => maker === id)?.[0]
  return slot === undefined ? `Maker#${id}` : `Maker(${slot})`
}
export const actorName = (c: Ctx, a: Actor): string =>
  a._tag === 'Role' ? 'Role' : isMaker(a) ? makerName(c, a.id) : a._tag
const keyName = (c: Ctx, k: string): string => actorName(c, actorOf(k))
export const askText = (c: Ctx, a: OpenAsk): string =>
  `${a.kind}|${actorName(c, a.from)}|${actorName(c, a.to)}|${
    a.about._tag === 'None' ? -1 : aboutNo(c, a.about.id)
  }`
const itemNames = (keys: Iterable<ItemKey>): ReadonlyArray<string> =>
  [...keys].flatMap((k) => nameOf(k) ?? []).sort()
const versOf = (v: Versions): Vers => Object.fromEntries(ITEMS.map((x) => [x, v.get(KEY[x]!) ?? 0]))
const FORM: { readonly [form: string]: string } = {
  none: 'NoForm',
  mech: 'Mech',
  ref: 'Ref',
  both: 'Both',
}

// canon.qnt's lossy part, applied to the TS state itself between steps (the model's states have
// been through it, and later steps read what it left): the versions a task was checked under
// while it is not in review, raised or done; the brief of a maker that has not read it; the base
// of a draft that is not a direction draft past evaluation. The other parts of a split are held
// done with nothing pending and no ask about them, so they never owe a step the model lacks.
export const canonState = (s: WorkState, c: Ctx): WorkState => ({
  ...s,
  asks: new Map(
    [...s.asks].filter(([, a]) => a.about._tag === 'None' || !c.ignored.has(a.about.id)),
  ),
  tasks: new Map([...s.tasks].map(([id, t]) => [
    id,
    c.ignored.has(id)
      ? { ...t, state: 'Done' as const, pending: new Set<string>(), maker: null }
      : ['Done', 'Raised', 'InReview'].includes(t.state)
      ? t
      : { ...t, checked: s.ver },
  ])),
  makers: new Map([...s.makers].map(([id, y]) => [id, y.claimed ? y : { ...y, brief: s.ver }])),
  fixes: new Map([...s.fixes].map(([id, f]) => [
    id,
    f.stage === 'Closed' || (f.stage !== 'Evaluating' && f.kind === 'DirectionDraft')
      ? f
      : { ...f, base: s.ver },
  ])),
})

// --- the projection ------------------------------------------------------------------------------

const taskCmp = (s: WorkState, c: Ctx, slot: number): CTask => {
  const t = s.tasks.get(c.slotTask.get(slot) ?? '')
  if (t === undefined) {
    return {
      state: 'Unsent',
      tries: 0,
      maker: 'NoOne',
      hasResult: false,
      checked: versOf(s.ver),
      pending: [],
      taken: false,
      sections: SECTIONS,
      floor: 'Split',
    }
  }
  return {
    state: t.state,
    tries: t.tries,
    maker: t.maker === null ? 'NoOne' : makerName(c, t.maker),
    hasResult: t.resultId >= 0,
    checked: versOf(t.checked),
    pending: itemNames(t.pending),
    taken: t.taken,
    sections: t.sections.length,
    floor: t.floor,
  }
}

const fixCmp = (f: Fix): CFix => ({
  stage: f.stage,
  entry: f.entry,
  level: f.level,
  kind: f.kind,
  form: f.form,
  ruleTries: f.ruleTries,
  items: itemNames(f.items),
  real: itemNames(f.real),
  roleOnly: f.roleOnly,
  base: versOf(f.base),
  cardBase: f.cardBase,
  needRevise: f.needRevise,
  loopRounds: f.loopRounds,
  wrote: itemNames(f.wrote),
  climbedTo: f.climbedTo,
  sendBacks: f.sendBacks,
  contradicted: f.contradicted,
})

const sorted = (xs: ReadonlyArray<string>): ReadonlyArray<string> => [...xs].sort()

export const project = (s: WorkState, c: Ctx): Cmp =>
  canonical({
    top: { hostSession: s.top.hostSession, done: s.top.done, ended: s.top.ended },
    session: s.session,
    tasks: Object.fromEntries(c.slots.map((n) => [String(n), taskCmp(s, c, n)])),
    makers: Object.fromEntries(
      [...s.makers.values()].filter((y) => !y.ended).map((y) => [makerName(c, y.id), {
        slot: slotOfTask(c, y.task) ?? -1,
        claimed: y.claimed,
        brief: versOf(y.brief),
      }]),
    ),
    fixes: Object.fromEntries([
      ...c.slots.map((n) => {
        const id = c.slotTask.get(n)
        return [String(n), fixCmp(fixOf(s, id ?? ''))] as const
      }),
      ['2', fixCmp(fixOf(s, 'edit'))] as const,
    ]),
    versions: versOf(s.ver),
    ruleForm: Object.fromEntries(
      [0, 1].map((n) => [String(n), FORM[s.items.get(`rule:${n}`)?.form ?? 'none'] ?? '?']),
    ),
    card: s.card.get(ROLE) ?? 0,
    fixDepth: Object.fromEntries(ITEMS.map((x) => [x, s.fixDepth.get(KEY[x]!) ?? -1])),
    // canon drops the ended makers from down
    down: sorted(
      [...s.down].filter((k) => {
        const a = actorOf(k)
        return !isMaker(a) || s.makers.get(a.id)?.ended === false
      }).map((k) => keyName(c, k)),
    ),
    asks: sorted([...s.asks.values()].map((a) => askText(c, a))),
    answered: sorted([...s.answered.values()].map((x) => askText(c, x.ask))),
    justAnswered: sorted([...s.justAnswered].map((k) => keyName(c, k))),
    askCount: Object.fromEntries(
      [...s.askCount].map(([k, n]) => {
        const [from, to] = JSON.parse(k) as [string, string]
        return [JSON.stringify([keyName(c, from), keyName(c, to)]), n]
      }),
    ),
  })

// --- what the TS core tells ----------------------------------------------------------------------

// A step as the model's told text names it (model.ts ownTold).
const stepText = (s: WorkState, c: Ctx, who: string, x: Step): string => {
  const slot = (task: string | null): number | string =>
    task === null ? '?' : slotOfTask(c, task) ?? `?${task}`
  const ask = (a: OpenAsk | undefined): string => a === undefined ? '?' : askText(c, a)
  switch (x.act) {
    case 'Open':
      return who === 'Host' ? 'Open:send' : `Open:make:${slot(x.task)}`
    case 'Hear':
      return `Hear:${ask(s.answered.get(x.ask ?? '')?.ask)}`
    case 'AnswerQuestion':
    case 'Review':
    case 'Respond':
      return `${x.act}:${ask(s.asks.get(x.ask ?? ''))}`
    case 'ReadBrief':
    case 'Report':
    case 'Resume':
    case 'RecheckDone':
    case 'RunRule':
      return `${x.act}:${slot(x.task)}`
    case 'Evaluate':
    case 'Advance':
    case 'WriteRule':
    case 'RunTest':
    case 'Ship':
    case 'LoopReview':
      return `${x.act}:${x.fix === null ? '?' : aboutNo(c, x.fix)}`
    case 'Revive':
      return `Revive:${x.actor === null ? '?' : keyName(c, x.actor)}`
    default:
      return x.act
  }
}

// The actor as the TS core names it (a maker by its current id).
export const actorOfName = (c: Ctx, name: string): Actor => {
  const slot = /^Maker\((\d+)\)$/.exec(name)?.[1]
  if (slot !== undefined) return { _tag: 'Maker', id: c.slotMaker.get(Number(slot)) ?? '?' }
  return name === 'Role' ? { _tag: 'Role', name: ROLE } : { _tag: name } as Actor
}

export const told = (s: WorkState, c: Ctx, who: string): ReadonlyArray<string> =>
  [...new Set(dos(s, actorOfName(c, who)).map((x) => stepText(s, c, who, x)))].sort()
