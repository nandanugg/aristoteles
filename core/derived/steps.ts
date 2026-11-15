// nextFor and stepKey (BUILD.md 3.5, D8, D14): the steps of `work next` for an agent, in the old
// order of `work next`, read from the derived states. A Do step holds the intents that the
// actor may run; each one passes canAct (nextFor drops the others, and a step with none waits).
// The bookkeeping steps of D14 are gone: no finish of a child of an ended task, no finish in an
// ended task, no finish of a child after an accept (C1, I2).
import type { Intent } from '../schema/actions.ts'
import { isMarked } from '../schema/index.ts'
import type {
  Assignment,
  AssignmentId,
  Blocker,
  DirectionId,
  NonEmpty,
  PointId,
  ResultId,
  RevisionId,
  RoleName,
  Task,
  TaskId,
  Work,
} from '../schema/index.ts'
import { canAct } from './can.ts'
import { leafName, turnOf } from './deciders.ts'
import {
  answered,
  blockersOfResult,
  deciderOf,
  decidesNow,
  decidesResults,
  decidingNow,
  decisionWaitsOn,
  directionIdsOf,
  evaluationCounts,
  evaluationDecision,
  isDo,
  itemAt,
  latestResultOf,
  mayChange,
  reviewsOf,
  sameRole,
  stopAnswered,
  stopKey,
  stopsOf,
  stopTask,
  unresolvedEscalationItems,
  within,
  workStop,
  oneUnit as isOneUnit,
  assignsOf,
  holdsA,
  leads,
  roleOfA,
} from './reads.ts'
import { rolesSuggestionsWaiting } from './adjustments.ts'
import type { Derived, Idle, NextFor, NextStep, StepKey, StepWhat } from './types.ts'
import { isEndedTask } from './types.ts'
import {
  newDirectionsToDraft,
  openDrafts,
  suggestionsToDraft,
  waitsForNewDraft,
} from './drafts.ts'
import {
  authorAssignment,
  authorOf,
  dirDrafters,
  explainerOf,
  explains,
  redrafterOf,
  redrafters,
} from './authors.ts'
import { noticesOf } from './notices.ts'
import { waitingFor } from './waiting.ts'

// A step before canAct: what it is, and the intents that would do it (none: the step waits).
export interface Candidate {
  readonly what: StepWhat
  readonly intents: ReadonlyArray<Intent>
}
const wait = (what: StepWhat): Candidate => ({ what, intents: [] })
const act = (what: StepWhat, ...intents: ReadonlyArray<Intent>): Candidate => ({ what, intents })

const nonEmpty = <A>(list: ReadonlyArray<A>): NonEmpty<A> | undefined => {
  const [one, ...rest] = list
  return one === undefined ? undefined : [one, ...rest]
}
const parentId = (a: Assignment): AssignmentId | undefined =>
  a.parent._tag === 'Parent' ? a.parent.id : undefined
// x is above a: its parent, at any depth.
const isAbove = (w: Work, x: AssignmentId, a: Assignment): boolean => {
  for (let y = parentId(a); y !== undefined;) {
    if (y === x) return true
    const up = w.assignments.get(y)
    y = up === undefined ? undefined : parentId(up)
  }
  return false
}
// The roles that an assignment gives work to: those of its role's assign act.
export const assignable = (w: Work, a: Assignment) =>
  assignsOf(roleOfA(w, a)).flatMap((name) => {
    const r = w.workflow.roles.get(name)
    return r?._tag === 'Model' ? [r] : []
  })
const sectionOf = (t: Task): string | null =>
  t.descriptionAi.context.section._tag === 'Section' ? t.descriptionAi.context.section.id : null
const claimedSince = (w: Work, a: AssignmentId) => {
  const claim = w.meta.get(a)?.claim
  return claim === undefined || claim._tag === 'Free' ? undefined : claim.since
}

// --- the states as the steps read them -----------------------------------------------------------

const ended = (d: Derived, a: AssignmentId): boolean =>
  d.states.assignments.get(a)?._tag === 'Ended'
const taskOpen = (d: Derived, t: TaskId): boolean => {
  const s = d.states.tasks.get(t)
  return s !== undefined && !isEndedTask(s)
}
const taskAccepted = (d: Derived, t: TaskId): boolean => d.states.tasks.get(t)?._tag === 'Accepted'
// A maker that may make a result now (the old openDo): Working, not out of tries.
const makesNow = (d: Derived, a: Assignment): boolean => {
  const s = d.states.assignments.get(a.id)
  return isDo(d.moment.work, a.role) && s?._tag === 'Working'
}
// An assignment whose tree has an open task that follows the direction.
export const followsDirection = (d: Derived, a: Assignment, direction: DirectionId): boolean => {
  const w = d.moment.work
  return [...w.tasks.values()].some(
    (t) =>
      taskOpen(d, t.id) && within(w, t.id, a.task) && directionIdsOf(w, t.id).includes(direction),
  )
}
// B2: a company direction changes in its repo; a revise step names only local directions.
const localDirections = (w: Work, task: TaskId): ReadonlyArray<DirectionId> =>
  directionIdsOf(w, task).filter((d) => w.directions.get(d)?.source._tag === 'Local')
const revise = (directions: ReadonlyArray<DirectionId>): ReadonlyArray<Intent> =>
  directions.map((direction) => ({ _tag: 'ReviseDirection', target: { direction } }))
const giveEach = (task: TaskId, roles: ReadonlyArray<RoleName>): ReadonlyArray<Intent> =>
  roles.map((role) => ({ _tag: 'Give', target: { task, role } }))

// --- the file turn (ruling 10.2: derived; one maker writes a file at a time) ---------------------

