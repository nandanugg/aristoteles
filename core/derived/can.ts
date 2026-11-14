// canAct (BUILD.md 3.5): the one check behind every refusal of state. nextFor offers only the
// intents that pass it, and every action calls it after its normalisation (3.6). It reads only
// Derived and never the content of an act (words, files, evidence): those are the action's.
// The refusal keeps the old words (the golden text); its choice is the actor's real choice (D10).
// One check per tag in a total table: a new act fails the compile until it has its check.
import type { ActionTag, Intent } from '../schema/actions.ts'
import { type ChoiceKind, refusal } from '../schema/errors.ts'
import {
  type Assignment,
  type AssignmentId,
  type Author,
  type By,
  type DeciderLeaf,
  type EventRef,
  human,
  type NonBlank,
  type TaskId,
  type Work,
} from '../schema/index.ts'
import { decisionTaskOf, hostOf, personOfForward, placementOf } from './catalog.ts'
import { metAt, turnOf, waitsForWords, leavesOf } from './deciders.ts'
import {
  actorOf,
  actsOf,
  below,
  can,
  coversMaker,
  approvedByOfDraft,
  decidersOfDraft,
  decidesResults,
  decidingNow,
  decisionMet,
  decisionWaitsFor,
  deciderOf,
  directionAt,
  draftAcceptItems,
  draftMatches,
  evaluationDecision,
  evaluationCounts,
  evaluationWaitsRef,
  countsWhenWritten,
  isAssignment,
  isCriticism,
  isDo,
  isOpenTask,
  isPerson,
  isPersonStop,
  itemAt,
  itemsOf,
  labelOf,
  labelWithRole,
  answererLabel,
  maxOf,
  mayChange,
  mayGive,
  neederOf,
  partsOf,
  personRejectItems,
  rootOf,
  roleNameOf,
  rulesOf,
  sameActor,
  sameRole,
  stopKey,
  stopRefAnswered,
  stopRefOf,
  stopRefTask,
  stopText,
  taskOfTarget,
  tierOf,
  roleAt,
  versionNumberOf,
  within,
  workStop,
  openedTopOf,
  currentTask,
  recheckRules,
  blockersOfResult,
  directionIdsOf,
  reviewItems,
  type Item,
} from './reads.ts'
import {
  type CanAct,
  type CanActOf,
  type Derived,
  type DraftLeaf,
  isEndedTask,
} from './types.ts'

const MAY: CanAct = { _tag: 'May' }
const no = (message: string, kind: ChoiceKind, words: string): CanAct => ({
  _tag: 'MayNot',
  refusal: refusal(message, kind, words as NonBlank),
})
// The first refusal of a list of checks, else May.
const first = (...checks: ReadonlyArray<() => CanAct>): CanAct => {
  for (const check of checks) {
    const r = check()
    if (r._tag === 'MayNot') return r
  }
  return MAY
}

interface Ctx {
  readonly d: Derived
  readonly w: Work
  readonly actor: Author
  // Who acts, as a record names it: an assignment, a person, or a model run outside any task.
  readonly by: By | undefined
}
type IntentOf<K extends ActionTag> = Extract<Intent, { readonly _tag: K }>
type Check<K extends ActionTag> = (c: Ctx, intent: IntentOf<K>) => CanAct

const byOf = (w: Work, actor: Author): By | undefined => {
  switch (actor._tag) {
    case 'Agent':
    case 'Program':
      return w.assignments.has(actor.assignment) ? actor.assignment : undefined
    case 'Person':
    case 'Supervisor':
      return human(actor.name)
    case 'ModelRun':
      return { _tag: 'Agent', name: actor.name, run: actor.at }
    default:
      return undefined
  }
}

// --- the actor -----------------------------------------------------------------------------------

const upTo = (a: Assignment): string => (a.parent._tag === 'Parent' ? 'your parent' : 'the person')
// The assignment of an agent that acts, open (C1: an agent of an ended task is Ended too).
const agentOpen = (c: Ctx): CanAct => {
  if (c.actor._tag !== 'Agent' && c.actor._tag !== 'Program') return MAY
  const a = c.w.assignments.get(c.actor.assignment)
  if (a === undefined)
    return no(`there is no assignment ${c.actor.assignment}`, 'Pick', 'use your own token')
  const state = c.d.states.assignments.get(a.id)
  if (state?._tag !== 'Ended') return MAY
  const why =
    state.why._tag === 'TaskEnded'
      ? `${a.id} is finished: its task ${a.task} ended`
      : `${a.id} is finished`
  return no(why, 'Escalate', `do no more work for it; tell ${upTo(a)}`)
}
const agentOf = (c: Ctx): Assignment | undefined =>
  c.actor._tag === 'Agent' || c.actor._tag === 'Program'
    ? c.w.assignments.get(c.actor.assignment)
    : undefined
const tierOfA = (w: Work, a: Assignment): string | undefined => tierOf(roleAt(w, a.role))
// A low agent with no claim has not read its brief yet, or its one unit is done.
const needClaim = (c: Ctx, a: Assignment): CanAct => {
  const claim = c.w.meta.get(a.id)?.claim
  if (claim !== undefined && claim._tag !== 'Free') return MAY
  const done =
    [...c.w.results.values()].some((r) => r.by === a.id) ||
    [...c.w.reviews.values()].some((r) => r.by === a.id)
  if (tierOfA(c.w, a) === 'low' && done) {
    return no(
      'your unit is done; this assignment has no open brief',
      'Wait',
      `STOP: ${upTo(a)} continues, and gives you this token again if there is more`,
    )
  }
  return no(
    'you have no brief in this attempt',
    'Wait',
    'read your brief first; your work follows it',
  )
}
const exists = (found: boolean, id: string, what: string): CanAct =>
  found ? MAY : no(`there is no ${what} ${id}`, 'Pick', `name a ${what} that exists`)
// The tier of the agent that acts; the person, a model run and the system act as high.
const tierOfActor = (c: Ctx): string => {
  const a = agentOf(c)
  return a === undefined ? 'high' : String(tierOfA(c.w, a))
}
// An act that only a high role (or the person) does.
const highOnly = (c: Ctx, message: (tier: string) => string, kind: ChoiceKind, words: string) => {
  const tier = tierOfActor(c)
  return tier === 'high' ? MAY : no(message(tier), kind, words)
}
const HOST_PROBLEM = 'the host (a Sol) records a system problem; escalate it to your parent'

// --- tasks and assignments -----------------------------------------------------------------------

