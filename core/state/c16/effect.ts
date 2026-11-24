// The effects of protocol.qnt in TS: what an accepted act does to the state (`effect`), and the act
// as taken (`take`: effect, the sweep of the asks, justAnswered, the next seq). Pure: every change
// is a new state. The model's ghosts and options are not kept: the environment's truths come in the
// act (caught, own, contra, holds) or are not state.
import type {
  Form as RecForm,
  ItemKey,
  RoleDraft,
  TaskSpec,
  Versions,
} from './data.ts'
import { EDIT, free, hasMech, kindOf } from './data.ts'
import {
  advance,
  applies,
  asksAbout,
  changedBy,
  closeAsk,
  depth,
  entryOf,
  epochOf,
  findAsk,
  fixAt,
  fixOf,
  liveMaker,
  nextStage,
  openAsk,
  type AskSpec,
  pipeStage,
  stageLevel,
  staleItems,
  taskOf,
  testRule,
  upStage,
  verOf,
} from './reads.ts'
import {
  CLOSED,
  type Fix,
  type Form,
  type Maker,
  type Stage,
  type Task,
  type WorkState,
} from './state.ts'
import { type Act, type Actor, type Body, type OpenBody, keyOf, pairKey } from './types.ts'

type Of<T extends Body['_tag']> = Extract<Body, { _tag: T }>

const HOST: Actor = { _tag: 'Host' }
const PIPE: Actor = { _tag: 'Pipe' }
const HUMAN: Actor = { _tag: 'Human' }

// --- small updates -------------------------------------------------------------------------------

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
const isDir = (x: ItemKey): boolean => kindOf(x) === 'dir'
const formOf = (f: RecForm): Form =>
  f === 'mech' ? 'Mech' : f === 'ref' ? 'Ref' : f === 'both' ? 'Both' : 'NoForm'

// The actors and subjects of a task's asks: its role (the persistent role it is sent to).
const roleOf = (t: Task): Actor => ({ _tag: 'Role', name: t.role })
const maker = (id: string): Actor => ({ _tag: 'Maker', id })
const exec = (from: Actor, to: Actor, id: string): AskSpec =>
  ({ kind: 'Execute', from, to, about: { _tag: 'Task', id } })
const raiseAsk = (by: Actor, fix: string): AskSpec =>
  ({ kind: 'Execute', from: by, to: PIPE, about: { _tag: 'Fix', id: fix } })
const open = (s: WorkState, spec: AskSpec): WorkState => openAsk(s, spec).state
const closeSpec = (s: WorkState, spec: AskSpec): WorkState => {
  const a = findAsk(s, spec)
  return a === undefined ? s : closeAsk(s, a.id)
}

// Every task or fix that changes gets `at`: the seq of the act.
const setT = (s: WorkState, i: string, f: (t: Task) => Task): WorkState => ({
  ...s,
  tasks: put(s.tasks, i, { ...f(taskOf(s, i)), at: s.seq }),
})
const setF = (s: WorkState, i: string, f: (z: Fix) => Fix): WorkState => {
  const { reviewMode, ...fix } = f(fixOf(s, i))
  // A report describes the draft at the person's decision. Leaving that stage clears it.
  return {
    ...s,
    fixes: put(s.fixes, i, {
      ...fix,
      ...(fix.stage === 'AtPerson' && reviewMode !== undefined ? { reviewMode } : {}),
      at: s.seq,
    }),
  }
}
const setM = (s: WorkState, m: string | null, f: (y: Maker) => Maker): WorkState => {
  const y = m === null ? undefined : s.makers.get(m)
  return m === null || y === undefined ? s : { ...s, makers: put(s.makers, m, f(y)) }
}
const bump = (s: WorkState, i: string): WorkState =>
  setF(s, i, (f) => ({ ...f, basisStep: f.basisStep + 1 }))
const newEpoch = (s: WorkState, a: Actor): WorkState => ({
  ...s,
  ep: put(s.ep, keyOf(a), epochOf(s, a) + 1),
})