const writesInPlace = (w: Work, a: Assignment): ReadonlyArray<string> =>
  w.config.roles[a.role]?.output?.includes('@')
    ? []
    : (w.tasks.get(a.task)?.descriptionAi.workspace ?? []).map((x) => x.path)
const overlap = (x: string, y: string): boolean =>
  x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
// Why a Working maker makes no result now, for a reason that can change back.
export const idleOf = (d: Derived, x: AssignmentId): Idle | undefined => {
  const w = d.moment.work
  const maker = w.assignments.get(x)
  if (maker === undefined || d.states.assignments.get(x)?._tag !== 'Working') return undefined
  const task = maker.task
  if (workStop(w, task)) return { _tag: 'WaitsForEvaluation', task }
  const need = w.tasks.get(task)?.needs.find((n) => !taskAccepted(d, n))
  return need === undefined ? undefined : { _tag: 'NeedsTask', task, need }
}
// A maker that may write now holds its turn: Working and not idle. An idle one gives the turn up
// at once; a Settled one reserves none; OutOfTries and Ended hold none.
const holdsTurn = (d: Derived, a: Assignment): boolean =>
  isDo(d.moment.work, a.role) &&
  d.states.assignments.get(a.id)?._tag === 'Working' &&
  idleOf(d, a.id) === undefined
// First come: a maker whose brief claims the file comes before one with no claim; of two claims,
// the later one took the file while the other was away; else the order of the assigns.
const heldSince = (w: Work, a: AssignmentId): string | undefined => {
  const claim = w.meta.get(a)?.claim
  return claim?._tag === 'Held' ? claim.since : undefined
}
// order: the ids of the assignments in the order of the assigns.
const comesFirst = (
  w: Work,
  order: ReadonlyArray<AssignmentId>,
  x: AssignmentId,
  a: AssignmentId,
): boolean => {
  const [sx, sa] = [heldSince(w, x), heldSince(w, a)]
  if (sx !== undefined && sa !== undefined && sx !== sa) return sx > sa
  if ((sx === undefined) !== (sa === undefined)) return sx !== undefined
  return order.indexOf(x) < order.indexOf(a)
}
// The file that maker `a` waits for, and the maker that writes it now. A maker that does not work
// (Settled, OutOfTries, Ended) waits for no file.
export const fileTurn = (
  d: Derived,
  a: AssignmentId,
): { readonly before: AssignmentId; readonly file: string } | undefined => {
  const w = d.moment.work
  const me = w.assignments.get(a)
  if (me === undefined || !isDo(w, me.role)) return undefined
  if (d.states.assignments.get(a)?._tag !== 'Working') return undefined
  const files = writesInPlace(w, me)
  const turns = [...w.assignments.values()].flatMap((x) => {
    if (x.id === a || !holdsTurn(d, x)) return []
    const file = writesInPlace(w, x).flatMap((f) => files.filter((g) => overlap(f, g)))[0]
    return file === undefined ? [] : [{ before: x.id, file }]
  })
  const order = [...w.assignments.keys()]
  const [first] = [...turns].sort((x, y) => (comesFirst(w, order, x.before, y.before) ? -1 : 1))
  return first !== undefined && comesFirst(w, order, first.before, a) ? first : undefined
}
export const waitersOf = (d: Derived, x: AssignmentId): ReadonlyArray<AssignmentId> =>
  [...d.moment.work.assignments.values()]
    .filter((y) => fileTurn(d, y.id)?.before === x)
    .map((y) => y.id)

// --- a brief over its limit (ruling 10.9) --------------------------------------------------------

// The nearest assignment above x that splits and may act (not Ended, its own brief fits);
// none: the owner of its task decides.
export const splitterAbove = (d: Derived, x: Assignment): Assignment | undefined => {
  const w = d.moment.work
  for (let y = parentId(x); y !== undefined;) {
    const up = w.assignments.get(y)
    if (up === undefined) return undefined
    const waits = d.states.assignments.get(up.id)?._tag === 'BriefOver'
    if (!ended(d, up.id) && !waits && holdsA(w, up, 'Split')) return up
    y = parentId(up)
  }
  return undefined
}
// The drafts of the directions of a task that wait for a decision. A brief over its limit waits
// on them, so their ids and the size are in the key of its steps: a decision, or a new size, ends
// a work wait (Nanda, 2026-11-15: an accept woke no one).
const openDraftsOfTask = (d: Derived, task: TaskId): ReadonlyArray<RevisionId> =>
  directionIdsOf(d.moment.work, task).flatMap((dir) => openDrafts(d, dir).map((x) => x.id))
const briefOver = (d: Derived, x: Assignment): Candidate | undefined => {
  const s = d.states.assignments.get(x.id)
  if (s?._tag !== 'BriefOver') return undefined
  const what: StepWhat = {
    _tag: 'BriefOverWaits',
    assignment: x.id,
    task: x.task,
    size: s.size,
    limit: s.limit,
    drafts: openDraftsOfTask(d, x.task),
  }
  return wait(what)
}
// The role above that splits shortens the directions of the task (B2: only local ones), or
// splits the task (remakes one unit of work).
const shortenSteps = (d: Derived, a: Assignment): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  return [...w.assignments.values()].flatMap((x): ReadonlyArray<Candidate> => {
    const s = d.states.assignments.get(x.id)
    if (s?._tag !== 'BriefOver' || splitterAbove(d, x)?.id !== a.id) return []
    const directions = localDirections(w, x.task)
    const what: StepWhat = {
      _tag: 'ShortenOrSplit',
      assignment: x.id,
      task: x.task,
      size: s.size,
      limit: s.limit,
      directions,
      drafts: openDraftsOfTask(d, x.task),
    }
    const t = w.tasks.get(x.task)
    // B1: one unit of work is remade, not split.
    const change: Intent =
      t !== undefined && isOneUnit(w, t)
        ? { _tag: 'RemakeTask', target: { task: x.task, answers: null } }
        : { _tag: 'SplitTask', target: { task: x.task, answers: null } }
    return [act(what, ...revise(directions), change)]
  })
}

