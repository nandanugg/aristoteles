// The operations of the page (Task.start, Review.decide, Direction.revise...) and the engine
// handlers, as a check and an apply for each stored event:
//   check: at write time only. It refuses exactly when the old engine or handler threw, with the
//          same words. It reads the Work and the CheckContext; it builds nothing that stays.
//   apply: at replay, and after a passed check. It builds exactly the records that the old engine
//          built (with the page's fields), names them in the old order (BUILD.md, parity notes),
//          and never refuses: a failure is a defect (the store is trusted).
import { Effect } from 'effect'
import { type Human, human } from '../domain/actor.ts'
import { contextOf } from '../domain/context.ts'
import { playedBy } from '../domain/derived.ts'
import { refuse, type Refused } from '../domain/errors.ts'
import {
  dataOf,
  type Event,
  type EventGroup,
  type EventOf,
  type EvidenceData,
  type ForwardedAct,
  type GroupOf,
  type Kind,
  kindOf,
  type TaskData,
  type WorkspaceData,
} from '../domain/events.ts'
import type { ContextFile, TierLimits, Workspace as WorkspaceFile } from '../domain/files.ts'
import {
  type AssignmentId,
  type Counted,
  type EscalationId,
  type IdByKind,
  type NonBlank,
  nextId,
  noCounters,
  type PointId,
  type PositiveInt,
  type QuestionId,
  type RejectId,
  type ResultId,
  type RevisionId,
  type RoleName,
  type RuleEntry,
  type TaskId,
  type Time,
  versionId,
} from '../domain/ids.ts'
import type {
  Act as RoleAct,
  Answerer,
  Assignment,
  By,
  Context,
  Direction,
  Evidence,
  Limit,
  Limits,
  NonEmpty,
  Point,
  Result,
  Review,
  Role,
  Task,
  Version,
  Workflow,
  Workspace,
} from '../domain/model.ts'
import {
  answerQuestion,
  askQuestion,
  briefAssignment,
  changeRoleWords,
  claim,
  closeTask,
  describeTask,
  finishAssignment,
  firstBrief,
  freeClaim,
  giveAssignment,
  grantPermission,
  makeOfficial,
  newMeta,
  openTask,
  openTaskDraft,
  replaceTask,
  revokePermission,
} from '../domain/moves.ts'
import type { CheckContext, CreatedId, Stepped, Work } from '../domain/work.ts'
import { type Acting, decidersOf, leavesOf, metAt, turnOf, waitsFor } from './deciders.ts'
import { lessonsOf, type Planned, planDrafted, planImported, planRevised } from './drafts.ts'
import { checked, found, type Guard, no, refusing, trusting } from './guard.ts'
import {
  actsOf,
  answeredItem,
  can,
  checkpointOf,
  contentOf,
  countsWhenWritten,
  coversMaker,
  decidersOfDraft,
  decidesResults,
  decidingNow,
  decisionMet,
  decisionWaitsFor,
  deciderOf,
  draftAcceptItems,
  draftMatches,
  evaluationCounts,
  evaluationDecision,
  evaluationWaitsRef,
  exhaustionResult,
  findRule,
  hasEvidence,
  isCriticism,
  isDo,
  isFault,
  isPersonStop,
  isRejectItem,
  madeBy,
  mayChange,
  mayGive,
  neederOf,
  openDo,
  partsOf,
  personRejectItems,
  rulesOf,
  stopKey,
  stopRefAnswered,
  stopRefOf,
  stopRefTask,
  stopText,
  taskAccepted,
  turnMatches,
  underNow,
  usedBy,
  vetoItem,
  within,
  workStop,
} from './queries.ts'
import { hostOf, rootOf } from './runs.ts'
import {
  actorOf,
  answererLabel,
  assignmentAt,
  below,
  currentOf,
  directionAt,
  draftAt,
  finished,
  isAssignment,
  isOpen,
  isPerson,
  type Item,
  itemAt,
  itemsOf,
  labelOf,
  labelWithRole,
  maxOf,
  officialAt,
  openAncestorOf,
  resultAt,
  reviewItems,
  roleAt,
  roleNameOf,
  ruleAt,
  sameActor,
  taskAt,
  tierOf,
  underNowOf,
} from './view.ts'
import { answererOf } from '../domain/derived.ts'

// The records whose rules are the engine's. The UI's records (a run, a task draft, a problem, a
// session, a send, the host's words), the role fits and the forwards are src/replay's: a
// forward or a confirm calls these for its inner act.
export const ENGINE_GROUPS = [
  'Workflow',
  'Task',
  'Assignment',
  'Result',
  'Review',
  'Question',
  'Note',
  'Evaluation',
  'Suggestion',
  'Revision',
  'Permission',
  'Source',
  'Checkpoint',
] as const satisfies ReadonlyArray<EventGroup>
export type EngineGroup = (typeof ENGINE_GROUPS)[number]
export type EngineEvent = GroupOf<EngineGroup>
export const isEngineEvent = (event: Event): event is EngineEvent =>
  (ENGINE_GROUPS as ReadonlyArray<string>).includes(event._tag)

// An act that the engine judges: a stored engine event, or the inner act of a forward (a
// review, a question or a message; the person's question to an agent is only forwarded), with
// what it knows about itself: who (as the engine judges them: an assignment, or a person), when,
// and the seq of its stored event. Who wrote it and where from is the store's (the author of the
// event) and the forward's (Work.forwards); no record keeps it.
export interface Act<E extends EngineEvent | ForwardedAct = EngineEvent | ForwardedAct> {
  readonly event: E
  readonly by: By
  readonly when: Time
  readonly seq: number
}

// --- small helpers -------------------------------------------------------------------------------

const put = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> =>
  new Map(map).set(key, value)
const unlimited: Limit = { _tag: 'Unlimited' }
const limitOf = (n: number | undefined): Limit =>
  n === undefined ? unlimited : { _tag: 'AtMost', max: n as PositiveInt }
const limitsOf = (tier: TierLimits | undefined): Limits => ({
  Assignment: {
    briefChars: limitOf(tier?.Assignment?.briefChars),
    attempts: limitOf(tier?.Assignment?.attempts),
  },
  Review: { rules: limitOf(tier?.Review?.rules) },
  Result: { size: limitOf(tier?.Result?.size) },
})
// A tier assigns only the tiers below it; a program is outside this order.
const TIER_RANK: Readonly<Record<string, number>> = { low: 1, medium: 2, high: 3 }

// The data of an event of a kind (its creation or its move), and the id that a move names.
type DataOf<K extends Kind> =
  EventOf<K> extends { readonly create: infer D }
    ? D
    : EventOf<K> extends { readonly move: infer D }
      ? D
      : never
const data = <K extends Kind>(act: Act, _kind: K): DataOf<K> => dataOf(act.event) as DataOf<K>
const movedId = <I>(act: Act): I => (act.event as unknown as { readonly id: I }).id

// The person that an act names: a person by, as a Human.
const personOf = (w: Work, by: By): Human => {
  const actor = actorOf(w, by)
  return actor._tag === 'Human' ? actor : human(actor.name)
}
// Who answers or decides as the record keeps it: an assignment, or the person.
const answererBy = (w: Work, by: By): Answerer => (isAssignment(by) ? by : personOf(w, by))
const reviewerBy = answererBy
const assignmentBy = (by: By): AssignmentId => {
  if (!isAssignment(by)) throw new Error(`${by.name} acts with no assignment`)
  return by
}
// A workspace entry of a file, as a task keeps it.
const workspaceOf = (x: WorkspaceFile): Workspace =>
  x.base === undefined
    ? { _tag: 'Files', source: x.source, path: x.path, verify: x.verify ?? null }
    : { _tag: 'Repo', source: x.source, path: x.path, base: x.base, verify: x.verify ?? null }
const workspaceDataOf = (x: WorkspaceData): Workspace => x
// The context of a part: its task's, with the keys that the part names over it.
const contextWith = (base: Context, more: ContextFile | undefined): Context => {
  if (more === undefined) return base
  const facts = new Map(base.facts)
  let section = base.section
  for (const [key, value] of Object.entries(more)) {
    if (key === 'section') section = { _tag: 'Section', id: value }
    else facts.set(key as never, value)
  }
  return { section, facts }
}
// A context as its file wrote it, for the compares of a remake.
const contextRecord = (c: Context): Readonly<Record<string, string>> => ({
  ...(c.section._tag === 'Section' ? { section: c.section.id } : {}),
  ...Object.fromEntries(c.facts),
})

// The tasks that a task file names in needs: each one exists and is open.
const neededTasks = (w: Work, ids: ReadonlyArray<string>, guard: Guard): void => {
  for (const id of ids) {
    const f = found(w, id, ['t'], guard)
    if (f?._tag === 'Task' && !isOpen(f.task)) {
      guard(`${id} is closed; a task does not need a closed task`)
    }
  }
}
const taskNamed = (w: Work, id: string): Task => {
  const f = found(w, id, ['t'], refusing)
  if (f?._tag !== 'Task') return no(`there is no task ${id}`)
  return f.task
}
const openTasksWithin = (w: Work, root: TaskId): ReadonlyArray<Task> =>
  [...w.tasks.values()].filter((t) => isOpen(t) && within(w, t.id, root))

// The Rejects that a split or a remake names in review: the points of a Reject, or one point.
const reviewList = (w: Work, id: string | null, act: 'split' | 'remake'): ReadonlyArray<Item> => {
  if (id === null) return []
  const points = reviewItems(w).filter((i) => i.group === id)
  if (points.length > 0) return points
  found(w, id, ['v'], refusing)
  const item = itemAt(w, id)
  if (item === undefined || item.review._tag !== 'Reject') {
    return no(
      `${id} is not a Reject; a ${act} answers a Reject (v<n>) or one point of it (v<n>.<m>)`,
    )
  }
  return [item]
}

// --- the builder of one step ---------------------------------------------------------------------

// One apply: a new Work in steps, and the ids it made in the old naming order.
class Build {
  work: Work
  readonly created: Array<CreatedId> = []
  constructor(work: Work) {
    this.work = work
  }
  name<K extends Counted>(kind: K): IdByKind[K] {
    const { id, counters } = nextId(this.work.counters, kind)
    this.work = { ...this.work, counters }
    this.created.push(id as CreatedId)
    return id
  }
  // The engine's clock: each record made takes the next at; a Reject takes one per point.
  tick(n = 1): number {
    const at = this.work.clock + 1
    this.work = { ...this.work, clock: this.work.clock + n }
    return at
  }
  done(): Stepped {
    return { work: this.work, created: this.created }
  }
}