// A maker ends: its claim ends, its asks, answers and question counts go (null: nothing ends).
const endMaker = (s: WorkState, m: string | null): WorkState => {
  if (m === null) return s
  const key = keyOf(maker(m))
  const mine = (a: { readonly from: Actor; readonly to: Actor }): boolean =>
    keyOf(a.from) === key || keyOf(a.to) === key
  const ended = setM(s, m, (y) => ({ ...y, ended: true, claimed: false }))
  return {
    ...ended,
    asks: new Map([...ended.asks].filter(([, a]) => !mine(a))),
    answered: new Map([...ended.answered].filter(([, r]) => !mine(r.ask))),
    justAnswered: without(ended.justAnswered, [key]),
    askCount: new Map(
      [...ended.askCount].filter(([k]) => !(JSON.parse(k) as ReadonlyArray<string>).includes(key)),
    ),
  }
}

// A new task: the host's (no parent) or a part of a split.
const addTask = (s: WorkState, id: string, spec: TaskSpec, parent: Task | null): WorkState => {
  const t: Task = {
    id,
    name: spec.name,
    goal: spec.goal,
    role: spec.role,
    parent: parent === null ? null : parent.id,
    sections: spec.sections,
    facts: { ...(parent?.facts ?? s.top.facts), ...spec.facts },
    directions: parent === null ? s.top.directions : parent.directions,
    generation: 0,
    state: 'Sent',
    tries: 0,
    maker: null,
    resultId: -1,
    checked: new Map(),
    pending: new Set(),
    caught: new Set(),
    taken: false,
    floor: parent === null ? 'Split' : 'Standard',
    at: s.seq,
  }
  return { ...s, tasks: put(s.tasks, id, t), nextTask: s.nextTask + 1 }
}

// --- raise, ladder, compare and set --------------------------------------------------------------

// The host's task is open again (a done task rejected, rechecked and failed).
const reopenHost = (s: WorkState, slot: string): WorkState =>
  open(s, exec(HOST, roleOf(taskOf(s, slot)), slot))

// A raise: the maker ends; the evaluation opens, an Execute to the pipeline role by `by`. What the
// task still has to recheck (pending) stays for the person's "take as is".
const raise = (s: WorkState, slot: string, tries: number, by: Actor): WorkState => {
  const t = taskOf(s, slot)
  const raised = setT(
    endMaker(s, t.maker),
    slot,
    (z) => ({ ...z, state: 'Raised', tries, maker: null }),
  )
  return open(
    setF(raised, slot, (f) => ({
      ...CLOSED,
      stage: 'Evaluating',
      basisStep: f.basisStep + 1,
      base: s.ver,
      cardBase: cardOf(s, t.role),
    })),
    raiseAsk(by, slot),
  )
}

// The work goes back to the role as a task (a fresh maker, no tries used).
const backToRole = (s: WorkState, i: string): WorkState => {
  const closed = (st: WorkState): WorkState =>
    setF(st, i, (f) => ({ ...CLOSED, basisStep: f.basisStep + 1 }))
  return free(i)
    ? closed(s)
    : closed(
      setT(s, i, (t) => ({ ...t, state: 'Sent', tries: 0, maker: null, pending: new Set() })),
    )
}

// A draft's change whose items (or card) moved since its base is not put in effect.
const conflict = (s: WorkState, i: string): boolean => {
  const f = fixOf(s, i)
  if (f.kind === 'RoleDraft') return f.cardBase < cardOf(s, roleDraftOf(f).role)
  return [...f.real].some((x) => verOf(f.base, x) < verOf(s.ver, x))
}
const redo = (s: WorkState, i: string): WorkState =>
  setF(s, i, (y) => ({
    ...y,
    stage: y.entry,
    base: s.ver,
    resolvesFight: false,
    resolvedOn: null,
    cardBase: y.kind === 'RoleDraft' ? cardOf(s, roleDraftOf(y).role) : y.cardBase,
    revision: y.revision + 1,
    basisStep: y.basisStep + 1,
  }))

// A draft at the level of an item already fixed at its level or higher goes one level up.
const refixed = (s: WorkState, i: string): boolean => {
  if (free(i)) return false
  const f = fixOf(s, i)
  return (
    f.kind === 'DirectionDraft' &&
    fixAt(f) < 3 &&
    [...f.real].some((x) => (s.fixDepth.get(x) ?? -1) >= fixAt(f))
  )
}
const raiseUp = (s: WorkState, i: string): WorkState => {
  const stage: Stage = fixAt(fixOf(s, i)) === 1 ? 'AtDirection' : 'AtPrinciple'
  return setF(s, i, (z) => ({
    ...z,
    stage,
    entry: stage,
    resolvesFight: false,
    resolvedOn: null,
    level: stage === 'AtDirection' ? 'Direct' : 'Principle',
    basisStep: z.basisStep + 1,
  }))
}

