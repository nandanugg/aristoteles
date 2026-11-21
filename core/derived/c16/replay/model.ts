// The model's store (types.qnt Store, as itf.ts decodes it), what is compared of it (Cmp: the
// state that both the model and the TS core project to), and what the model's wait tells each
// actor (protocol.qnt toldSteps, as one text per step).
import type { Plain } from './itf.ts'

// --- the model's store, as decoded ---------------------------------------------------------------

export interface MAsk {
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly about: number
}
export interface MTask {
  readonly state: string
  readonly tries: number
  readonly maker: string
  readonly resultId: number
  readonly checked: ReadonlyMap<string, number>
  readonly pending: ReadonlyArray<string>
  readonly badResult: boolean
  readonly broken: boolean
  readonly taken: boolean
  readonly sections: number
  readonly floor: string
}
export interface MMaker {
  readonly slot: number
  readonly ended: boolean
  readonly claimed: boolean
  readonly brief: ReadonlyMap<string, number>
}
export interface MFix {
  readonly stage: string
  readonly entry: string
  readonly level: string
  readonly kind: string
  readonly form: string
  readonly ruleTries: number
  readonly items: ReadonlyArray<string>
  readonly real: ReadonlyArray<string>
  readonly roleOnly: boolean
  readonly base: ReadonlyMap<string, number>
  readonly cardBase: number
  readonly needRevise: boolean
  readonly loopRounds: number
  readonly wrote: ReadonlyArray<string>
  readonly climbedTo: string
  readonly sendBacks: number
  readonly contradicted: boolean
}
export interface MStore {
  readonly top: { readonly hostSession: number; readonly done: boolean; readonly ended: boolean }
  readonly session: number
  readonly tasks: ReadonlyMap<number, MTask>
  readonly makers: ReadonlyMap<string, MMaker>
  readonly fixes: ReadonlyMap<number, MFix>
  readonly versions: ReadonlyMap<string, number>
  readonly ruleForm: ReadonlyMap<number, string>
  readonly card: number
  readonly fixDepth: ReadonlyMap<string, number>
  readonly down: ReadonlyArray<string>
  readonly asks: ReadonlyArray<MAsk>
  readonly answered: ReadonlyArray<MAsk>
  readonly justAnswered: ReadonlyArray<string>
  readonly askCount: ReadonlyMap<string, number>
}
export const storeOf = (p: Plain): MStore => p as unknown as MStore

export const EDIT = 2
export const ITEMS = ['D', 'R0', 'R1', 'S0', 'S1'] as const
export type Vers = { readonly [item: string]: number }
export const askStr = (a: MAsk): string => `${a.kind}|${a.from}|${a.to}|${a.about}`
export const pairStr = (from: string, to: string): string => JSON.stringify([from, to])
const SEND_BACKS = 3 // PERSON_SEND_BACKS: canon.qnt keeps a fix's sendBacks up to it

// types.qnt applies: an item applies to a slot.
export const applies = (item: string, slot: number): boolean =>
  item === 'D' || (item.startsWith('S') ? item === 'S1' || slot === 0 : item === `R${slot}`)
export const versOf = (m: ReadonlyMap<string, number>): Vers =>
  Object.fromEntries(ITEMS.map((x) => [x, m.get(x) ?? 0]))

// --- what is compared ----------------------------------------------------------------------------