// An assignment ends. A maker that ends while its latest try has a fault ended on that fault: a
// new maker would get the inputs that failed, so the task waits for an evaluation. What waited
// for it goes up (derived.ts answererOf follows the finish).
const endAssignment = (b: Build, id: AssignmentId, when: Time): void => {
  const a = assignmentAt(b.work, id)
  if (a.end._tag === 'NotEnded') {
    const ended = finishAssignment({ ...a, end: a.end }, when)
    b.work = { ...b.work, assignments: put(b.work.assignments, id, ended) }
  }
  const w = b.work
  if (!isDo(w, a.role) || !isOpen(taskAt(w, a.task))) return
  const last = [...w.results.values()].filter((r) => r.by === id).at(-1)
  if (last === undefined || !underNow(w, last)) return
  const fault = itemsOf(w, last.id)
    .filter((v) => isFault(w, v))
    .at(-1)
  if (fault === undefined) return
  if ([...w.exhaustions.values()].some((x) => exhaustionResult(w, x).id === last.id)) return
  const x = b.name('exhaustion')
  const exhaustion = { id: x, fault: fault.id as PointId, when, at: b.tick() }
  b.work = { ...b.work, exhaustions: put(b.work.exhaustions, x, exhaustion) }
}
// A low agent's claim ends with its one unit; a medium or high claim lasts until finish.
const endUnit = (b: Build, id: AssignmentId): void => {
  const role = roleAt(b.work, assignmentAt(b.work, id).role)
  const tier = tierOf(role)
  if (tier !== 'low' && tier !== undefined) return
  const meta = b.work.meta.get(id)
  if (meta !== undefined) b.work = { ...b.work, meta: put(b.work.meta, id, freeClaim(meta)) }
}

// --- the workflow --------------------------------------------------------------------------------

// The Work of a new dir: page Workflow.define from its first event (work init). The person who
// made the store owns the roles. The replay starts with it; an engine test builds its Work with
// it and applyAct, with no store.
export const newWork = (event: GroupOf<'Workflow'>, who: string, _when: Time): Work => {
  if (!('create' in event)) throw new Error('a Work starts with the definition of its workflow')
  const { config, hashes, texts } = event.create
  const names = Object.keys(config.roles) as Array<RoleName>
  const roles = new Map<RoleName, Role>(
    Object.entries(config.roles).map(([name, r]) => {
      const acts = r.acts.map((a): RoleAct => {
        if ('do' in a) return { _tag: 'Do', work: a.do }
        if ('review' in a) return { _tag: 'Review', resultsOf: a.review }
        if ('approve' in a) return { _tag: 'Approve', resultsOf: a.approve }
        return { _tag: 'Change', changesOf: a.change }
      })
      const role: Role =
        r.kind === 'program'
          ? { _tag: 'Program', role: name as RoleName, acts, limits: limitsOf(undefined) }
          : {
              _tag: 'Model',
              tier: r.tier,
              role: name as RoleName,
              acts,
              limits: limitsOf(config.limits[r.tier]),
            }
      return [name as RoleName, role]
    }),
  )
  const workflow: Workflow = {
    system: config.project,
    owner: human(who),
    roles,
    limits: limitsOf(undefined),
    decide: new Map(
      Object.entries(config.decide).map(([maker, file]) => [
        maker as RoleName,
        decidersOf(file, names),
      ]),
    ),
  }
  return {
    config,
    hashes,
    texts,
    workflow,
    fits: new Map(),
    directions: new Map(),
    drafts: new Map(),
    standards: new Map(),
    rules: new Map(),
    suggestions: new Map(),
    tasks: new Map(),
    changes: [],
    assignments: new Map(),
    results: new Map(),
    reviews: new Map(),
    questions: new Map(),
    notes: new Map(),
    exhaustions: new Map(),
    evaluations: new Map(),
    permissions: new Map(),
    checkpoints: new Map(),
    meta: new Map(),
    forwards: new Map(),
    sources: new Map(),
    resultFiles: new Map(),
    after: new Map(),
    runs: new Map(),
    sessions: new Map(),
    taskDrafts: new Map(),
    problems: new Map(),
    terminalEvents: [],
    sends: [],
    hostWords: new Map(),
    events: [],
    counters: noCounters,
    clock: 0,
  }
}

// --- tasks ---------------------------------------------------------------------------------------

// The task data of an open: from its event, or from the host's task draft.
const openedData = (w: Work, act: Act, guard: Guard): TaskData | undefined => {
  const d = data(act, 'Task.Opened') as DataOf<'Task.Opened'> | DataOf<'Task.OpenedFromDraft'>
  if (d._tag === 'Opened') return d.task
  const f = found(w, d.draft, ['td'], guard)
  if (f?._tag !== 'TaskDraft') return undefined
  return f.taskDraft.task
}
const checkOpen = (w: Work, act: Act): void => {
  const d = data(act, 'Task.Opened') as DataOf<'Task.Opened'> | DataOf<'Task.OpenedFromDraft'>
  if (d._tag === 'OpenedFromDraft') {
    const f = found(w, d.draft, ['td'], refusing)
    if (f?._tag !== 'TaskDraft') return
    const draft = f.taskDraft
    if (draft.opened._tag === 'Opened') no(`${draft.id} is opened as ${draft.opened.task}`)
    const run = w.runs.get(draft.run)
    if (run?.end._tag === 'Closed') no(`${draft.run} is closed; its drafts stay closed`)
    const top = [...w.taskDrafts.values()].find(
      (x) => x.run === draft.run && x.opened._tag === 'Opened',
    )
    if (top?.opened._tag === 'Opened') no(`${draft.run} has its top task ${top.opened.task}`)
  }
  const t = openedData(w, act, refusing)
  if (t === undefined) return
  neededTasks(w, t.needs, refusing)
  if (t.from !== null) found(w, t.from, ['r'], refusing)
}
const applyOpen = (b: Build, act: Act): void => {
  const w = b.work
  const t = openedData(w, act, trusting)
  if (t === undefined) throw new Error('an open names a task draft that the work does not have')
  const id = b.name('task')
  const task = openTask({
    id,
    name: t.name,
    owner: personOf(w, act.by),
    descriptionHuman: t.text,
    descriptionAi: {
      text: t.text,
      partOf: null,
      directions: t.directions,
      references: t.references,
      notes: [],
      context: contextOf(t.context),
      from: t.from,
      workspace: t.workspace.map(workspaceDataOf),
    },
    serves: { _tag: 'TopTask' },
    needs: t.needs,
    when: act.when,
  })
  b.work = { ...b.work, tasks: put(b.work.tasks, id, task) }
  const d = data(act, 'Task.OpenedFromDraft') as
    | DataOf<'Task.Opened'>
    | DataOf<'Task.OpenedFromDraft'>
  if (d._tag === 'OpenedFromDraft') {
    const draft = b.work.taskDrafts.get(d.draft)
    if (draft?.opened._tag === 'NotOpened') {
      const opened = openTaskDraft({ ...draft, opened: draft.opened }, id)
      b.work = { ...b.work, taskDrafts: put(b.work.taskDrafts, draft.id, opened) }
    }
  }
}

// The Rejects that a split or a remake answers. A split answers a Reject of its own task or of
// its results; a remake, one anywhere in the tree that it replaces. Only a point with no rule,
// and the person's Reject only by that person's own act.
const checkAnswers = (
  w: Work,
  task: TaskId,
  by: By,
  list: ReadonlyArray<Item>,
  act: 'split' | 'remake',
): void => {
  const about = (r: Item) => {
    const of = r.of._tag === 'Result' ? resultAt(w, r.of.id).task : r.of.id
    return act === 'split' ? of === task : r.of._tag !== 'Revision' && within(w, of as TaskId, task)
  }
  for (const r of list) {
    const reason = r.reason ?? ''
    if (isPerson(w, r.by) && actorOf(w, r.by).name !== actorOf(w, by).name) {
      no(
        `"${reason}" is the person's Reject; only that person's own ${act} answers it, or a ` +
          `direction change`,
      )
    }
    if (!about(r))
      no(`"${reason}" is not about ${task}; a ${act} answers only a Reject of its own task`)
    const of = r.of._tag === 'Result' ? resultAt(w, r.of.id).task : r.of.id
    if (isPersonStop(w, r) && !stopRefAnswered(w, { _tag: 'Item', item: r, at: r.at })) {
      no(
        `"${reason}" waits for an evaluation of ${of} first: what is wrong, why, and what to ` +
          `improve`,
      )
    }
    if (r.breaks !== undefined) {
      no(
        `"${reason}" names the rule ${ruleAt(w, r.breaks).id}; changed work with evidence ` +
          `answers it, not a ${act}`,
      )
    }
  }
  if (!isPerson(w, by)) {
    const point = personRejectItems(w, task, false).find(
      (r) => r.breaks === undefined && !r.redo && !list.some((x) => x.id === r.id),
    )
    if (point) {
      no(
        `"${point.reason ?? ''}" is the person's open point on ${task}; only that person's own ` +
          `${act} answers it`,
      )
    }
  }
}

// The frame of a remake: what the file names, else what the old task had.
const remakeFrame = (w: Work, old: Task, file: DataOf<'Task.Remade'>['file']) => {
  const tree = openTasksWithin(w, old.id).map((t) => t.id)
  const kept = old.needs.filter((n) => !tree.includes(n))
  return {
    tree,
    kept,
    needs: file.needs._tag === 'Set' ? file.needs.value : kept,
    directions:
      file.directions._tag === 'Set' ? file.directions.value : old.descriptionAi.directions,
    context:
      file.context._tag === 'Set' ? contextOf(file.context.value) : old.descriptionAi.context,
    workspace:
      file.workspace._tag === 'Set'
        ? file.workspace.value.map(workspaceDataOf)
        : old.descriptionAi.workspace,
  }
}
const spaceKey = (list: ReadonlyArray<Workspace>) =>
  JSON.stringify(
    list.map((x) => [x.source, x.path, x._tag === 'Repo' ? x.base : null, x.verify]).sort(),
  )
const contextKey = (c: Context) => JSON.stringify(Object.entries(contextRecord(c)).sort())
const sameSet = <A>(x: ReadonlyArray<A>, y: ReadonlyArray<A>) =>
  x.length === y.length && x.every((v) => y.includes(v))

