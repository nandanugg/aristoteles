// The effects of work.qnt in TS: what an accepted act does to the state (`effect`), and the
// act as taken (`take`). Pure: every change is a new state. The model's FIXED options are all
// on; its ghost fields (the environment's truths and the history flags) are not kept.
import { applies, changedBy, oldFor, testRule, verOf } from './items.ts'
import {
  CLOSED,
  depth,
  entryOf,
  epOf,
  fixAt,
  fx,
  liveMaker,
  nextStage,
  stageLevel,
  tk,
  upStage,
} from './reads.ts'
import type {
  Act,
  Actor,
  Fix,
  ItemKey,
  Level,
  Maker,
  RoleDraft,
  Stage,
  Task,
  TaskSpec,
  What,
  WorkState,
} from './types.ts'
import {
  EDIT,
  free,
  hasMech,
  HOST,
  isMakerActor,
  isRoleActor,
  kindOf,
  makerActor,
  roleActor,
} from './types.ts'

type Of<T extends What['_tag']> = Extract<What, { _tag: T }>

// --- small updates ---------------------------------------------------------------------------

const put = <K, V>(m: ReadonlyMap<K, V>, k: K, v: V): Map<K, V> => new Map(m).set(k, v)
const without = <T>(xs: ReadonlySet<T>, ys: Iterable<T>): Set<T> => {
  const drop = new Set(ys)
  return new Set([...xs].filter((x) => !drop.has(x)))
}
const cardOf = (s: WorkState, role: string): number => s.card.get(role) ?? 0
const roleDraftOf = (f: Fix): RoleDraft => {
  if (f.roleDraft === null) throw new Error('role fix without a draft')
  return f.roleDraft
}
const cardRole = (f: Fix): string => roleDraftOf(f).role
const isDir = (x: ItemKey): boolean => kindOf(x) === 'dir'

// Every task or fix that changes gets `at`: the seq of the act.
const setT = (s: WorkState, i: string, f: (t: Task) => Task): WorkState => ({
  ...s,
  tasks: put(s.tasks, i, { ...f(tk(s, i)), at: s.seq }),
})
const setF = (s: WorkState, i: string, f: (z: Fix) => Fix): WorkState => ({
  ...s,
  fixes: put(s.fixes, i, { ...f(fx(s, i)), at: s.seq }),
})
const setM = (s: WorkState, m: string | null, f: (y: Maker) => Maker): WorkState => {
  const y = m === null ? undefined : s.makers.get(m)
  return m === null || y === undefined ? s : { ...s, makers: put(s.makers, m, f(y)) }
}
export const endMaker = (s: WorkState, m: string | null): WorkState =>
  setM(s, m, (y) => ({ ...y, ended: true, claim: false }))
const bump = (s: WorkState, i: string): WorkState => setF(s, i, (f) => ({ ...f, step: f.step + 1 }))
export const newEp = (s: WorkState, k: Actor): WorkState => ({
  ...s,
  ep: put(s.ep, k, epOf(s, k) + 1),
})

// A new task: the host's (no parent) or a part of a split.
const addTask = (s: WorkState, spec: TaskSpec, parent: Task | null): WorkState => {
  const id = `t${s.nextTask}`
  const t: Task = {
    id,
    name: spec.name,
    goal: spec.goal,
    role: spec.role,
    parent: parent === null ? null : parent.id,
    sections: spec.sections,
    directions: parent === null ? s.top.directions : parent.directions,
    gen: 0,
    st: 'Sent',
    tries: 0,
    maker: null,
    rid: -1,
    checked: new Map(),
    pend: new Set(),
    caught: new Set(),
    taken: false,
    floor: parent === null ? 'Split' : 'Standard',
    at: s.seq,
  }
  return { ...s, tasks: put(s.tasks, id, t), nextTask: s.nextTask + 1 }
}

// --- raise, ladder, compare and set ----------------------------------------------------------