const give: Check<'Give'> = (c, { target: { task, role } }) => {
  const { w, d } = c
  const t = w.tasks.get(task)
  if (t === undefined) return exists(false, task, 'task')
  const r = w.workflow.roles.get(role)
  if (r === undefined)
    return no(`there is no role "${role}"`, 'Pick', 'name a role of the workflow')
  const state = d.states.tasks.get(task)
  // B5: a closed or replaced task takes no new assignment.
  if (state !== undefined && isEndedTask(state)) {
    const now = state._tag === 'Replaced' ? currentTask(w, task) : undefined
    return no(
      `${task} is closed; a closed task takes no new assignment`,
      'Pick',
      now === undefined
        ? 'give the work on an open task'
        : `give it on ${now}, which replaced ${task}`,
    )
  }
  // The CLI itself (System) gives a program its review on each report; nobody else does.
  if (r._tag === 'Program' && c.actor._tag !== 'System') {
    return no(`${role} is a program; it runs on each report by itself`, 'Pick', 'give a model role')
  }
  const makes = isDo(w, role)
  const tier = r._tag === 'Model' ? r.tier : undefined
  const by = c.by
  if (by !== undefined && !isAssignment(by) && by._tag === 'Human' && tier === 'low') {
    const leads = [...w.workflow.roles.values()]
      .filter((x) => x._tag === 'Model' && x.tier !== 'low')
      .map((x) => x.role)
    return no(
      `the person gives work to a medium or high role; ${role} is low, so a lead gives it its work`,
      'Pick',
      `give ${task} to a lead: ${leads.join(' or ') || 'a medium or high role'}`,
    )
  }
  if (by !== undefined && isAssignment(by)) {
    const parent = w.assignments.get(by)
    if (parent === undefined) return exists(false, by, 'assignment')
    const own = RANK[tierOfA(w, parent) ?? '']
    const theirs = RANK[tier ?? '']
    const ended = d.states.assignments.get(parent.id)?._tag === 'Ended'
    if (ended) return no('the parent assignment is finished', 'Escalate', `tell ${upTo(parent)}`)
    if (own !== undefined && theirs !== undefined && theirs >= own) {
      // No tier is below low: a low agent's only choice is to escalate.
      const low = tierOfA(w, parent) === 'low'
      return no(
        `a ${tierOfA(w, parent)} role assigns only lower tiers; "${role}" is ${tier}`,
        low ? 'Escalate' : 'Pick',
        low
          ? 'escalate it: no tier is below low'
          : 'give a role of a lower tier, or escalate for a higher one',
      )
    }
    if (!within(w, task, parent.task)) {
      return no(
        `${task} is outside the task tree of ${parent.task}`,
        'Escalate',
        `${t.owner.name} assigns it`,
      )
    }
    if (makes && !approverAbove(c, parent.id, role)) {
      return no(
        `${labelOf(w, parent.id)} decides no ${role} results, and no assignment above it ` +
          `does; a role that approves ${role} assigns it`,
        'Escalate',
        'escalate it to the role that approves it',
      )
    }
    const claim = needClaim(c, parent)
    if (claim._tag === 'MayNot') return claim
  }
  if (makes) {
    const open = [...w.assignments.values()].find((a) => {
      const s = d.states.assignments.get(a.id)
      const open = s?._tag === 'Working' || s?._tag === 'BriefOver' || s?._tag === 'Settled'
      return a.task === task && isDo(w, a.role) && open
    })
    if (open) {
      return no(`${t.name} already has an open Do assignment`, 'Pick', `${open.id} makes it`)
    }
    const need = t.needs.find((n) => d.states.tasks.get(n)?._tag !== 'Accepted')
    if (need !== undefined) {
      return no(
        `${task} needs ${need} (${w.tasks.get(need)?.name}), which is not accepted; its maker ` +
          'starts after that',
        'Wait',
        `give the maker when ${need} is accepted`,
      )
    }
    const stop = workStop(w, task)
    if (stop !== undefined) return no(stop, 'Wait', 'the evaluation, or its change, comes first')
  }
  const limit = maxOf(r.limits.Review.rules)
  if (limit !== undefined && r.acts.some((a) => a._tag === 'Review')) {
    const count = rulesOf(w, task).filter(
      (x) => x.checkedBy._tag === 'Role' && x.checkedBy.role === role,
    ).length
    if (count > limit) {
      return no(
        `${role} would check ${count} rules; the limit is ${limit}: split the task, so that ` +
          'each part has fewer rules, or shorten the rules (work guide limits)',
        'Escalate',
        'a high role splits the task',
      )
    }
  }
  return MAY
}
const RANK: Readonly<Record<string, number>> = { low: 1, medium: 2, high: 3 }
// A maker needs a decider: the giver, or an assignment above it, approves its role now.
const approverAbove = (c: Ctx, from: AssignmentId, role: string): boolean => {
  const { w } = c
  const at = c.d.moment.at
  for (let x: AssignmentId | undefined = from; x !== undefined;) {
    if (can(w, x, 'Approve', role, at)) return true
    const p: Assignment['parent'] | undefined = w.assignments.get(x)?.parent
    x = p?._tag === 'Parent' ? p.id : undefined
  }
  return false
}

const childOf = (_w: Work, child: Assignment, parent: AssignmentId): boolean =>
  child.parent._tag === 'Parent' && child.parent.id === parent

const free: Check<'Free'> = (c, { target: { assignment } }) => {
  const x = c.w.assignments.get(assignment)
  if (x === undefined) return exists(false, assignment, 'assignment')
  const by = agentOf(c)
  if (by !== undefined && !childOf(c.w, x, by.id)) {
    return no(`${x.id} is not your child`, 'Pick', 'free a child of yours')
  }
  return MAY
}

// Ruling 10.3: a parent does not end while a child still works on an open task (Working, or
// BriefOver: it works once its brief is short). A settled child ends with its parent
// (ParentEnded); OutOfTries and Ended children work no more.
const finish: Check<'Finish'> = (c, { target: { assignment } }) => {
  const { w, d } = c
  const x = w.assignments.get(assignment)
  if (x === undefined) return exists(false, assignment, 'assignment')
  const by = agentOf(c)
  if (by !== undefined && x.id !== by.id && !childOf(w, x, by.id)) {
    return no(`${x.id} is not your child`, 'Pick', 'finish yourself, or a child of yours')
  }
  const works = (y: Assignment): boolean => {
    const s = d.states.assignments.get(y.id)?._tag
    return s === 'Working' || s === 'BriefOver'
  }
  const working = [...w.assignments.values()].filter((y) => childOf(w, y, x.id) && works(y))
  const [child] = working
  if (child !== undefined) {
    const list = working.map((y) => `${y.id} (on ${y.task})`).join(', ')
    return no(
      `${x.id} has open children: ${list}; they still work on open tasks`,
      'Wait',
      `do your other steps until ${child.task} is accepted; a settled child ends with ${x.id}`,
    )
  }
  return MAY
}

const brief: Check<'Brief'> = (c, { target: { assignment } }) => {
  const { w, d } = c
  const a = w.assignments.get(assignment)
  if (a === undefined) return exists(false, assignment, 'assignment')
  const state = d.states.assignments.get(a.id)
  if (state?._tag === 'Ended') {
    return no(`${a.id} is finished`, 'Escalate', `do no more work for it; tell ${upTo(a)}`)
  }
  const claim = w.meta.get(a.id)?.claim
  if (claim !== undefined && claim._tag !== 'Free' && tierOfA(w, a) === 'low') {
    return no(
      `${a.id} is claimed since ${claim.since.slice(11, 16)} by another subagent`,
      'Escalate',
      `STOP and tell ${upTo(a)}`,
    )
  }
  const stop = isDo(w, a.role) && state?._tag === 'Working' ? workStop(w, a.task) : undefined
  if (stop) return no(stop, 'Wait', `STOP and tell ${upTo(a)}; the work goes on after it`)
  return MAY
}

const report: Check<'Report'> = (c, { target: { assignment } }) => {
  const { w, d } = c
  const a = w.assignments.get(assignment)
  if (a === undefined) return exists(false, assignment, 'assignment')
  const t = w.tasks.get(a.task)
  const name = labelOf(w, a.id)
  const at = d.moment.at
  if (!actsOf(w, a.id, at).some((x) => x._tag === 'Do')) {
    return no(`${name} has no Do act`, 'Escalate', `tell ${upTo(a)}`)
  }
  const state = d.states.assignments.get(a.id)
  if (state?._tag === 'Ended') {
    const closed = state.why._tag === 'TaskEnded'
    return no(
      closed ? `${t?.name} is closed` : `${name} is finished`,
      'Escalate',
      `tell ${upTo(a)}`,
    )
  }
  const stop = workStop(w, a.task)
  if (stop !== undefined) return no(stop, 'Wait', `STOP and tell ${upTo(a)}`)
  const task = d.states.tasks.get(a.task)
  if (task?._tag === 'Returned' || task?._tag === 'WaitsForEvaluation') {
    return no(`${t?.name} is returned until a change answers it`, 'Wait', `tell ${upTo(a)}`)
  }
  if (task?._tag === 'Accepted') {
    return no(`${t?.name} is accepted; a Reject or a change reopens it`, 'Wait', 'nothing to make')
  }
  const need = t?.needs.find((n) => d.states.tasks.get(n)?._tag !== 'Accepted')
  if (need !== undefined) {
    return no(
      `${a.task} needs ${need} (${w.tasks.get(need)?.name}), which is not accepted`,
      'Wait',
      `report when ${need} is accepted`,
    )
  }
  if (state?._tag === 'OutOfTries') {
    return no(`${name} has used its ${state.max} attempts`, 'Escalate', `tell ${upTo(a)}`)
  }
  return MAY
}

