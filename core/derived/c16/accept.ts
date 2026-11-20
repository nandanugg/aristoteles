// The store's check (protocol.qnt accept, allowed, basisOf): who may send an act, from which epoch,
// what is legal in the state, on which basis, from which build; and the asks the act names.
// Every check of the model is on.
import type { Refusal as RefusalRecord } from '../../state/c16/types.ts'
import { type Maker, type Task, type WorkState } from '../../state/c16/state.ts'
import {
  allDone,
  askCountOf,
  depth,
  epochOf,
  fixOf,
  isLive,
  briefStale,
  testRule,
  uncovered,
  vsum,
  verOf,
} from '../../state/c16/reads.ts'
import {
  type Act,
  type Actor,
  type Body,
  type OpenAsk,
  type RefusalName,
  answers,
  hasEpoch,
  isMaker,
  isPersistent,
  keyOf,
  pairKey,
} from '../../state/c16/types.ts'
import { EDIT, free, hasMech, hasRef } from '../../state/work/types.ts'
import type { TaskSpec, Verdict } from '../../state/work/types.ts'
import { ownToldSteps } from './obligations.ts'

// --- the records, read without throwing ------------------------------------------------------

const sameActor = (a: Actor, b: Actor): boolean => keyOf(a) === keyOf(b)
const taskOf = (s: WorkState, id: string): Task | undefined => s.tasks.get(id)
const makerIdOf = (a: Actor): string | null => (isMaker(a) ? a.id : null)
const aboutTask = (ask: OpenAsk): string | null => ask.about._tag === 'Task' ? ask.about.id : null
const aboutFix = (ask: OpenAsk): string | null => ask.about._tag === 'Fix' ? ask.about.id : null

// A maker act: on a working task, by its live maker that is up.
const makerAt = (s: WorkState, id: string): boolean => {
  const m = s.makers.get(id)
  const t = m === undefined ? undefined : taskOf(s, m.task)
  return m !== undefined && t !== undefined && !s.down.has(keyOf({ _tag: 'Maker', id })) &&
    t.state === 'Working' && !m.ended && t.maker === id
}
const knownRole = (s: WorkState, a: Actor): boolean => a._tag === 'Role' && s.cards.has(a.name)
// canAsk: a live host, role, pipeline role or maker, and up.
const canAsk = (s: WorkState, a: Actor): boolean =>
  !s.down.has(keyOf(a)) &&
  (a._tag === 'Host' || a._tag === 'Pipe' || knownRole(s, a) || (isMaker(a) && isLive(s, a.id)))
const canBeAsked = (s: WorkState, a: Actor): boolean =>
  a._tag === 'Human' || a._tag === 'Host' || a._tag === 'Pipe' || knownRole(s, a) ||
  (isMaker(a) && isLive(s, a.id))
const known = (s: WorkState, a: Actor): boolean =>
  a._tag === 'Host' || a._tag === 'Pipe' || knownRole(s, a) || (isMaker(a) && s.makers.has(a.id))

const roleOfMaker = (s: WorkState, id: string): string | undefined => {
  const m = s.makers.get(id)
  return m === undefined ? undefined : taskOf(s, m.task)?.role
}

// --- the basis ---------------------------------------------------------------------------------