const deeperEntry = (entry: Stage, upper: Stage): Stage =>
  upper === 'AtPerson'
    ? entry
    : depth(stageLevel(upper)) > depth(stageLevel(entry))
    ? upper
    : entry
// A rule failing its own examples again: one stage up the ladder, then the person.
const ruleClimb = (z: Fix): Fix => {
  const upper = upStage(z.climbedTo)
  const entry = deeperEntry(z.entry, upper)
  return {
    ...z,
    climbedTo: upper,
    stage: upper,
    entry,
    level: stageLevel(entry),
    ruleTries: 0,
    loopRounds: 0,
    kind: upper === 'AtPerson' ? z.kind : 'DirectionDraft',
  }
}
// A draft the review loop sends back again: one level up from its entry; a role draft goes to the
// person.
const loopClimb = (z: Fix): Fix => {
  const upper: Stage = z.kind === 'RoleDraft'
    ? 'AtPerson'
    : upStage(z.entry === 'AtRule' ? 'AtStandard' : z.entry)
  if (upper === 'AtPerson') return { ...z, stage: 'AtPerson', loopRounds: 0, needRevise: false }
  return {
    ...z,
    stage: upper,
    entry: upper,
    level: stageLevel(upper),
    loopRounds: 0,
    needRevise: false,
    revision: z.revision + 1,
  }
}

// --- changes in effect ---------------------------------------------------------------------------

const EARLY: ReadonlyArray<Stage> = [
  'AtPrinciple',
  'AtDirection',
  'AtStandard',
  'AtRule',
  'Testing',
  'Drafting',
]

// The items of fix i's draft take effect: records set, versions up, the tasks they apply to owe a
// recheck (a direction change every done task, else those it reaches), the other open drafts
// rebased. Never a raised task's own work.
const itemsInEffect = (s: WorkState, i: string): WorkState => {
  const f = fixOf(s, i)
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
  // A contradicted rule is owed by the tasks it applies to (done, raised, in review); a done task
  // owes what the change reaches.
  // Only a change of a rule fights, and not a rule the change itself puts in effect.
  const tasks = new Map(s2.tasks)
  const ruleChange = [...c].some((x) => kindOf(x) === 'rule')
  for (const [j, t] of s2.tasks) {
    const pending = [...t.pending].filter((x) => !s2.items.has(x) || applies(s2, x, t))
    if (pending.length !== t.pending.size) {
      tasks.set(j, { ...t, pending: new Set(pending), at: s.seq })
    }
    if (j === i) continue
    const fought = ruleChange && ['Done', 'Raised', 'InReview'].includes(t.state)
      ? [...f.fights].filter((x) => !c.has(x) && applies(s2, x, t))
      : []
    const hit = t.state === 'Done' ? [...c].filter((x) => applies(s2, x, t)) : []
    if (fought.length + hit.length > 0) {
      tasks.set(j, { ...t, pending: new Set([...pending, ...fought, ...hit]), at: s.seq })
    }
  }
  // Rebase: a draft built before a direction change, or at the person over the same items.
  const dirChange = [...c].some(isDir)
  let s3: WorkState = { ...s2, tasks }
  for (const [j, z] of s2.fixes) {
    const early = EARLY.includes(z.stage) && dirChange
    const late = (z.stage === 'InLoop' || z.stage === 'AtPerson') &&
      z.kind === 'DirectionDraft' && [...z.real].some((x) => c.has(x))
    if (j !== i && (early || late)) {
      s3 = setF(s3, j, (y) => ({
        ...y,
        stage: y.entry,
        base: ver,
        resolvesFight: false,
        resolvedOn: null,
        revision: y.revision + 1,
        basisStep: y.basisStep + 1,
      }))
    }
  }
  return s3
}

// An accepted role draft: the card changes; the other role drafts of the role are rebased.
const cardInEffect = (s: WorkState, i: string): WorkState => {
  const f = fixOf(s, i)
  const role = roleDraftOf(f).role
  let s1: WorkState = {
    ...s,
    cards: put(s.cards, role, roleDraftOf(f)),
    card: put(s.card, role, cardOf(s, role) + 1),
  }
  for (const [j, z] of s.fixes) {
    if (
      j !== i && z.kind === 'RoleDraft' && roleDraftOf(z).role === role &&
      (z.stage === 'InLoop' || z.stage === 'AtPerson')
    ) {
      s1 = setF(s1, j, (y) => ({
        ...y,
        stage: 'InLoop',
        cardBase: cardOf(s1, role),
        revision: y.revision + 1,
        basisStep: y.basisStep + 1,
      }))
    }
  }
  return s1
}

