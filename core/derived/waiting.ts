// waitingFor (BUILD.md 3.5, D9): the one list behind `work waiting` and the decisions of the page.
// Each item says whom it waits for, where it shows (its Placement), when the page shows it (its
// hold, for the four page kinds), and the step that answers it. The kinds and their order are
// those of the old rows of `work waiting` and of the old decisions of the page; an irrelevant
// record (C2, C3, C6) is no item, because the states say so.
import type { Intent } from '../schema/actions.ts'
import type {
  Assignment,
  AssignmentId,
  Author,
  Direction,
  Revision,
  RoleName,
  Task,
  TaskId,
  Time,
  Work,
} from '../schema/index.ts'
import { canAct } from './can.ts'
import { decisionTaskOf, hostOf, placementOf, taskOfAnswer } from './catalog.ts'
import { openDrafts, suggestionsToDraft, waitsForNewDraft } from './drafts.ts'
import { roleWordsDrafts } from './role-words.ts'
import {
  answered,
  answeredItem,
  blockersOfResult,
  decisionWaitsOn,
  directionIdsOf,
  evaluationCounts,
  evaluationDecision,
  evaluationWaits,
  itemsOf,
  latestResultOf,
  refOf,
  resultAt,
  stopAnswered,
  stopKey,
  stopsOf,
  stopTask,
  taskOfTarget,
  within,
  workStop,
} from './reads.ts'
import { activeHostExists, fileTurn, followsDirection, highAbove, tierOfA } from './steps.ts'
import {
  type Derived,
  type Hold,
  isEndedTask,
  type NextStep,
  type Placement,
  type WaitingFor,
  type WaitingItem,
  type WaitingKind,
  type WaitsFor,
} from './types.ts'

type AssignmentParent = Assignment['parent']
type Bare = WaitingItem extends infer I ? (I extends WaitingItem ? Omit<I, 'step'> : never) : never

const person = (name: string): WaitsFor => ({ _tag: 'Person', name })
const actorOf = (f: WaitsFor): Author | undefined =>
  f._tag === 'Person'
    ? { _tag: 'Person', name: f.name, channel: 'terminal' }
    : f._tag === 'Assignment'
      ? { _tag: 'Agent', assignment: f.assignment }
      : undefined
// The step of a person's item: its intents that pass canAct; none left, and it waits.
const stepOf = (d: Derived, item: Bare, intents: ReadonlyArray<Intent>): NextStep => {
  const what = { _tag: 'PersonDecides' as const, kind: item._tag as WaitingKind, id: idOf(item) }
  const actor = actorOf(item.for)
  const allowed = intents.filter((i) => actor !== undefined && canAct(d, actor, i)._tag === 'May')
  const [one, ...rest] = allowed
  return one === undefined ? { _tag: 'Wait', what } : { _tag: 'Do', what, intents: [one, ...rest] }
}
// The id that a step of a person's item names (the old row's first id).
export const idOf = (item: Bare | WaitingItem): string => {
  switch (item._tag) {
    case 'Question':
      return item.question
    case 'Escalation':
      return item.escalation
    case 'Forward':
      return item.forward
    case 'DraftForPerson':
    case 'DraftForRole':
    case 'DraftVetoed':
    case 'RoleWords':
    case 'RoleWordsRejected':
      return item.draft
    case 'ChangePoint':
      return item.point
    case 'Stop':
      return item.stop.id
    case 'EvaluationForOwner':
      return item.evaluation
    case 'Suggestion':
      return item.suggestion
    case 'DecideResult':
      return item.result
    case 'IdleAssignment':
      return item.assignment
    case 'IdleTask':
      return item.task
    case 'OutsideNeed':
      return `${item.task} ${item.need}`
    case 'Problem':
      return item.problem
    case 'RunEnd':
      return item.run
    case 'BriefOver':
      return item.assignment
  }
}

const placed = (d: Derived, task: TaskId | undefined): Placement =>
  task === undefined ? { _tag: 'DirWide' } : placementOf(d.moment, task, d.states)