// The revision (or -1, none) an act of this body names as its basis: what its sender saw.
export const basisOf = (s: WorkState, body: Body): number => {
  switch (body._tag) {
    case 'Open':
      return body.open._tag === 'OpenReject' ? taskOf(s, body.open.task)?.resultId ?? -1 : -1
    case 'Report': {
      const ask = s.asks.get(body.ask)
      const id = ask === undefined ? null : makerIdOf(ask.to)
      return id === null ? -1 : s.makers.get(id)?.revisions ?? -1
    }
    case 'Review': {
      const id = aboutAsk(s, body.ask, aboutTask)
      return id === null ? -1 : taskOf(s, id)?.resultId ?? -1
    }
    case 'Respond': {
      const id = aboutAsk(s, body.ask, aboutFix)
      return id === null ? -1 : fixOf(s, id).basisStep
    }
    case 'Evaluate':
    case 'Advance':
    case 'WriteRule':
    case 'RunTest':
    case 'Ship':
    case 'LoopReview':
      return fixOf(s, body.fix).basisStep
    case 'RecheckDone':
      return taskOf(s, body.task)?.resultId ?? -1
    default:
      return -1
  }
}
const aboutAsk = (
  s: WorkState,
  id: string,
  about: (a: OpenAsk) => string | null,
): string | null => {
  const ask = s.asks.get(id)
  return ask === undefined ? null : about(ask)
}
// Acts that also name the item versions their sender saw (the others name only a revision).
const versioned = (body: Body): boolean =>
  body._tag === 'Report' || body._tag === 'Review' || body._tag === 'Evaluate'
const basisOk = (s: WorkState, a: Act): boolean => {
  const c = basisOf(s, a.body)
  return (c < 0 || a.seen === c) && (!versioned(a.body) || a.seenVer === vsum(s))
}

// --- authority: who may send each act ----------------------------------------------------------

// An act that names an ask is the ask's: its `to` answers, reports, reviews, responds; its `from`
// hears. An ask that is gone leaves the class of sender (the ask itself is then `stale`).
const authority = (s: WorkState, a: Act): boolean => {
  const b = a.body
  const w = a.who
  switch (b._tag) {
    case 'Open':
      switch (b.open._tag) {
        case 'OpenQuestion':
          return w._tag === 'Host' || w._tag === 'Role' || w._tag === 'Pipe' || isMaker(w)
        case 'OpenSend':
          return w._tag === 'Host'
        case 'OpenMake': {
          const t = taskOf(s, b.open.task)
          return t !== undefined && w._tag === 'Role' && w.name === t.role
        }
        case 'OpenReject':
          return w._tag === 'Human'
      }
      return false
    case 'AskEdit':
    case 'EndProject':
    case 'MoveHost':
      return w._tag === 'Human'
    case 'AnswerQuestion':
      return sameAsAsk(s.asks.get(b.ask), w, 'to', () => true)
    case 'Hear':
      return sameAsAsk(s.answered.get(b.ask)?.ask, w, 'from', () => true)
    case 'Report':
      return sameAsAsk(s.asks.get(b.ask), w, 'to', isMaker)
    case 'Review':
      return sameAsAsk(s.asks.get(b.ask), w, 'to', (x) => x._tag === 'Role')
    case 'Respond':
      return sameAsAsk(s.asks.get(b.ask), w, 'to', (x) => x._tag === 'Human')
    case 'AskRaise':
      return isMaker(w)
    case 'ReadBrief':
      return isMaker(w) && w.id === b.maker
    case 'Resume': {
      const r = roleOfMaker(s, b.maker)
      return r !== undefined && w._tag === 'Role' && w.name === r
    }
    case 'Reassign':
    case 'TopDone':
      return w._tag === 'Host'
    case 'Evaluate':
    case 'Advance':
    case 'WriteRule':
    case 'RunTest':
    case 'Ship':
    case 'LoopReview':
    case 'RecheckDone':
      return w._tag === 'Pipe'
    case 'RunRule':
    case 'Exit':
      return w._tag === 'Harness'
    case 'Revive':
      return w._tag === (b.actor._tag === 'Host' ? 'Human' : 'Harness')
  }
}
const sameAsAsk = (
  ask: OpenAsk | undefined,
  who: Actor,
  side: 'from' | 'to',
  cls: (a: Actor) => boolean,
): boolean => ask === undefined ? cls(who) : sameActor(ask[side], who)

// --- the asks the act names: stale, heard ------------------------------------------------------

const seqOfAsk = (id: string): number => Number(id.split('.')[0])
// The asker has asked again since: a question of its own opened after that occurrence.
const askedSince = (s: WorkState, who: Actor, seq: number): boolean =>
  [...s.asks.values(), ...[...s.answered.values()].map((x) => x.ask)].some((a) =>
    a.kind === 'Question' && sameActor(a.from, who) && a.at > seq
  )