// A raise: the maker ends; the evaluation opens. What the task still has to be rechecked
// against (pend) stays for the person's "take as is".
export const raise = (s: WorkState, i: string, tries: number): WorkState => {
  const t = tk(s, i)
  const s1 = setT(endMaker(s, t.maker), i, (z) => ({ ...z, st: 'Raised', tries, maker: null }))
  return setF(s1, i, (f) => ({
    ...CLOSED,
    stage: 'SEval',
    step: f.step + 1,
    base: s.ver,
    cardBase: cardOf(s, t.role),
  }))
}

// The work goes back to the role as a task (a fresh maker, no tries used).
export const backToRole = (s: WorkState, i: string): WorkState => {
  const closed = (st: WorkState): WorkState =>
    setF(st, i, (f) => ({ ...CLOSED, step: f.step + 1 }))
  return free(i)
    ? closed(s)
    : closed(setT(s, i, (t) => ({ ...t, st: 'Sent', tries: 0, maker: null, pend: new Set() })))
}

// A draft's change whose items (or card) moved since its base is not put in effect.
export const conflict = (s: WorkState, i: string): boolean => {
  const f = fx(s, i)
  if (f.kind === 'DRole') return f.cardBase < cardOf(s, cardRole(f))
  return [...f.real].some((x) => verOf(f.base, x) < verOf(s.ver, x))
}
export const redo = (s: WorkState, i: string): WorkState =>
  setF(s, i, (y) => ({
    ...y,
    stage: y.entry,
    base: s.ver,
    cardBase: y.kind === 'DRole' ? cardOf(s, cardRole(y)) : y.cardBase,
    rev: y.rev + 1,
    step: y.step + 1,
  }))

// A draft that changes an item already fixed at its level or higher goes one level up.
export const refixed = (s: WorkState, i: string): boolean => {
  if (free(i)) return false
  const f = fx(s, i)
  return (
    f.kind === 'DDir' &&
    fixAt(f) < 3 &&
    [...f.real].some((x) => (s.fixDepth.get(x) ?? -1) >= fixAt(f))
  )
}
export const raiseUp = (s: WorkState, i: string): WorkState => {
  const st: Stage = fixAt(fx(s, i)) === 1 ? 'SDirAssess' : 'SPrinciple'
  const level: Level = st === 'SDirAssess' ? 'Direct' : 'Principle'
  return setF(s, i, (z) => ({ ...z, stage: st, entry: st, level, step: z.step + 1 }))
}

const deeperEntry = (e: Stage, n: Stage): Stage =>
  n === 'SAtPerson' ? e : depth(stageLevel(n)) > depth(stageLevel(e)) ? n : e
// A rule failing its own examples again: one stage up the ladder, then the person.
export const ruleClimb = (z: Fix): Fix => {
  const n = upStage(z.climb)
  const e = deeperEntry(z.entry, n)
  return {
    ...z,
    climb: n,
    stage: n,
    entry: e,
    level: stageLevel(e),
    ruleTries: 0,
    loops: 0,
    kind: n === 'SAtPerson' ? z.kind : 'DDir',
  }
}
// A draft the review loop sends back again: one level up from its entry; a role draft goes to
// the person.
export const loopClimb = (z: Fix): Fix => {
  const n: Stage =
    z.kind === 'DRole'
      ? 'SAtPerson'
      : upStage(z.entry === 'SRuleAssess' ? 'SStdAssess' : z.entry)
  if (n === 'SAtPerson') return { ...z, stage: 'SAtPerson', loops: 0, needRevise: false }
  return {
    ...z,
    stage: n,
    entry: n,
    level: stageLevel(n),
    loops: 0,
    needRevise: false,
    rev: z.rev + 1,
  }
}

// --- changes in effect -----------------------------------------------------------------------

const EARLY: ReadonlyArray<Stage> = [
  'SPrinciple',
  'SDirAssess',
  'SStdAssess',
  'SRuleAssess',
  'STest',
  'SDraft',
]