// --- reviews -------------------------------------------------------------------------------------

// Who may Accept or Reject a result or a task: its owner, a Change act on it, a role that
// covers or decides the maker.
const mayDecide = (c: Ctx, by: By, of: 'Result' | 'Task', id: string, task: string): boolean => {
  const { w } = c
  const at = c.d.moment.at
  const t = w.tasks.get(task as never)
  if (t === undefined) return false
  if (actorOf(w, by).name === t.owner.name || mayChange(w, by, t.id, at)) return true
  if (of === 'Result') {
    return coversMaker(w, by, id as never, at) || decidesResults(w, by, id as never, at)
  }
  return [...w.assignments.values()]
    .filter((a) => a.task === t.id && isDo(w, a.role))
    .some((a) => can(w, by, 'Review', a.role, at) || can(w, by, 'Approve', a.role, at))
}
const notYours = (c: Ctx, by: By, maker: Assignment | undefined, task: string): CanAct =>
  no(
    `${labelWithRole(c.w, by)} may not review this: ` +
      (maker !== undefined
        ? `a result is reviewed by a role that reviews or approves its maker (${maker.role})`
        : `only the owner of ${task}, or a role with a Change act on it, reviews it`),
    'Pick',
    'review a result of your own tree',
  )

// A low checker reviews the one result that its brief named (a task too: round2 C2). A newer
// result than that one means escalate; any other target means review the named one.
const lowChecks = (c: Ctx, target: string): CanAct => {
  const { w, d } = c
  const a = agentOf(c)
  if (a === undefined || tierOfA(w, a) !== 'low' || isDo(w, a.role)) return MAY
  const claim = w.meta.get(a.id)?.claim
  const briefed = claim?._tag === 'Checking' ? claim.result : undefined
  if (briefed === undefined) {
    const words = 'escalate that nothing was reported'
    return no('your brief named no result to review', 'Escalate', words)
  }
  if (briefed === target) return MAY
  const message = `your brief named ${briefed}; a low checker reviews only that result`
  return d.states.results.get(briefed)?._tag === 'Superseded'
    ? no(message, 'Escalate', `escalate with --result=${briefed}: ${target} came after your brief`)
    : no(message, 'Pick', `review ${briefed}`)
}

const reviewResult = (c: Ctx, result: string, accept: boolean): CanAct => {
  const { w, d } = c
  const r = w.results.get(result as never)
  if (r === undefined) return exists(false, result, 'result')
  const by = c.by
  if (by === undefined)
    return no('a review has an author', 'Pick', 'review as an agent or a person')
  const low = lowChecks(c, r.id)
  if (low._tag === 'MayNot') return low
  if (!mayDecide(c, by, 'Result', r.id, r.task)) {
    return notYours(c, by, w.assignments.get(r.by), r.task)
  }
  const at = d.moment.at
  const who = deciderOf(w, r.id)
  const now = decidingNow(w, r.id)
  const own = rulesOf(w, r.task).filter(
    (x) => x.checkedBy._tag === 'Role' && x.checkedBy.role === roleNameOf(w, by),
  )
  // A checker of its own rules reviews out of the deciders' turn (B3); whether a point names one
  // of its rules is content, the action's to check.
  const asChecker = own.length > 0
  if (
    who &&
    decidesResults(w, by, r.id, at) &&
    !turnOf(who, { by, when: at }, now, sameRole(w)) &&
    !asChecker
  ) {
    return no(
      `${roleNameOf(w, by) ?? 'person'} decides this result after the accept of ` +
        waitsForWords(who, now, sameRole(w)),
      'Wait',
      `decide it after ${waitsForWords(who, now, sameRole(w))}`,
    )
  }
  if (isCriticism(w, { by, of: { _tag: 'Result', id: r.id }, when: at })) {
    if (accept) {
      return no(
        `${actorOf(w, by).name} approves directions and standards; the accept of ` +
          `${decisionWaitsFor(w, r.id, [])} decides a result`,
        'Pick',
        'accept the end of the project, or a draft of a direction',
      )
    }
    if (!decisionMet(w, r.id, now)) {
      return no(
        `this result waits for the accept of ${decisionWaitsFor(w, r.id, now)}; criticise it ` +
          'after its deciders accept it',
        'Wait',
        `criticise it after ${decisionWaitsFor(w, r.id, now)}`,
      )
    }
  }
  return MAY
}

const rejectTask = (c: Ctx, task: string): CanAct => {
  const t = c.w.tasks.get(task as never)
  if (t === undefined) return exists(false, task, 'task')
  const low = lowChecks(c, task)
  if (low._tag === 'MayNot') return low
  if (c.by === undefined || !mayDecide(c, c.by, 'Task', task, task)) {
    return c.by === undefined ? MAY : notYours(c, c.by, undefined, task)
  }
  return MAY
}

// A low role reviews only results: no draft, no evaluation.
const lowReview = (c: Ctx, what: string): CanAct => {
  const a = agentOf(c)
  return a !== undefined && tierOfA(c.w, a) === 'low'
    ? no(`a low role does not review ${what}`, 'Escalate', 'escalate it to your parent')
    : MAY
}

// The checks of a review of a draft, and S2, S7: the owner's own accept, a twin rule id.
const reviewDraft = (c: Ctx, id: string, accept: boolean): CanAct => {
  const { w, d } = c
  const draft = w.drafts.get(id as never)
  if (draft === undefined) return exists(false, id, 'draft')
  const low = lowReview(c, 'drafts of directions')
  if (low._tag === 'MayNot') return low
  const by = c.by
  if (by === undefined)
    return no('a review has an author', 'Pick', 'review as an agent or a person')
  const direction = directionAt(w, draft.of)
  const state = d.states.revisions.get(draft.id)
  switch (state?._tag) {
    case 'Official':
      return no(
        `${id} is official: it made ${direction.name} v${versionNumberOf(state.version)}`,
        'Pick',
        'review an open draft',
      )
    case 'Outdated': {
      const on =
        draft._tag === 'Change'
          ? `is built on ${direction.name} v${versionNumberOf(draft.base)}, an old version`
          : `drafts ${direction.name} anew, and it has a version`
      return no(
        `${id} ${on} (${state.current} is current), so it stopped; a new draft changes ` +
          state.current,
        'Pick',
        `review a draft built on ${state.current}`,
      )
    }
    case 'Conflicted':
      if (!accept) break
      return no(
        state.with === draft.id
          ? `${id} has the rule id "${state.rule}" twice; revise with a new id`
          : draft.origin._tag === 'Imported'
            ? `the rule id "${state.rule}" of this company direction is used by another ` +
              'direction of the project; give one of them a new id (a company rule changes in ' +
              'its repo)'
            : `the rule id "${state.rule}" is already used by another direction; revise with a ` +
              'new id',
        'Pick',
        `pick which draft keeps the id "${state.rule}": reject this one, or revise ${state.with}`,
      )
    case 'Vetoed': {
      const veto = itemAt(w, state.by)
      return no(
        `${id} is ended by the Reject of ${veto ? labelOf(w, veto.by) : state.by}: ` +
          `${veto?.reason ?? ''}; its reviser revises the current version again`,
        'Pick',
        'review the next draft',
      )
    }
    default:
      break
  }
  const reviser: By =
    draft.origin._tag === 'Written'
      ? draft.origin.by
      : { _tag: 'Agent', name: 'refresh', run: draft.origin.commit }
  if (sameActor(w, by, reviser) || below(w, by, reviser)) {
    return no(
      `${id} is your own draft, or a draft from above you; another actor reviews it`,
      'Pick',
      'review a draft of another reviser',
    )
  }
  if (itemsOf(w, id).some((r) => sameActor(w, r.by, by))) {
    return no(`${labelOf(w, by)} already reviewed ${id}`, 'Pick', 'review another draft')
  }
  const who = decidersOfDraft(w, draft.id)
  const matches = draftMatches(w, draft.of)
  const accepts = draftAcceptItems(w, draft.id)
  const at = d.moment.at
  const acting = { by, when: at }
  // The turn is approvedBy's; the owner's own leaf (S2, A1-1) has no turn: an agent's accept is
  // stored, and the draft waits for the owner's accept as one more leaf.
  const turn = approvedByOfDraft(w, draft.id)
  if (
    leavesOf<DeciderLeaf>(turn).some((leaf) => matches(leaf, acting)) &&
    !turnOf<DraftLeaf>(turn, acting, accepts, matches)
  ) {
    const words = waitsForWords<DraftLeaf>(turn, accepts, matches)
    return no(
      `${labelOf(w, by)} reviews ${id} after the accept of ${words}`,
      'Wait',
      `review it after ${words}`,
    )
  }
  const owner = direction.owner.name
  const isOwner = isPerson(w, by) && actorOf(w, by).name === owner
  if (accept && draft._tag === 'New' && !isOwner) {
    const after = [...accepts, { by, when: at, at: w.clock + 1 }]
    if (metAt(who, after, matches) !== undefined) {
      return no(
        `${id} makes a new direction; ${owner} accepts it`,
        'Escalate',
        `${owner} accepts it`,
      )
    }
  }
  return MAY
}