const topOf = (w: Work, t: Task): Task => {
  let top = t
  while (top.serves._tag === 'Serves') {
    const up = w.tasks.get(top.serves.task)
    if (up === undefined) break
    top = up
  }
  return top
}
const rolesOfTier = (w: Work, wanted: (tier: string | undefined) => boolean): RoleName[] =>
  [...w.workflow.roles.values()]
    .filter((r) => wanted(r._tag === 'Model' ? r.tier : undefined))
    .map((r) => r.role)
const give = (task: TaskId, roles: ReadonlyArray<RoleName>): ReadonlyArray<Intent> =>
  roles.map((role) => ({ _tag: 'Give', target: { task, role } }))

// When the page shows an item (decisionsOf): at once when it is raw (a forward, a problem that the
// UI recorded) or the host's own words, when the host wrote its words, when no host holds its
// placement (S11: the host of the placement; 10.10: any active host for an item of no project),
// or after hostWaitMinutes.
const holdOf = (d: Derived, id: string, placement: Placement, at: Time, raw: boolean): Hold => {
  const m = d.moment
  const waitMs = m.outside.settings.hostWaitMinutes * 60000
  const words = m.work.hostWords.get(id as never)
  const hosted =
    placement._tag === 'DirWide'
      ? activeHostExists(d)
      : hostOf(m, placement, d.states)._tag === 'Host'
  const late = Date.parse(m.at) - Date.parse(at) >= waitMs
  if (raw || words !== undefined || !hosted || late) return { _tag: 'Shown' }
  return { _tag: 'HeldForHost', until: new Date(Date.parse(at) + waitMs).toISOString() as Time }
}

// Every item that waits, in the old order: questions, escalations, forwards, the drafts of each
// direction, change points, stops and evaluations, suggestions, deciders, file waits, idle tasks,
// outside needs; then the problems and the ends of the page.
export const allItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const items: Array<WaitingItem> = []
  const add = (item: Bare, intents: ReadonlyArray<Intent>) =>
    items.push({ ...item, step: stepOf(d, item, intents) } as WaitingItem)

  // Questions and escalations, to the one that answers them now (C1, C2: Open only).
  for (const [id, state] of d.states.questions) {
    const q = w.questions.get(id)
    if (state._tag !== 'Open' || q === undefined) continue
    const f: WaitsFor =
      typeof state.answerer === 'string'
        ? { _tag: 'Assignment', assignment: state.answerer }
        : person(state.answerer.name)
    const intent: Intent = { _tag: 'Answer', target: { question: id } }
    add({ _tag: 'Question', question: id, for: f, placement: placed(d, q.stops), at: q.when }, [
      intent,
    ])
  }
  for (const [id, state] of d.states.escalations) {
    const v = w.reviews.get(id)
    if (state._tag !== 'Open' || v?._tag !== 'Escalate') continue
    const f: WaitsFor =
      typeof state.answerer === 'string'
        ? { _tag: 'Assignment', assignment: state.answerer }
        : person(state.answerer.name)
    const placement = placed(d, resultAt(w, v.of).task)
    const item: Bare = {
      _tag: 'Escalation',
      escalation: id,
      result: v.of,
      for: f,
      placement,
      at: v.when,
    }
    add(item, [{ _tag: 'Resolve', target: { escalation: id } }])
  }
  // A relayed act that waits for its person's confirm (C6: an irrelevant one is gone).
  for (const [ref, state] of d.states.forwards) {
    if (state._tag !== 'Waiting') continue
    const logged = w.events.find((l) => refOf(l.recorded.seq) === ref)
    const e = logged?.recorded.event
    if (logged === undefined || e?._tag !== 'Forward' || !('create' in e)) continue
    const author = logged.recorded.author
    const of = author._tag === 'Agent' ? w.assignments.get(author.assignment)?.task : undefined
    const placement = placed(d, of)
    const at = logged.recorded.at
    const hold = holdOf(d, ref, placement, at, true)
    const item: Bare = {
      _tag: 'Forward',
      forward: ref,
      hold,
      for: person(e.create.person),
      placement,
      at,
    }
    add(item, [{ _tag: 'Confirm', target: { forward: ref } }])
  }
  items.push(...draftItems(d))
  items.push(...roleWordsItems(d))
  items.push(...changeItems(d))
  items.push(...stopItems(d))
  items.push(...suggestionItems(d))
  items.push(...deciderItems(d))
  items.push(...idleItems(d))
  items.push(...briefItems(d))
  items.push(...pageItems(d))
  return items
}