// --- the words of a draft for the person (ruling 10.10) -----------------------------------------

// Each draft that waits for a person and has no words of a host yet: the host of its project
// writes them; a draft from no project goes to every active host, and the first words end it.
const explainSteps = (d: Derived, a: Assignment): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  const seen = new Set<string>()
  return waitingFor(d, { _tag: 'Everyone' }).flatMap((item): ReadonlyArray<Candidate> => {
    if (item._tag !== 'DraftForPerson' || seen.has(item.draft)) return []
    seen.add(item.draft)
    const draft = w.drafts.get(item.draft)
    if (draft === undefined || w.hostWords.has(item.draft)) return []
    const on = { _tag: 'Draft', id: draft.id } as const
    if (authorOf(w, draft)._tag === 'Host' || !explains(explainerOf(d, on), a.id)) return []
    const dirWide = item.placement._tag === 'DirWide'
    const what: StepWhat = { _tag: 'ExplainDraft', draft: draft.id, direction: draft.of, dirWide }
    return [act(what, { _tag: 'WriteHostWords', target: { on } })]
  })
}

// What no task follows (P1): a company draft of a new direction that misses examples, which a
// model adds before the person's accept (P10 rejected, onboarding 2026-11-14); a suggestion for a
// new direction, which it drafts; the person's words about the roles, which it drafts as an
// adjustment (P7). Each goes to the drafters of dirDrafters.
const dirSteps = (d: Derived, a: Assignment): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  if (!dirDrafters(d).includes(a.id)) return []
  const steps: Array<Candidate> = []
  for (const x of w.drafts.values()) {
    if (x._tag !== 'New' || x.flow.some(isMarked)) continue
    if (d.states.revisions.get(x.id)?._tag !== 'Waiting') continue
    const what: StepWhat = { _tag: 'AddExamples', draft: x.id, direction: x.of }
    steps.push(act(what, { _tag: 'AddExamples', target: { draft: x.id } }))
  }
  for (const y of newDirectionsToDraft(d)) {
    const what: StepWhat = { _tag: 'DraftNewDirection', suggestion: y.id }
    steps.push(act(what, { _tag: 'DraftDirection', target: {} }))
  }
  for (const y of rolesSuggestionsWaiting(w)) {
    const what: StepWhat = { _tag: 'AnswerRolesSuggestion', suggestion: y.id }
    steps.push(act(what, { _tag: 'DraftAdjustment', target: {} }))
  }
  return steps
}

// --- the steps of an agent -----------------------------------------------------------------------

// The candidate steps of a lead assignment, in the old order; an ended one has none.
export const candidatesOf = (d: Derived, id: AssignmentId): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  const a = w.assignments.get(id)
  if (a === undefined || ended(d, id)) return []
  // Ruling 10.9: an agent whose brief is over its limit waits; what is routed to it still shows.
  const over = briefOver(d, a)
  const steps: Array<Candidate> = over === undefined ? [...expiredSources(d, a)] : [over]
  for (const [q, state] of d.states.questions) {
    if (state._tag === 'Open' && state.answerer === id) {
      steps.push(act({ _tag: 'Answer', question: q }, { _tag: 'Answer', target: { question: q } }))
    }
  }
  for (const [e, state] of d.states.escalations) {
    const v = w.reviews.get(e)
    if (state._tag !== 'Open' || state.answerer !== id || v?._tag !== 'Escalate') continue
    const intent: Intent = { _tag: 'Resolve', target: { escalation: e } }
    steps.push(act({ _tag: 'Resolve', escalation: e, result: v.of }, intent))
  }
  if (over !== undefined) return steps
  steps.push(...shortenSteps(d, a))
  steps.push(...explainSteps(d, a))
  steps.push(...dirSteps(d, a))
  // A result made from an old input: its maker makes it again, at the turn of its decider (B3).
  for (const t of w.tasks.values()) {
    if (!within(w, t.id, a.task) || !taskOpen(d, t.id)) continue
    const result = latestResultOf(w, t.id)
    if (result === undefined) continue
    const who = deciderOf(w, result.id)
    const turn =
      who === undefined
        ? decidesResults(w, id, result.id, d.moment.at)
        : decidesResults(w, id, result.id, d.moment.at) &&
          turnOf(who, { by: id, when: d.moment.at }, decidingNow(w, result.id), sameRole(w))
    const decides = turn && !hasOpenRecheck(w, result.id)
    const recheck: Intent = { _tag: 'Recheck', target: { result: result.id } }
    const stale = d.moment.outside.stale.get(result.id)
    if (stale && decides) {
      steps.push(act({ _tag: 'RecheckStaleSource', result: result.id, ...stale }, recheck))
    }
    const old = blockersOfResult(w, result.id).find((i) => i._tag === 'OldNeed')
    if (old?._tag === 'OldNeed' && decides) {
      const what: StepWhat = {
        _tag: 'RecheckOldNeed',
        result: result.id,
        need: old.ref,
        newer: old.newer,
      }
      steps.push(act(what, recheck))
    }
  }
  steps.push(...draftSteps(d, a))
  if (taskAccepted(d, a.task)) {
    steps.push(...acceptedSteps(d, a))
    return steps
  }
  for (const t of w.tasks.values()) {
    if (!within(w, t.id, a.task) || !taskOpen(d, t.id) || taskAccepted(d, t.id)) continue
    steps.push(...taskSteps(d, a, t))
  }
  return steps
}
const hasOpenRecheck = (w: Work, result: ResultId): boolean =>
  reviewsOf(w, result).some((v) => v._tag === 'Recheck' && !answered(w, v.id))