const checkRemake = (w: Work, act: Act): void => {
  const d = data(act, 'Task.Remade')
  const old = taskNamed(w, movedId<TaskId>(act))
  const review = reviewList(w, d.review, 'remake')
  if (d.file.needs._tag === 'Set') neededTasks(w, d.file.needs.value, refusing)
  if (d.file.from !== null) found(w, d.file.from, ['r'], refusing)
  const { by, when } = act
  if (!mayChange(w, by, old.id, when)) no(`${labelOf(w, by)} has no change act on ${old.name}`)
  if (!isOpen(old)) no(`${old.id} is closed; a closed task is not remade`)
  const frame = remakeFrame(w, old, d.file)
  const agent = !isPerson(w, by)
  if (agent) {
    for (const t of frame.tree) {
      const waits = evaluationWaitsRef(w, t)
      if (waits)
        no(`${t} waits for an evaluation of ${stopText(w, waits)}; a remake comes after it`)
    }
  }
  const inner = [...w.tasks.values()].find(
    (t) =>
      isOpen(t) &&
      !within(w, t.id, old.id) &&
      t.needs.some((n) => n !== old.id && frame.tree.includes(n)),
  )
  if (inner) no(`${inner.id} needs a part of ${old.id}; remake ${inner.id} first`)
  checkAnswers(w, old.id, by, review, 'remake')
  if (agent) {
    const point = personRejectItems(w, old.id, true).find((r) => !review.some((x) => x.id === r.id))
    if (point)
      no(`"${point.reason ?? ''}" is the person's open Reject in ${old.id}; a remake would drop it`)
  }
  const was = old.descriptionAi
  if (agent) {
    const keys = new Set([
      ...Object.keys(contextRecord(was.context)),
      ...Object.keys(contextRecord(frame.context)),
    ])
    const changed = [...keys].some(
      (k) => contextRecord(was.context)[k] !== contextRecord(frame.context)[k],
    )
    if (
      !sameSet(frame.directions, was.directions) ||
      changed ||
      spaceKey(frame.workspace) !== spaceKey(was.workspace)
    ) {
      no(
        `an agent's remake keeps the directions, the context, and the workspace of ${old.id}; ` +
          `only the person changes them (leave them out of the file, and the remake keeps them)`,
      )
    }
    const dropped = frame.kept.find((n) => !frame.needs.includes(n))
    if (dropped)
      no(
        `an agent's remake keeps the needs of ${old.id}; it may add a need, but only the person ` +
          `drops ${dropped}`,
      )
  }
  const same =
    d.file.text === was.text &&
    sameSet(frame.directions, was.directions) &&
    contextKey(frame.context) === contextKey(was.context) &&
    spaceKey(frame.workspace) === spaceKey(was.workspace) &&
    sameSet(frame.needs, frame.kept) &&
    sameSet(d.file.references, was.references) &&
    (d.file.from ?? was.from) === was.from
  if (same) {
    no(
      `the remake of ${old.id} says what ${old.id} says; a remake changes its scope: the text, ` +
        `the needs, the directions, the context, the workspace, or the references`,
    )
  }
  const seen = new Set<TaskId>()
  const reaches = (list: ReadonlyArray<TaskId>): boolean =>
    list.some(
      (n) =>
        frame.tree.includes(n) ||
        (!seen.has(n) && seen.add(n) !== undefined && reaches(w.tasks.get(n)?.needs ?? [])),
    )
  if (reaches(frame.needs)) {
    no(
      `a cycle of needs: the new ${d.file.name} would need itself through ` +
        `${frame.needs.join(', ')}`,
    )
  }
}
// A change of scope: a new task replaces the old one, and the old task and its open parts close
// as replaced. Each open task that needed the old task needs the new one.
const applyRemake = (b: Build, act: Act): void => {
  const d = data(act, 'Task.Remade')
  const w = b.work
  const old = taskAt(w, movedId<TaskId>(act))
  const frame = remakeFrame(w, old, d.file)
  const id = b.name('task')
  const task = openTask({
    id,
    name: d.file.name,
    owner: old.owner,
    descriptionHuman: d.file.text,
    descriptionAi: {
      text: d.file.text,
      partOf: null,
      directions: frame.directions,
      references: d.file.references,
      notes: [],
      context: frame.context,
      from: d.file.from,
      workspace: frame.workspace,
    },
    serves: old.serves,
    needs: frame.needs,
    when: act.when,
  })
  let tasks = put(b.work.tasks, id, task)
  for (const t of tasks.values()) {
    if (isOpen(t) && t.id !== id && t.needs.includes(old.id)) {
      tasks = put(tasks, t.id, { ...t, needs: t.needs.map((n) => (n === old.id ? id : n)) })
    }
  }
  for (const t of frame.tree) {
    const open = tasks.get(t)
    if (open?.end._tag === 'NotEnded') {
      tasks = put(tasks, t, replaceTask({ ...open, end: open.end }, id, act.by, d.reason, act.when))
    }
  }
  const answers = d.review === null ? [] : [d.review]
  const change = {
    _tag: 'Remake' as const,
    task: old.id,
    answers,
    by: act.by,
    when: act.when,
    at: b.tick(),
  }
  b.work = { ...b.work, tasks, changes: [...b.work.changes, change] }
}

const checkSplit = (w: Work, act: Act): void => {
  const d = data(act, 'Task.Split')
  const task = taskNamed(w, movedId<TaskId>(act))
  const review = reviewList(w, d.review, 'split')
  for (const p of d.parts) if (p.from !== undefined) found(w, p.from, ['r'], refusing)
  const { by, when } = act
  if (!mayChange(w, by, task.id, when)) no(`${labelOf(w, by)} has no change act on ${task.name}`)
  if (d.parts.some((p) => !p.text)) no('each smaller task needs its own text')
  if (!isOpen(task)) no(`${task.id} is closed; a closed task takes no parts`)
  if (partsOf(w, task.id).some(isOpen)) {
    no(`${task.id} already has parts; split a part, or remake ${task.id}`)
  }
  const waits = !isPerson(w, by) && evaluationWaitsRef(w, task.id)
  if (waits)
    no(`${task.id} waits for an evaluation of ${stopText(w, waits)}; a split comes after it`)
  d.parts.forEach((p, i) => {
    if (d.parts.findIndex((x) => x.name === p.name) !== i) {
      no(`two parts are named ${p.name}; each part needs its own name`)
    }
    const above = d.parts.slice(0, i).map((x) => x.name)
    const unknown = (p.after ?? []).find((n) => !above.includes(n))
    if (unknown !== undefined) {
      no(`part ${p.name}: after names "${unknown}", which is not a part above it in this split`)
    }
  })
  checkAnswers(w, task.id, by, review, 'split')
}
// A big task becomes smaller tasks that serve it, and the task needs them. Each part waits for
// what its task waits for, and for the parts that it runs after.
const applySplit = (b: Build, act: Act): void => {
  const d = data(act, 'Task.Split')
  const task = taskAt(b.work, movedId<TaskId>(act))
  const answers = d.review === null ? [] : [d.review]
  const change = {
    _tag: 'Split' as const,
    task: task.id,
    answers,
    by: act.by,
    when: act.when,
    at: b.tick(),
  }
  b.work = { ...b.work, changes: [...b.work.changes, change] }
  const made: Array<Task> = []
  for (const p of d.parts) {
    const id = b.name('task')
    const after = (p.after ?? []).flatMap((n) => made.filter((x) => x.name === n).map((x) => x.id))
    const ai = task.descriptionAi
    const part = openTask({
      id,
      name: p.name,
      owner: task.owner,
      descriptionHuman: p.text,
      descriptionAi: {
        ...ai,
        text: p.text,
        partOf: ai.text,
        context: contextWith(ai.context, p.context),
        from: p.from ?? ai.from,
        workspace: p.workspace ? p.workspace.map(workspaceOf) : ai.workspace,
        references: p.references ?? ai.references,
      },
      serves: { _tag: 'Serves', task: task.id },
      needs: [...task.needs, ...after],
      when: act.when,
    })
    made.push(part)
    b.work = { ...b.work, tasks: put(b.work.tasks, id, part) }
  }
  const parent = { ...task, needs: [...task.needs, ...made.map((x) => x.id)] }
  b.work = { ...b.work, tasks: put(b.work.tasks, task.id, parent) }
}

// A task that another open task needs is not closed. A close closes the open parts of the task
// too; an agent's close never drops the person's open Reject anywhere in the tree.
const checkClose = (w: Work, act: Act): void => {
  const task = taskNamed(w, movedId<TaskId>(act))
  const { by, when } = act
  if (!mayChange(w, by, task.id, when)) no(`${labelOf(w, by)} has no change act on ${task.name}`)
  const needer = neederOf(w, task.id)
  if (needer) {
    const need = needer.needs.find((n) => within(w, n, task.id))
    no(
      `${needer.id} needs ${need}; without it the scope of ${needer.id} changes: remake ` +
        `${needer.id}`,
    )
  }
  if (isPerson(w, by)) return
  const point = personRejectItems(w, task.id, true)[0]
  if (point)
    no(`"${point.reason ?? ''}" is the person's open Reject in ${task.id}; a close would drop it`)
  for (const t of openTasksWithin(w, task.id)) {
    const waits = evaluationWaitsRef(w, t.id)
    if (waits)
      no(`${t.id} waits for an evaluation of ${stopText(w, waits)}; a close comes after it`)
  }
}
const applyClose = (b: Build, act: Act): void => {
  const d = data(act, 'Task.Closed')
  let tasks = b.work.tasks
  for (const t of openTasksWithin(b.work, movedId<TaskId>(act))) {
    if (t.end._tag === 'NotEnded') {
      tasks = put(tasks, t.id, closeTask({ ...t, end: t.end }, act.by, d.reason, act.when))
    }
  }
  b.work = { ...b.work, tasks }
}

// --- assignments --------------------------------------------------------------------------------

const givenData = (act: Act) =>
  data(act, 'Assignment.GivenMaker') as
    | DataOf<'Assignment.GivenMaker'>
    | DataOf<'Assignment.GivenReviewer'>