export interface CTask {
  readonly state: string
  readonly tries: number
  readonly maker: string
  readonly hasResult: boolean
  readonly checked: Vers
  readonly pending: ReadonlyArray<string>
  readonly taken: boolean
  readonly sections: number
  readonly floor: string
}
export interface CMaker {
  readonly slot: number
  readonly claimed: boolean
  readonly brief: Vers
}
export interface CFix {
  readonly stage: string
  readonly entry?: string
  readonly level?: string
  readonly kind?: string
  readonly form?: string
  readonly ruleTries?: number
  readonly items?: ReadonlyArray<string>
  readonly real?: ReadonlyArray<string>
  readonly roleOnly?: boolean
  readonly base?: Vers
  readonly cardBase?: number
  readonly needRevise?: boolean
  readonly loopRounds?: number
  readonly wrote?: ReadonlyArray<string>
  readonly climbedTo?: string
  readonly sendBacks?: number
  readonly contradicted?: boolean
}
// Skipped on purpose: the ghosts (the environment's truths and the history flags: broken,
// badResult, cause, fights, testOk, refOk, roleLabel, trueBase, ghost), the counters that canon
// sets to one value (generation, revisions, epochs, nextMaker, basisStep, revision, sentBack),
// the model's bounds (changes, agentChanges) and the ended makers (canon drops them).
export interface Cmp {
  readonly top: { readonly hostSession: number; readonly done: boolean; readonly ended: boolean }
  readonly session: number
  readonly tasks: { readonly [slot: string]: CTask }
  readonly makers: { readonly [maker: string]: CMaker }
  readonly fixes: { readonly [fix: string]: CFix }
  readonly versions: Vers
  readonly ruleForm: { readonly [rule: string]: string }
  readonly card: number
  readonly fixDepth: Vers
  readonly down: ReadonlyArray<string>
  readonly asks: ReadonlyArray<string>
  readonly answered: ReadonlyArray<string>
  readonly justAnswered: ReadonlyArray<string>
  readonly askCount: { readonly [pair: string]: number }
}

const sorted = (xs: ReadonlyArray<string>): ReadonlyArray<string> => [...xs].sort()
const record = <V>(m: ReadonlyMap<number | string, V>): { readonly [k: string]: V } =>
  Object.fromEntries([...m].map(([k, v]) => [String(k), v]))

export const modelCmp = (m: MStore): Cmp => ({
  top: { hostSession: m.top.hostSession, done: m.top.done, ended: m.top.ended },
  session: m.session,
  tasks: record(
    new Map([...m.tasks].map(([slot, t]) => [slot, {
      state: t.state,
      tries: t.tries,
      maker: t.maker,
      hasResult: t.resultId >= 0,
      checked: versOf(t.checked),
      pending: sorted(t.pending),
      taken: t.taken,
      sections: t.sections,
      floor: t.floor,
    }])),
  ),
  makers: record(
    new Map([...m.makers].filter(([, y]) => !y.ended).map(([id, y]) =>
      [id, { slot: y.slot, claimed: y.claimed, brief: versOf(y.brief) }]
    )),
  ),
  fixes: record(
    new Map([...m.fixes].map(([id, f]) => [id, {
      stage: f.stage,
      entry: f.entry,
      level: f.level,
      kind: f.kind,
      form: f.form,
      ruleTries: f.ruleTries,
      items: sorted(f.items),
      real: sorted(f.real),
      roleOnly: f.roleOnly,
      base: versOf(f.base),
      cardBase: f.cardBase,
      needRevise: f.needRevise,
      loopRounds: f.loopRounds,
      wrote: sorted(f.wrote),
      climbedTo: f.climbedTo,
      sendBacks: f.sendBacks,
      contradicted: f.contradicted,
    }])),
  ),
  versions: versOf(m.versions),
  ruleForm: record(m.ruleForm),
  card: m.card,
  fixDepth: Object.fromEntries(ITEMS.map((x) => [x, m.fixDepth.get(x) ?? -1])),
  down: sorted(m.down),
  asks: sorted(m.asks.map(askStr)),
  answered: sorted(m.answered.map(askStr)),
  justAnswered: sorted(m.justAnswered),
  askCount: record(m.askCount),
})