// The drafts of each direction: a vetoed one that waits for a new draft, a draft that waits for
// a role's accept, a draft that waits for a person (S2: the owner's own accept too).
const draftItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const out: Array<WaitingItem> = []
  const add = (item: Bare, intents: ReadonlyArray<Intent>) =>
    out.push({ ...item, step: stepOf(d, item, intents) } as WaitingItem)
  const directions = [...w.directions.values()].sort(
    (a, b) => Number(b._tag === 'Official') - Number(a._tag === 'Official'),
  )
  for (const dir of directions) {
    const owner = person(dir.owner.name)
    for (const x of w.drafts.values()) {
      const state = d.states.revisions.get(x.id)
      if (x.of !== dir.id || state?._tag !== 'Vetoed' || !waitsForNewDraft(d, x)) continue
      const placement = placed(d, answeredTask(w, x))
      const item: Bare = {
        _tag: 'DraftVetoed',
        draft: x.id,
        reject: state.by,
        for: owner,
        placement,
        at: x.when,
      }
      add(item, reviseAgain(d, x))
    }
    for (const x of openDrafts(d, dir.id)) {
      const state = d.states.revisions.get(x.id)
      if (state?._tag !== 'Waiting') continue
      const placement = placed(d, answeredTask(w, x))
      const top = [...w.tasks.values()].find(
        (t) =>
          !isEndedTask(d.states.tasks.get(t.id) ?? { _tag: 'Closed' }) &&
          t.serves._tag === 'TopTask' &&
          directionIdsOf(w, t.id).includes(dir.id),
      )
      for (const leaf of state.waitsFor) {
        if (leaf._tag !== 'Role') continue
        const reviewer = reviewerOf(d, x, leaf.role)
        const item: Bare = {
          _tag: 'DraftForRole',
          draft: x.id,
          role: leaf.role,
          reviewer:
            reviewer === undefined
              ? { _tag: 'NoReviewer' }
              : { _tag: 'Reviewer', assignment: reviewer },
          for: owner,
          placement,
          at: x.when,
        }
        add(item, reviewer === undefined && top !== undefined ? give(top.id, [leaf.role]) : [])
      }
      const named = new Set<string>()
      for (const leaf of state.waitsFor) {
        if (leaf._tag === 'Role') continue
        const name = leaf._tag === 'OwnerAccept' ? leaf.owner.name : leaf.name
        if (named.has(name)) continue
        named.add(name)
        const hold = holdOf(d, x.id, placement, x.when, false)
        const of = { _tag: 'Revision', id: x.id } as const
        const item: Bare = {
          _tag: 'DraftForPerson',
          draft: x.id,
          leaf,
          hold,
          for: person(name),
          placement,
          at: x.when,
        }
        add(item, [
          { _tag: 'Accept', target: { of } },
          { _tag: 'Reject', target: { of } },
        ])
      }
    }
  }
  return out
}
// New words of a role (ruling 2026-11-14): a draft that waits for the person shows at once (no
// host writes words about it); a rejected draft waits for a newer draft of its role, by its
// drafter while that agent is open, else by the person, who gives the work to a high role.
const roleWordsItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const out: Array<WaitingItem> = []
  const add = (item: Bare, intents: ReadonlyArray<Intent>) =>
    out.push({ ...item, step: stepOf(d, item, intents) } as WaitingItem)
  const owner = person(w.workflow.owner.name)
  const placement: Placement = { _tag: 'DirWide' }
  const drafts = roleWordsDrafts(w)
  for (const x of drafts) {
    const state = d.states.roleWords.get(x.ref)
    const of = { draft: x.ref, role: x.role, placement, at: x.at }
    if (state?._tag === 'Waiting') {
      const hold = holdOf(d, x.ref, placement, x.at, true)
      add({ _tag: 'RoleWords', ...of, hold, for: owner }, [
        { _tag: 'AcceptRoleWords', target: { draft: x.ref } },
        { _tag: 'RejectRoleWords', target: { draft: x.ref } },
      ])
    }
    const latest = drafts.findLast((y) => y.role === x.role)?.ref === x.ref
    if (state?._tag !== 'Rejected' || !latest) continue
    const agent = x.by._tag === 'Agent' ? x.by.assignment : undefined
    const open = agent !== undefined && d.states.assignments.get(agent)?._tag !== 'Ended'
    const drafter: WaitsFor = open ? { _tag: 'Assignment', assignment: agent } : owner
    const again: ReadonlyArray<Intent> = open
      ? [{ _tag: 'DraftRoleWords', target: { role: x.role } }]
      : []
    add({ _tag: 'RoleWordsRejected', ...of, for: drafter }, again)
  }
  return out
}