// A parent assignment gives work only to a lower tier, and only in its own task tree. A maker
// needs a decider above it, the accepted work of the tasks that it needs, and no stop.
const checkGive = (w: Work, act: Act): void => {
  const d = givenData(act)
  const task = taskNamed(w, d.task)
  const role = w.workflow.roles.get(d.role)
  if (role === undefined) return no(`there is no role "${d.role}"`)
  const makes = isDo(w, role.role)
  if (d._tag === 'GivenMaker' && !makes) {
    no(
      `${role.role} makes no result, so it has no attempts; a limit of attempts is for a role ` +
        `that makes`,
    )
  }
  if (d._tag === 'GivenReviewer' && makes) no(`${role.role} makes results: it has attempts`)
  const { by, when } = act
  if (isAssignment(by)) {
    const parent = assignmentAt(w, by)
    const own = TIER_RANK[tierOf(roleAt(w, parent.role)) ?? '']
    const theirs = TIER_RANK[tierOf(role) ?? '']
    if (own !== undefined && theirs !== undefined && theirs >= own) {
      no(
        `a ${tierOf(roleAt(w, parent.role))} role assigns only lower tiers; "${role.role}" is ` +
          `${tierOf(role)}`,
      )
    }
    if (!within(w, task.id, parent.task))
      no(`${task.id} is outside the task tree of ${parent.task}`)
    if (finished(parent)) no('the parent assignment is finished')
    let decider: AssignmentId | undefined = parent.id
    while (decider !== undefined && !can(w, decider, 'Approve', role.role, when)) {
      const p: Assignment['parent'] = assignmentAt(w, decider).parent
      decider = p._tag === 'Parent' ? p.id : undefined
    }
    if (makes && decider === undefined) {
      no(
        `${labelOf(w, parent.id)} decides no ${role.role} results, and no assignment above it ` +
          `does; a role that approves ${role.role} assigns it`,
      )
    }
  }
  const ceiling = maxOf(role.limits.Assignment.attempts)
  const asked = d._tag === 'GivenMaker' ? d.maxAttempts : null
  if (makes && ceiling !== undefined && asked !== null && asked > ceiling) {
    no(`maxAttempts ${asked} is over the ${tierOf(role) ?? role.role} limit of ${ceiling}`)
  }
  if (makes) {
    if ([...w.assignments.values()].some((a) => a.task === task.id && openDo(w, a.id))) {
      no(`${task.name} already has an open Do assignment`)
    }
    const need = task.needs.find((n) => !taskAccepted(w, n, when))
    if (need !== undefined) {
      no(
        `${task.id} needs ${need} (${taskAt(w, need).name}), which is not accepted; its maker ` +
          `starts after that`,
      )
    }
    const stop = workStop(w, task.id, when)
    if (stop !== undefined) no(stop)
  }
  const rulesLimit = maxOf(role.limits.Review.rules)
  if (rulesLimit !== undefined && role.acts.some((a) => a._tag === 'Review')) {
    const count = rulesOf(w, task.id).filter(
      (r) => r.checkedBy._tag === 'Role' && r.checkedBy.role === role.role,
    ).length
    if (count > rulesLimit) {
      no(
        `${playedBy(role)} (${role.role}) would check ${count} rules; the limit is ` +
          `${rulesLimit}: split the task, so that each part has fewer rules, or shorten the ` +
          `rules (work guide limits)`,
      )
    }
  }
}
const applyGive = (b: Build, act: Act): void => {
  const d = givenData(act)
  const w = b.work
  const task = taskAt(w, d.task)
  const role = roleAt(w, d.role)
  const id = b.name('assignment')
  const player = playedBy(role)
  const base = {
    id,
    actor: { _tag: 'Agent' as const, name: player, run: `${player}-${id.slice(1)}` },
    role: role.role,
    task: task.id,
    under: underNowOf(w, task),
    parent: isAssignment(act.by)
      ? ({ _tag: 'Parent', id: act.by } as const)
      : ({ _tag: 'GivenByPerson' } as const),
    when: act.when,
  }
  const assignment =
    d._tag === 'GivenMaker'
      ? giveAssignment({
          ...base,
          _tag: 'Maker',
          maxAttempts:
            d.maxAttempts === null
              ? role.limits.Assignment.attempts
              : { _tag: 'AtMost', max: d.maxAttempts },
        })
      : giveAssignment({ ...base, _tag: 'Reviewer' })
  // A new maker of a task ends the makers before it: what waits for them goes up.
  if (d._tag === 'GivenMaker') {
    for (const x of [...b.work.assignments.values()]) {
      if (x.task === task.id && isDo(b.work, x.role) && !finished(x))
        endAssignment(b, x.id, act.when)
    }
  }
  b.work = {
    ...b.work,
    assignments: put(b.work.assignments, id, assignment),
    meta: put(b.work.meta, id, newMeta(d.secret)),
  }
}

// A brief takes the snapshot and the claim. The first brief of a task records how its output
// looked before any work (a report equal to it is untouched work).
const applyBrief = (b: Build, act: Act): void => {
  const d = data(act, 'Assignment.Briefed') as
    | DataOf<'Assignment.Briefed'>
    | DataOf<'Assignment.BriefedToCheck'>
    | DataOf<'Assignment.BriefedFirst'>
  const w = b.work
  const id = movedId<AssignmentId>(act)
  const a = assignmentAt(w, id)
  const under = underNowOf(w, taskAt(w, a.task))
  const briefed =
    a.end._tag === 'NotEnded' ? briefAssignment({ ...a, end: a.end }, under) : { ...a, under }
  const meta = w.meta.get(id)
  const result = d._tag === 'BriefedToCheck' ? d.result : null
  b.work = {
    ...w,
    assignments: put(w.assignments, id, briefed),
    meta: meta === undefined ? w.meta : put(w.meta, id, claim(meta, act.when, result)),
  }
  const task = taskAt(b.work, a.task)
  if (d._tag === 'BriefedFirst' && task.untouched._tag === 'NotBriefed') {
    const inPlace =
      d.before._tag === 'InPlace'
        ? ({ _tag: 'InPlace', texts: d.before.texts, at: act.when } as const)
        : ({ _tag: 'NotInPlace' } as const)
    const first = firstBrief({ ...task, untouched: task.untouched }, d.untouched, inPlace)
    b.work = { ...b.work, tasks: put(b.work.tasks, task.id, first) }
  }
}

// --- results -------------------------------------------------------------------------------------

const checkReport = (w: Work, act: Act): void => {
  const d = data(act, 'Result.Result')
  for (const m of d.madeFrom) if (m._tag === 'Result') found(w, m.result, ['r'], refusing)
  const id = assignmentBy(act.by)
  const a = assignmentAt(w, id)
  const task = taskAt(w, a.task)
  const name = labelOf(w, id)
  const { when } = act
  if (!actsOf(w, id, when).some((x) => x._tag === 'Do')) no(`${name} has no Do act`)
  if (finished(a)) no(`${name} is finished`)
  if (!isOpen(task)) no(`${task.name} is closed`)
  const stop = workStop(w, task.id, when)
  if (stop !== undefined) no(stop)
  if (itemsOf(w, task.id).some((r) => isRejectItem(r) && !answeredItem(w, r))) {
    no(`${task.name} is returned until a change answers it`)
  }
  if (taskAccepted(w, task.id, when))
    no(`${task.name} is accepted; a Reject or a change reopens it`)
  const need = task.needs.find((n) => !taskAccepted(w, n, when))
  if (need !== undefined)
    no(`${task.id} needs ${need} (${taskAt(w, need).name}), which is not accepted`)
  const limit = maxOf(roleAt(w, a.role).limits.Result.size)
  if (limit !== undefined && d.work._tag === 'File' && d.work.size > limit) {
    no(
      `the result has size ${d.work.size}; the limit is ${limit}: split the task ` +
        `(work guide limits)`,
    )
  }
  const max = a._tag === 'Maker' ? maxOf(a.maxAttempts) : undefined
  if (max !== undefined && usedBy(w, id) >= max) no(`${name} has used its ${max} attempts`)
}
const applyReport = (b: Build, act: Act): void => {
  const d = data(act, 'Result.Result')
  const by = assignmentBy(act.by)
  const a = assignmentAt(b.work, by)
  const id = b.name('result')
  const result: Result = {
    id,
    task: a.task,
    by,
    output: d.output,
    madeFrom: d.madeFrom,
    work: d.work,
    under: a.under,
    when: act.when,
    at: b.tick(),
  }
  b.work = {
    ...b.work,
    results: put(b.work.results, id, result),
    resultFiles: put(b.work.resultFiles, id, d.files),
    after: d.after === null ? b.work.after : put(b.work.after, id, d.after),
  }
  endUnit(b, by)
}

// --- reviews ------------------------------------------------------------------------------------

type ReviewData =
  | DataOf<'Review.Accept'>
  | DataOf<'Review.Reject'>
  | DataOf<'Review.Recheck'>
  | DataOf<'Review.Escalate'>
  | DataOf<'Review.Resolve'>
const reviewData = (act: Act): ReviewData => dataOf(act.event) as ReviewData

// The target of a review, as a result, task, draft or evaluation id; a resolve's is its
// escalation's.
const targetOf = (
  w: Work,
  d: ReviewData,
): { readonly _tag: string; readonly id: string } | undefined => {
  switch (d._tag) {
    case 'Accept':
    case 'Reject':
      return d.of
    case 'Recheck':
    case 'Escalate':
      return { _tag: 'Result', id: d.of }
    case 'Resolve': {
      const escalated = w.reviews.get(d.escalation)
      return escalated?._tag === 'Escalate' ? { _tag: 'Result', id: escalated.of } : undefined
    }
  }
}
// The task that a review's target belongs to (the person's view of the versions reads it).
const reviewTask = (
  w: Work,
  of: { readonly _tag: string; readonly id: string },
): TaskId | undefined => {
  if (of._tag === 'Task') return of.id as TaskId
  if (of._tag === 'Result') return resultAt(w, of.id as ResultId).task
  if (of._tag === 'Evaluation') {
    const e = w.evaluations.get(of.id as never)
    return e === undefined ? undefined : stopRefTask(w, stopRefOrThrow(w, e.answers))
  }
  return undefined
}
const stopRefOrThrow = (w: Work, stop: Parameters<typeof stopRefOf>[1]) => {
  const ref = stopRefOf(w, stop)
  if (ref === undefined) throw new Error(`there is no stop ${stop.id}`)
  return ref
}
// The evidence of a review: a rule by its id in the official version now.
const evidenceOf = (
  w: Work,
  list: ReadonlyArray<EvidenceData>,
  guard: Guard,
): ReadonlyArray<Evidence> =>
  list.map((e) => {
    const rule = e.rule === null ? undefined : findRule(w, e.rule)
    if (e.rule !== null && rule === undefined)
      guard(`there is no rule "${e.rule}" in an official version`)
    return { says: e.what, meets: rule?.entry ?? null, at: e.where, uses: [] }
  })
const evidenceData = (d: ReviewData): ReadonlyArray<EvidenceData> =>
  d._tag === 'Accept' ? d.of.evidence : d._tag === 'Resolve' ? d.evidence : []