// canon.qnt on what is compared: the counters and copies canon sets are set the same way on both
// sides, the item versions are shifted so each item's smallest copy is 0, a closed fix is one
// record. Idempotent: the model's states pass through it unchanged.
export const canonical = (c: Cmp): Cmp => {
  const kept = (state: string): boolean => ['Done', 'Raised', 'InReview'].includes(state)
  const tasks = Object.entries(c.tasks).map(([k, t]) =>
    [k, { ...t, checked: kept(t.state) ? t.checked : c.versions }] as const
  )
  const makers = Object.entries(c.makers).map(([k, y]) =>
    [k, { ...y, brief: y.claimed ? y.brief : c.versions }] as const
  )
  const fixes = Object.entries(c.fixes).map(([k, f]): readonly [string, CFix] => {
    if (f.stage === 'Closed') return [k, { stage: 'Closed' }]
    // while a test command is due, the TS core holds `contradicted` as it was (RunTest decides)
    return [k, {
      ...f,
      contradicted: f.stage === 'Testing' ? undefined : f.contradicted,
      sendBacks: Math.min(f.sendBacks ?? 0, SEND_BACKS),
      base: f.stage !== 'Evaluating' && f.kind === 'DirectionDraft' ? f.base : c.versions,
      cardBase: f.kind === 'RoleDraft' ? f.cardBase : c.card,
    }]
  })
  const open = fixes.filter(([, f]) => f.stage !== 'Closed').map(([, f]) => f)
  const copies: ReadonlyArray<Vers> = [
    c.versions,
    ...tasks.map(([, t]) => t.checked),
    ...makers.map(([, y]) => y.brief),
    ...open.map((f) => f.base as Vers),
  ]
  const lowest = Object.fromEntries(
    ITEMS.map((x) => [x, Math.min(...copies.map((v) => v[x] ?? 0))]),
  )
  const shift = (v: Vers): Vers =>
    Object.fromEntries(ITEMS.map((x) => [x, (v[x] ?? 0) - (lowest[x] ?? 0)]))
  const cardLowest = Math.min(c.card, ...open.map((f) => f.cardBase as number))
  return {
    ...c,
    versions: shift(c.versions),
    card: c.card - cardLowest,
    tasks: Object.fromEntries(tasks.map(([k, t]) => [k, { ...t, checked: shift(t.checked) }])),
    makers: Object.fromEntries(makers.map(([k, y]) => [k, { ...y, brief: shift(y.brief) }])),
    fixes: Object.fromEntries(fixes.map(([k, f]) =>
      [k, f.stage === 'Closed'
        ? f
        : { ...f, base: shift(f.base as Vers), cardBase: (f.cardBase as number) - cardLowest }]
    )),
  }
}

// --- what the model's wait tells -----------------------------------------------------------------

const slotsOf = (m: MStore): ReadonlyArray<number> => [...m.tasks.keys()]
const fixIds = (m: MStore): ReadonlyArray<number> => [EDIT, ...slotsOf(m)]
const fixOf = (m: MStore, id: number): MFix | undefined => m.fixes.get(id)
const itemsFor = (slot: number): ReadonlyArray<string> => ITEMS.filter((x) => applies(x, slot))
const testRule = (m: MStore, x: string): boolean =>
  x.startsWith('R') && m.ruleForm.get(Number(x.slice(1))) === 'Mech'
const recheckDue = (m: MStore, slot: number): boolean => {
  const t = m.tasks.get(slot)
  return t !== undefined && t.state === 'Done' && t.pending.some((x) => !testRule(m, x))
}
const runRuleDue = (m: MStore, slot: number): boolean => {
  const t = m.tasks.get(slot)
  return t !== undefined && t.state === 'Done' && t.pending.some((x) => testRule(m, x))
}
const allDone = (m: MStore): boolean =>
  [...m.tasks.values()].every((t) => t.state === 'Done' && t.pending.length === 0)
const briefStale = (m: MStore, y: MMaker): boolean =>
  itemsFor(y.slot).some((x) => (y.brief.get(x) ?? 0) < (m.versions.get(x) ?? 0))
// The maker is told something now: it holds the working task and is up.
const makerLive = (m: MStore, id: string): MMaker | null => {
  const y = m.makers.get(id)
  const t = y === undefined ? undefined : m.tasks.get(y.slot)
  return y !== undefined && !y.ended && !m.down.includes(id) && t?.state === 'Working' &&
      t.maker === id
    ? y
    : null
}
const PIPE_STAGE: ReadonlyArray<readonly [string, string]> = [
  ['Evaluating', 'Evaluate'],
  ['AtPrinciple', 'Advance'],
  ['AtDirection', 'Advance'],
  ['AtStandard', 'Advance'],
  ['AtRule', 'WriteRule'],
  ['Testing', 'RunTest'],
  ['Drafting', 'Ship'],
  ['InLoop', 'LoopReview'],
]