const reviewEvaluation = (c: Ctx, id: string): CanAct => {
  const { w } = c
  const e = w.evaluations.get(id as never)
  if (e === undefined) return exists(false, id, 'evaluation')
  const low = lowReview(c, 'evaluations')
  if (low._tag === 'MayNot') return low
  const ref = stopRefOf(w, e.answers)
  const task = ref === undefined ? undefined : w.tasks.get(stopRefTask(w, ref))
  const by = c.by
  if (by === undefined || !isPerson(w, by)) {
    return no(
      'the person evaluates a change of a direction or a principle',
      'Escalate',
      'the owner of the task reviews it',
    )
  }
  const name = actorOf(w, by).name
  if (task !== undefined && name !== task.owner.name) {
    return no(
      `${name} is not the owner of ${task.id}; ${task.owner.name} accepts its evaluations`,
      'Escalate',
      `${task.owner.name} reviews it`,
    )
  }
  if (countsWhenWritten(e)) {
    return no(
      `an evaluation at the level ${e.level} counts when it is written`,
      'Pick',
      'nothing to review',
    )
  }
  const decided = evaluationDecision(w, e)
  if (decided) {
    return no(
      `the evaluation is already ${decided._tag === 'Accept' ? 'accepted' : 'rejected'}`,
      'Pick',
      'review a newer evaluation',
    )
  }
  return MAY
}

const acceptOf: Check<'Accept'> = (c, { target: { of } }) =>
  first(
    () => agentOpen(c),
    () =>
      of._tag === 'Result'
        ? reviewResult(c, of.id, true)
        : of._tag === 'Revision'
          ? reviewDraft(c, of.id, true)
          : reviewEvaluation(c, of.id),
  )
const rejectOf: Check<'Reject'> = (c, { target: { of } }) =>
  first(
    () => agentOpen(c),
    () => {
      switch (of._tag) {
        case 'Result':
          return reviewResult(c, of.id, false)
        case 'Task':
          return rejectTask(c, of.id)
        case 'Revision':
          return reviewDraft(c, of.id, false)
        case 'Evaluation':
          return reviewEvaluation(c, of.id)
      }
    },
  )

// A recheck asks for new work after a change outside, or reopens accepted work.
const recheck: Check<'Recheck'> = (c, { target: { result } }) => {
  const { w, d } = c
  const a = agentOf(c)
  if (a === undefined) return no("a recheck is an agent's act", 'Pick', 'an agent asks for it')
  const r = w.results.get(result)
  if (r === undefined) return exists(false, result, 'result')
  if (tierOfA(w, a) === 'low') {
    return no('a low role does not ask for a recheck; escalate it', 'Escalate', 'escalate it')
  }
  if (!within(w, r.task, a.task)) {
    return no(`${result} is outside the task tree of ${a.id}`, 'Pick', 'name a result of your tree')
  }
  const task = w.tasks.get(r.task)
  if (task !== undefined && !isOpenTask(task)) {
    return no(
      `${r.task} is closed; it takes no new result, so a recheck cannot be answered`,
      'Pick',
      'name a result of an open task',
    )
  }
  const outside =
    d.moment.outside.stale.has(r.id) ||
    blockersOfResult(w, r.id).some((i) => i._tag === 'OldNeed' || i._tag === 'OldVersion') ||
    directionIdsOf(w, r.task).some((x) => recheckRules(w, r.id, x).length > 0)
  if (!outside && d.states.results.get(r.id)?._tag !== 'Accepted') {
    return no(
      `nothing changed outside since ${result} was made, and it is not accepted, so a recheck ` +
        'would be a free try',
      'Pick',
      `review it with a point of what is wrong, or escalate what changed`,
    )
  }
  if (!mayDecide(c, a.id, 'Result', r.id, r.task))
    return notYours(c, a.id, w.assignments.get(r.by), r.task)
  return needClaim(c, a)
}

const escalateResult: Check<'EscalateResult'> = (c, { target: { result } }) => {
  const a = agentOf(c)
  if (a === undefined) return no("an escalation is an agent's act", 'Pick', 'an agent escalates')
  const r = c.w.results.get(result)
  if (r === undefined) return exists(false, result, 'result')
  if (!within(c.w, r.task, a.task)) {
    return no(`${result} is outside the task tree of ${a.id}`, 'Pick', 'name a result of your tree')
  }
  return MAY
}
const escalateTask: Check<'EscalateTask'> = (c) =>
  agentOf(c) === undefined
    ? no("an escalation is an agent's act", 'Pick', 'an agent escalates')
    : MAY

const resolve: Check<'Resolve'> = (c, { target: { escalation } }) => {
  const { w, d } = c
  const e = w.reviews.get(escalation)
  if (e?._tag !== 'Escalate') {
    return no(
      `${escalation} is not an escalation; a resolve ends an escalation`,
      'Pick',
      'name an escalation that waits for you',
    )
  }
  const state = d.states.escalations.get(escalation)
  if (state?._tag === 'Resolved') {
    return no(`${escalation} is resolved already`, 'Pick', 'name an escalation that waits')
  }
  if (state?._tag === 'Irrelevant') {
    return no(
      state.why._tag === 'ResultSuperseded'
        ? `${escalation} is irrelevant: ${state.why.by} came after ${e.of}`
        : `${escalation} is irrelevant: its task ${state.why.task} ended`,
      'Pick',
      'name an escalation that waits',
    )
  }
  const by = c.by
  if (by === undefined) return MAY
  const answerer = state?._tag === 'Open' ? state.answerer : e.answerBy
  const isAnswerer =
    typeof answerer === 'string' ? by === answerer : actorOf(w, by).name === answerer.name
  const allowed =
    !sameActor(w, by, e.by) &&
    (isAnswerer || (typeof answerer === 'string' && decidesResults(w, by, e.of, d.moment.at)))
  if (!allowed) {
    return no(
      `${labelOf(w, by)} may not resolve "${e.reason}"`,
      'Pick',
      `${answererLabel(w, answerer)} resolves it`,
    )
  }
  return MAY
}

const ask: Check<'Ask'> = (c, { target: { to } }) => {
  const a = agentOf(c)
  if (a === undefined) return no("a question is an agent's act", 'Pick', 'an agent asks')
  if (tierOfA(c.w, a) === 'low' && to === 'Owner') {
    return no('a low role asks its parent', 'Pick', 'ask your parent')
  }
  // The host answers from the directions; it asks nobody above it.
  const host = hostOf(c.d.moment, { _tag: 'OnTask', task: a.task }, c.d.states)
  const above = a.parent._tag === 'Parent' && to === 'Above'
  if (host._tag === 'Host' && host.assignment === a.id && !above) {
    return no(
      'you are the host of this project: answer it from the directions; when a direction reads ' +
        'two ways, draft its change (work direction revise), and the person accepts it',
      'Write',
      'answer it from the directions, or draft the change of the direction',
    )
  }
  return MAY
}