// Who may Accept or Reject a result or a task: its owner, a Change act on it, a role that
// covers or decides the maker.
export const mayDecide = (
  w: Work,
  by: By,
  of: { readonly _tag: string; readonly id: string },
  task: TaskId,
  when: Time,
) => {
  if (actorOf(w, by).name === taskAt(w, task).owner.name || mayChange(w, by, task, when))
    return true
  if (of._tag === 'Result') {
    return (
      coversMaker(w, by, of.id as ResultId, when) || decidesResults(w, by, of.id as ResultId, when)
    )
  }
  const makers = [...w.assignments.values()]
    .filter((a) => a.task === task && isDo(w, a.role))
    .map((a) => a.role)
  return makers.some(
    (role) => can(w, by, 'Review', role, when) || can(w, by, 'Approve', role, when),
  )
}
const isAnswerer = (w: Work, by: By, answerer: Answerer): boolean =>
  typeof answerer === 'string' ? by === answerer : actorOf(w, by).name === answerer.name

// The checks before the time of the files: the target, and the rules of the evidence.
const checkReviewBefore = (w: Work, act: Act): void => {
  const d = reviewData(act)
  if (d._tag === 'Escalate') {
    found(w, d.of, ['r'], refusing)
    return
  }
  if (d._tag === 'Resolve') {
    const f = found(w, d.escalation, ['v'], refusing)
    if (f?._tag !== 'Review' || f.review._tag !== 'Escalate') {
      no('a resolve ends an escalation; this review is not an escalation')
    }
  } else {
    const of = targetOf(w, d)
    if (of !== undefined) found(w, of.id, ['r', 't', 'd', 'ev'], refusing)
  }
  evidenceOf(w, evidenceData(d), refusing)
}
// An accept is about the reported work, so the work must be unchanged (write time only); a
// resolve with no evidence ends an escalation in words, so it is not checked.
const changedTarget = (w: Work, act: Act): ResultId | undefined => {
  const d = reviewData(act)
  if (d._tag === 'Accept') return d.of._tag === 'Result' ? d.of.id : undefined
  if (d._tag === 'Resolve' && d.evidence.length > 0) {
    return targetOf(w, d)?.id as ResultId | undefined
  }
  return undefined
}

// The checks of Review.decide on a draft.
const checkDraftReview = (
  w: Work,
  act: Act,
  accept: boolean,
  evidence: ReadonlyArray<Evidence>,
  id: RevisionId,
) => {
  const { by, when } = act
  const draft = draftAt(w, id)
  const direction = directionAt(w, draft.of)
  const made = madeBy(w, id)
  if (made) no(`${id} is official: it made ${direction.name} v${made.number}`)
  const vetoed = vetoItem(w, id)
  if (vetoed) {
    no(
      `${id} is ended by the Reject of ${labelOf(w, vetoed.by)}: ${vetoed.reason ?? ''}; its ` +
        `reviser revises the current version again`,
    )
  }
  const reviser: By =
    draft.origin._tag === 'Written'
      ? draft.origin.by
      : { _tag: 'Agent', name: 'refresh', run: draft.origin.commit }
  if (sameActor(w, by, reviser) || below(w, by, reviser)) {
    no(`${id} is your own draft, or a draft from above you; another actor reviews it`)
  }
  if (itemsOf(w, id).some((r) => sameActor(w, r.by, by)))
    no(`${labelOf(w, by)} already reviewed ${id}`)
  if (accept && isAssignment(by) && !hasEvidence(evidence)) {
    no(`an accept of ${id} says where it read in the draft and what it saw: give evidence`)
  }
  if (accept && !isAssignment(by) && !isPerson(w, by) && !hasEvidence(evidence)) {
    no(`an accept of ${id} says where it read in the draft and what it saw: give evidence`)
  }
  const who = decidersOfDraft(w, id)
  const matches = draftMatches(w, draft.of)
  const accepts = draftAcceptItems(w, id)
  const acting: Acting = { by, when }
  if (
    leavesOf(who).some((leaf) => matches(leaf, acting)) &&
    !turnOf(who, acting, accepts, matches)
  ) {
    no(`${labelOf(w, by)} reviews ${id} after the accept of ${waitsFor(who, accepts, matches)}`)
  }
  if (accept) {
    const after = [...accepts, { by, when, at: w.clock + 1 }]
    if (metAt(who, after, matches) !== undefined) {
      const problem = officialProblem(w, id, after)
      if (problem !== undefined) no(problem)
    }
  }
}
// Why the accept that would make a draft official is refused, or none.
const officialProblem = (
  w: Work,
  id: RevisionId,
  accepts: ReadonlyArray<Acting>,
): string | undefined => {
  const draft = draftAt(w, id)
  const direction = directionAt(w, draft.of)
  const now = officialAt(w, draft.of) ? currentOf(w, draft.of) : undefined
  const owner = direction.owner.name
  if (draft._tag === 'New' && now) {
    return (
      `${id} drafts ${direction.name} anew, and ${direction.name} has v${now.number} now; ` +
      `its reviser revises the current version`
    )
  }
  const baseNumber =
    draft._tag === 'Change' ? Number(draft.base.slice(draft.base.lastIndexOf('@') + 1)) : undefined
  if (baseNumber !== undefined && baseNumber !== now?.number) {
    return (
      `${id} is built on ${direction.name} v${baseNumber}, an old version; its reviser ` +
      `revises the current one`
    )
  }
  const person = accepts.some((a) => isPerson(w, a.by) && actorOf(w, a.by).name === owner)
  if (draft._tag === 'New' && !person) return `${id} makes a new direction; ${owner} accepts it`
  const base =
    baseNumber === undefined || now === undefined
      ? undefined
      : officialAt(w, draft.of)?.versions[baseNumber - 1]
  if (base !== undefined && draft.says !== base.says && !person) {
    return `${id} changes what ${direction.name} says; a new spirit needs the accept of ${owner}`
  }
  const reject = itemsOf(w, id).find(isRejectItem)
  if (reject && !person) {
    return (
      `${id} has the Reject of ${labelOf(w, reject.by)}; after it, only the accept of ` +
      `${owner} makes it official`
    )
  }
  const elsewhere = [...w.directions.values()]
    .filter((d) => d._tag === 'Official' && d.id !== draft.of)
    .flatMap((d) =>
      currentOf(w, d.id).standards.flatMap((e) =>
        (w.standards.get(e)?.rules ?? []).map((r) => ruleAt(w, r).id),
      ),
    )
  const before = new Set((base?.standards ?? []).flatMap((e) => w.standards.get(e)?.rules ?? []))
  const rules = draft.standards.flatMap((e) => w.standards.get(e)?.rules ?? [])
  const twin = rules
    .filter((r) => !before.has(r))
    .map((r) => ruleAt(w, r))
    .find((r) => elsewhere.includes(r.id))
  if (twin) {
    return draft.origin._tag === 'Imported'
      ? `the rule id "${twin.id}" of this company direction is used by another direction of the ` +
          `project; give one of them a new id (a company rule changes in its repo)`
      : `the rule id "${twin.id}" is already used by another direction; revise with a new id`
  }
  const ids = rules.map((r) => ruleAt(w, r).id)
  const repeated = ids.find((x, i) => ids.indexOf(x) !== i)
  if (repeated !== undefined)
    return `${id} has the rule id "${repeated}" twice; revise with a new id`
  return undefined
}

// The checks of decideEvaluation: only the owner of its task reviews it, once.
const checkEvaluationReview = (
  w: Work,
  act: Act,
  accept: boolean,
  evidence: ReadonlyArray<Evidence>,
  id: string,
) => {
  const e = w.evaluations.get(id as never)
  if (e === undefined) return
  const task = taskAt(w, stopRefTask(w, stopRefOrThrow(w, e.answers)))
  const { by } = act
  if (!isPerson(w, by)) no('the person evaluates a change of a direction or a principle')
  const name = actorOf(w, by).name
  if (name !== task.owner.name) {
    no(`${name} is not the owner of ${task.id}; ${task.owner.name} accepts its evaluations`)
  }
  if (countsWhenWritten(e)) no(`an evaluation at the level ${e.level} counts when it is written`)
  const decided = evaluationDecision(w, e)
  if (decided)
    no(`the evaluation is already ${decided._tag === 'Accept' ? 'accepted' : 'rejected'}`)
  if (accept && !hasEvidence(evidence)) {
    no(
      'an accept of an evaluation says where the owner read, such as the results and the Rejects ' +
        'that it names: give evidence',
    )
  }
}

// The checks of Review.decide on a result or a task, for one point (a Reject's points share
// every check but the rule that each one names).
const checkDecide = (
  w: Work,
  act: Act,
  of: { readonly _tag: string; readonly id: string },
  decision: 'Accept' | 'Reject' | 'Escalate',
  options: {
    readonly breaks?: RuleEntry
    readonly redo?: boolean
    readonly resolves?: EscalationId
  },
): void => {
  const { by, when } = act
  const task = reviewTask(w, of)
  if (task === undefined) return
  if (options.redo && !isOpen(taskAt(w, task))) {
    no(`${task} is closed; it takes no new result, so a recheck cannot be answered`)
  }
  const breaks = options.breaks
  if (breaks !== undefined && !rulesOf(w, task).some((r) => r.entry === breaks)) {
    const top = rootOf(w, task)
    const holder = [...w.tasks.values()].find(
      (t) =>
        isOpen(t) &&
        t.id !== task &&
        within(w, t.id, top) &&
        rulesOf(w, t.id).some((r) => r.entry === breaks),
    )
    no(
      `${task} is not checked by ${ruleAt(w, breaks).id}` +
        (holder ? `; it is a rule of ${holder.id}: reject the result of ${holder.id}` : ''),
    )
  }
  if (decision !== 'Escalate' && !mayDecide(w, by, of, task, when))
    no(`${labelWithRole(w, by)} may not review this`)
  if (of._tag === 'Result' && decision !== 'Escalate' && options.resolves === undefined) {
    const result = of.id as ResultId
    const who = deciderOf(w, result)
    const now = decidingNow(w, result)
    const own = rulesOf(w, task).filter(
      (r) => r.checkedBy._tag === 'Role' && r.checkedBy.role === roleNameOf(w, by),
    )
    const asChecker =
      own.length > 0 && (decision === 'Accept' || own.some((r) => r.entry === breaks))
    if (
      who &&
      decidesResults(w, by, result, when) &&
      !turnOf(who, { by, when }, now, turnMatches(w)) &&
      !asChecker
    ) {
      no(
        `${roleNameOf(w, by) ?? 'person'} decides this result after the accept of ` +
          `${waitsFor(who, now, turnMatches(w))}`,
      )
    }
    if (isCriticism(w, { by, of: { _tag: 'Result', id: result }, when } as Item)) {
      if (decision === 'Accept') {
        no(
          `${actorOf(w, by).name} approves directions and standards; the accept of ` +
            `${decisionWaitsFor(w, result, [])} decides a result`,
        )
      }
      if (!decisionMet(w, result, now)) {
        no(
          `this result waits for the accept of ${decisionWaitsFor(w, result, now)}; criticise it ` +
            `after its deciders accept it`,
        )
      }
    }
  }
  const resolves = options.resolves
  if (resolves !== undefined) {
    const escalated = w.reviews.get(resolves)
    if (escalated?._tag !== 'Escalate')
      return no('a resolve ends an escalation; this review is not an escalation')
    const answerer = answererOf(w, escalated.answerBy)
    const toPerson = typeof answerer !== 'string'
    const allowed =
      !sameActor(w, by, escalated.by) &&
      (isAnswerer(w, by, answerer) ||
        (!toPerson && of._tag === 'Result' && decidesResults(w, by, of.id as ResultId, when)))
    if (!allowed) no(`${labelOf(w, by)} may not resolve "${escalated.reason}"`)
    // New: an escalation is resolved once; a resolved one has no move back to open.
    if (reviewItems(w).some((r) => r.resolves === resolves)) no(`${resolves} is resolved already`)
  }
}