// Ship's standard change: in effect at once.
const shipStandard = (s: WorkState, i: string): WorkState => {
  if (conflict(s, i)) return redo(s, i)
  if (refixed(s, i)) return raiseUp(s, i)
  return backToRole(itemsInEffect(s, i), i)
}

// The person's edit after the pipeline role carried it down: back to the person when it has items
// the person did not write, leaves out what they wrote, or is contradicted. In effect, the host
// reassigns the roles (Accepted).
const shipEdit = (s: WorkState): WorkState => {
  const f = fixOf(s, EDIT)
  const back = [...f.real].some((x) => !f.wrote.has(x)) ||
    [...f.wrote].some((x) => !f.real.has(x)) || f.contradicted
  if (back) return setF(s, EDIT, (z) => ({ ...z, stage: 'InLoop' }))
  if (conflict(s, EDIT)) return redo(s, EDIT)
  return setF(itemsInEffect(s, EDIT), EDIT, (z) => ({ ...z, stage: 'Accepted' }))
}

// --- Open: a question, the host's task, a maker for a task, the person's reject ------------------

const openEffect = (s: WorkState, a: Act, o: OpenBody): WorkState => {
  switch (o._tag) {
    case 'OpenQuestion': {
      const from = a.who
      const key = pairKey(from, o.to)
      const spec: AskSpec = { kind: 'Question', from, to: o.to, about: { _tag: 'None' } }
      const asked = openAsk(s, spec, o.question)
      return { ...asked.state, askCount: put(s.askCount, key, (s.askCount.get(key) ?? 0) + 1) }
    }
    case 'OpenSend': {
      const id = `t${s.nextTask}`
      return open(addTask(s, id, o.spec, null), exec(HOST, { _tag: 'Role', name: o.spec.role }, id))
    }
    // A fresh maker takes the task: its Execute is open (the id is the store's).
    case 'OpenMake': {
      const t = taskOf(s, o.task)
      const id = `m${s.nextMaker}`
      const made: WorkState = {
        ...s,
        nextMaker: s.nextMaker + 1,
        makers: put(s.makers, id, {
          id,
          task: o.task,
          ended: false,
          claimed: false,
          brief: new Map(),
          revisions: 0,
        }),
        ep: put(s.ep, keyOf(maker(id)), 0),
      }
      return open(
        setT(made, o.task, (z) => ({ ...z, state: 'Working', tries: 0, maker: id })),
        exec(roleOf(t), maker(id), o.task),
      )
    }
    // The person's reject of a result (a done task opens the top again): the task is raised.
    case 'OpenReject': {
      const t = taskOf(s, o.task)
      const reopened = t.state === 'Done'
        ? reopenHost({ ...s, top: { ...s.top, done: false } }, o.task)
        : s
      return raise(reopened, o.task, t.tries, HUMAN)
    }
  }
}

// --- Evaluate, WriteRule, RunTest, Ship ----------------------------------------------------------

// D5: a split closes the host's ask for the parent and the pipeline ask, and opens an Execute
// Host -> Role per part, atomically (the parent is split, its parts are tasks of their own).
const split = (s: WorkState, i: string, parts: ReadonlyArray<TaskSpec>): WorkState => {
  const t = taskOf(s, i)
  const parted = setT(s, i, (z) => ({
    ...z,
    state: 'Split',
    maker: null,
    pending: new Set(),
    caught: new Set(),
  }))
  const closed = asksAbout(parted, { _tag: 'Fix', id: i })
    .filter((x) => x.kind === 'Execute' && x.to._tag === 'Pipe')
    .reduce((acc, x) => closeAsk(acc, x.id), closeSpec(parted, exec(HOST, roleOf(t), i)))
  const grown = parts.reduce((acc, p) => {
    const id = `t${acc.nextTask}`
    return open(addTask(acc, id, p, t), exec(HOST, { _tag: 'Role', name: p.role }, id))
  }, closed)
  return setF(grown, i, (f) => ({ ...CLOSED, basisStep: f.basisStep }))
}