// Each outside source that is expired and that the latest result of an open task of the tree
// was made from, once, in the order of the dir's sources.
const expiredSources = (d: Derived, a: Assignment): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  const used = new Set<string>()
  for (const t of w.tasks.values()) {
    if (!taskOpen(d, t.id) || !within(w, t.id, a.task)) continue
    for (const m of latestResultOf(w, t.id)?.madeFrom ?? []) {
      if (m._tag === 'Outside') used.add(m.name)
    }
  }
  const hours = d.moment.outside.settings.outsideSourceHours
  return d.states.sources.flatMap((s): ReadonlyArray<Candidate> => {
    if (s.state._tag !== 'Expired' || !used.has(s.name)) return []
    const what: StepWhat = {
      _tag: 'ReadSource',
      source: s.name,
      revision: s.revision,
      seenAt: s.state.seenAt,
      hours,
    }
    return [act(what, { _tag: 'ReadSource', target: { name: s.name } })]
  })
}

// The drafts of the directions of this tree: a draft that waits for this role's accept (S2: never
// for the owner's own accept), a vetoed draft that its tree revises, the suggestions to draft.
const draftSteps = (d: Derived, a: Assignment): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  const at = d.moment.at
  const directs = holdsA(w, a, 'Direct')
  const steps: Array<Candidate> = []
  const own = [...w.directions.values()].filter(
    (x) =>
      x._tag === 'Official' &&
      [...w.tasks.values()].some(
        (t) => within(w, t.id, a.task) && directionIdsOf(w, t.id).includes(x.id),
      ),
  )
  for (const x of own.flatMap((o) => openDrafts(d, o.id))) {
    const state = d.states.revisions.get(x.id)
    if (state?._tag !== 'Waiting') continue
    const reviser = authorAssignment(authorOf(w, x))
    const reviserTree = reviser !== undefined && (reviser === a.id || isAbove(w, reviser, a))
    const mine = state.waitsFor.some((leaf) =>
      leaf._tag === 'Role'
        ? leaf.role === a.role
        : leaf._tag === 'Human' && mayChange(w, a.id, x.of, at),
    )
    if (!mine || reviewsOf(w, x.id).some((r) => r.by === a.id) || reviserTree) continue
    const of = { _tag: 'Revision', id: x.id } as const
    steps.push(
      act(
        { _tag: 'ReviewDraft', draft: x.id },
        { _tag: 'Accept', target: { of } },
        { _tag: 'Reject', target: { of } },
      ),
    )
  }
  // A vetoed draft (S6: built on the current version): its redrafter revises it again.
  for (const x of w.drafts.values()) {
    const state = d.states.revisions.get(x.id)
    if (state?._tag !== 'Vetoed' || x._tag !== 'Change' || !directs) continue
    if (!redrafters(redrafterOf(d, x)).includes(a.id) || !waitsForNewDraft(d, x)) continue
    const what: StepWhat = { _tag: 'ReviseRejectedDraft', draft: x.id, reject: state.by }
    steps.push(act(what, ...revise([x.of])))
  }
  for (const { y, direction } of suggestionsToDraft(d)) {
    const local = w.directions.get(direction)?.source._tag === 'Local'
    if (!directs || !local || !followsDirection(d, a, direction)) continue
    const what: StepWhat = { _tag: 'AnswerSuggestion', suggestion: y.id, direction }
    steps.push(act(what, ...revise([direction])))
  }
  return steps
}

// The top assignment puts accepted code on its base; then it finishes (D14: its children are
// settled, and end when it ends).
const acceptedSteps = (d: Derived, a: Assignment): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  const steps: Array<Candidate> = []
  const accepted = latestResultOf(w, a.task)
  const [repo = '', commit = ''] = accepted?.output.split('@') ?? []
  const space = w.tasks.get(a.task)?.descriptionAi.workspace.find((x) => x.path === repo)
  if (
    accepted &&
    a.parent._tag === 'GivenByPerson' &&
    space?._tag === 'Repo' &&
    /^[0-9a-f]{7,40}$/.test(commit) &&
    !d.moment.outside.onBase.has(accepted.id)
  ) {
    const what: StepWhat = {
      _tag: 'PutOnBase',
      task: a.task,
      result: accepted.id,
      repo,
      base: space.base,
      commit,
    }
    steps.push(wait(what))
  }
  const finish: Intent = { _tag: 'Finish', target: { assignment: a.id } }
  steps.push(act({ _tag: 'FinishAcceptedTask', task: a.task }, finish))
  return steps
}

// B6: an escalate step waits while this assignment's escalation of the same target is open.
const escalatedTask = (d: Derived, a: Assignment): boolean =>
  [...d.moment.work.questions.values()].some(
    (q) => q.from === a.id && q.stops === a.task && d.states.questions.get(q.id)?._tag === 'Open',
  )
const escalatedResult = (d: Derived, a: Assignment, result: ResultId): boolean =>
  unresolvedEscalationItems(d.moment.work, result).some((e) => {
    const state = d.states.escalations.get(e.id as never)
    return e.by === a.id && state?._tag === 'Open'
  })
const escalateTask = (a: Assignment): Intent => ({
  _tag: 'EscalateTask',
  target: { task: a.task },
})