// The checks of a review after the time of the files.
const checkReviewAfter = (w: Work, act: Act): void => {
  const d = reviewData(act)
  const evidence = evidenceOf(w, evidenceData(d), trusting)
  switch (d._tag) {
    case 'Escalate':
      return checkDecide(w, act, { _tag: 'Result', id: d.of }, 'Escalate', {})
    case 'Recheck':
      return checkDecide(w, act, { _tag: 'Result', id: d.of }, 'Reject', { redo: true })
    case 'Resolve': {
      const of = targetOf(w, d)
      if (of === undefined) return
      // The engine reads a resolve as an Accept; resolves skips the decider turn.
      return checkDecide(w, act, of, 'Accept', { resolves: d.escalation })
    }
    case 'Accept':
      if (d.of._tag === 'Revision') return checkDraftReview(w, act, true, evidence, d.of.id)
      if (d.of._tag === 'Evaluation') return checkEvaluationReview(w, act, true, evidence, d.of.id)
      return checkDecide(w, act, d.of, 'Accept', {})
    case 'Reject': {
      const of = d.of
      if (of._tag === 'Revision') return checkDraftReview(w, act, false, [], of.id)
      if (of._tag === 'Evaluation') return checkEvaluationReview(w, act, false, [], of.id)
      if (of._tag === 'Task') return checkDecide(w, act, of, 'Reject', {})
      for (const p of of.points) {
        const rule = p.breaks === null ? undefined : findRule(w, p.breaks)
        if (p.breaks !== null && rule === undefined)
          no(`there is no rule "${p.breaks}" in an official version`)
        checkDecide(w, act, of, 'Reject', rule === undefined ? {} : { breaks: rule.entry })
      }
      return
    }
  }
}

// The review, made: one record (a Reject holds its points), at the engine's clock. A fault that
// uses the last try of a maker stops the task until it is evaluated.
const applyReview = (b: Build, act: Act): void => {
  const d = reviewData(act)
  const w = b.work
  const by = act.by
  const of = targetOf(w, d)
  const task = of === undefined ? undefined : reviewTask(w, of)
  const under = isAssignment(by)
    ? assignmentAt(w, by).under
    : task === undefined || of?._tag === 'Revision'
      ? new Map()
      : underNowOf(w, taskAt(w, task))
  const base = { under, when: act.when }
  const evidence = evidenceOf(w, evidenceData(d), trusting)
  let review: Review
  switch (d._tag) {
    case 'Escalate': {
      const a = assignmentBy(by)
      const id = b.name('review')
      const answerBy: Answerer = openAncestorOf(w, a) ?? taskAt(w, resultAt(w, d.of).task).owner
      review = {
        ...base,
        _tag: 'Escalate',
        id: id as EscalationId,
        by: a,
        of: d.of,
        reason: d.reason,
        answerBy,
        at: b.tick(),
      }
      break
    }
    case 'Recheck': {
      const id = b.name('review')
      review = {
        ...base,
        _tag: 'Recheck',
        id,
        by: assignmentBy(by),
        of: d.of,
        reason: d.reason,
        at: b.tick(),
      }
      break
    }
    case 'Resolve': {
      const id = b.name('review')
      review = {
        ...base,
        _tag: 'Resolve',
        id,
        by: answererBy(w, by),
        escalation: d.escalation,
        resolution: d.resolution,
        evidence,
        at: b.tick(),
      }
      break
    }
    case 'Accept': {
      const id = b.name('review')
      review = acceptOf(w, by, d, evidence, { ...base, id, at: b.tick() })
      break
    }
    case 'Reject': {
      const id = b.name('review') as RejectId
      review = rejectOf(w, by, d, {
        ...base,
        id,
        at: b.tick(d.of._tag === 'Result' || d.of._tag === 'Task' ? d.of.points.length : 1),
      })
      break
    }
  }
  b.work = { ...b.work, reviews: put(b.work.reviews, review.id, review) }
  // A draft that its deciders accepted becomes the next version.
  if (review._tag === 'Accept' && review.of._tag === 'Revision') {
    const draft = review.of.id
    const after = b.work
    const who = decidersOfDraft(after, draft)
    if (
      metAt(who, draftAcceptItems(after, draft), draftMatches(after, draftAt(after, draft).of)) !==
      undefined
    ) {
      makeVersion(b, draft, act.when)
    }
  }
  exhaust(b, review)
  if (review._tag !== 'Escalate' && isAssignment(by)) endUnit(b, by)
  if (review._tag === 'Escalate') endUnit(b, review.by)
}
const acceptOf = (
  w: Work,
  by: By,
  d: DataOf<'Review.Accept'>,
  evidence: ReadonlyArray<Evidence>,
  base: {
    readonly id: Review['id']
    readonly under: Assignment['under']
    readonly when: Time
    readonly at: number
  },
): Review => {
  const reviewer = reviewerBy(w, by)
  const nonEmpty = evidence as NonEmpty<Evidence>
  switch (d.of._tag) {
    case 'Result':
      return {
        ...base,
        _tag: 'Accept',
        reason: d.reason,
        by: reviewer,
        of: { _tag: 'Result', id: d.of.id, evidence: nonEmpty },
      }
    case 'Evaluation':
      return {
        ...base,
        _tag: 'Accept',
        reason: d.reason,
        by: personOf(w, by),
        of: { _tag: 'Evaluation', id: d.of.id, evidence: nonEmpty },
      }
    case 'Revision':
      return typeof reviewer === 'string'
        ? {
            ...base,
            _tag: 'Accept',
            reason: d.reason,
            by: reviewer,
            of: { _tag: 'Revision', id: d.of.id, evidence: nonEmpty },
          }
        : {
            ...base,
            _tag: 'Accept',
            reason: d.reason,
            by: reviewer,
            of: { _tag: 'Revision', id: d.of.id, evidence },
          }
  }
}
const rejectOf = (
  w: Work,
  by: By,
  d: DataOf<'Review.Reject'>,
  base: {
    readonly id: RejectId
    readonly under: Assignment['under']
    readonly when: Time
    readonly at: number
  },
): Review => {
  const reviewer = reviewerBy(w, by)
  const of = d.of
  switch (of._tag) {
    case 'Result': {
      const points = of.points.map((p): Point => {
        const rule = p.breaks === null ? undefined : findRule(w, p.breaks)
        return {
          text: p.text,
          breaks: rule ? { _tag: 'Rule', rule: rule.entry } : { _tag: 'NoRule' },
        }
      }) as unknown as NonEmpty<Point>
      return { ...base, _tag: 'Reject', by: reviewer, of: { _tag: 'Result', id: of.id, points } }
    }
    case 'Task':
      return {
        ...base,
        _tag: 'Reject',
        by: reviewer,
        of: { _tag: 'Task', id: of.id, points: of.points },
      }
    case 'Revision':
      return {
        ...base,
        _tag: 'Reject',
        by: reviewer,
        of: { _tag: 'Revision', id: of.id, reason: of.reason },
      }
    case 'Evaluation':
      return {
        ...base,
        _tag: 'Reject',
        by: personOf(w, by),
        of: { _tag: 'Evaluation', id: of.id, reason: of.reason },
      }
  }
}
// A fault on the last try of its maker: an exhaustion of that maker's result, once.
const exhaust = (b: Build, review: Review): void => {
  const w = b.work
  const faults = [...w.reviews.values()].includes(review)
    ? reviewItems(w).filter((i) => i.review === review)
    : []
  const first = faults.find((i) => isFault(w, i))
  if (first === undefined || first.of._tag !== 'Result') return
  const result = resultAt(w, first.of.id)
  if (!underNow(w, result)) return
  const maker = assignmentAt(w, result.by)
  const max = maker._tag === 'Maker' ? maxOf(maker.maxAttempts) : undefined
  if (max === undefined || usedBy(w, maker.id) < max) return
  if ([...w.exhaustions.values()].some((x) => exhaustionResult(w, x).id === result.id)) return
  const x = b.name('exhaustion')
  const exhaustion = {
    id: x,
    fault: first.id as PointId,
    when: first.when,
    at: first.at,
  }
  b.work = { ...b.work, exhaustions: put(b.work.exhaustions, x, exhaustion) }
}
// The draft becomes the next version (version 1 of a new direction). Each new standard or rule
// of a later version becomes a lesson that later tasks can find.
const makeVersion = (b: Build, draft: RevisionId, when: Time): void => {
  const w = b.work
  const x = draftAt(w, draft)
  const d = directionAt(w, x.of)
  const from = d._tag === 'Official' ? currentOf(w, d.id) : undefined
  const version: Version<Direction> = {
    of: d.id,
    number: ((from?.number ?? 0) + 1) as PositiveInt,
    says: x.says,
    standards: x.standards,
    revision: draft,
    when,
  }
  b.work = { ...w, directions: put(w.directions, d.id, makeOfficial(d, version)) }
  b.created.push(versionId(d.id, version.number))
  if (from === undefined) return
  for (const text of lessonsOf(b.work, d.id, contentOf(from), contentOf(version))) {
    const id = b.name('note')
    const lesson = {
      _tag: 'Lesson' as const,
      id,
      from: x.answers,
      text,
      rule: versionId(d.id, version.number),
      when,
    }
    b.work = { ...b.work, notes: put(b.work.notes, id, lesson) }
  }
}