const evaluate = (s: WorkState, a: Act, w: Of<'Evaluate'>): WorkState => {
  const i = w.fix
  const s1 = bump(s, i)
  if (w.level === 'Split') return split(s1, i, w.parts)
  if (w.level === 'Fit') {
    const rd = w.roleDraft
    return setF(s1, i, (f) => ({
      ...f,
      level: w.level,
      kind: 'RoleDraft',
      stage: 'InLoop',
      entry: 'InLoop',
      roleDraft: rd,
      roleOnly: rd !== null && rd.model === s.cards.get(rd.role)?.model,
      cardBase: rd === null ? f.cardBase : cardOf(s, rd.role),
      summary: w.summary,
    }))
  }
  return setF(s1, i, (f) => ({
    ...f,
    level: w.level,
    kind: 'DirectionDraft',
    stage: entryOf(w.level),
    entry: entryOf(w.level),
    base: a.vers,
    summary: w.summary,
  }))
}

const runTest = (s: WorkState, w: Of<'RunTest'>): WorkState => {
  const i = w.fix
  const contra = w.contra.length > 0
  const f = fixOf(s, i)
  const s1 = bump(s, i)
  if (!w.own) {
    // the cross test ran whatever the own test said: a rewrite that no longer fights is clear
    return setF(s1, i, (z) =>
      z.ruleTries >= 1
        ? { ...ruleClimb(z), contradicted: z.contradicted && contra }
        : { ...z, stage: 'AtRule', ruleTries: 1, contradicted: z.contradicted && contra })
  }
  if (contra && f.entry !== 'AtDirection' && f.entry !== 'AtPrinciple') {
    return setF(s1, i, (z) => ({
      ...z,
      kind: 'DirectionDraft',
      level: 'Direct',
      stage: 'AtDirection',
      entry: 'AtDirection',
      contradicted: true,
      fights: new Set(w.contra),
    }))
  }
  if (contra) {
    return setF(s1, i, (z) => ({
      ...z,
      stage: 'Drafting',
      contradicted: true,
      fights: new Set(w.contra),
    }))
  }
  return setF(s1, i, (z) => ({
    ...z,
    stage: 'Drafting',
    fights: new Set(),
    contradicted: false,
  }))
}

// A standard change takes effect at once; a draft entered at direction or principle goes to the
// loop whatever it names.
const ship = (s: WorkState, w: Of<'Ship'>): WorkState => {
  const i = w.fix
  const real = changedBy(s, w.draft)
  const s1 = setF(s, i, (f) => ({
    ...f,
    items: w.items,
    real,
    draft: w.draft,
    resolvesFight: w.resolvesFight,
    resolvedOn: s.ver,
    basisStep: f.basisStep + 1,
  }))
  if (free(i)) return shipEdit(s1)
  const entry = fixOf(s, i).entry
  const escalated = entry === 'AtDirection' || entry === 'AtPrinciple'
  if (![...real].some(isDir) && !escalated) return shipStandard(s1, i)
  if (refixed(s1, i)) return raiseUp(s1, i)
  return setF(s1, i, (z) => ({ ...z, stage: 'InLoop' }))
}

// --- Respond: accept, send back, take as is, evaluate again --------------------------------------

const sameVersions = (a: Versions, b: Versions): boolean =>
  [...new Set([...a.keys(), ...b.keys()])].every((x) => verOf(a, x) === verOf(b, x))

const acceptIt = (s: WorkState, i: string): WorkState => {
  const f = fixOf(s, i)
  if (conflict(s, i)) return redo(s, i)
  if (refixed(s, i)) return raiseUp(s, i)
  // a contradicted draft whose direction resolves the contradiction no longer fights
  // (a test-command rule's value counts only on the versions it was computed on)
  const testCommand = f.form === 'Mech' || f.form === 'Both'
  const onVersions = f.resolvedOn !== null && sameVersions(f.resolvedOn, s.ver)
  const settled = f.contradicted && f.resolvesFight && (!testCommand || onVersions)
    ? setF(s, i, (z) => ({ ...z, fights: new Set() }))
    : s
  const s1 = bump(
    f.kind === 'DirectionDraft' ? itemsInEffect(settled, i) : cardInEffect(settled, i),
    i,
  )
  return f.kind === 'RoleDraft' && f.roleOnly
    ? backToRole(s1, i)
    : setF(s1, i, (z) => ({ ...z, stage: 'Accepted' }))
}