const answer: Check<'Answer'> = (c, { target: { question } }) => {
  const { w, d } = c
  const q = w.questions.get(question)
  if (q === undefined) return exists(false, question, 'question')
  const state = d.states.questions.get(question)
  if (state?._tag === 'Answered') {
    return no(
      `the question is answered already: "${state.answer}"`,
      'Pick',
      'answer another question',
    )
  }
  if (state?._tag === 'Irrelevant') {
    return no(
      `${question} is irrelevant: its task ${state.task} ended`,
      'Pick',
      'answer another question',
    )
  }
  const by = c.by
  if (by === undefined || state?._tag !== 'Open') return MAY
  const now = state.answerer
  const yes = typeof now === 'string' ? by === now : actorOf(w, by).name === now.name
  if (!yes) {
    return no(
      `${answererLabel(w, now)} answers this question, not ${labelOf(w, by)}`,
      'Pick',
      `${answererLabel(w, now)} answers it`,
    )
  }
  return MAY
}

// An evaluation answers one stop: the high role of the task's tree, or its owner.
const evaluate: Check<'Evaluate'> = (c, { target: { stop } }) => {
  const { w } = c
  const ref = stopRefOf(w, stop)
  const isStop = ref !== undefined && (ref._tag === 'Exhaustion' || isPersonStop(w, ref.item))
  if (ref === undefined || !isStop) {
    return no(
      'an evaluation answers a stop: the last try of a maker that ended on a fault, or a Reject ' +
        'of the person',
      'Pick',
      'name a stop that waits for an evaluation',
    )
  }
  const task = w.tasks.get(stopRefTask(w, ref))
  if (task === undefined) return exists(false, stopRefTask(w, ref), 'task')
  if (!isOpenTask(task)) return no(`${task.id} is closed`, 'Pick', 'name a stop of an open task')
  const by = c.by
  const person = by !== undefined && isPerson(w, by)
  if (person && by !== undefined && actorOf(w, by).name !== task.owner.name) {
    return no(
      `${actorOf(w, by).name} is not the owner of ${task.id}; ${task.owner.name} evaluates its ` +
        'mistakes',
      'Escalate',
      `${task.owner.name} evaluates it`,
    )
  }
  const a = agentOf(c)
  if (!person && a !== undefined) {
    const label = labelOf(w, a.id)
    const tier = tierOfA(w, a)
    if (tier !== 'high') {
      return no(
        `${label} is ${tier}; only a high role evaluates a stop: escalate it to your parent`,
        'Escalate',
        'escalate it to your parent',
      )
    }
    if (!within(w, task.id, a.task)) {
      return no(
        `${task.id} is outside the task tree of ${label}`,
        'Pick',
        'name a stop of your tree',
      )
    }
  }
  if (stopRefAnswered(w, ref)) {
    return no(
      `${stopText(w, ref)} already has an evaluation that counts`,
      'Pick',
      'nothing to evaluate',
    )
  }
  if (!person) {
    const key = stopKey(w, stop)
    const pending = [...w.evaluations.values()].find(
      (e) => stopKey(w, e.answers) === key && !evaluationDecision(w, e) && !evaluationCounts(w, e),
    )
    if (pending) {
      return no(
        `an evaluation of ${task.id} at the level ${pending.level} waits for ` +
          `${task.owner.name}'s accept; a new one comes after that answer`,
        'Wait',
        `${task.owner.name} answers ${pending.id} first`,
      )
    }
  }
  return MAY
}

// --- the change of a task ------------------------------------------------------------------------

// The Rejects that a split or a remake answers: a point with no rule, the person's only by that
// person, and only after its evaluation.
const answersOk = (
  c: Ctx,
  task: string,
  answers: string | null,
  act: 'split' | 'remake',
): CanAct => {
  const { w } = c
  const by = c.by
  if (by === undefined) return MAY
  const list = answers === null ? [] : itemsOfAnswer(w, answers)
  for (const r of list) {
    const reason = r.reason ?? ''
    if (isPerson(w, r.by) && actorOf(w, r.by).name !== actorOf(w, by).name) {
      return no(
        `"${reason}" is the person's Reject; only that person's own ${act} answers it, or a ` +
          'direction change',
        'Pick',
        'answer it with a direction change, or leave it for the person',
      )
    }
    const of = taskOfTarget(w, r.of)
    const about =
      act === 'split'
        ? of === task
        : r.of._tag !== 'Revision' && of !== undefined && within(w, of, task as never)
    if (!about) {
      return no(
        `"${reason}" is not about ${task}; a ${act} answers only a Reject of its own task`,
        'Pick',
        `name a Reject of ${task}`,
      )
    }
    if (isPersonStop(w, r) && !stopRefAnswered(w, { _tag: 'Item', item: r, at: r.at })) {
      return no(
        `"${reason}" waits for an evaluation of ${of} first: what is wrong, why, and what to ` +
          'improve',
        'Wait',
        'the evaluation comes first',
      )
    }
    if (r.breaks !== undefined) {
      return no(
        `"${reason}" names the rule ${w.rules.get(r.breaks)?.id}; changed work with evidence ` +
          `answers it, not a ${act}`,
        'Pick',
        'answer it with changed work',
      )
    }
  }
  if (!isPerson(w, by)) {
    const point = personRejectItems(w, task as never, false).find(
      (r) => r.breaks === undefined && !r.redo && !list.some((x) => x.id === r.id),
    )
    if (point) {
      return no(
        `"${point.reason ?? ''}" is the person's open point on ${task}; only that person's own ` +
          `${act} answers it`,
        'Escalate',
        'the person splits or remakes it',
      )
    }
  }
  return MAY
}
// The Rejects that a split or a remake names: the points of a Reject, or one point.
const itemsOfAnswer = (w: Work, id: string): ReadonlyArray<Item> => {
  const points = reviewItems(w).filter((i) => i.group === id)
  if (points.length > 0) return points
  const item = itemAt(w, id)
  return item === undefined || item.review._tag !== 'Reject' ? [] : [item]
}

const changeTask = (c: Ctx, task: string): CanAct => {
  const t = c.w.tasks.get(task as never)
  if (t === undefined) return exists(false, task, 'task')
  if (c.by !== undefined && !mayChange(c.w, c.by, t.id, c.d.moment.at)) {
    return no(
      `${labelOf(c.w, c.by)} has no change act on ${t.name}`,
      'Escalate',
      `${t.owner.name} changes it`,
    )
  }
  return MAY
}
// A change of a task is the person's, or a high role's (before its change act, as the old CLI).
const highChange = (c: Ctx, act: 'split' | 'remake' | 'close', words: string): CanAct =>
  highOnly(c, (tier) => `a ${tier} role does not ${act} tasks`, 'Escalate', words)
const split: Check<'SplitTask'> = (c, { target: { task, answers } }) =>
  first(
    () => agentOpen(c),
    () => highChange(c, 'split', 'escalate what the split would do'),
    () => changeTask(c, task),
    () => {
      const { w } = c
      const t = w.tasks.get(task)
      if (t === undefined) return MAY
      if (!isOpenTask(t))
        return no(`${task} is closed; a closed task takes no parts`, 'Pick', 'split an open task')
      if (partsOf(w, task).some(isOpenTask)) {
        return no(
          `${task} already has parts; split a part, or remake ${task}`,
          'Pick',
          `split a part of ${task}`,
        )
      }
      const waits = c.by !== undefined && !isPerson(w, c.by) && evaluationWaitsRef(w, task)
      if (waits) {
        return no(
          `${task} waits for an evaluation of ${stopText(w, waits)}; a split comes after it`,
          'Wait',
          'the evaluation comes first',
        )
      }
      return answersOk(c, task, answers, 'split')
    },
  )