// The texts of an actor's own told steps. Open: `Open:send` (the host's, one whatever the slot),
// `Open:make:<slot>`; a step on an ask names the ask; a step of a maker its slot; a step of the
// pipeline role its fix.
const ownTold = (m: MStore, actor: string): ReadonlyArray<string> => {
  if (m.top.ended) return []
  const hostOn = actor === 'Host' && m.top.hostSession === m.session
  const slots = slotsOf(m)
  const live = makerLive(m, actor)
  return [
    ...(hostOn && slots.some((n) => m.tasks.get(n)?.state === 'Unsent') ? ['Open:send'] : []),
    ...(actor === 'Role'
      ? slots.filter((n) => m.tasks.get(n)?.state === 'Sent').map((n) => `Open:make:${n}`)
      : []),
    ...m.answered.filter((a) => a.from === actor).map((a) => `Hear:${askStr(a)}`),
    ...(live !== null && (!live.claimed || briefStale(m, live)) ? [`ReadBrief:${live.slot}`] : []),
    ...(live !== null && live.claimed && !briefStale(m, live) ? [`Report:${live.slot}`] : []),
    ...(actor === 'Role'
      ? slots.flatMap((n) => {
        const id = m.tasks.get(n)?.maker ?? 'NoOne'
        const y = m.makers.get(id)
        return y !== undefined && !y.ended && m.down.includes(id) ? [`Resume:${n}`] : []
      })
      : []),
    ...(actor === 'Role'
      ? m.asks.filter((a) => a.kind === 'Check' && a.to === 'Role').map((a) =>
        `Review:${askStr(a)}`
      )
      : []),
    ...(actor === 'Pipe'
      ? fixIds(m).flatMap((id) => {
        const act = PIPE_STAGE.find(([stage]) => stage === fixOf(m, id)?.stage)?.[1]
        return act === undefined ? [] : [`${act}:${id}`]
      })
      : []),
    ...(actor === 'Human'
      ? m.asks.filter((a) => a.kind === 'Decide').map((a) => `Respond:${askStr(a)}`)
      : []),
    ...(hostOn && fixIds(m).some((id) => fixOf(m, id)?.stage === 'Accepted') ? ['Reassign'] : []),
    ...(hostOn && allDone(m) && !m.top.done ? ['TopDone'] : []),
    ...(actor === 'Pipe'
      ? slots.filter((n) => recheckDue(m, n)).map((n) => `RecheckDone:${n}`)
      : []),
    ...(actor === 'Harness'
      ? slots.filter((n) => runRuleDue(m, n)).map((n) => `RunRule:${n}`)
      : []),
    ...(actor === 'Human' && m.down.includes('Host') ? ['Revive:Host'] : []),
    ...(actor === 'Harness'
      ? ['Role', 'Pipe'].filter((x) => m.down.includes(x)).map((x) => `Revive:${x}`)
      : []),
    ...(actor === 'Human' && m.top.done && allDone(m) ? ['EndProject'] : []),
  ]
}

// toldSteps: an answerer that has just answered and has a step of its own is told only that.
export const modelTold = (m: MStore, actor: string, alternate = true): ReadonlyArray<string> => {
  if (m.top.ended) return []
  const own = ownTold(m, actor)
  if (alternate && m.justAnswered.includes(actor) && own.length > 0) {
    return [...new Set(own)].sort()
  }
  const answers = m.asks.filter((a) => a.kind === 'Question' && a.to === actor).map((a) =>
    `AnswerQuestion:${askStr(a)}`
  )
  return [...new Set([...own, ...answers])].sort()
}

// The actors whose told steps are compared: the five that live, and the live makers.
export const modelActors = (m: MStore): ReadonlyArray<string> => [
  'Human',
  'Host',
  'Role',
  'Pipe',
  'Harness',
  ...[...m.makers].filter(([, y]) => !y.ended).map(([id]) => id),
]

// --- who waits for whom, and what is owed --------------------------------------------------------

// waitsFor: the open asks that are not questions and not the person's, as `from>to`.
export const modelWaits = (m: MStore): ReadonlyArray<string> =>
  [...new Set(m.asks.filter((a) => a.kind !== 'Question' && a.from !== 'Human').map((a) =>
    `${a.from}>${a.to}`
  ))].sort()