// The named ask is not there: closed or replaced (`stale`); an answer already heard (`heard`).
// A heard answer leaves no record: it is the one Hear names that no later question replaced.
const askGone = (s: WorkState, a: Act): 'stale' | 'heard' | null => {
  const b = a.body
  switch (b._tag) {
    case 'AnswerQuestion':
    case 'Report':
    case 'Review':
    case 'Respond':
      return s.asks.has(b.ask) ? null : 'stale'
    case 'Hear': {
      if (s.answered.has(b.ask) || s.asks.has(b.ask)) return null
      const seq = seqOfAsk(b.ask)
      return Number.isNaN(seq) || seq >= s.seq || askedSince(s, a.who, seq) ? 'stale' : 'heard'
    }
    default:
      return null
  }
}

// --- form ------------------------------------------------------------------------------------

const formOk = (s: WorkState, a: Act): boolean => {
  if (a.body._tag !== 'AnswerQuestion') return true
  const ask = s.asks.get(a.body.ask)
  if (ask === undefined || ask.kind !== 'Question') return true // gone: `stale`; else `legal`
  return ask.question !== null && answers(ask.question.form, a.body.answer)
}

// --- legal: what each act needs of the state ---------------------------------------------------

const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

const sendOk = (s: WorkState, sp: TaskSpec): boolean => {
  const open = uncovered(s)
  return sp.sections.length > 0 && new Set(sp.sections).size === sp.sections.length &&
    sp.sections.every((x) => open.includes(x)) && s.cards.has(sp.role)
}
const splitOk = (s: WorkState, t: Task, parts: ReadonlyArray<TaskSpec>): boolean => {
  const all = parts.flatMap((p) => p.sections)
  return t.sections.length > 1 && parts.length >= 2 &&
    parts.every((p) =>
      p.sections.length > 0 && p.sections.length < t.sections.length &&
      p.sections.every((x) => t.sections.includes(x)) && s.cards.has(p.role)
    ) &&
    new Set(all).size === all.length && sameSet(all, t.sections)
}
const makerOk = (s: WorkState, m: Maker): boolean => {
  const t = taskOf(s, m.task)
  return t !== undefined && m.claimed && !briefStale(s, m.brief, t)
}
const verdictOk = (s: WorkState, t: Task, v: Verdict): boolean => {
  switch (v) {
    case 'Pass':
      return t.caught.size === 0
    case 'Fail':
      return t.tries + 1 < s.maxTries
    case 'RaiseTries':
      return t.tries + 1 >= s.maxTries
    default:
      return true
  }
}
const recheckItems = (s: WorkState, t: Task): ReadonlyArray<string> =>
  [...t.pending].filter((x) => !testRule(s, x))
const recheckDue = (s: WorkState, t: Task | undefined): t is Task =>
  t !== undefined && t.state === 'Done' && recheckItems(s, t).length > 0
// The recheck names the items it judged at the versions it saw: what is pending now.
const recheckCurrent = (s: WorkState, t: Task, a: Act, items: ReadonlySet<string>): boolean => {
  const xs = recheckItems(s, t)
  return items.size === xs.length &&
    xs.every((x) => items.has(x) && verOf(a.vers, x) === verOf(s.ver, x))
}

// A question: a live asker toward a live actor, not itself.
const questionOk = (s: WorkState, a: Act, to: Actor): boolean =>
  canAsk(s, a.who) && canBeAsked(s, to) && !sameActor(a.who, to)

// One question open or unheard per ordered pair.
const pairTaken = (s: WorkState, from: Actor, to: Actor): boolean => {
  const k = pairKey(from, to)
  const same = (x: OpenAsk): boolean => x.kind === 'Question' && pairKey(x.from, x.to) === k
  return [...s.asks.values()].some(same) || [...s.answered.values()].some((x) => same(x.ask))
}
const overCap = (s: WorkState, from: Actor, to: Actor): boolean =>
  askCountOf(s, from, to) >= s.askCap

