// The store's check of work.qnt (accept) in TS: who may act, from which epoch, what is legal in
// the state, on which basis, from which build. Every option of FIXED is on.
import { briefOld, verOf, testRule, vsum } from '../../state/work/items.ts'
import { allDone, depth, epOf, fx, uncovered } from '../../state/work/reads.ts'
import type { Act, Maker, Task, What, WorkState } from '../../state/work/types.ts'
import {
  EDIT,
  HARNESS,
  HOST,
  PERSON,
  PIPE,
  free,
  hasMech,
  hasRef,
  isPersistent,
  makerActor,
  roleActor,
} from '../../state/work/types.ts'

const roleOf = (s: WorkState, i: string): string | undefined => s.tasks.get(i)?.role
const makerRole = (s: WorkState, m: string): string | undefined => {
  const mm = s.makers.get(m)
  return mm === undefined ? undefined : roleOf(s, mm.task)
}

// The basis of an act, now. -1: the act names none.
export const cur = (s: WorkState, what: What): number => {
  switch (what._tag) {
    case 'Review':
    case 'Reject':
    case 'RecheckDone':
      return s.tasks.get(what.task)?.rid ?? -1
    case 'Report':
      return s.makers.get(what.maker)?.revs ?? -1
    case 'Accept':
    case 'SendBack':
    case 'Advance':
    case 'WriteRule':
    case 'RunTest':
    case 'Ship':
    case 'LoopReview':
      return fx(s, what.fix).step
    case 'Decide':
    case 'Evaluate':
      return fx(s, what.task).step
    default:
      return -1
  }
}

// Acts whose judgement depends on the item versions.
export const dirBased = (what: What): boolean =>
  what._tag === 'Review' || what._tag === 'Report' || what._tag === 'Evaluate'

export const authority = (s: WorkState, a: Act): boolean => {
  const w = a.what
  switch (w._tag) {
    case 'EndProject':
    case 'MoveHost':
    case 'EditDirection':
    case 'Reject':
    case 'Accept':
    case 'SendBack':
    case 'Decide':
      return a.who === PERSON
    case 'SendTask':
    case 'Reassign':
    case 'TopDone':
      return a.who === HOST
    case 'AssignDo':
    case 'Review': {
      const r = roleOf(s, w.task)
      return r !== undefined && a.who === roleActor(r)
    }
    case 'Resume': {
      const r = makerRole(s, w.maker)
      return r !== undefined && a.who === roleActor(r)
    }
    case 'ReadBrief':
    case 'Report':
      return a.who === makerActor(w.maker)
    case 'Evaluate':
    case 'Advance':
    case 'WriteRule':
    case 'RunTest':
    case 'Ship':
    case 'LoopReview':
    case 'RecheckDone':
      return a.who === PIPE
    case 'RunRule':
    case 'Exit':
      return a.who === HARNESS
    case 'Revive':
      return a.who === (w.who === HOST ? PERSON : HARNESS)
  }
}

// The person and the harness have no epoch.
export const epochOk = (s: WorkState, a: Act): boolean =>
  a.who === PERSON || a.who === HARNESS || a.ep >= epOf(s, a.who)

// A maker act: on a working task, by its live maker.
export const makerAt = (s: WorkState, m: string): boolean => {
  const mm = s.makers.get(m)
  const t = mm === undefined ? undefined : s.tasks.get(mm.task)
  return (
    mm !== undefined &&
    t !== undefined &&
    !s.down.has(makerActor(m)) &&
    t.st === 'Working' &&
    !mm.ended &&
    t.maker === m
  )
}