// The steps of one open task of the tree that is not accepted.
const taskSteps = (d: Derived, a: Assignment, t: Task): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  const splits = holdsA(w, a, 'Split')
  const result = latestResultOf(w, t.id)
  const items = result ? blockersOfResult(w, result.id) : []
  // A mistake is evaluated before anything else moves the task.
  if (workStop(w, t.id)) return evaluationSteps(d, a, t)
  const steps: Array<Candidate> = []
  // A Reject of the task itself waits for a change (B1: the step names its point).
  for (const point of taskRejects(w, t.id)) {
    if (items.some((i) => 'ref' in i && i.ref === point)) continue
    const local = localDirections(w, t.id)
    if (holdsA(w, a, 'Direct') && local.length > 0) {
      const what: StepWhat = {
        _tag: 'ReviseForReturnedTask',
        point,
        task: t.id,
        directions: directionIdsOf(w, t.id),
      }
      steps.push(act(what, ...revise(local)))
    } else if (!escalatedTask(d, a)) {
      const what: StepWhat = { _tag: 'EscalateForReturnedTask', point, task: t.id }
      steps.push(act(what, escalateTask(a)))
    }
  }
  const waitsFor = (n: TaskId) => taskOpen(d, n) && !taskAccepted(d, n)
  for (const n of t.needs) {
    if (waitsFor(n) && !within(w, n, a.task)) {
      steps.push(wait({ _tag: 'WaitsForOutsideNeed', task: t.id, need: n }))
    }
  }
  for (const n of t.needs) {
    const serves = w.tasks.get(n)?.serves
    const part = serves?._tag === 'Serves' && serves.task === t.id
    if (waitsFor(n) && within(w, n, a.task) && !part) {
      steps.push(wait({ _tag: 'RunsAfter', task: t.id, need: n }))
    }
  }
  if (t.needs.some(waitsFor)) return steps
  // An open lead that this role assigns, whose task holds this one, runs it: first one below
  // this assignment.
  const mine = assignsOf(roleOfA(w, a))
  const running = [...w.assignments.values()].filter(
    (x) =>
      !ended(d, x.id) &&
      x.id !== a.id &&
      mine.includes(x.role) &&
      leads(roleOfA(w, x)) &&
      within(w, t.id, x.task),
  )
  const lead = running.find((x) => isAbove(w, a.id, x)) ?? running[0]
  const changed = result !== undefined && d.moment.outside.changed.has(result.id)
  const fix = items.some(
    (i) =>
      (i._tag === 'Reject' && (itemAt(w, i.ref)?.breaks !== undefined || answered(w, i.ref))) ||
      i._tag === 'Unchanged' ||
      i._tag === 'Recheck',
  )
  if (lead) {
    steps.push(wait({ _tag: 'LeadRuns', lead: lead.id, task: t.id }))
    if (result) {
      // A checker that this assignment gave is its subagent to start.
      const checks = !changed && !fix ? checkRolesOf(w, items) : []
      steps.push(...checkerSteps(d, a, t, result.id, checks, true))
      steps.push(...changeSteps(d, a, t, result.id, items, false))
      steps.push(...deciderSteps(d, a, result.id, items))
    }
    return steps
  }
  const lower = assignable(w, a)
  const subLeads = nonEmpty(lower.filter(leads).map((r) => r.role))
  if (splits && t.id === a.task && !result && t.needs.length === 0 && subLeads) {
    if (sectionOf(t) !== null) {
      const what: StepWhat = { _tag: 'RunSectionWithLead', task: t.id, roles: subLeads }
      return [...steps, act(what, ...giveEach(t.id, subLeads))]
    }
    if (mayChange(w, a.id, t.id, d.moment.at)) {
      const split: Intent = { _tag: 'SplitTask', target: { task: t.id, answers: null } }
      return [...steps, act({ _tag: 'SplitFirst', task: t.id }, split)]
    }
  }
  if (t.id !== a.task && subLeads) {
    const what: StepWhat = { _tag: 'RunWithLead', task: t.id, roles: subLeads }
    return [...steps, act(what, ...giveEach(t.id, subLeads))]
  }
  if (!result || changed || fix) {
    if (result) steps.push(...changePointSteps(d, a, t, result.id, items, true))
    const makers = lower
      .filter((r) => !leads(r) && r.acts.some((x) => x._tag === 'Do'))
      .map((r) => r.role)
    steps.push(makerStep(d, a, t, result !== undefined, makers))
    return steps
  }
  if (items.some((i) => i._tag === 'OldVersion')) {
    steps.push(wait({ _tag: 'CheckAgainUnderNewVersion', result: result.id }))
  }
  // The maker of the result does not choose its checkers, nor decide it. A role that leads
  // nothing checks only its own rules: the lead of the task sees to the other checkers.
  const maker = isDo(w, a.role) && a.task === t.id
  const leader = leads(roleOfA(w, a))
  const roles = checkRolesOf(w, items).filter((r) => leader || r === a.role)
  if (!maker) steps.push(...checkerSteps(d, a, t, result.id, roles, false))
  steps.push(...changeSteps(d, a, t, result.id, items, false))
  if (!maker) steps.push(...deciderSteps(d, a, result.id, items))
  return steps
}
// The roles that check the rules of a result that lack evidence; after a direction change that
// left the work unchanged, the rules of the changed standards too.
const checkRolesOf = (w: Work, items: ReadonlyArray<Blocker>): ReadonlyArray<RoleName> => {
  const again = items.flatMap((i) => (i._tag === 'OldVersion' ? i.rules : []))
  const rules = [...items.flatMap((i) => (i._tag === 'Evidence' ? [i.ref] : [])), ...again]
  const roles = rules.flatMap((e) => {
    const checkedBy = w.rules.get(e)?.checkedBy
    return checkedBy?._tag === 'Role' ? [checkedBy.role] : []
  })
  return [...new Set(roles)]
}
// The open points of the Rejects of a task itself.
const taskRejects = (w: Work, task: TaskId): ReadonlyArray<PointId> =>
  [...w.reviews.values()].flatMap((v) =>
    v._tag === 'Reject' && v.of._tag === 'Task' && v.of.id === task
      ? v.of.points.map((_, i) => `${v.id}.${i + 1}` as PointId).filter((p) => !answered(w, p))
      : [],
  )