// Take as is: the task is done, rechecked against the changes since its result was checked; the
// host's ask closes. Evaluate again: the raise goes back to evaluation.
const respond = (s: WorkState, w: Of<'Respond'>, fix: string): WorkState => {
  switch (w.reply) {
    case 'AcceptIt':
      return acceptIt(s, fix)
    case 'SendItBack':
      return setF(s, fix, (f) => ({
        ...f,
        stage: 'InLoop',
        resolvesFight: false,
        resolvedOn: null,
        sentBack: new Set([...f.sentBack, f.revision]),
        needRevise: true,
        loopRounds: 0,
        sendBacks: f.sendBacks + 1,
        basisStep: f.basisStep + 1,
      }))
    case 'TakeAsIs': {
      const t = taskOf(s, fix)
      const done = setF(
        setT(s, fix, (z) => ({
          ...z,
          state: 'Done',
          taken: true,
          pending: new Set([...staleItems(s, z), ...z.pending]),
        })),
        fix,
        (f) => ({ ...CLOSED, basisStep: f.basisStep + 1 }),
      )
      return closeSpec(done, exec(HOST, roleOf(t), fix))
    }
    case 'EvaluateAgain':
      return setF(s, fix, (f) => ({ ...CLOSED, stage: 'Evaluating', basisStep: f.basisStep + 1 }))
  }
}

// --- Review, Report ------------------------------------------------------------------------------

const review = (s: WorkState, w: Of<'Review'>): WorkState => {
  const check = s.asks.get(w.ask)
  if (check === undefined || check.about._tag !== 'Task') return s
  const i = check.about.id
  const t = taskOf(s, i)
  const closed = closeAsk(s, w.ask)
  switch (w.verdict) {
    case 'Pass':
      return closeSpec(
        setT(endMaker(closed, t.maker), i, (z) => ({
          ...z,
          state: 'Done',
          maker: null,
          checked: s.ver,
          pending: new Set(),
          caught: new Set(),
        })),
        exec(HOST, roleOf(t), i),
      )
    // The revision goes to the same maker. A rechecked task has none: a fresh one.
    case 'Fail': {
      const live = liveMaker(s, i)
      if (live === null) {
        return setT(closed, i, (z) => ({ ...z, state: 'Sent', tries: z.tries + 1 }))
      }
      return open(
        setM(
          setT(closed, i, (z) => ({ ...z, state: 'Working', tries: z.tries + 1 })),
          live,
          (y) => ({ ...y, revisions: y.revisions + 1 }),
        ),
        exec(roleOf(t), maker(live), i),
      )
    }
    case 'RaiseTries':
      return raise(closed, i, t.tries + 1, roleOf(t))
    default:
      return raise(closed, i, t.tries, roleOf(t))
  }
}

// The answer closes the maker's Execute; the result is a Check ask to the role.
const report = (s: WorkState, w: Of<'Report'>): WorkState => {
  const ask = s.asks.get(w.ask)
  if (ask === undefined || ask.to._tag !== 'Maker') return s
  const y = s.makers.get(ask.to.id)
  if (y === undefined) return s
  const t = taskOf(s, y.task)
  const reviewed = setT(closeAsk(s, w.ask), y.task, (z) => ({
    ...z,
    state: 'InReview',
    resultId: z.resultId + 1,
    checked: y.brief,
    taken: false,
    caught: w.caught,
  }))
  return open(reviewed, { kind: 'Check', from: ask.to, to: roleOf(t), about: ask.about })
}

// --- Recheck, RunRule ----------------------------------------------------------------------------

// What a recheck settles: the items it judged are checked now, or the task goes back to the role
// and the top is open again.
const rechecked = (s: WorkState, i: string, xs: ReadonlySet<ItemKey>, holds: boolean): WorkState =>
  holds
    ? setT(s, i, (z) => ({
      ...z,
      pending: without(z.pending, xs),
      checked: new Map([
        ...z.checked,
        ...[...xs].map((x): [ItemKey, number] => [x, verOf(s.ver, x)]),
      ]),
    }))
    : reopenHost(
      {
        ...setT(s, i, (z) => ({ ...z, state: 'Sent', tries: 0, maker: null, pending: new Set() })),
        top: { ...s.top, done: false },
      },
      i,
    )

// --- Exit, Revive, Reassign ----------------------------------------------------------------------