const legal = (s: WorkState, a: Act): boolean => {
  const b = a.body
  switch (b._tag) {
    case 'Open': {
      const o = b.open
      switch (o._tag) {
        case 'OpenQuestion':
          return questionOk(s, a, o.to) && !pairTaken(s, a.who, o.to) && !overCap(s, a.who, o.to)
        case 'OpenSend':
          return sendOk(s, o.spec)
        case 'OpenMake':
          return taskOf(s, o.task)?.state === 'Sent'
        case 'OpenReject': {
          const t = taskOf(s, o.task)
          return t !== undefined && t.resultId >= 0 &&
            (t.state === 'InReview' || t.state === 'Done')
        }
      }
      return false
    }
    case 'EndProject':
      return s.top.done && allDone(s)
    case 'MoveHost':
      return b.fromSession === s.session
    case 'AskEdit':
      return fixOf(s, EDIT).stage === 'Closed' &&
        [...b.draft.keys()].some((x) => x.startsWith('dir:'))
    case 'AnswerQuestion': {
      const ask = s.asks.get(b.ask)
      return ask !== undefined && ask.kind === 'Question' &&
        !(s.justAnswered.has(keyOf(ask.to)) && ownToldSteps(s, ask.to).length > 0)
    }
    case 'Hear':
      return s.answered.has(b.ask)
    case 'AskRaise':
      return isMaker(a.who) && makerAt(s, a.who.id) && overCap(s, a.who, b.to)
    case 'ReadBrief':
      return makerAt(s, b.maker)
    case 'Resume': {
      const m = s.makers.get(b.maker)
      return m !== undefined && !m.ended && s.down.has(keyOf({ _tag: 'Maker', id: b.maker }))
    }
    case 'Report': {
      const ask = s.asks.get(b.ask)
      const id = ask === undefined ? null : makerIdOf(ask.to)
      const m = id === null ? undefined : s.makers.get(id)
      return ask !== undefined && m !== undefined && ask.kind === 'Execute' &&
        ask.from._tag === 'Role' && aboutTask(ask) === m.task && makerAt(s, m.id) && makerOk(s, m)
    }
    case 'Review': {
      const ask = s.asks.get(b.ask)
      const id = ask === undefined ? null : aboutTask(ask)
      const t = id === null ? undefined : taskOf(s, id)
      return ask !== undefined && ask.kind === 'Check' && ask.to._tag === 'Role' &&
        t !== undefined && t.state === 'InReview' && verdictOk(s, t, b.verdict)
    }
    case 'Respond': {
      const ask = s.asks.get(b.ask)
      const id = ask === undefined ? null : aboutFix(ask)
      return ask !== undefined && id !== null && ask.kind === 'Decide' && ask.to._tag === 'Human' &&
        fixOf(s, id).stage === 'AtPerson' &&
        (b.reply === 'AcceptIt' || b.reply === 'SendItBack' || !free(id))
    }
    case 'Evaluate': {
      const t = taskOf(s, b.fix)
      if (t === undefined || fixOf(s, b.fix).stage !== 'Evaluating') return false
      if (b.level !== 'Fit' && depth(b.level) < depth(t.floor)) return false
      if (b.level === 'Split') return splitOk(s, t, b.parts)
      return b.level !== 'Fit' || (b.roleDraft !== null && s.cards.has(b.roleDraft.role))
    }
    case 'Advance':
      return ['AtPrinciple', 'AtDirection', 'AtStandard'].includes(fixOf(s, b.fix).stage)
    case 'WriteRule': {
      const r = b.rec
      const ok = r.form !== 'none' && (!hasMech(r.form) || r.test !== null) &&
        (!hasRef(r.form) || (r.ref !== null && b.refOk)) &&
        (b.fights.length === 0 || !hasMech(r.form))
      return fixOf(s, b.fix).stage === 'AtRule' && b.rule.startsWith('rule:') && ok
    }
    case 'RunTest':
      return fixOf(s, b.fix).stage === 'Testing'
    case 'Ship':
      return fixOf(s, b.fix).stage === 'Drafting'
    case 'LoopReview':
      return fixOf(s, b.fix).stage === 'InLoop' && !(b.toPerson && fixOf(s, b.fix).needRevise)
    case 'Reassign':
      return [...s.fixes.values()].some((f) => f.stage === 'Accepted')
    case 'TopDone':
      return allDone(s) && !s.top.done
    case 'RecheckDone': {
      const t = taskOf(s, b.task)
      return recheckDue(s, t) && recheckCurrent(s, t, a, b.items)
    }
    case 'RunRule': {
      const t = taskOf(s, b.task)
      return t !== undefined && t.state === 'Done' && [...t.pending].some((x) => testRule(s, x))
    }
    case 'Revive':
      return isPersistent(b.actor) && s.down.has(keyOf(b.actor))
    case 'Exit':
      return !s.down.has(keyOf(b.actor)) && known(s, b.actor)
  }
}