// The items of fix i's draft take effect (DESIGN 9): records set, versions up, the tasks they
// apply to owe a recheck, the other open drafts rebased.
export const itemsInEffect = (s: WorkState, i: string): WorkState => {
  const f = fx(s, i)
  const c = f.real
  const items = new Map(s.items)
  for (const [x, r] of f.draft) {
    if (r === null) items.delete(x)
    else items.set(x, r)
  }
  const ver = new Map(s.ver)
  for (const x of c) ver.set(x, verOf(s.ver, x) + 1)
  const fixDepth = new Map(s.fixDepth)
  if (!free(i)) for (const x of c) fixDepth.set(x, fixAt(f))
  const s1: WorkState = { ...s, items, ver, fixDepth }
  const s2 = free(i)
    ? s1
    : setT(s1, i, (z) => ({
      ...z,
      floor: fixAt(f) >= 2 || z.floor === 'Principle' ? 'Principle' : 'Direct',
    }))
  // A contradicted rule is owed by the tasks it applies to (done, raised, in review); a done
  // task owes what the change reaches.
  const tasks = new Map(s2.tasks)
  for (const [j, t] of s2.tasks) {
    if (j === i) continue
    const fought = ['Done', 'Raised', 'InReview'].includes(t.st)
      ? [...f.fights].filter((x) => applies(s2, x, t))
      : []
    const hit = t.st === 'Done' ? [...c].filter((x) => applies(s2, x, t)) : []
    if (fought.length + hit.length > 0) {
      tasks.set(j, { ...t, pend: new Set([...t.pend, ...fought, ...hit]), at: s.seq })
    }
  }
  // Rebase: a draft built before a direction change, or at the person over the same items.
  const dirChange = [...c].some(isDir)
  let s3: WorkState = { ...s2, tasks }
  for (const [j, z] of s2.fixes) {
    const early = EARLY.includes(z.stage) && dirChange
    const late =
      (z.stage === 'SLoop' || z.stage === 'SAtPerson') &&
      z.kind === 'DDir' &&
      [...z.real].some((x) => c.has(x))
    if (j !== i && (early || late)) {
      s3 = setF(s3, j, (y) => ({
        ...y,
        stage: y.entry,
        base: ver,
        rev: y.rev + 1,
        step: y.step + 1,
      }))
    }
  }
  return s3
}

// An accepted role draft: the card changes; the other role drafts of the role are rebased.
export const cardInEffect = (s: WorkState, i: string): WorkState => {
  const f = fx(s, i)
  const role = cardRole(f)
  const card = put(s.card, role, cardOf(s, role) + 1)
  const cards = put(s.cards, role, roleDraftOf(f))
  let s1: WorkState = { ...s, cards, card }
  for (const [j, z] of s.fixes) {
    if (
      j !== i &&
      z.kind === 'DRole' &&
      cardRole(z) === role &&
      (z.stage === 'SLoop' || z.stage === 'SAtPerson')
    ) {
      s1 = setF(s1, j, (y) => ({
        ...y,
        stage: 'SLoop',
        cardBase: cardOf(s1, role),
        rev: y.rev + 1,
        step: y.step + 1,
      }))
    }
  }
  return s1
}

// Ship's standard change: in effect at once.
export const shipStandard = (s: WorkState, i: string): WorkState => {
  if (conflict(s, i)) return redo(s, i)
  if (refixed(s, i)) return raiseUp(s, i)
  return backToRole(itemsInEffect(s, i), i)
}

// The person's edit after the pipeline role carried it down: back to the person when it has
// items the person did not write, leaves out what they wrote, or is contradicted.
export const shipEdit = (s: WorkState): WorkState => {
  const f = fx(s, EDIT)
  const back =
    [...f.real].some((x) => !f.wrote.has(x)) ||
    [...f.wrote].some((x) => !f.real.has(x)) ||
    f.contradicted
  if (back) return setF(s, EDIT, (z) => ({ ...z, stage: 'SLoop' }))
  if (conflict(s, EDIT)) return redo(s, EDIT)
  return setF(itemsInEffect(s, EDIT), EDIT, (z) => ({ ...z, stage: 'SAccepted' }))
}