export const reviewOk = (s: WorkState, i: string, a: Act): boolean => {
  const t = s.tasks.get(i)
  const w = a.what
  if (t === undefined || t.st !== 'InReview' || w._tag !== 'Review') return false
  switch (w.v) {
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

// The recheck names the items it judged at the versions it saw: what is pending now.
export const recheckDue = (s: WorkState, i: string): boolean => {
  const t = s.tasks.get(i)
  return t !== undefined && t.st === 'Done' && [...t.pend].some((x) => !testRule(s, x))
}
export const recheckCurrent = (s: WorkState, i: string, a: Act): boolean => {
  const t = s.tasks.get(i)
  if (t === undefined || a.what._tag !== 'RecheckDone') return false
  const xs = [...t.pend].filter((x) => !testRule(s, x))
  const named = a.what.items
  return (
    named.size === xs.length &&
    xs.every((x) => named.has(x) && verOf(a.vers, x) === verOf(s.ver, x))
  )
}

const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

const sendOk = (s: WorkState, sp: { sections: ReadonlyArray<string>; role: string }): boolean => {
  const open = uncovered(s)
  return (
    sp.sections.length > 0 &&
    new Set(sp.sections).size === sp.sections.length &&
    sp.sections.every((x) => open.includes(x)) &&
    s.cards.has(sp.role)
  )
}

const splitOk = (
  s: WorkState,
  t: Task,
  parts: ReadonlyArray<{ sections: ReadonlyArray<string>; role: string }>,
): boolean => {
  const all = parts.flatMap((p) => p.sections)
  return (
    t.sections.length > 1 &&
    parts.length >= 2 &&
    parts.every(
      (p) =>
        p.sections.length > 0 &&
        p.sections.length < t.sections.length &&
        p.sections.every((x) => t.sections.includes(x)) &&
        s.cards.has(p.role),
    ) &&
    new Set(all).size === all.length &&
    sameSet(all, t.sections)
  )
}

const makerOk = (s: WorkState, m: Maker): boolean => {
  const t = s.tasks.get(m.task)
  return t !== undefined && m.claim && !briefOld(s, m.brief, t)
}

export const legal = (s: WorkState, a: Act): boolean => {
  const w = a.what
  switch (w._tag) {
    case 'EndProject':
      return s.top.done && allDone(s)
    case 'MoveHost':
      return w.fromSession === s.session
    case 'EditDirection':
      return (
        fx(s, EDIT).stage === 'SClosed' && [...w.draft.keys()].some((x) => x.startsWith('dir:'))
      )
    case 'Reject': {
      const t = s.tasks.get(w.task)
      return t !== undefined && t.rid >= 0 && (t.st === 'InReview' || t.st === 'Done')
    }
    case 'Accept':
    case 'SendBack':
      return fx(s, w.fix).stage === 'SAtPerson'
    case 'Decide':
      return s.tasks.has(w.task) && !free(w.task) && fx(s, w.task).stage === 'SAtPerson'
    case 'SendTask':
      return sendOk(s, w.spec)
    case 'Reassign':
      return [...s.fixes.values()].some((f) => f.stage === 'SAccepted')
    case 'TopDone':
      return allDone(s) && !s.top.done
    case 'AssignDo':
      return s.tasks.get(w.task)?.st === 'Sent'
    case 'Review':
      return reviewOk(s, w.task, a)
    case 'Resume': {
      const m = s.makers.get(w.maker)
      return m !== undefined && !m.ended && s.down.has(makerActor(w.maker))
    }
    case 'ReadBrief':
      return makerAt(s, w.maker)
    case 'Report': {
      const m = s.makers.get(w.maker)
      return m !== undefined && makerAt(s, w.maker) && makerOk(s, m)
    }
    case 'Evaluate': {
      const t = s.tasks.get(w.task)
      if (t === undefined || fx(s, w.task).stage !== 'SEval') return false
      if (w.level !== 'Fit' && depth(w.level) < depth(t.floor)) return false
      if (w.level === 'Split') return splitOk(s, t, w.parts)
      const d = w.roleDraft
      return w.level !== 'Fit' || (d !== null && s.cards.has(d.role))
    }
    case 'Advance':
      return ['SPrinciple', 'SDirAssess', 'SStdAssess'].includes(fx(s, w.fix).stage)
    case 'WriteRule': {
      const r = w.rec
      const formOk =
        r.form !== 'none' &&
        (!hasMech(r.form) || r.test !== null) &&
        (!hasRef(r.form) || (r.ref !== null && w.refOk))
      return fx(s, w.fix).stage === 'SRuleAssess' && w.rule.startsWith('rule:') && formOk
    }
    case 'RunTest':
      return fx(s, w.fix).stage === 'STest'
    case 'Ship':
      return fx(s, w.fix).stage === 'SDraft'
    case 'LoopReview':
      return fx(s, w.fix).stage === 'SLoop' && !(w.toPerson && fx(s, w.fix).needRevise)
    case 'RecheckDone':
      return recheckDue(s, w.task) && recheckCurrent(s, w.task, a)
    case 'RunRule': {
      const t = s.tasks.get(w.task)
      return t !== undefined && t.st === 'Done' && [...t.pend].some((x) => testRule(s, x))
    }
    case 'Revive':
      return isPersistent(w.who) && s.down.has(w.who)
    case 'Exit':
      return !s.down.has(w.who)
  }
}

export const basisOk = (s: WorkState, a: Act): boolean => {
  const c = cur(s, a.what)
  return (c < 0 || a.seen === c) && (!dirBased(a.what) || a.seenVer === vsum(s))
}

export type Refusal = 'ended' | 'authority' | 'epoch' | 'legal' | 'basis' | 'build'

export const refusal = (s: WorkState, a: Act): Refusal | null =>
  s.top.ended && a.who !== HARNESS
    ? 'ended'
    : !authority(s, a)
    ? 'authority'
    : !epochOk(s, a)
    ? 'epoch'
    : !legal(s, a)
    ? 'legal'
    : !basisOk(s, a)
    ? 'basis'
    : a.old
    ? 'build'
    : null

export const accept = (s: WorkState, a: Act): boolean => refusal(s, a) === null