// The task that a draft answers (its first Reject of a task or a result), for its placement.
const answeredTask = (w: Work, x: Revision<Direction>): TaskId | undefined =>
  x.answers.map((a) => taskOfAnswer(w, a)).find((t) => t !== undefined)
// An open assignment of a role outside the reviser's tree that follows the direction.
const reviewerOf = (
  d: Derived,
  x: Revision<Direction>,
  role: RoleName,
): AssignmentId | undefined => {
  const w = d.moment.work
  const reviser = x.origin._tag === 'Written' ? x.origin.by : undefined
  const inTree = (id: AssignmentId) => {
    for (let z: AssignmentId | undefined = id; z !== undefined;) {
      if (z === reviser) return true
      const p: AssignmentParent | undefined = w.assignments.get(z)?.parent
      z = p?._tag === 'Parent' ? p.id : undefined
    }
    return false
  }
  return [...w.assignments.values()].find(
    (y) =>
      d.states.assignments.get(y.id)?._tag !== 'Ended' &&
      y.role === role &&
      !inTree(y.id) &&
      followsDirection(d, y, x.of) &&
      !itemsOf(w, x.id).some((r) => r.by === y.id),
  )?.id
}
// After a decider's veto: its reviser revises again; a finished reviser's role is assigned anew.
const reviseAgain = (d: Derived, x: Revision<Direction>): ReadonlyArray<Intent> => {
  const w = d.moment.work
  if (x.origin._tag !== 'Written' || typeof x.origin.by !== 'string') return []
  const reviser = w.assignments.get(x.origin.by)
  if (reviser === undefined || d.states.assignments.get(reviser.id)?._tag !== 'Ended') return []
  const next = [...w.assignments.values()].some(
    (y) =>
      d.states.assignments.get(y.id)?._tag !== 'Ended' &&
      tierOfA(w, y) === 'high' &&
      followsDirection(d, y, x.of),
  )
  if (next) return []
  const top = [...w.tasks.values()].find(
    (t) =>
      d.states.tasks.get(t.id) !== undefined &&
      !isEndedTask(d.states.tasks.get(t.id) ?? { _tag: 'Closed' }) &&
      t.serves._tag === 'TopTask' &&
      directionIdsOf(w, t.id).includes(x.of),
  )
  return top === undefined ? [] : give(top.id, [reviser.role])
}