// A task that waits for an evaluation, or for the change that its evaluation asks for.
const evaluationSteps = (d: Derived, a: Assignment, t: Task): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  const splits = holdsA(w, a, 'Split')
  const steps: Array<Candidate> = []
  const stops = stopsOf(w, t.id).filter((s) => !stopAnswered(w, s))
  for (const stop of stops) {
    const key = stopKey(w, stop)
    const pending = [...w.evaluations.values()]
      .filter(
        (e) =>
          stopKey(w, e.answers) === key &&
          evaluationDecision(w, e) === undefined &&
          !evaluationCounts(w, e),
      )
      .at(-1)
    if (pending) {
      steps.push(wait({ _tag: 'EvaluationWaitsForOwner', evaluation: pending.id, task: t.id }))
      continue
    }
    if (splits) {
      steps.push(
        act({ _tag: 'Evaluate', task: t.id, stop }, { _tag: 'Evaluate', target: { stop } }),
      )
      continue
    }
    const evaluator = [...w.assignments.values()].find(
      (x) => !ended(d, x.id) && holdsA(w, x, 'Split') && within(w, t.id, x.task),
    )
    steps.push(
      wait(
        evaluator
          ? { _tag: 'WaitsForEvaluationBy', task: t.id, stop, evaluator: evaluator.id }
          : { _tag: 'WaitsForEvaluationNoSplitter', task: t.id, stop },
      ),
    )
  }
  if (stops.length > 0) return steps
  const e = [...w.evaluations.values()]
    .filter((x) => stopTask(w, x.answers) === t.id && evaluationCounts(w, x))
    .at(-1)
  const evaluation = e?.id ?? null
  if (
    [...w.tasks.values()].some(
      (p) => p.serves._tag === 'Serves' && p.serves.task === t.id && taskOpen(d, p.id),
    )
  ) {
    return [wait({ _tag: 'WaitsForParts', task: t.id, evaluation })]
  }
  const pending = directionIdsOf(w, t.id).flatMap((x) => openDrafts(d, x))[0]
  if (pending) {
    return [wait({ _tag: 'DraftOfEvaluationWaits', task: t.id, draft: pending.id, evaluation })]
  }
  if (!splits) return [wait({ _tag: 'WaitsForChangeOfEvaluation', task: t.id, evaluation })]
  // B2: a task whose directions are all company directions gets its change through a remake.
  const local = localDirections(w, t.id)
  if (e?.level === 'task' || local.length === 0) {
    const oneUnit = isOneUnit(w, t)
    if (mayChange(w, a.id, t.id, d.moment.at)) {
      const remake: Intent = { _tag: 'RemakeTask', target: { task: t.id, answers: null } }
      const split: Intent = { _tag: 'SplitTask', target: { task: t.id, answers: null } }
      const what: StepWhat = { _tag: 'RemakeAsEvaluated', task: t.id, evaluation, oneUnit }
      return [act(what, remake, split)]
    }
    const what: StepWhat = { _tag: 'EscalateForRemake', task: t.id, evaluation, oneUnit }
    return [escalatedTask(d, a) ? wait(what) : act(what, escalateTask(a))]
  }
  const what: StepWhat = {
    _tag: 'ReviseAsEvaluated',
    task: t.id,
    evaluation,
    directions: directionIdsOf(w, t.id),
  }
  return [act(what, ...revise(local))]
}

// The change points of a result, unless this assignment escalated the result already (B6).
const changeSteps = (
  d: Derived,
  a: Assignment,
  t: Task,
  result: ResultId,
  items: ReadonlyArray<Blocker>,
  first: boolean,
): ReadonlyArray<Candidate> =>
  escalatedResult(d, a, result) ? [] : changePointSteps(d, a, t, result, items, first)
// A blocker that only a direction change can close: the point that it names.
const changePoint = (w: Work, item: Blocker): PointId | undefined => {
  if (item._tag === 'Change') return item.ref
  if (item._tag !== 'Reject') return undefined
  return itemAt(w, item.ref)?.breaks === undefined && !answered(w, item.ref) ? item.ref : undefined
}
const changePointSteps = (
  d: Derived,
  a: Assignment,
  t: Task,
  result: ResultId,
  items: ReadonlyArray<Blocker>,
  first: boolean,
): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  return items.flatMap((item): ReadonlyArray<Candidate> => {
    const point = changePoint(w, item)
    if (point === undefined) return []
    const drafts = nonEmpty(
      directionIdsOf(w, t.id).flatMap((x) => openDrafts(d, x).map((y) => y.id)),
    )
    if (drafts) return [wait({ _tag: 'ChangeWaitsForDraft', point, drafts, first })]
    const local = localDirections(w, t.id)
    if (holdsA(w, a, 'Direct') && local.length > 0) {
      const what: StepWhat = {
        _tag: 'ReviseForPoint',
        point,
        directions: directionIdsOf(w, t.id),
        first,
      }
      return [act(what, ...revise(local))]
    }
    const what: StepWhat = { _tag: 'EscalateForPoint', point, result, first }
    return [act(what, { _tag: 'EscalateResult', target: { result } })]
  })
}