// --- the acts --------------------------------------------------------------------------------

const evaluate = (s: WorkState, a: Act, w: Of<'Evaluate'>): WorkState => {
  const i = w.task
  const s1 = bump(s, i)
  if (w.level === 'Split') {
    const t = tk(s, i)
    const s2 = setT(s1, i, (z) => ({ ...z, st: 'Split', maker: null }))
    const s3 = w.parts.reduce((acc, p) => addTask(acc, p, t), s2)
    return setF(s3, i, (f) => ({ ...CLOSED, step: f.step }))
  }
  if (w.level === 'Fit') {
    const rd = w.roleDraft
    return setF(s1, i, (f) => ({
      ...f,
      level: w.level,
      kind: 'DRole',
      stage: 'SLoop',
      entry: 'SLoop',
      roleDraft: rd,
      roleOnly: rd !== null && rd.model === s.cards.get(rd.role)?.model,
      cardBase: rd === null ? f.cardBase : cardOf(s, rd.role),
      summary: w.summary,
    }))
  }
  return setF(s1, i, (f) => ({
    ...f,
    level: w.level,
    kind: 'DDir',
    stage: entryOf(w.level),
    entry: entryOf(w.level),
    base: a.vers,
    summary: w.summary,
  }))
}

const runTest = (s: WorkState, w: Of<'RunTest'>): WorkState => {
  const i = w.fix
  const contra = w.contra.length > 0
  const f = fx(s, i)
  const s1 = bump(s, i)
  if (!w.own) {
    return setF(s1, i, (z) =>
      z.ruleTries >= 1 ? ruleClimb(z) : { ...z, stage: 'SRuleAssess', ruleTries: 1 })
  }
  if (contra && f.entry !== 'SDirAssess' && f.entry !== 'SPrinciple') {
    return setF(s1, i, (z) => ({
      ...z,
      kind: 'DDir',
      level: 'Direct',
      stage: 'SDirAssess',
      entry: 'SDirAssess',
      contradicted: true,
      fights: new Set(w.contra),
    }))
  }
  if (contra) {
    return setF(s1, i, (z) => ({
      ...z,
      stage: 'SDraft',
      contradicted: true,
      fights: new Set(w.contra),
    }))
  }
  return setF(s1, i, (z) => ({ ...z, stage: 'SDraft', fights: new Set() }))
}

const ship = (s: WorkState, w: Of<'Ship'>): WorkState => {
  const i = w.fix
  const real = changedBy(s, w.draft)
  const s1 = setF(s, i, (f) => ({
    ...f,
    items: w.items,
    real,
    draft: w.draft,
    step: f.step + 1,
  }))
  if (free(i)) return shipEdit(s1)
  const entry = fx(s, i).entry
  const escalated = entry === 'SDirAssess' || entry === 'SPrinciple'
  if (![...real].some(isDir) && !escalated) return shipStandard(s1, i)
  if (refixed(s1, i)) return raiseUp(s1, i)
  return setF(s1, i, (z) => ({ ...z, stage: 'SLoop' }))
}

const accept = (s: WorkState, i: string): WorkState => {
  const f = fx(s, i)
  if (conflict(s, i)) return redo(s, i)
  if (refixed(s, i)) return raiseUp(s, i)
  const s1 = bump(f.kind === 'DDir' ? itemsInEffect(s, i) : cardInEffect(s, i), i)
  return f.kind === 'DRole' && f.roleOnly
    ? backToRole(s1, i)
    : setF(s1, i, (z) => ({ ...z, stage: 'SAccepted' }))
}