// A question over its pair's cap: a maker takes AskRaise; any other asker is simply refused.
const capOf = (s: WorkState, a: Act): boolean =>
  a.body._tag === 'Open' && a.body.open._tag === 'OpenQuestion' && isMaker(a.who) &&
  makerAt(s, a.who.id) && questionOk(s, a, a.body.open.to) && overCap(s, a.who, a.body.open.to)
const pairOf = (s: WorkState, a: Act): boolean =>
  a.body._tag === 'Open' && a.body.open._tag === 'OpenQuestion' &&
  questionOk(s, a, a.body.open.to) && pairTaken(s, a.who, a.body.open.to)

// --- the store's check -------------------------------------------------------------------------

// Where the act comes from: MoveHost belongs to the person's terminal (`work run continue`).
export type Via = 'terminal' | 'page'

// The first failing check, or null. The order: terminal, build, ended, authority, epoch, form,
// stale (heard), pair, cap, legal, basis.
export const refusal = (s: WorkState, a: Act, via: Via = 'terminal'): RefusalName | null => {
  if (a.body._tag === 'MoveHost' && via === 'page') return 'terminal'
  if (a.old) return 'build'
  if (s.top.ended && a.who._tag !== 'Harness') return 'ended'
  if (!authority(s, a)) return 'authority'
  if (hasEpoch(a.who) && a.ep < epochOf(s, a.who)) return 'epoch'
  if (!formOk(s, a)) return 'form'
  const gone = askGone(s, a)
  if (gone !== null) return gone
  if (pairOf(s, a)) return 'pair'
  if (capOf(s, a)) return 'cap'
  if (!legal(s, a)) return 'legal'
  return basisOk(s, a) ? null : 'basis'
}

export const accept = (s: WorkState, a: Act, via: Via = 'terminal'): boolean =>
  refusal(s, a, via) === null

const WORDS: Readonly<Record<RefusalName, string>> = {
  ended: 'the project has ended',
  authority: 'this actor may not send that act',
  epoch: 'this process was replaced by a newer one',
  legal: 'the act is not allowed in the state now',
  basis: 'the act was built on an older view: look again and send it again',
  build: 'this page is an old build: reload it',
  stale: 'the ask the act names is closed or was replaced',
  form: 'the answer does not fit the question',
  pair: 'the earlier question to that actor is still open or not yet heard',
  cap: 'enough questions to that actor: the next one raises the task',
  heard: 'that answer was already heard',
  terminal: 'run `work run continue` in a terminal',
}
// The refusal as the page and the CLI show it; a cap points the maker at AskRaise.
export const refused = (s: WorkState, a: Act, via: Via = 'terminal'): RefusalRecord | null => {
  const name = refusal(s, a, via)
  if (name === null) return null
  return name === 'cap'
    ? { refused: name, words: WORDS[name], next: 'AskRaise' }
    : { refused: name, words: WORDS[name] }
}