// Who makes the next result of a task: the open maker that waits for its file, works, or waits
// for a subagent; else a new maker (B4: of a role that canAct allows), or an escalation.
const makerStep = (
  d: Derived,
  a: Assignment,
  t: Task,
  redo: boolean,
  makers: ReadonlyArray<RoleName>,
): Candidate => {
  const w = d.moment.work
  const over = [...w.assignments.values()].find((x) => x.task === t.id && isDo(w, x.role))
  const overStep = over === undefined ? undefined : briefOver(d, over)
  if (overStep !== undefined) return overStep
  const maker = [...w.assignments.values()].find((x) => x.task === t.id && makesNow(d, x))
  const waits = maker && fileTurn(d, maker.id)
  if (maker && waits) return wait({ _tag: 'MakerWaitsForFile', maker: maker.id, ...waits })
  // The maker itself never waits on itself: it reads its brief, or reports what it made.
  if (maker?.id === a.id) {
    const self = { assignment: a.id }
    return claimedSince(w, a.id) === undefined
      ? act({ _tag: 'BriefToMake', task: t.id, redo }, { _tag: 'Brief', target: self })
      : act({ _tag: 'ReportWork', maker: a.id, task: t.id }, { _tag: 'Report', target: self })
  }
  if (maker && claimedSince(w, maker.id) !== undefined) {
    const what: StepWhat = { _tag: 'MakerWorking', maker: maker.id, task: t.id }
    return act(what, { _tag: 'Free', target: { assignment: maker.id } })
  }
  if (maker) {
    const ownChild = parentId(maker) === a.id
    return wait({ _tag: 'GiveMakerCommand', maker: maker.id, task: t.id, redo, ownChild })
  }
  const roles = nonEmpty(makers)
  if (roles) return act({ _tag: 'AssignMaker', task: t.id, roles }, ...giveEach(t.id, roles))
  const what: StepWhat = { _tag: 'NoMakerRole', task: t.id }
  return escalatedTask(d, a) ? wait(what) : act(what, escalateTask(a))
}

// The checker of each role that checks a rule of the result: one open checker of a role on a task
// (can.ts). ownOnly: only the checkers that this assignment gave.
const checkerSteps = (
  d: Derived,
  a: Assignment,
  t: Task,
  result: ResultId,
  roles: ReadonlyArray<RoleName>,
  ownOnly: boolean,
): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  return roles.flatMap((role): ReadonlyArray<Candidate> => {
    const checker = [...w.assignments.values()].find(
      (x) => x.task === t.id && !ended(d, x.id) && x.role === role,
    )
    const own = checker !== undefined && parentId(checker) === a.id
    return !ownOnly || own ? [checkerStep(d, a, t, result, role, checker)] : []
  })
}
const checkerStep = (
  d: Derived,
  a: Assignment,
  t: Task,
  result: ResultId,
  role: RoleName,
  checker: Assignment | undefined,
): Candidate => {
  const w = d.moment.work
  const r = w.workflow.roles.get(role)
  if (r?._tag === 'Program') {
    const what: StepWhat = { _tag: 'ProgramChecksNextReport', role, task: t.id, result }
    return act(what, { _tag: 'Recheck', target: { result } })
  }
  const of = { _tag: 'Result', id: result } as const
  const over = checker === undefined ? undefined : briefOver(d, checker)
  if (over !== undefined) return over
  if (role === a.role) {
    return act(
      { _tag: 'CheckYourself', result },
      { _tag: 'Accept', target: { of } },
      { _tag: 'Reject', target: { of } },
    )
  }
  if (checker && claimedSince(w, checker.id) !== undefined) {
    const what: StepWhat = { _tag: 'CheckerWorking', checker: checker.id, result }
    return act(what, { _tag: 'Free', target: { assignment: checker.id } })
  }
  if (checker) {
    const ownChild = parentId(checker) === a.id
    return wait({ _tag: 'GiveCheckerCommand', checker: checker.id, result, task: t.id, ownChild })
  }
  if (r?._tag === 'Model' && !assignsOf(roleOfA(w, a)).includes(role)) {
    const what: StepWhat = { _tag: 'CheckerNotAssigned', result, role }
    const escalate: Intent = { _tag: 'EscalateResult', target: { result } }
    return escalatedResult(d, a, result) ? wait(what) : act(what, escalate)
  }
  return act({ _tag: 'AssignChecker', result, role, task: t.id }, ...giveEach(t.id, [role]))
}

// The decider decides when only its accept is left (B3: its turn of an Order); otherwise the step
// says whose accept the decision waits for.
const deciderSteps = (
  d: Derived,
  a: Assignment,
  result: ResultId,
  items: ReadonlyArray<Blocker>,
): ReadonlyArray<Candidate> => {
  const w = d.moment.work
  const isDecider = (i: { readonly _tag: string }) =>
    i._tag === 'DeciderAcceptedUnderOld' ||
    i._tag === 'DeciderWaits' ||
    i._tag === 'DeciderAnyApprover'
  const decider = items.find(isDecider)
  if (!decider || !items.every(isDecider)) return []
  if (decidesNow(w, a.id, result, d.moment.at)) {
    const of = { _tag: 'Result', id: result } as const
    return [
      act(
        { _tag: 'Decide', result, again: decider._tag === 'DeciderAcceptedUnderOld' },
        { _tag: 'Accept', target: { of } },
        { _tag: 'Reject', target: { of } },
      ),
    ]
  }
  const task = w.results.get(result)?.task
  if (task === undefined) return []
  const lower = assignable(w, a).map((r) => r.role)
  return decisionWaitsOn(w, result).map((leaf): Candidate => {
    const open =
      leaf._tag === 'Role'
        ? [...w.assignments.values()].find(
            (x) => !ended(d, x.id) && x.role === leaf.role && within(w, task, x.task),
          )
        : undefined
    if (open) return wait({ _tag: 'WaitsForDecider', result, decider: open.id })
    if (leaf._tag === 'Role' && lower.includes(leaf.role)) {
      const what: StepWhat = { _tag: 'AssignDecider', result, role: leaf.role, task }
      return act(what, ...giveEach(task, [leaf.role]))
    }
    return wait({ _tag: 'DeciderByPerson', result, leaf, task })
  })
}