// The points that only a direction change, a split or a remake answers.
const changeItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const out: Array<WaitingItem> = []
  const seen = new Set<string>()
  const openTasks = [...w.tasks.values()].filter((t) => {
    const s = d.states.tasks.get(t.id)
    return s !== undefined && !isEndedTask(s) && s._tag !== 'Accepted'
  })
  const points: Array<{ readonly t: Task; readonly point: string }> = []
  for (const t of openTasks) {
    const result = latestResultOf(w, t.id)
    if (!result || evaluationWaits(w, t.id) !== undefined) continue
    for (const b of blockersOfResult(w, result.id)) {
      if (b._tag !== 'Change' && b._tag !== 'Reject') continue
      const ref = itemsOf(w, result.id).find((i) => i.id === b.ref)
      if (!ref) continue
      if (b._tag === 'Reject' && (ref.breaks !== undefined || answered(w, ref.id))) continue
      points.push({ t, point: ref.id })
    }
  }
  for (const t of openTasks.filter((x) => evaluationWaits(w, x.id) === undefined)) {
    for (const r of itemsOf(w, t.id)) {
      if (r.decision !== 'Reject' || r.redo || answeredItem(w, r)) continue
      if (points.some(({ point }) => point === r.id)) continue
      points.push({ t, point: r.id })
    }
  }
  for (const { t, point } of points) {
    if (seen.has(point)) continue
    seen.add(point)
    const item = itemsOf(w, t.id).find((i) => i.id === point) ?? undefined
    const own = item === undefined || taskOfTarget(w, item.of) === t.id
    const parts = [...w.tasks.values()].some(
      (p) => p.serves._tag === 'Serves' && p.serves.task === t.id && openTasks.includes(p),
    )
    const oneUnit = parts || t.descriptionAi.context.section._tag === 'Section'
    const answers = point as never
    const change: ReadonlyArray<Intent> = own
      ? [
          oneUnit
            ? { _tag: 'RemakeTask', target: { task: t.id, answers } }
            : { _tag: 'SplitTask', target: { task: t.id, answers } },
        ]
      : []
    const suggest: ReadonlyArray<Intent> = directionIdsOf(w, t.id)
      .filter((x) => openDrafts(d, x).length === 0)
      .map((direction) => ({
        _tag: 'Suggest',
        target: { about: { _tag: 'Direction', direction } },
      }))
    const bare: Bare = {
      _tag: 'ChangePoint',
      task: t.id,
      point: point as never,
      for: person(t.owner.name),
      placement: placed(d, t.id),
      at: t.when,
    }
    out.push({ ...bare, step: stepOf(d, bare, [...change, ...suggest]) } as WaitingItem)
  }
  return out
}