// --- questions and notes -------------------------------------------------------------------------

// An agent's question, or the person's question to an agent (only forwarded).
type AskedOfAgent = {
  readonly _tag: 'Asked'
  readonly text: NonBlank
  readonly to: { readonly _tag: 'Agent'; readonly assignment: AssignmentId }
}
const askedData = (act: Act) => dataOf(act.event) as DataOf<'Question.Asked'> | AskedOfAgent

// Who an agent's question goes to: the nearest open assignment above, else the owner; in a
// project of the UI, the host in the owner's place.
const answererOfAsk = (w: Work, a: Assignment, to: 'Above' | 'Owner', guard: Guard): Answerer => {
  const owner = taskAt(w, a.task).owner
  const first: Answerer = to === 'Owner' ? owner : (openAncestorOf(w, a.id) ?? owner)
  const host = hostOf(w, a.task)
  if (host === undefined || typeof first === 'string') return first
  if (host === a.id) {
    guard(
      'you are the host of this project: answer it from the directions; when a direction reads ' +
        'two ways, draft its change (work direction revise), and the person accepts it',
    )
    return first
  }
  return host
}
const checkAsk = (w: Work, act: Act): void => {
  const d = askedData(act)
  if (d.to._tag === 'Agent') {
    const f = found(w, d.to.assignment, ['a'], refusing)
    if (f?._tag === 'Assignment' && finished(f.assignment)) {
      no(
        `${labelOf(w, f.assignment.id)} is finished, so it answers no question; ask an open ` +
          `assignment`,
      )
    }
    return
  }
  answererOfAsk(w, assignmentAt(w, assignmentBy(act.by)), d.to._tag, refusing)
}
const applyAsk = (b: Build, act: Act): void => {
  const d = askedData(act)
  const w = b.work
  const id = b.name('question')
  const to = d.to
  const question =
    to._tag === 'Agent'
      ? askQuestion({
          _tag: 'Question',
          id,
          text: d.text,
          stops: assignmentAt(w, to.assignment).task,
          answerBy: to.assignment,
          from: personOf(w, act.by),
          when: act.when,
        })
      : askQuestion({
          _tag: 'Question',
          id,
          text: d.text,
          stops: assignmentAt(w, assignmentBy(act.by)).task,
          answerBy: answererOfAsk(w, assignmentAt(w, assignmentBy(act.by)), to._tag, trusting),
          from: assignmentBy(act.by),
          when: act.when,
        })
  b.work = { ...b.work, questions: put(b.work.questions, id, question) }
}
// An escalation with no result: a maker sends its blocked task up; it ends the maker's unit.
const applyEscalated = (b: Build, act: Act): void => {
  const d = data(act, 'Question.Escalated')
  const a = assignmentAt(b.work, assignmentBy(act.by))
  const id = b.name('question')
  const answerBy: Answerer = openAncestorOf(b.work, a.id) ?? taskAt(b.work, a.task).owner
  const question = askQuestion({
    _tag: 'Question',
    id,
    text: d.text,
    stops: a.task,
    answerBy,
    from: a.id,
    when: act.when,
  })
  b.work = { ...b.work, questions: put(b.work.questions, id, question) }
  endUnit(b, a.id)
}
// Only the one that a question waits for answers it, once (bug 2).
const checkAnswer = (w: Work, act: Act): void => {
  const f = found(w, movedId<string>(act), ['q'], refusing)
  if (f?._tag !== 'Question') return
  const q = f.question
  const now = answererOf(w, q.answerBy)
  if (!isAnswerer(w, act.by, now))
    no(`${answererLabel(w, now)} answers this question, not ${labelOf(w, act.by)}`)
  if (q.status._tag === 'Answered') no(`the question is answered already: "${q.status.answer}"`)
}
const applyAnswer = (b: Build, act: Act): void => {
  const d = data(act, 'Question.Answered')
  const id = movedId<QuestionId>(act)
  const q = b.work.questions.get(id)
  if (q?.status._tag !== 'Open') throw new Error(`${id} is no open question`)
  const answered = answerQuestion(
    { ...q, status: q.status },
    d.text,
    answererBy(b.work, act.by),
    act.when,
  )
  b.work = { ...b.work, questions: put(b.work.questions, id, answered) }
}

const applyNote = (b: Build, act: Act): void => {
  const d = dataOf(act.event) as DataOf<'Note.Message'> | DataOf<'Note.Finding'>
  const id = b.name('note')
  const note =
    d._tag === 'Message'
      ? { _tag: 'Message' as const, id, about: d.about, text: d.text, by: act.by, when: act.when }
      : { _tag: 'Finding' as const, id, about: d.about, text: d.text, when: act.when }
  b.work = { ...b.work, notes: put(b.work.notes, id, note) }
}

// --- evaluations ---------------------------------------------------------------------------------

// The high role of the task's tree, or the person, says what is wrong, why the task cannot be
// done as asked, and what to improve. It answers one stop.
const checkEvaluate = (w: Work, act: Act): void => {
  const d = data(act, 'Evaluation.Evaluation')
  found(w, d.stop.id, ['ex', 'v'], refusing)
  const ref = stopRefOf(w, d.stop)
  const isStop = ref !== undefined && (ref._tag === 'Exhaustion' || isPersonStop(w, ref.item))
  if (ref === undefined || !isStop) {
    return no(
      'an evaluation answers a stop: the last try of a maker that ended on a fault, or a Reject ' +
        'of the person',
    )
  }
  const task = taskAt(w, stopRefTask(w, ref))
  if (!isOpen(task)) no(`${task.id} is closed`)
  const { by } = act
  const person = isPerson(w, by)
  if (person && actorOf(w, by).name !== task.owner.name) {
    no(
      `${actorOf(w, by).name} is not the owner of ${task.id}; ${task.owner.name} evaluates its ` +
        `mistakes`,
    )
  }
  if (!person && isAssignment(by)) {
    const a = assignmentAt(w, by)
    const label = labelOf(w, by)
    if (finished(a)) no(`${label} is finished`)
    const tier = tierOf(roleAt(w, a.role))
    if (tier !== 'high') no(`${label} is ${tier}; a high role evaluates a mistake, or the person`)
    if (!within(w, task.id, a.task)) no(`${task.id} is outside the task tree of ${label}`)
  }
  if (stopRefAnswered(w, ref)) no(`${stopText(w, ref)} already has an evaluation that counts`)
  if (!person) {
    const key = stopKey(w, d.stop)
    const pending = [...w.evaluations.values()].find(
      (e) => stopKey(w, e.answers) === key && !evaluationDecision(w, e) && !evaluationCounts(w, e),
    )
    if (pending) {
      no(
        `an evaluation of ${task.id} at the level ${pending.level} waits for ` +
          `${task.owner.name}'s accept; a new one comes after that answer`,
      )
    }
  }
}
const applyEvaluate = (b: Build, act: Act): void => {
  const d = data(act, 'Evaluation.Evaluation')
  const w = b.work
  const ref = stopRefOrThrow(w, d.stop)
  const task = stopRefTask(w, ref)
  const person = isPerson(w, act.by)
  // After the owner rejected an evaluation of the task, the next one of an agent waits too.
  const rejected = person
    ? undefined
    : [...w.evaluations.values()]
        .filter((e) => stopRefTask(w, stopRefOrThrow(w, e.answers)) === task && e.at > ref.at)
        .map((e) => evaluationDecision(w, e))
        .find((v) => v?._tag === 'Reject')
  const id = b.name('evaluation')
  const evaluation = {
    id,
    answers: d.stop,
    by: answererBy(w, act.by),
    wrong: d.wrong,
    why: d.why,
    improve: d.improve,
    level: d.level,
    after:
      rejected === undefined
        ? ({ _tag: 'FirstTry' } as const)
        : ({ _tag: 'OwnerRejected', reject: rejected.id as RejectId } as const),
    when: act.when,
    at: b.tick(),
  }
  b.work = { ...b.work, evaluations: put(b.work.evaluations, id, evaluation) }
}

// --- suggestions, drafts, permissions, sources, checkpoints --------------------------------------

// Feedback in words: about a direction, a standard, or a rule of an official version now.
const suggestionAbout = (w: Work, d: DataOf<'Suggestion.Suggestion'>, guard: Guard) => {
  const about = d.about
  const none = (key: string) => guard(`there is no rule "${key}" in an official version`)
  switch (about._tag) {
    case 'NewDirection':
      return { _tag: 'NewDirection' } as const
    case 'Direction':
      if (officialAt(w, about.direction) === undefined) none(about.direction)
      return { _tag: 'Direction', direction: about.direction } as const
    case 'Standard': {
      for (const x of w.directions.values()) {
        if (x._tag !== 'Official') continue
        const s = currentOf(w, x.id)
          .standards.map((e) => w.standards.get(e))
          .find((s) => s?.id === about.key)
        if (s) return { _tag: 'Standard', standard: s.entry } as const
      }
      none(about.key)
      return undefined
    }
    case 'Rule': {
      const rule = findRule(w, about.key)
      if (rule === undefined) {
        none(about.key)
        return undefined
      }
      return { _tag: 'Rule', rule: rule.entry } as const
    }
  }
}
const applySuggestion = (b: Build, act: Act): void => {
  const d = data(act, 'Suggestion.Suggestion')
  const about = suggestionAbout(b.work, d, trusting)
  if (about === undefined) throw new Error('a suggestion about nothing of an official version')
  const id = b.name('suggestion')
  const suggestion = { id, about, says: d.says, by: act.by, when: act.when, at: b.tick() }
  b.work = { ...b.work, suggestions: put(b.work.suggestions, id, suggestion) }
}

const planDraft = (
  w: Work,
  act: Act,
  id: RevisionId,
  at: number,
  guard: Guard,
): Planned | undefined => {
  const d = dataOf(act.event) as
    | DataOf<'Revision.Drafted'>
    | DataOf<'Revision.Revised'>
    | DataOf<'Revision.Imported'>
  const x = { id, when: act.when, at }
  switch (d._tag) {
    case 'Drafted':
      return planDrafted(w, x, d, act.by, guard)
    case 'Revised':
      return planRevised(w, x, d, act.by, guard)
    case 'Imported':
      return planImported(w, x, d, guard)
  }
}
const applyDraft = (b: Build, act: Act): void => {
  const id = b.name('revision')
  const planned = planDraft(b.work, act, id, b.tick(), trusting)
  if (planned === undefined) throw new Error(`the draft ${id} names no direction`)
  const w = b.work
  b.work = {
    ...w,
    directions: put(w.directions, planned.direction.id, planned.direction),
    standards: new Map([...w.standards, ...planned.scratch.standards]),
    rules: new Map([...w.rules, ...planned.scratch.rules]),
    drafts: put(w.drafts, id, planned.revision),
  }
}