const depthOf = (a: MAsk): number =>
  a.kind === 'Decide' ? 3 : a.kind === 'Check' ? 2 : a.from === 'Host' ? 0 : 1
const PIPE_STAGES = PIPE_STAGE.map(([stage]) => stage)

// The obligations (protocol.qnt obligationsOf), each with the texts of the steps that discharge
// it (discharges); the TS core's owed items are named the same way (project.ts).
interface Ob {
  readonly ob: string
  readonly by: ReadonlyArray<string>
}
const obligations = (m: MStore): ReadonlyArray<Ob> => {
  if (m.top.ended) return []
  const slots = slotsOf(m)
  const pipeFix = (id: number): string[] => PIPE_STAGE.map(([, act]) => `${act}:${id}`)
  const innermost = (a: MAsk): boolean =>
    !m.asks.some((o) => o.kind !== 'Question' && o.about === a.about && depthOf(o) > depthOf(a))
  const fromAsk = (a: MAsk): ReadonlyArray<Ob> => {
    const text = askStr(a)
    if (a.kind === 'Question') return [{ ob: `AskOb:${text}`, by: [`AnswerQuestion:${text}`] }]
    if (!innermost(a)) return []
    if (a.kind === 'Execute' && a.from.startsWith('Maker')) return []
    if (depthOf(a) === 0 && m.tasks.get(a.about)?.state !== 'Sent') return []
    if (a.to === 'Pipe') {
      return PIPE_STAGES.includes(fixOf(m, a.about)?.stage ?? '')
        ? [{ ob: `PipeOb:${a.about}`, by: pipeFix(a.about) }]
        : []
    }
    if (a.kind === 'Execute' && a.to.startsWith('Maker') && m.down.includes(a.to)) {
      const slot = m.makers.get(a.to)?.slot
      return [{ ob: `ResumeOb:${slot}`, by: [`Resume:${slot}`] }]
    }
    if (a.kind === 'Execute' && a.from === 'Host') {
      return [{ ob: `AskOb:${text}`, by: [`Open:make:${a.about}`] }]
    }
    if (a.kind === 'Execute') {
      return [{ ob: `AskOb:${text}`, by: [`ReadBrief:${a.about}`, `Report:${a.about}`] }]
    }
    return [{ ob: `AskOb:${text}`, by: [`${a.kind === 'Check' ? 'Review' : 'Respond'}:${text}`] }]
  }
  return [
    ...['Host', 'Role', 'Pipe'].filter((p) => m.down.includes(p)).map((p) =>
      ({ ob: `ReviveOb:${p}`, by: [`Revive:${p}`] })
    ),
    ...(allDone(m)
      ? [m.top.done ? { ob: 'EndOb', by: ['EndProject'] } : { ob: 'TopDoneOb', by: ['TopDone'] }]
      : []),
    ...(fixIds(m).some((id) => fixOf(m, id)?.stage === 'Accepted')
      ? [{ ob: 'ReassignOb', by: ['Reassign'] }]
      : []),
    ...m.asks.flatMap(fromAsk),
    ...m.answered.map((a) => ({ ob: `HearOb:${askStr(a)}`, by: [`Hear:${askStr(a)}`] })),
    ...slots.flatMap((n) => [
      ...(m.tasks.get(n)?.state === 'Unsent' ? [{ ob: 'SendOb', by: ['Open:send'] }] : []),
      ...(recheckDue(m, n) ? [{ ob: `RecheckOb:${n}`, by: [`RecheckDone:${n}`] }] : []),
      ...(runRuleDue(m, n) ? [{ ob: `RuleRunOb:${n}`, by: [`RunRule:${n}`] }] : []),
    ]),
  ]
}

// Each obligation with its owner: the actors told a step that discharges it (the alternation of
// answers and own steps is the told order, not ownership: it is left out here).
export const modelOwed = (m: MStore): ReadonlyArray<string> =>
  [...new Set(obligations(m).flatMap(({ ob, by }) => {
    const owners = modelActors(m).filter((who) =>
      modelTold(m, who, false).some((step) => by.includes(step))
    )
    return owners.length === 0 ? [`${ob}@-`] : owners.map((who) => `${ob}@${who}`)
  }))].sort()