// A task that waits for an evaluation, or for the change that its evaluation asks for.
const stopItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const out: Array<WaitingItem> = []
  const highRoles = rolesOfTier(w, (tier) => tier === 'high')
  for (const t of w.tasks.values()) {
    const s = d.states.tasks.get(t.id)
    if (s === undefined || isEndedTask(s) || s._tag === 'Accepted' || !workStop(w, t.id)) continue
    const owner = person(t.owner.name)
    const placement = placed(d, t.id)
    const stops = stopsOf(w, t.id).filter((x) => !stopAnswered(w, x))
    const highOpen = [...w.assignments.values()].some(
      (x) =>
        d.states.assignments.get(x.id)?._tag !== 'Ended' &&
        tierOfA(w, x) === 'high' &&
        within(w, t.id, x.task),
    )
    const top = topOf(w, t)
    if (stops.length === 0) {
      // Evaluated: the task waits for the change that its evaluation asks for.
      const e = [...w.evaluations.values()]
        .filter((x) => stopTask(w, x.answers) === t.id && evaluationCounts(w, x))
        .at(-1)
      const changing =
        [...w.tasks.values()].some(
          (p) =>
            p.serves._tag === 'Serves' &&
            p.serves.task === t.id &&
            !isEndedTask(d.states.tasks.get(p.id) ?? { _tag: 'Closed' }),
        ) || directionIdsOf(w, t.id).some((x) => openDrafts(d, x).length > 0)
      if (!e || changing) continue
      const directions = directionIdsOf(w, t.id)
      const intents: ReadonlyArray<Intent> =
        e.level === 'task' || directions.length === 0
          ? [{ _tag: 'RemakeTask', target: { task: t.id, answers: null } }]
          : directions.map((direction) => ({
              _tag: 'Suggest',
              target: { about: { _tag: 'Direction', direction } },
            }))
      const bare: Bare = {
        _tag: 'Stop',
        task: t.id,
        stop: e.answers,
        for: owner,
        placement,
        at: e.when,
      }
      out.push({ ...bare, step: stepOf(d, bare, intents) } as WaitingItem)
      continue
    }
    for (const stop of stops) {
      const pending = [...w.evaluations.values()]
        .filter(
          (e) =>
            stopKey(w, e.answers) === stopKey(w, stop) &&
            !evaluationDecision(w, e) &&
            !evaluationCounts(w, e),
        )
        .at(-1)
      if (pending !== undefined) {
        const of = { _tag: 'Evaluation', id: pending.id } as const
        const bare: Bare = {
          _tag: 'EvaluationForOwner',
          evaluation: pending.id,
          for: owner,
          placement,
          at: pending.when,
        }
        const intents: ReadonlyArray<Intent> = [
          { _tag: 'Accept', target: { of } },
          { _tag: 'Reject', target: { of } },
        ]
        out.push({ ...bare, step: stepOf(d, bare, intents) } as WaitingItem)
        continue
      }
      if (highOpen) continue
      const bare: Bare = { _tag: 'Stop', task: t.id, stop, for: owner, placement, at: t.when }
      const intents: ReadonlyArray<Intent> = [
        { _tag: 'Evaluate', target: { stop } },
        ...give(top.id, highRoles),
      ]
      out.push({ ...bare, step: stepOf(d, bare, intents) } as WaitingItem)
    }
  }
  return out
}

// A suggestion that no open high role can answer, and one that asks for a new direction.
const suggestionItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const out: Array<WaitingItem> = []
  const highRoles = rolesOfTier(w, (tier) => tier === 'high')
  for (const { y, direction } of suggestionsToDraft(d)) {
    const dir = w.directions.get(direction)
    if (dir === undefined) continue
    const top = [...w.tasks.values()].find(
      (t) =>
        !isEndedTask(d.states.tasks.get(t.id) ?? { _tag: 'Closed' }) &&
        t.serves._tag === 'TopTask' &&
        directionIdsOf(w, t.id).includes(direction),
    )
    const external = dir.source._tag === 'External'
    const highWorks = [...w.assignments.values()].some(
      (x) =>
        d.states.assignments.get(x.id)?._tag !== 'Ended' &&
        tierOfA(w, x) === 'high' &&
        followsDirection(d, x, direction),
    )
    if (!external && highWorks) continue
    const bare: Bare = {
      _tag: 'Suggestion',
      suggestion: y.id,
      about: { _tag: 'Direction', direction },
      for: person(dir.owner.name),
      placement: placed(d, top?.id),
      at: y.when,
    }
    const intents = external || top === undefined ? [] : give(top.id, highRoles)
    out.push({ ...bare, step: stepOf(d, bare, intents) } as WaitingItem)
  }
  // A new direction: a model run outside any task drafts it; each person sees it.
  for (const y of w.suggestions.values()) {
    if (y.about._tag !== 'NewDirection' || draftedNew(d, y.id)) continue
    const bare: Bare = {
      _tag: 'Suggestion',
      suggestion: y.id,
      about: { _tag: 'NewDirection' },
      for: person(w.workflow.owner.name),
      placement: { _tag: 'DirWide' },
      at: y.when,
    }
    out.push({ ...bare, step: stepOf(d, bare, []) } as WaitingItem)
  }
  return out
}
const draftedNew = (d: Derived, id: string): boolean =>
  [...d.moment.work.drafts.values()].some((x) => {
    if (!x.answers.includes(id as never)) return false
    const state = d.states.revisions.get(x.id)?._tag
    return (
      state === 'Official' || state === 'Waiting' || (state === 'Vetoed' && waitsForNewDraft(d, x))
    )
  })

