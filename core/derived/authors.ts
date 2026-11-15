// Who wrote a draft, who writes the words of a decision, and who writes the next draft after a
// Reject: one reader each, so the steps, canAct, the page and the words never disagree.
import type { AssignmentId, Direction, Revision, Run, TaskId, Work } from '../schema/index.ts'
import type { WordsOn } from '../schema/actions.ts'
import { hostOf, placementOf, taskOfAnswer } from './catalog.ts'
import { currentTask, holdsA, openedTopOf, problemTask } from './reads.ts'
import { followsDirection } from './steps.ts'
import type { DraftAuthor, Derived, Explainer, Placement, Redrafter } from './types.ts'

// The author of a draft. A run's id (--by=h1), or an assignment in a run's session, is the host.
export const authorOf = (w: Work, x: Revision<Direction>): DraftAuthor => {
  if (x.origin._tag !== 'Written') return { _tag: x.origin._tag }
  const by = x.origin.by
  const sessionsOf = (r: Run) => [r.session, ...r.formerSessions]
  if (typeof by === 'object') {
    const run = w.runs.get(by.name as never)
    if (run === undefined) return { _tag: 'ModelRun', name: by.name, run: by.run }
    const held = [...w.sessions.values()].filter((s) => sessionsOf(run).includes(s.session))
    return { _tag: 'Host', run: run.id, assignment: held.at(-1)?.assignment }
  }
  const session = w.sessions.get(by)?.session
  const run = [...w.runs.values()].find((r) => session && sessionsOf(r).includes(session))
  if (run === undefined) return { _tag: 'Assignment', assignment: by }
  return { _tag: 'Host', run: run.id, assignment: by }
}
// The assignment that wrote a draft, when one did.
export const authorAssignment = (a: DraftAuthor): AssignmentId | undefined =>
  a._tag === 'Assignment' || a._tag === 'Host' ? a.assignment : undefined

// The task of a draft (P8): the task of the Reject that it answers; else the project of its
// author (a host's run, an agent's task). The person's own change (it answers a suggestion, or a
// model run outside any task wrote it), an onboarded draft and a company refresh are the work of
// the dir: they have no task.
export const draftTaskOf = (w: Work, x: Revision<Direction>): TaskId | undefined => {
  const answered = x.answers.map((a) => taskOfAnswer(w, a)).find((t) => t !== undefined)
  if (answered !== undefined) return answered
  if (x.answers.some((a) => a.startsWith('s'))) return undefined
  const author = authorOf(w, x)
  if (author._tag === 'Assignment') return w.assignments.get(author.assignment)?.task
  if (author._tag !== 'Host') return undefined
  const opened = openedTopOf(w, author.run)
  return opened === undefined ? undefined : currentTask(w, opened)
}
// The task where a decision of the page sits: a problem's, a draft's (draftTaskOf), a run's top.
export const decisionTaskOf = (w: Work, on: WordsOn): TaskId | undefined => {
  switch (on._tag) {
    case 'Problem': {
      const p = w.problems.get(on.id)
      return p === undefined ? undefined : problemTask(w, p)
    }
    case 'End': {
      const opened = openedTopOf(w, on.id)
      return opened === undefined ? undefined : currentTask(w, opened)
    }
    case 'Draft': {
      const x = w.drafts.get(on.id)
      return x === undefined ? undefined : draftTaskOf(w, x)
    }
  }
}

// The hosts of the open runs (the host's assignment on each run's top task now).
const runHosts = (d: Derived): ReadonlyArray<AssignmentId> => {
  const w = d.moment.work
  return [...w.runs.values()].flatMap((run) => {
    const state = d.states.runs.get(run.id)?._tag
    const opened = openedTopOf(w, run.id)
    if (opened === undefined || state === 'Done' || state === 'Closed') return []
    const top: Placement = { _tag: 'OnTask', task: currentTask(w, opened) }
    const host = hostOf(d.moment, top, d.states)
    return host._tag === 'Host' ? [host.assignment] : []
  })
}

// Who drafts what no task follows (P1): a new direction, the examples of a company draft, the
// adjustment that words about the roles ask for. The hosts of the open runs, else every open agent
// that directs or fits roles and may act (a brief over its limit waits).
export const dirDrafters = (d: Derived): ReadonlyArray<AssignmentId> => {
  const hosts = runHosts(d)
  if (hosts.length > 0) return hosts
  const w = d.moment.work
  return [...w.assignments.values()].flatMap((a) => {
    const s = d.states.assignments.get(a.id)?._tag
    return s !== 'Ended' && s !== 'BriefOver' && (holdsA(w, a, 'Direct') || holdsA(w, a, 'Fit'))
      ? [a.id]
      : []
  })
}

// The host of a decision's project writes its words. The work of the dir has no host (P8): the
// person reads it as it is.
export const explainerOf = (d: Derived, on: WordsOn): Explainer => {
  const task = decisionTaskOf(d.moment.work, on)
  if (task === undefined) return { _tag: 'None' }
  const host = hostOf(d.moment, placementOf(d.moment, task, d.states), d.states)
  return host._tag === 'Host' ? { _tag: 'Host', assignment: host.assignment } : { _tag: 'None' }
}
export const explains = (e: Explainer, a: AssignmentId): boolean =>
  e._tag === 'Host' && e.assignment === a

// Who writes the next draft after a decider's Reject. A model run has ended: the explainer of
// the draft revises it; with no host, the person runs the model again or says it in words.
export const redrafterOf = (d: Derived, x: Revision<Direction>): Redrafter => {
  const w = d.moment.work
  const author = authorOf(w, x)
  if (author._tag === 'Imported') return { _tag: 'Repo' }
  if (author._tag === 'Onboarded') return { _tag: 'Official' }
  const writer = authorAssignment(author)
  // A step revises only a change: a new direction of a model run is drafted anew by a model run.
  if (writer === undefined && x._tag === 'New') return { _tag: 'Person' }
  if (writer === undefined) {
    const e = explainerOf(d, { _tag: 'Draft', id: x.id })
    return e._tag === 'Host' ? { _tag: 'Host', assignment: e.assignment } : { _tag: 'Person' }
  }
  const open = (a: AssignmentId) => d.states.assignments.get(a)?._tag !== 'Ended'
  if (open(writer)) return { _tag: 'Writer', assignment: writer }
  const [one, ...rest] = [...w.assignments.values()].flatMap((y) =>
    open(y.id) && holdsA(w, y, 'Direct') && followsDirection(d, y, x.of) ? [y.id] : [],
  )
  if (one !== undefined) return { _tag: 'Follower', finished: writer, followers: [one, ...rest] }
  const role = w.assignments.get(writer)?.role
  return role === undefined ? { _tag: 'Person' } : { _tag: 'NewRole', finished: writer, role }
}
// The agents that write the next draft.
export const redrafters = (r: Redrafter): ReadonlyArray<AssignmentId> => {
  switch (r._tag) {
    case 'Writer':
      return [r.assignment]
    case 'Host':
      return [r.assignment]
    case 'Follower':
      return r.followers
    default:
      return []
  }
}