// --- nextFor and stepKey -------------------------------------------------------------------------

// A candidate as a step: its intents that pass canAct; none left, and it waits (D8).
const stepOf = (d: Derived, actor: Parameters<NextFor>[1], c: Candidate): NextStep => {
  const allowed = nonEmpty(c.intents.filter((i) => canAct(d, actor, i)._tag === 'May'))
  return allowed === undefined
    ? { _tag: 'Wait', what: c.what }
    : { _tag: 'Do', what: c.what, intents: allowed }
}

export const nextFor: NextFor = (d, actor) => {
  if (actor._tag === 'Agent') {
    // The notices come last (ruling 10.1): the lines that the watcher typed before.
    const all = [...candidatesOf(d, actor.assignment), ...noticesOf(d, actor.assignment)]
    return all.map((c) => stepOf(d, actor, c))
  }
  if (actor._tag === 'Person') {
    return waitingFor(d, { _tag: 'Person', name: actor.name }).map((i) => i.step)
  }
  return []
}

// The ids that a step names, by its tag (no words, no times, no flags): bug 13.
const IDS: {
  readonly [K in StepWhat['_tag']]: (s: Extract<StepWhat, { _tag: K }>) => ReadonlyArray<string>
} = {
  ReadSource: (s) => [s.source],
  Answer: (s) => [s.question],
  Resolve: (s) => [s.escalation, s.result],
  RecheckStaleSource: (s) => [s.result, s.source],
  RecheckOldNeed: (s) => [s.result, s.need, s.newer],
  BriefOverWaits: (s) => [s.assignment, s.task, `${s.size}`, ...s.drafts],
  ExplainDraft: (s) => [s.draft],
  ShortenOrSplit: (s) => [s.assignment, s.task, `${s.size}`, ...s.directions, ...s.drafts],
  ReviewDraft: (s) => [s.draft],
  ReviseRejectedDraft: (s) => [s.draft, s.reject],
  AnswerSuggestion: (s) => [s.suggestion, s.direction],
  AnswerRolesSuggestion: (s) => [s.suggestion],
  DraftNewDirection: (s) => [s.suggestion],
  AddExamples: (s) => [s.draft],
  PutOnBase: (s) => [s.task, s.result],
  FinishAcceptedTask: (s) => [s.task],
  EvaluationWaitsForOwner: (s) => [s.evaluation, s.task],
  Evaluate: (s) => [s.task, s.stop.id],
  WaitsForEvaluationBy: (s) => [s.task, s.stop.id, s.evaluator],
  WaitsForEvaluationNoSplitter: (s) => [s.task, s.stop.id],
  WaitsForParts: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : [])],
  DraftOfEvaluationWaits: (s) => [s.task, s.draft, ...(s.evaluation ? [s.evaluation] : [])],
  WaitsForChangeOfEvaluation: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : [])],
  RemakeAsEvaluated: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : [])],
  EscalateForRemake: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : [])],
  ReviseAsEvaluated: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : []), ...s.directions],
  ReviseForReturnedTask: (s) => [s.point, s.task, ...s.directions],
  EscalateForReturnedTask: (s) => [s.point, s.task],
  WaitsForOutsideNeed: (s) => [s.task, s.need],
  RunsAfter: (s) => [s.task, s.need],
  LeadRuns: (s) => [s.lead, s.task],
  RunSectionWithLead: (s) => [s.task, ...s.roles],
  SplitFirst: (s) => [s.task],
  RunWithLead: (s) => [s.task, ...s.roles],
  ChangeWaitsForDraft: (s) => [s.point, ...s.drafts],
  ReviseForPoint: (s) => [s.point, ...s.directions],
  EscalateForPoint: (s) => [s.point, s.result],
  MakerWaitsForFile: (s) => [s.maker, s.before],
  MakerWorking: (s) => [s.maker, s.task],
  BriefToMake: (s) => [s.task],
  ReportWork: (s) => [s.maker, s.task],
  GiveMakerCommand: (s) => [s.maker, s.task],
  AssignMaker: (s) => [s.task, ...s.roles],
  NoMakerRole: (s) => [s.task],
  CheckAgainUnderNewVersion: (s) => [s.result],
  ProgramChecksNextReport: (s) => [s.role, s.task, s.result],
  CheckYourself: (s) => [s.result],
  CheckerWorking: (s) => [s.checker, s.result],
  GiveCheckerCommand: (s) => [s.checker, s.result, s.task],
  CheckerNotAssigned: (s) => [s.result, s.role],
  AssignChecker: (s) => [s.result, s.role, s.task],
  Decide: (s) => [s.result],
  WaitsForDecider: (s) => [s.result, s.decider],
  AssignDecider: (s) => [s.result, s.role, s.task],
  DeciderByPerson: (s) => [s.result, leafName(s.leaf), s.task],
  PersonDecides: (s) => [s.kind, s.id],
  AnswerPrompt: (s) => [s.agent, s.prompt],
  RecordFailure: (s) => [s.agent, s.failure],
  RecordAgentFailure: (s) => [s.agent, s.failure],
  WriteEndWords: (s) => [s.run],
  TestProblem: (s) => [s.problem, ...(s.asked === null ? [] : [s.asked])],
  WaitsForAnswer: (s) => [s.question],
  Answered: (s) => [s.question],
  Resolved: (s) => [s.escalation, s.result],
}
export const keyOfWhat = (what: StepWhat): string =>
  [what._tag, ...(IDS[what._tag] as (s: StepWhat) => ReadonlyArray<string>)(what)].join(' ')
export const stepKey: StepKey = (steps) => steps.map((s) => keyOfWhat(s.what)).join('\n')