// A result whose decision waits for a role that no open assignment plays.
const deciderItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const out: Array<WaitingItem> = []
  const deciderTags = ['DeciderWaits', 'DeciderAnyApprover', 'DeciderAcceptedUnderOld']
  const open = (id: AssignmentId) => d.states.assignments.get(id)?._tag !== 'Ended'
  const leads = rolesOfTier(w, (tier) => tier !== undefined && tier !== 'low')
  for (const t of w.tasks.values()) {
    const s = d.states.tasks.get(t.id)
    if (s === undefined || isEndedTask(s) || s._tag === 'Accepted') continue
    const result = latestResultOf(w, t.id)
    if (!result) continue
    if (!blockersOfResult(w, result.id).every((i) => deciderTags.includes(i._tag))) continue
    for (const leaf of decisionWaitsOn(w, result.id)) {
      if (leaf._tag !== 'Role') continue
      const role = leaf.role
      const plays = [...w.assignments.values()].some(
        (x) => open(x.id) && x.role === role && within(w, t.id, x.task),
      )
      if (plays) continue
      const top = topOf(w, t)
      const low = w.workflow.roles.get(role)
      const isLow = low?._tag === 'Model' && low.tier === 'low'
      if (isLow) {
        const leadWorks = [...w.assignments.values()].some(
          (x) => open(x.id) && tierOfA(w, x) !== 'low' && within(w, t.id, x.task),
        )
        if (leadWorks) continue
      }
      const bare: Bare = {
        _tag: 'DecideResult',
        result: result.id,
        leaf,
        for: person(t.owner.name),
        placement: placed(d, t.id),
        at: result.when,
      }
      out.push({
        ...bare,
        step: stepOf(d, bare, give(top.id, isLow ? leads : [role])),
      } as WaitingItem)
    }
  }
  return out
}

// A maker that waits for a file; a task that no open assignment works on; a need of another tree.
const idleItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const out: Array<WaitingItem> = []
  const open = (id: AssignmentId) => d.states.assignments.get(id)?._tag !== 'Ended'
  const taskOpen = (id: TaskId) => {
    const s = d.states.tasks.get(id)
    return s !== undefined && !isEndedTask(s)
  }
  for (const y of w.assignments.values()) {
    const task = w.tasks.get(y.task)
    if (!open(y.id) || task === undefined || !taskOpen(task.id)) continue
    // Ruling 10.2: the maker before it writes now, so the person has nothing to do but wait.
    const waits = fileTurn(d, y.id)
    if (!waits) continue
    const bare: Bare = {
      _tag: 'IdleAssignment',
      assignment: y.id,
      before: waits.before,
      file: waits.file,
      for: person(task.owner.name),
      placement: placed(d, task.id),
      at: y.when,
    }
    out.push({ ...bare, step: stepOf(d, bare, []) } as WaitingItem)
  }
  const openTasks = [...w.tasks.values()].filter(
    (t) => taskOpen(t.id) && d.states.tasks.get(t.id)?._tag !== 'Accepted',
  )
  const idle = openTasks.filter(
    (t) => ![...w.assignments.values()].some((x) => open(x.id) && within(w, t.id, x.task)),
  )
  const leads = rolesOfTier(w, (tier) => tier !== undefined && tier !== 'low')
  const parentIdle = (t: Task) =>
    t.serves._tag === 'Serves' && idle.some((i) => i.id === (t.serves as { task: TaskId }).task)
  for (const t of idle.filter((x) => !parentIdle(x))) {
    const bare: Bare = {
      _tag: 'IdleTask',
      task: t.id,
      for: person(t.owner.name),
      placement: placed(d, t.id),
      at: t.when,
    }
    out.push({ ...bare, step: stepOf(d, bare, give(t.id, leads)) } as WaitingItem)
  }
  for (const t of openTasks) {
    for (const id of t.needs) {
      const n = w.tasks.get(id)
      if (n === undefined || !taskOpen(n.id)) continue
      if (topOf(w, n).id === topOf(w, t).id || d.states.tasks.get(n.id)?._tag === 'Accepted')
        continue
      const bare: Bare = {
        _tag: 'OutsideNeed',
        task: t.id,
        need: n.id,
        for: person(t.owner.name),
        placement: placed(d, t.id),
        at: t.when,
      }
      out.push({ ...bare, step: stepOf(d, bare, []) } as WaitingItem)
    }
  }
  return out
}