// The live makers of the tasks of a role: [task, maker].
const liveOf = (s: WorkState, a: Actor): Array<[string, string]> =>
  [...s.tasks.keys()].flatMap((j) => {
    const m = liveMaker(s, j)
    const mine = a._tag === 'Role' && taskOf(s, j).role === a.name
    return m !== null && mine ? [[j, m] as [string, string]] : []
  })

// A process exits; a role's exit is the exit of its makers too; every exit ends a claim.
const exit = (s: WorkState, a: Actor): WorkState => {
  const gone = [a, ...(a._tag === 'Role' ? liveOf(s, a).map(([, m]) => maker(m)) : [])]
  const s1: WorkState = { ...s, down: new Set([...s.down, ...gone.map(keyOf)]) }
  return gone.reduce(
    (acc, g) => (g._tag === 'Maker' ? setM(acc, g.id, (y) => ({ ...y, claimed: false })) : acc),
    s1,
  )
}

// The revived role has lost its makers: they end (their questions and answers go too). A working
// task goes back to Sent (a fresh maker, no tries kept). A task in review keeps its Check: the role
// checks the result itself. The host and the pipeline role are revived as they were.
const revive = (s: WorkState, a: Actor): WorkState => {
  const s1 = newEpoch({ ...s, down: without(s.down, [keyOf(a)]) }, a)
  return liveOf(s, a).reduce((acc, [j, m]) => {
    const t = taskOf(acc, j)
    const check = [...acc.asks.values()].find((x) =>
      x.kind === 'Check' && x.from._tag === 'Maker' && x.from.id === m
    )
    const lost = endMaker(acc, m)
    if (t.state === 'InReview' && check !== undefined) {
      return { ...lost, asks: put(lost.asks, check.id, check) }
    }
    return t.state === 'Working'
      ? setT(lost, j, (z) => ({ ...z, state: 'Sent', maker: null }))
      : lost
  }, s1)
}

// The accepted raises go back to the role; the role's open work is sent again to the new role
// (its makers end). Not a change of the items.
const reassign = (s: WorkState): WorkState => {
  const accepted = [...s.fixes].filter(([, f]) => f.stage === 'Accepted').map(([j]) => j)
  const s1 = accepted.reduce(backToRole, s)
  return [...s1.tasks].reduce(
    (acc, [j, t]) =>
      t.state === 'Working' || t.state === 'InReview'
        ? setT(endMaker(acc, t.maker), j, (z) => ({ ...z, state: 'Sent', tries: 0, maker: null }))
        : acc,
    s1,
  )
}

// --- the acts ------------------------------------------------------------------------------------

const askFix = (s: WorkState, id: string): string => {
  const a = s.asks.get(id)
  if (a === undefined || a.about._tag !== 'Fix') throw new Error(`no decide ask ${id}`)
  return a.about.id
}