const review = (s: WorkState, w: Of<'Review'>): WorkState => {
  const i = w.task
  const t = tk(s, i)
  switch (w.v) {
    case 'Pass':
      return setT(endMaker(s, t.maker), i, (z) => ({
        ...z,
        st: 'Done',
        maker: null,
        checked: s.ver,
        pend: new Set(),
        caught: new Set(),
      }))
    // The revision goes to the same maker. A rechecked task has none: a fresh one.
    case 'Fail':
      return liveMaker(s, i) === null
        ? setT(s, i, (z) => ({ ...z, st: 'Sent', tries: z.tries + 1 }))
        : setM(setT(s, i, (z) => ({ ...z, st: 'Working', tries: z.tries + 1 })), t.maker, (y) => ({
          ...y,
          revs: y.revs + 1,
        }))
    case 'RaiseTries':
      return raise(s, i, t.tries + 1)
    default:
      return raise(s, i, t.tries)
  }
}

const now = (s: WorkState, x: ItemKey): number => verOf(s.ver, x)
// What a recheck settles: the items it judged are checked now, or the task goes back.
const rechecked = (s: WorkState, i: string, xs: ReadonlySet<ItemKey>, holds: boolean): WorkState =>
  holds
    ? setT(s, i, (z) => ({
      ...z,
      pend: without(z.pend, xs),
      checked: new Map([...z.checked, ...[...xs].map((x): [ItemKey, number] => [x, now(s, x)])]),
    }))
    : {
      ...setT(s, i, (z) => ({ ...z, st: 'Sent', tries: 0, maker: null, pend: new Set() })),
      top: { ...s.top, done: false },
    }

// The live makers of the tasks of a role: [task, maker].
const liveOf = (s: WorkState, k: Actor): Array<[string, string]> =>
  [...s.tasks.keys()].flatMap((j) => {
    const m = liveMaker(s, j)
    return m !== null && roleActor(tk(s, j).role) === k ? [[j, m] as [string, string]] : []
  })

const exit = (s: WorkState, k: Actor): WorkState => {
  const gone = [k, ...(isRoleActor(k) ? liveOf(s, k).map(([, m]) => makerActor(m)) : [])]
  const s1: WorkState = { ...s, down: new Set([...s.down, ...gone]) }
  return gone.filter(isMakerActor).reduce(
    (acc, g) => setM(acc, g.slice('maker:'.length), (y) => ({ ...y, claim: false })),
    s1,
  )
}

// A revived role starts again: its makers end and their tasks go to a fresh maker.
const revive = (s: WorkState, k: Actor): WorkState => {
  const s1 = newEp({ ...s, down: without(s.down, [k]) }, k)
  return isRoleActor(k)
    ? liveOf(s, k).reduce(
      (acc, [j, m]) => {
        const s2 = endMaker(acc, m)
        return tk(s, j).st === 'Working'
          ? setT(s2, j, (z) => ({ ...z, st: 'Sent', maker: null }))
          : s2
      },
      s1,
    )
    : s1
}

const reassign = (s: WorkState): WorkState => {
  const accepted = [...s.fixes].filter(([, f]) => f.stage === 'SAccepted').map(([j]) => j)
  const s1 = accepted.reduce(backToRole, s)
  return [...s1.tasks].reduce(
    (acc, [j, t]) =>
      t.st === 'Working' || t.st === 'InReview'
        ? setT(endMaker(acc, t.maker), j, (z) => ({ ...z, st: 'Sent', tries: 0, maker: null }))
        : acc,
    s1,
  )
}