// Ruling 10.9: a brief over its limit with no high role above it: the owner of its task splits
// the task (a person suggests a direction change in words; a high role writes it).
const briefItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  return [...w.assignments.values()].flatMap((x): ReadonlyArray<WaitingItem> => {
    const t = w.tasks.get(x.task)
    if (d.states.assignments.get(x.id)?._tag !== 'BriefOver' || t === undefined) return []
    if (highAbove(d, x) !== undefined) return []
    const bare: Bare = {
      _tag: 'BriefOver',
      assignment: x.id,
      task: t.id,
      for: person(t.owner.name),
      placement: placed(d, t.id),
      at: x.when,
    }
    const split: Intent = { _tag: 'SplitTask', target: { task: t.id, answers: null } }
    return [{ ...bare, step: stepOf(d, bare, [split]) } as WaitingItem]
  })
}

// The page's own kinds: a system problem (C3, S12: Open only) and the end of a project.
const pageItems = (d: Derived): ReadonlyArray<WaitingItem> => {
  const w = d.moment.work
  const out: Array<WaitingItem> = []
  for (const [id, state] of d.states.problems) {
    const p = w.problems.get(id)
    if (state._tag !== 'Open' || p === undefined) continue
    const task = decisionTaskOf(w, id)
    const placement = placed(d, task)
    const raw = p.recordedBy._tag !== 'Host'
    const hold = holdOf(d, id, placement, p.at, raw || p.recordedBy._tag === 'Host')
    const owner = w.tasks.get(p.stopped)?.owner.name ?? w.workflow.owner.name
    const bare: Bare = {
      _tag: 'Problem',
      problem: id,
      hold,
      for: person(owner),
      placement,
      at: p.at,
    }
    out.push({
      ...bare,
      step: stepOf(d, bare, [{ _tag: 'FixProblem', target: { problem: id } }]),
    } as WaitingItem)
  }
  for (const [id, state] of d.states.runs) {
    if (state._tag !== 'AwaitingEndAccept') continue
    const top = state.top
    const last = latestResultOf(w, top)
    const accept = last
      ? itemsOf(w, last.id)
          .filter((v) => v.decision === 'Accept')
          .at(-1)
      : undefined
    const at = last ? (accept?.when ?? last.when) : d.moment.at
    const placement: Placement = { _tag: 'OnTask', task: top }
    const hold = holdOf(d, id, placement, at, false)
    const owner = w.tasks.get(top)?.owner.name ?? w.workflow.owner.name
    const bare: Bare = { _tag: 'RunEnd', run: id, top, hold, for: person(owner), placement, at }
    const intents: ReadonlyArray<Intent> = [
      { _tag: 'EndRun', target: { run: id } },
      { _tag: 'Reject', target: { of: { _tag: 'Task', id: top } } },
    ]
    out.push({ ...bare, step: stepOf(d, bare, intents) } as WaitingItem)
  }
  return out
}

// A new direction asks every person of the config; any other item asks the one it names.
const matches = (w: Work, item: WaitingItem, name: string): boolean => {
  if (item._tag === 'Suggestion' && item.about._tag === 'NewDirection') {
    return w.config.people.includes(name)
  }
  return item.for._tag === 'Person' && item.for.name === name
}

export const waitingFor: WaitingFor = (d, who) => {
  const items = allItems(d)
  if (who._tag === 'Everyone') return items
  return items.filter((i) => matches(d.moment.work, i, who.name))
}