const grantedData = (act: Act) => data(act, 'Permission.Granted')
const checkGrant = (w: Work, act: Act): void => {
  const d = grantedData(act)
  if (!w.workflow.roles.has(d.to)) no(`there is no role "${d.to}"`)
  const act2 = d.act
  if (act2._tag === 'Change') {
    for (const id of act2.changesOf) {
      if (officialAt(w, id as never) === undefined) found(w, id, ['t'], refusing)
    }
  } else {
    for (const n of act2.resultsOf) if (!w.workflow.roles.has(n)) no(`there is no role "${n}"`)
  }
  if (!mayGive(w, act.by, act2, act.when)) no(`${labelOf(w, act.by)} may not give this act`)
}
const applyGrant = (b: Build, act: Act): void => {
  const d = grantedData(act)
  const id = b.name('permission')
  const permission = grantPermission({
    id,
    act: d.act,
    to: d.to,
    by: act.by,
    until: d.until,
    when: act.when,
    at: b.tick(),
  })
  b.work = { ...b.work, permissions: put(b.work.permissions, id, permission) }
}
// The giver ends a permission early, once. The acts before the revoke stay.
const checkRevoke = (w: Work, act: Act): void => {
  const f = found(w, movedId<string>(act), ['x'], refusing)
  if (f?._tag !== 'Permission') return
  const x = f.permission
  if (!sameActor(w, act.by, x.by)) no('only the giver revokes a permission')
  if (x.revoked._tag === 'Revoked') no(`this permission is already revoked, at ${x.revoked.at}`)
}
const applyRevoke = (b: Build, act: Act): void => {
  const id = movedId<Parameters<typeof b.work.permissions.get>[0]>(act)
  const x = b.work.permissions.get(id)
  if (x?.revoked._tag !== 'NotRevoked') throw new Error(`${id} is no permission in force`)
  b.work = {
    ...b.work,
    permissions: put(
      b.work.permissions,
      id,
      revokePermission({ ...x, revoked: x.revoked }, act.when),
    ),
  }
}

const applyCheckpoint = (b: Build, act: Act): void => {
  const d = data(act, 'Checkpoint.Checkpoint')
  const w = b.work
  const id = b.name('checkpoint')
  const part = checkpointOf(w, d.task, [...w.sources.values()], d.next, act.when)
  b.work = { ...b.work, checkpoints: put(b.work.checkpoints, id, { ...part, id }) }
}

// --- the check and the apply of each kind --------------------------------------------------------

// Each act has its time: an act with a time before the last act of the engine is refused.
const checkTime = (w: Work, act: Act): void => {
  const last = w.events.findLast(({ recorded }) => {
    const e = recorded.event
    return isEngineEvent(e) || e._tag === 'Forward'
  })?.recorded.at
  if (last !== undefined && Date.parse(act.when) < Date.parse(last)) {
    no(`an act at ${act.when} comes before the last act, at ${last}`)
  }
}

// The checks with no outside read, by kind.
const checkSync = (w: Work, act: Act): void => {
  const kind = kindOf(act.event)
  switch (kind) {
    case 'Workflow.Defined':
      return no('the store has a config; use work config apply')
    case 'Task.Opened':
    case 'Task.OpenedFromDraft':
      return checkOpen(w, act)
    case 'Task.Remade':
      return checkRemake(w, act)
    case 'Task.Split':
      return checkSplit(w, act)
    case 'Task.Closed':
      return checkClose(w, act)
    case 'Task.Described':
      taskNamed(w, movedId<string>(act))
      return
    case 'Assignment.GivenMaker':
    case 'Assignment.GivenReviewer':
      return checkGive(w, act)
    case 'Assignment.Briefed':
    case 'Assignment.BriefedToCheck':
    case 'Assignment.BriefedFirst':
    case 'Assignment.Freed':
    case 'Assignment.Finished':
      found(w, movedId<string>(act), ['a'], refusing)
      return
    case 'Result.Result':
      return checkReport(w, act)
    case 'Question.Asked':
      return checkAsk(w, act)
    case 'Question.Answered':
      return checkAnswer(w, act)
    case 'Note.Message': {
      const d = data(act, 'Note.Message')
      found(w, d.about, ['t'], refusing)
      return
    }
    case 'Evaluation.Evaluation':
      return checkEvaluate(w, act)
    case 'Suggestion.Suggestion':
      suggestionAbout(w, data(act, 'Suggestion.Suggestion'), refusing)
      return
    case 'Revision.Drafted':
    case 'Revision.Revised':
    case 'Revision.Imported': {
      const { id } = nextId(w.counters, 'revision')
      planDraft(w, act, id, w.clock + 1, refusing)
      return
    }
    case 'Permission.Granted':
      return checkGrant(w, act)
    case 'Permission.Revoked':
      return checkRevoke(w, act)
    case 'Source.Checked': {
      const name = movedId<string>(act)
      if (w.sources.get(name)?._tag !== 'Outside')
        no(`${name} is no outside source that an agent read`)
      return
    }
    case 'Checkpoint.Checkpoint':
      taskNamed(w, data(act, 'Checkpoint.Checkpoint').task)
      return
    default:
      return
  }
}

// The check of an act at write time: the same words as the old engine and its handler.
export const checkAct = (work: Work, act: Act, ctx: CheckContext): Effect.Effect<void, Refused> =>
  Effect.gen(function* () {
    yield* checked(() => checkTime(work, act))
    const kind = kindOf(act.event)
    if (kind.startsWith('Review.')) {
      yield* checked(() => checkReviewBefore(work, act))
      const result = changedTarget(work, act)
      if (result !== undefined && (yield* ctx.changed(resultAt(work, result)))) {
        return yield* Effect.fail(refuse(`the work changed after ${result} was reported`))
      }
      yield* checked(() => checkReviewAfter(work, act))
      return
    }
    yield* checked(() => checkSync(work, act))
    if (kind === 'Assignment.GivenMaker' || kind === 'Assignment.GivenReviewer') {
      // The CLI measures the brief as it prints it, in the Work with the new assignment.
      const d = givenData(act)
      const limit = maxOf(roleAt(work, d.role).limits.Assignment.briefChars)
      if (limit === undefined) return
      const stepped = applyAct(work, act)
      const a = [...stepped.work.assignments.values()].at(-1)
      if (a === undefined) return
      const size = ctx.measure(stepped.work, a)
      if (size > limit) {
        return yield* Effect.fail(
          refuse(
            `the brief of ${taskAt(work, d.task).name} has ${size} characters; the limit is ` +
              `${limit}: shorten its directions, or split the task (work guide limits)`,
          ),
        )
      }
    }
  })

// The apply of an act: the records that it makes, in the old naming order.
export const applyAct = (work: Work, act: Act): Stepped => {
  const b = new Build(work)
  const kind = kindOf(act.event)
  switch (kind) {
    case 'Workflow.Defined':
      throw new Error('a Work is defined once, by newWork')
    case 'Workflow.RoleWordsChanged': {
      const d = data(act, 'Workflow.RoleWordsChanged')
      b.work = {
        ...work,
        config: changeRoleWords(work.config, d.roles),
        hashes: d.hashes,
        texts: d.texts,
      }
      break
    }
    case 'Task.Opened':
    case 'Task.OpenedFromDraft':
      applyOpen(b, act)
      break
    case 'Task.Remade':
      applyRemake(b, act)
      break
    case 'Task.Split':
      applySplit(b, act)
      break
    case 'Task.Closed':
      applyClose(b, act)
      break
    case 'Task.Described': {
      const id = movedId<TaskId>(act)
      const task = describeTask(taskAt(work, id), data(act, 'Task.Described').text)
      b.work = { ...work, tasks: put(work.tasks, id, task) }
      break
    }
    case 'Assignment.GivenMaker':
    case 'Assignment.GivenReviewer':
      applyGive(b, act)
      break
    case 'Assignment.Briefed':
    case 'Assignment.BriefedToCheck':
    case 'Assignment.BriefedFirst':
      applyBrief(b, act)
      break
    case 'Assignment.Freed': {
      const id = movedId<AssignmentId>(act)
      const meta = work.meta.get(id)
      if (meta !== undefined) b.work = { ...work, meta: put(work.meta, id, freeClaim(meta)) }
      break
    }
    case 'Assignment.Finished': {
      const id = movedId<AssignmentId>(act)
      endAssignment(b, id, act.when)
      const meta = b.work.meta.get(id)
      if (meta !== undefined) b.work = { ...b.work, meta: put(b.work.meta, id, freeClaim(meta)) }
      break
    }
    case 'Result.Result':
      applyReport(b, act)
      break
    case 'Review.Accept':
    case 'Review.Reject':
    case 'Review.Recheck':
    case 'Review.Escalate':
    case 'Review.Resolve':
      applyReview(b, act)
      break
    case 'Question.Asked':
      applyAsk(b, act)
      break
    case 'Question.Escalated':
      applyEscalated(b, act)
      break
    case 'Question.Answered':
      applyAnswer(b, act)
      break
    case 'Note.Message':
    case 'Note.Finding':
      applyNote(b, act)
      break
    case 'Evaluation.Evaluation':
      applyEvaluate(b, act)
      break
    case 'Suggestion.Suggestion':
      applySuggestion(b, act)
      break
    case 'Revision.Drafted':
    case 'Revision.Revised':
    case 'Revision.Imported':
      applyDraft(b, act)
      break
    case 'Permission.Granted':
      applyGrant(b, act)
      break
    case 'Permission.Revoked':
      applyRevoke(b, act)
      break
    case 'Source.Moved': {
      const source = data(act, 'Source.Moved').source
      b.work = { ...work, sources: put(work.sources, source.name, source) }
      break
    }
    case 'Source.Checked':
      // The same revision read again: when it was seen is the time of this event (the log's).
      break
    case 'Checkpoint.Checkpoint':
      applyCheckpoint(b, act)
      break
    default:
      throw new Error(`${kind} is no act of the engine`)
  }
  return b.done()
}