const remake: Check<'RemakeTask'> = (c, { target: { task, answers } }) =>
  first(
    () => agentOpen(c),
    () => highChange(c, 'remake', 'escalate what the remake would do'),
    () => changeTask(c, task),
    () => {
      const { w } = c
      const t = w.tasks.get(task)
      if (t === undefined) return MAY
      if (!isOpenTask(t))
        return no(`${task} is closed; a closed task is not remade`, 'Pick', 'remake an open task')
      const agent = c.by !== undefined && !isPerson(w, c.by)
      if (agent) {
        for (const x of [...w.tasks.values()].filter(
          (y) => isOpenTask(y) && within(w, y.id, task),
        )) {
          const waits = evaluationWaitsRef(w, x.id)
          if (waits) {
            return no(
              `${x.id} waits for an evaluation of ${stopText(w, waits)}; a remake comes after it`,
              'Wait',
              'the evaluation comes first',
            )
          }
        }
      }
      const inner = [...w.tasks.values()].find(
        (x) =>
          isOpenTask(x) &&
          !within(w, x.id, task) &&
          x.needs.some((n) => n !== task && within(w, n, task)),
      )
      if (inner) {
        return no(
          `${inner.id} needs a part of ${task}; remake ${inner.id} first`,
          'Pick',
          `remake ${inner.id} first`,
        )
      }
      const ok = answersOk(c, task, answers, 'remake')
      if (ok._tag === 'MayNot') return ok
      // C4: a Reject of a part that ended does not count (personRejectItems skips it).
      const listed = answers === null ? [] : itemsOfAnswer(w, answers).map((x) => x.id)
      const point = agent
        ? personRejectItems(w, task, true).find((r) => !listed.includes(r.id))
        : undefined
      if (point) {
        return no(
          `"${point.reason ?? ''}" is the person's open Reject in ${task}; a remake would drop it`,
          'Escalate',
          'the person answers it, or remakes the task',
        )
      }
      return MAY
    },
  )
const close: Check<'CloseTask'> = (c, { target: { task } }) =>
  first(
    () => agentOpen(c),
    () => highChange(c, 'close', 'escalate why the task closes'),
    () => changeTask(c, task),
    () => {
      const { w } = c
      const needer = neederOf(w, task)
      if (needer) {
        const need = needer.needs.find((n) => within(w, n, task))
        return no(
          `${needer.id} needs ${need}; without it the scope of ${needer.id} changes: remake ` +
            needer.id,
          'Pick',
          `remake ${needer.id} first`,
        )
      }
      if (c.by === undefined || isPerson(w, c.by)) return MAY
      // C4: a Reject of a part that ended does not count.
      const point = personRejectItems(w, task, true)[0]
      if (point) {
        // The words of the old CLI: the point's id, on the task of what it rejects.
        const on = taskOfTarget(w, point.of) ?? task
        return no(
          `${point.id} is the person's open Reject on ${on}; a close would drop it`,
          'Escalate',
          'the person answers it, or closes the task',
        )
      }
      for (const t of [...w.tasks.values()].filter((y) => isOpenTask(y) && within(w, y.id, task))) {
        const waits = evaluationWaitsRef(w, t.id)
        if (waits) {
          return no(
            `${t.id} waits for an evaluation of ${stopText(w, waits)}; a close comes after it`,
            'Wait',
            'the evaluation comes first',
          )
        }
      }
      return MAY
    },
  )

// --- directions ----------------------------------------------------------------------------------

// A model drafts a direction: a high role, or a run outside any task; the person suggests.
const draftDirection: Check<'DraftDirection'> = (c) => {
  if (c.actor._tag === 'Person') {
    return no(
      'the person gives direction in words: work suggest --says="<the direction that is ' +
        'missing>"; a model drafts it, and you accept or reject it',
      'Write',
      'suggest the direction in words; a model drafts it',
    )
  }
  return highOnly(
    c,
    (tier) => `a ${tier} role does not draft directions`,
    'Write',
    'suggest it in words instead',
  )
}
const revise: Check<'ReviseDirection'> = (c, intent) =>
  first(
    () =>
      highOnly(
        c,
        (tier) => `a ${tier} role does not revise directions; escalate it, or suggest it`,
        'Write',
        'suggest the change in words',
      ),
    () => reviseOf(c, intent),
  )
const reviseOf: Check<'ReviseDirection'> = (c, { target: { direction } }) => {
  const { w } = c
  const d = w.directions.get(direction)
  if (d === undefined) return no(`there is no direction "${direction}"`, 'Pick', 'name a direction')
  // B2: a company direction changes in its repo.
  if (d.source._tag === 'External') {
    return no(
      `${direction} is a company direction from ${d.source.repo} (${d.source.path}); it changes ` +
        'there, with a pull request. Suggest the change',
      'Escalate',
      `suggest the change of ${direction}; its repo takes a pull request`,
    )
  }
  if (d._tag !== 'Official') {
    return no(
      `${direction} has no version yet; a draft of it is the whole direction`,
      'Pick',
      'draft the whole direction anew',
    )
  }
  if (c.by !== undefined && isPerson(w, c.by)) {
    return no(
      `the person gives direction in words, as a suggestion about ${d.name}`,
      'Write',
      `suggest the change of ${direction} in words; a high role writes the draft`,
    )
  }
  return agentOpen(c)
}

// --- runs, problems, terminals, sends ------------------------------------------------------------

const runNamed = (c: Ctx, run: string): CanAct => exists(c.w.runs.has(run as never), run, 'run')
const continueRun: Check<'ContinueRun'> = (c, { target: { run } }) =>
  first(
    () => runNamed(c, run),
    () => {
      const r = c.w.runs.get(run)
      if (r?.end._tag === 'Done') return no(`${run} is done`, 'Pick', 'start a new run')
      if (r?.end._tag === 'Closed') return no(`${run} is closed`, 'Pick', 'start a new run')
      return MAY
    },
  )
const endRun: Check<'EndRun'> = (c, { target: { run } }) =>
  first(
    () => runNamed(c, run),
    () => {
      const r = c.w.runs.get(run)
      const state = c.d.states.runs.get(run)
      if (r?.end._tag === 'Done') return no(`${run} is done`, 'Pick', 'nothing to end')
      if (r?.end._tag === 'Closed') return no(`${run} is closed`, 'Pick', 'nothing to end')
      if (state?._tag !== 'AwaitingEndAccept') {
        const opened = openedTopOf(c.w, run)
        const top = opened === undefined ? undefined : currentTask(c.w, opened)
        return no(
          `${run} is not done: its top task is not accepted${top ? ` (${top})` : ''}`,
          'Wait',
          'end it when its top task is accepted',
        )
      }
      return MAY
    },
  )
// A page Close is CloseTask, then CloseRun: the run's own end, not its RunState, decides here.
const closeRun: Check<'CloseRun'> = (c, { target: { run } }) =>
  first(
    () => runNamed(c, run),
    () => {
      const r = c.w.runs.get(run)
      if (r?.end._tag === 'Closed') return no(`${run} is closed`, 'Pick', 'nothing to close')
      if (r?.end._tag === 'Done')
        return no(`${run} is done; a done project stays done`, 'Pick', 'nothing to close')
      return MAY
    },
  )
const draftTask: Check<'DraftTask'> = (c, { target: { run } }) =>
  first(
    () => runNamed(c, run),
    () => {
      const r = c.w.runs.get(run)
      if (r?.end._tag === 'Closed') return no(`${run} is closed`, 'Pick', 'start a new run')
      const top = openedTopOf(c.w, run)
      if (top !== undefined) {
        return no(
          `${run} has its top task ${top}; a part of it comes from a split`,
          'Pick',
          `split ${top}`,
        )
      }
      return MAY
    },
  )
