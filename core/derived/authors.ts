// Who wrote a draft, who writes the words of a decision, and who writes the next draft after a
// Reject: one reader each, so the steps, canAct, the page and the words never disagree.
import type { AssignmentId, Direction, Revision, Run, Work } from '../schema/index.ts'
import type { WordsOn } from '../schema/actions.ts'
import { decisionTaskOf, hostOf, placementOf } from './catalog.ts'
import { currentTask, openedTopOf, tierOfAssignment } from './reads.ts'
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

// The hosts of the open runs (the Sol of each run's top task now), with their sessions.
const hosts = (d: Derived) => {
  const w = d.moment.work
  return [...w.runs.values()].flatMap((run) => {
    const state = d.states.runs.get(run.id)?._tag
    const opened = openedTopOf(w, run.id)
    if (opened === undefined || state === 'Done' || state === 'Closed') return []
    const top: Placement = { _tag: 'OnTask', task: currentTask(w, opened) }
    const host = hostOf(d.moment, top, d.states)
    return host._tag === 'Host' ? [host] : []
  })
}
// Ruling 10.10: the active hosts, the hosts of the open runs (F7). No reading of a pane: the CLI
// reads none, the page reads the pump, and both must derive the same steps and holds. A host whose
// pane died keeps its steps until it runs again, as the host of a project does.
export const activeHosts = (d: Derived): ReadonlyArray<AssignmentId> =>
  hosts(d).map((h) => h.assignment)

// Who drafts what no task follows (P1): a new direction, the examples of a company draft, the
// adjustment that words about the roles ask for. The active hosts, else every open high agent
// that may act (a brief over its limit waits).
export const dirDrafters = (d: Derived): ReadonlyArray<AssignmentId> => {
  const active = activeHosts(d)
  if (active.length > 0) return active
  const w = d.moment.work
  return [...w.assignments.values()].flatMap((a) => {
    const s = d.states.assignments.get(a.id)?._tag
    return s !== 'Ended' && s !== 'BriefOver' && tierOfAssignment(w, a) === 'high' ? [a.id] : []
  })
}

// The host of a decision's project writes its words; a decision of no project, any active host.
export const explainerOf = (d: Derived, on: WordsOn): Explainer => {
  const task = decisionTaskOf(d.moment.work, on)
  const placement: Placement =
    task === undefined ? { _tag: 'DirWide' } : placementOf(d.moment, task, d.states)
  if (placement._tag === 'OnTask') {
    const host = hostOf(d.moment, placement, d.states)
    return host._tag === 'Host' ? { _tag: 'Host', assignment: host.assignment } : { _tag: 'None' }
  }
  const [one, ...rest] = activeHosts(d)
  return one === undefined ? { _tag: 'None' } : { _tag: 'AnyActiveHost', hosts: [one, ...rest] }
}
export const explains = (e: Explainer, a: AssignmentId): boolean =>
  e._tag === 'Host' ? e.assignment === a : e._tag === 'AnyActiveHost' && e.hosts.includes(a)

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
    if (e._tag === 'Host') return { _tag: 'Hosts', hosts: [e.assignment] }
    return e._tag === 'AnyActiveHost' ? { _tag: 'Hosts', hosts: e.hosts } : { _tag: 'Person' }
  }
  const open = (a: AssignmentId) => d.states.assignments.get(a)?._tag !== 'Ended'
  if (open(writer)) return { _tag: 'Writer', assignment: writer }
  const [one, ...rest] = [...w.assignments.values()].flatMap((y) =>
    open(y.id) && tierOfAssignment(w, y) === 'high' && followsDirection(d, y, x.of) ? [y.id] : [],
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
    case 'Hosts':
      return r.hosts
    case 'Follower':
      return r.followers
    default:
      return []
  }
}