export const effect = (s: WorkState, a: Act): WorkState => {
  const w = a.what
  switch (w._tag) {
    case 'EndProject':
      return { ...s, top: { ...s.top, ended: true } }
    case 'MoveHost':
      return newEp(
        { ...s, session: s.session + 1, top: { ...s.top, hostSession: s.session + 1 } },
        HOST,
      )
    // The person's edit enters at direction assessment, built on the versions the page showed.
    case 'EditDirection':
      return setF(s, EDIT, (f) => ({
        ...CLOSED,
        stage: 'SDirAssess',
        entry: 'SDirAssess',
        level: 'Direct',
        kind: 'DDir',
        base: a.old ? s.ver : a.vers,
        draft: w.draft,
        wrote: new Set(w.draft.keys()),
        step: f.step + 1,
      }))
    case 'Reject': {
      const t = tk(s, w.task)
      return raise(t.st === 'Done' ? { ...s, top: { ...s.top, done: false } } : s, w.task, t.tries)
    }
    case 'Accept':
      return accept(s, w.fix)
    case 'SendBack':
      return setF(s, w.fix, (f) => ({
        ...f,
        stage: 'SLoop',
        sentBack: new Set([...f.sentBack, f.rev]),
        needRevise: true,
        loops: 0,
        backs: f.backs + 1,
        step: f.step + 1,
      }))
    // Take the result as it is (rechecked against what changed since), or evaluate again.
    case 'Decide':
      return w.take
        ? setF(
          setT(s, w.task, (t) => ({
            ...t,
            st: 'Done',
            taken: true,
            pend: new Set([...oldFor(s, t), ...t.pend]),
          })),
          w.task,
          (f) => ({ ...CLOSED, step: f.step + 1 }),
        )
        : setF(s, w.task, (f) => ({ ...CLOSED, stage: 'SEval', step: f.step + 1 }))
    case 'SendTask':
      return addTask(s, w.spec, null)
    case 'Reassign':
      return reassign(s)
    case 'TopDone':
      return { ...s, top: { ...s.top, done: true } }
    case 'AssignDo': {
      const id = `m${s.nextMaker}`
      const y: Maker = {
        id,
        task: w.task,
        ended: false,
        claim: false,
        brief: new Map(),
        revs: 0,
      }
      const s1 = {
        ...s,
        nextMaker: s.nextMaker + 1,
        makers: put(s.makers, id, y),
        ep: put(s.ep, makerActor(id), 0),
      }
      return setT(s1, w.task, (t) => ({ ...t, st: 'Working', tries: 0, maker: id }))
    }
    case 'Review':
      return review(s, w)
    case 'Resume':
      return newEp({ ...s, down: without(s.down, [makerActor(w.maker)]) }, makerActor(w.maker))
    case 'ReadBrief':
      return setM(s, w.maker, (y) => ({ ...y, claim: true, brief: s.ver }))
    case 'Report': {
      const y = s.makers.get(w.maker)
      if (y === undefined) return s
      return setT(s, y.task, (z) => ({
        ...z,
        st: 'InReview',
        rid: z.rid + 1,
        checked: y.brief,
        taken: false,
        caught: w.caught,
      }))
    }
    case 'Evaluate':
      return evaluate(s, a, w)
    case 'Advance':
      return setF(bump(s, w.fix), w.fix, (f) => ({ ...f, stage: nextStage(f.stage) }))
    case 'WriteRule':
      return setF(bump(s, w.fix), w.fix, (f) => ({
        ...f,
        draft: put(f.draft, w.rule, w.rec),
        form: w.rec.form,
        fights: new Set(),
        contradicted: false,
        stage: hasMech(w.rec.form) ? 'STest' : 'SDraft',
      }))
    case 'RunTest':
      return runTest(s, w)
    case 'Ship':
      return ship(s, w)
    case 'LoopReview':
      return setF(bump(s, w.fix), w.fix, (z) =>
        w.toPerson
          ? { ...z, stage: 'SAtPerson' }
          : z.loops >= 1
          ? loopClimb(z)
          : { ...z, rev: z.rev + 1, loops: z.loops === 1 ? 2 : 1, needRevise: false })
    case 'RecheckDone':
      return rechecked(s, w.task, w.items, w.holds)
    case 'RunRule':
      return rechecked(
        s,
        w.task,
        new Set([...tk(s, w.task).pend].filter((x) => testRule(s, x))),
        w.holds,
      )
    case 'Revive':
      return revive(s, w.who)
    case 'Exit':
      return exit(s, w.who)
  }
}

export const take = (s: WorkState, a: Act): WorkState => {
  const s1 = effect(s, a)
  return { ...s1, seq: s1.seq + 1 }
}