// S3: only a draft that waits is opened.
const openFromDraft: Check<'OpenTaskFromDraft'> = (c, { target: { draft } }) => {
  const x = c.w.taskDrafts.get(draft)
  if (x === undefined) return exists(false, draft, 'task draft')
  const state = c.d.states.taskDrafts.get(draft)
  if (state?._tag === 'Opened')
    return no(`${draft} is opened as ${state.task}`, 'Pick', `open ${state.task}`)
  if (state?._tag === 'Dropped') {
    const top = openedTopOf(c.w, x.run)
    return top !== undefined
      ? no(`${x.run} has its top task ${top}`, 'Pick', `work on ${top}`)
      : no(`${x.run} is closed; its drafts stay closed`, 'Pick', 'start a new run')
  }
  return MAY
}
// An agent records and fixes the problems of its own project only.
const ownProject = (c: Ctx, task: string): CanAct => {
  const a = agentOf(c)
  if (a === undefined) return MAY
  const top = (t: string) => currentTask(c.w, rootOf(c.w, t as never))
  if (top(a.task) === top(task)) return MAY
  return no(
    `${a.id} works in another project; the host of that project records its problems`,
    'Pick',
    'record a problem of your own project',
  )
}
// The host (a high role) or the person records and fixes a problem; the old CLI checked the tier
// before it read the target.
const hostProblem = (c: Ctx): CanAct =>
  first(
    () => agentOpen(c),
    () => highOnly(c, () => HOST_PROBLEM, 'Escalate', 'escalate it to your parent'),
  )
const recordProblem: Check<'RecordProblem'> = (c, { target: { task } }) => {
  const host = hostProblem(c)
  if (host._tag === 'MayNot') return host
  const t = c.w.tasks.get(task)
  if (t === undefined) return exists(false, task, 'task')
  if (!isOpenTask(t)) {
    return no(`${task} is closed; a closed task is stopped by nothing`, 'Pick', 'name an open task')
  }
  return ownProject(c, task)
}
const fixProblem: Check<'FixProblem'> = (c, { target: { problem } }) => {
  const host = hostProblem(c)
  if (host._tag === 'MayNot') return host
  const p = c.w.problems.get(problem)
  if (p === undefined) return exists(false, problem, 'problem')
  if (p.fixed._tag === 'Fixed') return no(`${problem} is fixed`, 'Pick', 'nothing to fix')
  return ownProject(c, p.stopped)
}
const DIR_WORDS = 'only the host of a project writes the words of a decision'
const hostWords: Check<'WriteHostWords'> = (c, { target: { on } }) => {
  const a = agentOf(c)
  if (a === undefined) return MAY
  const task = decisionTaskOf(c.w, on) ?? a.task
  const host = hostOf(c.d.moment, placementOf(c.d.moment, task, c.d.states), c.d.states)
  const own = hostOf(c.d.moment, { _tag: 'OnTask', task: a.task }, c.d.states)
  const isHost =
    (host._tag === 'Host' && host.assignment === a.id) ||
    (own._tag === 'Host' && own.assignment === a.id)
  return isHost ? MAY : no(DIR_WORDS, 'Escalate', 'the host of the project writes them')
}
const startSession: Check<'StartSession'> = (c, { target: { assignment } }) => {
  const a = c.w.assignments.get(assignment)
  if (a === undefined) return exists(false, assignment, 'assignment')
  return c.d.states.assignments.get(a.id)?._tag === 'Ended'
    ? no(`${a.id} is finished`, 'Pick', 'start a terminal for an open assignment')
    : MAY
}
const runOfSession = (w: Work, session: string) =>
  [...w.runs.values()].find((r) => r.session === session)
// S10: the host's own pane is the person's terminal: the page neither stops nor resumes it.
const stopTerminal: Check<'StopTerminal'> = (c, { target: { session } }) => {
  const run = runOfSession(c.w, session)
  if (run?.terminal._tag === 'Pane') {
    return no(
      `${session} is the host's own pane, the person's terminal; the page does not stop it`,
      'Pick',
      'stop the AI CLI in its own pane',
    )
  }
  return MAY
}
const resumeTerminal: Check<'ResumeTerminal'> = (c, { target: { session } }) => {
  const run = runOfSession(c.w, session)
  if (run !== undefined) {
    const state = c.d.states.runs.get(run.id)
    if (run.terminal._tag === 'Pane') {
      return no(
        `${session} is the host's own pane, the person's terminal; the page does not resume it`,
        'Pick',
        'trigger the host again in its own pane',
      )
    }
    if (state?._tag === 'Done' || state?._tag === 'Closed') {
      return no(
        `${run.id} is ${state._tag === 'Done' ? 'done' : 'closed'}`,
        'Pick',
        'start a new run',
      )
    }
  }
  const a = [...c.w.sessions.values()].find((s) => s.session === session)?.assignment
  if (a !== undefined && c.d.states.assignments.get(a)?._tag === 'Ended') {
    return no(`${a} is finished`, 'Pick', 'resume the terminal of open work')
  }
  return MAY
}
const send: Check<'Send'> = (c, { target: { session } }) => {
  const a = agentOf(c)
  if (a === undefined) return MAY
  const role = roleAt(c.w, a.role)
  if (role._tag !== 'Model' || role.tier !== 'high') {
    return no(
      'only the host (a Sol) sends input to the terminal of a child',
      'Escalate',
      'tell your parent',
    )
  }
  const to = [...c.w.sessions.values()].find((s) => s.session === session)?.assignment
  const child = to === undefined ? undefined : c.w.assignments.get(to)
  if (child !== undefined && (child.id === a.id || !within(c.w, child.task, a.task))) {
    return no(`${child.id} is not a child of ${a.id}`, 'Pick', 'send to a child of yours')
  }
  return MAY
}
// Only the top agent (medium or high, with no parent) forwards the person.
const topForwards = (c: Ctx): CanAct => {
  const a = agentOf(c)
  if (a === undefined) return MAY
  if (a.parent._tag !== 'Parent' && tierOfA(c.w, a) !== 'low') return MAY
  return no(
    'only the top agent (medium or high, with no parent) forwards the person',
    'Escalate',
    'ask your parent',
  )
}
const confirm: Check<'Confirm'> = (c, { target: { forward } }) => {
  const f = c.w.forwards.get(forward)
  const state = c.d.states.forwards.get(forward)
  if (f === undefined || f._tag !== 'Confirmable' || state?._tag === 'Confirmed') {
    return no(
      `${forward} is not a forwarded act that waits for a confirm`,
      'Pick',
      'confirm another',
    )
  }
  if (state?._tag === 'Irrelevant') {
    return no(`${forward} waits for nothing: ${state.why._tag}`, 'Pick', 'confirm another')
  }
  const person = personOfForward(c.w, forward)
  const who = c.actor._tag === 'Person' ? c.actor.name : ''
  if (person !== who)
    return no(`${forward} is ${person}'s to confirm`, 'Escalate', `${person} confirms it`)
  return MAY
}
const revoke: Check<'Revoke'> = (c, { target: { permission } }) => {
  const x = c.w.permissions.get(permission)
  if (x === undefined) return exists(false, permission, 'permission')
  if (c.by !== undefined && !sameActor(c.w, c.by, x.by)) {
    return no('only the giver revokes a permission', 'Escalate', 'the giver revokes it')
  }
  if (x.revoked._tag === 'Revoked') {
    return no(`this permission is already revoked, at ${x.revoked.at}`, 'Pick', 'nothing to revoke')
  }
  return MAY
}
const grant: Check<'Grant'> = (c, { target: { act, to } }) => {
  if (!c.w.workflow.roles.has(to))
    return no(`there is no role "${to}"`, 'Pick', 'name a role of the workflow')
  if (c.by !== undefined && !mayGive(c.w, c.by, act, c.d.moment.at)) {
    return no(
      `${labelOf(c.w, c.by)} may not give this act`,
      'Escalate',
      'one who has the act gives it',
    )
  }
  return MAY
}
const taskNamed = (c: Ctx, task: string): CanAct =>
  exists(c.w.tasks.has(task as never), task, 'task')