export const effect = (s: WorkState, a: Act): WorkState => {
  const w = a.body
  switch (w._tag) {
    case 'EndProject':
      return { ...s, top: { ...s.top, ended: true } }
    // Run continue: the run's host moves to a new session, the assignment follows it.
    case 'MoveHost':
      return newEpoch(
        { ...s, session: s.session + 1, top: { ...s.top, hostSession: s.session + 1 } },
        HOST,
      )
    case 'Open':
      return openEffect(s, a, w.open)
    // The person's edit enters at direction assessment, built on the versions the page showed.
    case 'AskEdit':
      return open(
        setF(s, EDIT, (f) => ({
          ...CLOSED,
          stage: 'AtDirection',
          entry: 'AtDirection',
          level: 'Direct',
          kind: 'DirectionDraft',
          base: a.old ? s.ver : a.vers,
          draft: w.draft,
          wrote: new Set(w.draft.keys()),
          basisStep: f.basisStep + 1,
        })),
        raiseAsk(HUMAN, EDIT),
      )
    case 'AnswerQuestion': {
      const ask = s.asks.get(w.ask)
      if (ask === undefined) return s
      return {
        ...closeAsk(s, w.ask),
        answered: put(s.answered, w.ask, { ask, answer: w.answer, at: s.seq }),
      }
    }
    case 'Hear': {
      const answered = new Map(s.answered)
      answered.delete(w.ask)
      return { ...s, answered, heardIds: put(s.heardIds, w.ask, keyOf(a.who)) }
    }
    // A maker past the cap raises its task as a problem no rule covers.
    case 'AskRaise': {
      if (a.who._tag !== 'Maker') return s
      const y = s.makers.get(a.who.id)
      if (y === undefined) return s
      const t = taskOf(s, y.task)
      return raise(s, y.task, t.tries, roleOf(t))
    }
    case 'Report':
      return report(s, w)
    case 'Review':
      return review(s, w)
    case 'Respond':
      return respond(s, w, askFix(s, w.ask))
    case 'Reassign':
      return reassign(s)
    case 'TopDone':
      return { ...s, top: { ...s.top, done: true } }
    case 'Resume':
      return newEpoch({ ...s, down: without(s.down, [keyOf(maker(w.maker))]) }, maker(w.maker))
    case 'ReadBrief':
      return setM(s, w.maker, (y) => ({ ...y, claimed: true, brief: s.ver }))
    case 'Evaluate':
      return evaluate(s, a, w)
    case 'Advance':
      return setF(bump(s, w.fix), w.fix, (f) => ({ ...f, stage: nextStage(f.stage) }))
    case 'WriteRule':
      return setF(bump(s, w.fix), w.fix, (f) => ({
        ...f,
        draft: put(f.draft, w.rule, w.rec),
        form: formOf(w.rec.form),
        // a rule with no test command: the role's claim, and a rewrite that still fights stays
        // contradicted; a rule with one keeps the flag until RunTest brings the harness's verdict
        fights: new Set(w.fights),
        contradicted: hasMech(w.rec.form) ? f.contradicted : f.contradicted && w.fights.length > 0,
        stage: hasMech(w.rec.form) ? 'Testing' : 'Drafting',
      }))
    case 'RunTest':
      return runTest(s, w)
    case 'Ship':
      return ship(s, w)
    case 'LoopReview':
      return setF(bump(s, w.fix), w.fix, (z) => {
        const next: Fix = w.toPerson
          ? { ...z, stage: 'AtPerson' }
          : z.loopRounds >= 1
          ? loopClimb(z)
          : { ...z, revision: z.revision + 1, loopRounds: z.loopRounds === 1 ? 2 : 1, needRevise: false }
        return { ...next, reviewMode: w.mode }
      })
    case 'RecheckDone':
      return rechecked(s, w.task, w.items, w.holds)
    // The harness's test commands of the pending rules, on a done result.
    case 'RunRule':
      return rechecked(
        s,
        w.task,
        new Set([...taskOf(s, w.task).pending].filter((x) => testRule(s, x))),
        w.holds,
      )
    case 'Revive':
      return revive(s, w.actor)
    case 'Exit':
      return exit(s, w.actor)
  }
}

// The asks follow the state: the pipeline's asks go with the fix's stage (an Execute to the
// pipeline role while the fix is in its stages or at the person, a Decide while it waits for the
// person: a change that sends a draft back withdraws it, a new one is a new occurrence).
const sweep = (s: WorkState): WorkState => {
  const stageOf = (about: { readonly _tag: string; readonly id?: string }): Stage =>
    fixOf(s, about.id ?? '').stage
  const dead = [...s.asks.values()].filter((x) =>
    (x.kind === 'Execute' && x.to._tag === 'Pipe' && x.about._tag === 'Fix' &&
      !(pipeStage(stageOf(x.about)) || stageOf(x.about) === 'AtPerson')) ||
    (x.kind === 'Decide' && stageOf(x.about) !== 'AtPerson')
  )
  const swept = dead.reduce((acc, x) => closeAsk(acc, x.id), s)
  return [...swept.fixes].filter(([, f]) => f.stage === 'AtPerson').reduce(
    (acc, [id]) =>
      asksAbout(acc, { _tag: 'Fix', id }).some((x) => x.kind === 'Decide')
        ? acc
        : open(acc, { kind: 'Decide', from: PIPE, to: HUMAN, about: { _tag: 'Fix', id } }),
    swept,
  )
}

// Every taken act: effect, the sweep, then the answerer alternates answering with a step of its own
// (justAnswered), then the next seq.
export const take = (s: WorkState, a: Act): WorkState => {
  const swept = sweep(effect(s, a))
  const key = keyOf(a.who)
  return advance({
    ...swept,
    justAnswered: a.body._tag === 'AnswerQuestion'
      ? new Set([...swept.justAnswered, key])
      : without(swept.justAnswered, [key]),
  })
}