const lowNo = (c: Ctx, message: string, words: string): CanAct => {
  const a = agentOf(c)
  return a !== undefined && tierOfA(c.w, a) === 'low' ? no(message, 'Escalate', words) : MAY
}
// New words of a role (ruling 2026-11-14): a high role or a model run outside any task drafts
// them, and the person accepts or rejects them; the person writes their own in the file.
const draftRoleWords: Check<'DraftRoleWords'> = (c, { target: { role } }) => {
  if (c.actor._tag === 'Person') {
    return no(
      `the person writes the words of ${role} in aristoteles.yaml, then runs work config apply`,
      'Write',
      `write the new words of ${role} in aristoteles.yaml, then apply them`,
    )
  }
  if (!c.w.workflow.roles.has(role)) {
    return no(`there is no role "${role}"`, 'Pick', 'name a role of the workflow')
  }
  return highOnly(
    c,
    (tier) => `a ${tier} role does not draft the words of a role; escalate them`,
    'Escalate',
    'escalate the new words of the role to your parent',
  )
}
// Only the person decides a draft of role words, and only one that waits.
const decideRoleWords = (c: Ctx, draft: EventRef): CanAct => {
  if (c.actor._tag !== 'Person') {
    return no(
      'only the person accepts or rejects new words of a role',
      'Escalate',
      'the person decides them on the page; work waiting --for=<person> lists them',
    )
  }
  const state = c.d.states.roleWords.get(draft)
  const waits = 'name a draft that work waiting lists'
  switch (state?._tag) {
    case undefined:
      return no(`${draft} is no draft of the words of a role`, 'Pick', waits)
    case 'Waiting':
      return MAY
    case 'Replaced':
      return no(`${draft} is replaced by ${state.by}, a newer draft of the role`, 'Pick', waits)
    case 'Accepted':
      return no(`${draft} is accepted already (${state.by})`, 'Pick', waits)
    case 'Rejected':
      return no(`${draft} is rejected already (${state.by})`, 'Pick', waits)
  }
}

const CHECKS: { readonly [K in ActionTag]: Check<K> } = {
  DefineWorkflow: () =>
    no('the store has a config; use work config apply', 'Pick', 'apply the config'),
  ApplyConfig: () => MAY,
  RestoreConfig: () => MAY,
  FitRole: (c) =>
    highOnly(
      c,
      () => 'a person or a high role records role fitness',
      'Escalate',
      'the person or a high role fits it',
    ),
  DraftRoleWords: draftRoleWords,
  AcceptRoleWords: (c, { target: { draft } }) => decideRoleWords(c, draft),
  RejectRoleWords: (c, { target: { draft } }) => decideRoleWords(c, draft),
  SaveSettings: () => MAY,
  JoinRun: () => MAY,
  ContinueRun: continueRun,
  EndRun: endRun,
  CloseRun: closeRun,
  DraftTask: draftTask,
  RecordProblem: recordProblem,
  FixProblem: fixProblem,
  WriteHostWords: hostWords,
  StartSession: startSession,
  ReportTerminal: () => MAY,
  StopTerminal: stopTerminal,
  ResumeTerminal: resumeTerminal,
  Send: send,
  SupervisorSend: () => MAY,
  SendDelivered: () => MAY,
  SendDropped: () => MAY,
  OpenTask: () => MAY,
  OpenTaskFromDraft: openFromDraft,
  SplitTask: split,
  RemakeTask: remake,
  CloseTask: close,
  DescribeTask: (c, i) => taskNamed(c, i.target.task),
  Give: (c, i) =>
    first(
      () => agentOpen(c),
      () => give(c, i),
    ),
  Free: (c, i) =>
    first(
      () => agentOpen(c),
      () => free(c, i),
    ),
  Finish: finish,
  Brief: brief,
  Report: report,
  Accept: acceptOf,
  Reject: rejectOf,
  Recheck: (c, i) =>
    first(
      () => agentOpen(c),
      () => recheck(c, i),
    ),
  EscalateResult: (c, i) =>
    first(
      () => agentOpen(c),
      () => escalateResult(c, i),
    ),
  EscalateTask: (c, i) =>
    first(
      () => agentOpen(c),
      () => escalateTask(c, i),
    ),
  Resolve: (c, i) =>
    first(
      () => agentOpen(c),
      () => resolve(c, i),
    ),
  Ask: (c, i) =>
    first(
      () => agentOpen(c),
      () => ask(c, i),
    ),
  Answer: (c, i) =>
    first(
      () => agentOpen(c),
      () => answer(c, i),
    ),
  Note: (c, i) =>
    first(
      () => agentOpen(c),
      () => taskNamed(c, i.target.task),
    ),
  Evaluate: (c, i) =>
    first(
      () => agentOpen(c),
      () => evaluate(c, i),
    ),
  Checkpoint: (c, i) =>
    first(
      () => agentOpen(c),
      () => lowNo(c, 'a low role does not checkpoint; report or escalate', 'report or escalate'),
      () => taskNamed(c, i.target.task),
    ),
  ReadSource: (c) =>
    first(
      () => agentOpen(c),
      () => lowNo(c, 'a low role records no source', 'stop and tell your parent what changed'),
    ),
  DraftDirection: draftDirection,
  ReviseDirection: revise,
  ImportCompany: () => MAY,
  Suggest: (c) => agentOpen(c),
  Grant: (c, i) =>
    first(
      () => agentOpen(c),
      () => grant(c, i),
    ),
  Revoke: (c, i) =>
    first(
      () => agentOpen(c),
      () => revoke(c, i),
    ),
  Forward: (c) =>
    first(
      () => agentOpen(c),
      () => topForwards(c),
    ),
  Confirm: confirm,
}

// The guard of every act of an agent (the old CLI's guard table): its assignment is open, it read
// its brief in this attempt where the act needs a claim, and the act's target is in its tree.
// Give, Recheck, Free and Finish check these in their own rows above.
const CLAIMED: ReadonlySet<ActionTag> = new Set<ActionTag>([
  'SplitTask',
  'RemakeTask',
  'CloseTask',
  'Report',
  'Accept',
  'Reject',
  'Resolve',
  'Evaluate',
  'DraftDirection',
  'ReviseDirection',
  'DraftRoleWords',
  'Forward',
  'Grant',
  'Revoke',
])
// The record that an act names and the task that holds it; undefined: no task (a draft).
const targetOf = (w: Work, intent: Intent): readonly [string, TaskId] | undefined => {
  switch (intent._tag) {
    case 'SplitTask':
    case 'RemakeTask':
    case 'CloseTask':
    case 'Checkpoint':
      return [intent.target.task, intent.target.task]
    case 'Accept':
    case 'Reject': {
      const of = intent.target.of
      if (of._tag === 'Task') return [of.id, of.id]
      const task = of._tag === 'Result' ? w.results.get(of.id)?.task : undefined
      return task === undefined ? undefined : [of.id, task]
    }
    case 'Resolve': {
      const e = w.reviews.get(intent.target.escalation)
      const task = e?._tag === 'Escalate' ? w.results.get(e.of)?.task : undefined
      return task === undefined ? undefined : [intent.target.escalation, task]
    }
    default:
      return undefined
  }
}
const guard = (c: Ctx, intent: Intent): CanAct => {
  const a = c.actor._tag === 'Agent' ? agentOf(c) : undefined
  if (a === undefined) return MAY
  return first(
    () => agentOpen(c),
    () => (CLAIMED.has(intent._tag) ? needClaim(c, a) : MAY),
    () => {
      const target = targetOf(c.w, intent)
      if (target === undefined || within(c.w, target[1], a.task)) return MAY
      return no(
        `${target[0]} is outside the task tree of ${a.id} (${a.task})`,
        'Pick',
        'act on a record of your own task tree',
      )
    },
  )
}

export const canAct: CanActOf = (d, actor, intent) => {
  const w = d.moment.work
  const c: Ctx = { d, w, actor, by: byOf(w, actor) }
  const check = CHECKS[intent._tag] as (c: Ctx, intent: Intent) => CanAct
  return first(
    () => guard(c, intent),
    () => check(c, intent),
  )
}
