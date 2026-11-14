// The reads of the records that a fold step needs: a record by its id (a missing one is a bug,
// since the store was checked), who an act is by, the tree of tasks and assignments, the run of
// a tree, and the versions of a direction. They read facts of the Work only.
import {
  type Actor,
  type Assignment,
  type AssignmentId,
  type By,
  type Direction,
  type DirectionId,
  human,
  type Human,
  type Limit,
  type OfficialDirection,
  type Question,
  type Result,
  type ResultId,
  type Revision,
  type RevisionId,
  type Role,
  type RoleName,
  type Rule,
  type RuleEntry,
  type Run,
  type RunId,
  type Standard,
  type StandardEntry,
  type Task,
  type TaskId,
  type Time,
  type Under,
  type Version,
  type Work,
} from '../schema/index.ts'

// --- a record by its id --------------------------------------------------------------------------

const need = <K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V => {
  const value = map.get(key)
  if (value === undefined) throw new Error(`the work has no ${what} ${String(key)}`)
  return value
}
export const taskAt = (w: Work, id: TaskId): Task => need(w.tasks, id, 'task')
export const assignmentAt = (w: Work, id: AssignmentId): Assignment =>
  need(w.assignments, id, 'assignment')
export const resultAt = (w: Work, id: ResultId): Result => need(w.results, id, 'result')
export const roleAt = (w: Work, name: RoleName): Role => need(w.workflow.roles, name, 'role')
export const draftAt = (w: Work, id: RevisionId): Revision<Direction> => need(w.drafts, id, 'draft')
export const directionAt = (w: Work, id: DirectionId): Direction =>
  need(w.directions, id, 'direction')
export const standardAt = (w: Work, entry: StandardEntry): Standard =>
  need(w.standards, entry, 'standard')
export const ruleAt = (w: Work, entry: RuleEntry): Rule => need(w.rules, entry, 'rule')

export const isOpen = (t: Task): boolean => t.end._tag === 'NotEnded'
export const finished = (a: Assignment): boolean => a.end._tag !== 'NotEnded'
export const maxOf = (limit: Limit): number | undefined =>
  limit._tag === 'AtMost' ? limit.max : undefined
export const atOrBefore = (a: Time, b: Time): boolean => Date.parse(a) <= Date.parse(b)
export const isDo = (w: Work, role: string): boolean =>
  w.workflow.roles.get(role as RoleName)?.acts.some((a) => a._tag === 'Do') ?? false
export const resultsOf = (w: Work, task: TaskId): ReadonlyArray<Result> =>
  [...w.results.values()].filter((r) => r.task === task)
export const openQuestions = (w: Work, target: TaskId | ResultId): ReadonlyArray<Question> =>
  [...w.questions.values()].filter((q) => q.status._tag === 'Open' && q.stops === target)

// --- who acts ------------------------------------------------------------------------------------

export const isAssignment = (by: By): by is AssignmentId => typeof by === 'string'
// The actor of an act: an assignment's run, a person, or a model run outside any task.
export const actorOf = (w: Work, by: By): Actor =>
  isAssignment(by) ? assignmentAt(w, by).actor : by
export const isPerson = (w: Work, by: By): boolean => actorOf(w, by)._tag === 'Human'
// The person that an act names, as a Human.
export const personOf = (w: Work, by: By): Human => {
  const actor = actorOf(w, by)
  return actor._tag === 'Human' ? actor : human(actor.name)
}
// Who answers or decides as a record keeps it: an assignment, or the person.
export const answererBy = (w: Work, by: By): AssignmentId | Human =>
  isAssignment(by) ? by : personOf(w, by)
export const assignmentBy = (by: By): AssignmentId => {
  if (!isAssignment(by)) throw new Error(`${by.name} acts with no assignment`)
  return by
}
// Two actors are the same when they are one person, or one run.
export const sameActor = (w: Work, a: By, b: By): boolean => {
  const [x, y] = [actorOf(w, a), actorOf(w, b)]
  if (x._tag === 'Human' || y._tag === 'Human') return x.name === y.name
  return x.run === y.run
}
export const roleOf = (w: Work, by: By): Role | undefined =>
  isAssignment(by) ? roleAt(w, assignmentAt(w, by).role) : undefined
export const roleNameOf = (w: Work, by: By): RoleName | undefined =>
  isAssignment(by) ? assignmentAt(w, by).role : undefined
export const tierOf = (role: Role | undefined): string | undefined =>
  role?._tag === 'Model' ? role.tier : undefined

// --- the trees -----------------------------------------------------------------------------------

// A task is in the tree of another when it is that task or serves it, at any depth.
const within = (w: Work, task: TaskId, root: TaskId): boolean => {
  for (let t: TaskId | undefined = task; t !== undefined; ) {
    if (t === root) return true
    const serves: Task['serves'] | undefined = w.tasks.get(t)?.serves
    t = serves?._tag === 'Serves' ? serves.task : undefined
  }
  return false
}
export const partsOf = (w: Work, task: TaskId): ReadonlyArray<Task> =>
  [...w.tasks.values()].filter((t) => t.serves._tag === 'Serves' && t.serves.task === task)
export const openTasksWithin = (w: Work, root: TaskId): ReadonlyArray<Task> =>
  [...w.tasks.values()].filter((t) => isOpen(t) && within(w, t.id, root))

const parentOf = (w: Work, a: AssignmentId): AssignmentId | undefined => {
  const p = assignmentAt(w, a).parent
  return p._tag === 'Parent' ? p.id : undefined
}
// The nearest assignment above that is not finished: who a question or an escalation goes to.
// (derived: the answerer now, BUILD.md 3.4 row 10, owns this state of the chain.)
export const openAncestorOf = (w: Work, a: AssignmentId): AssignmentId | undefined => {
  for (let x = parentOf(w, a); x !== undefined; x = parentOf(w, x)) {
    if (!finished(assignmentAt(w, x))) return x
  }
  return undefined
}

// --- the runs of the page ------------------------------------------------------------------------

// A remade task is replaced by its remake: the task of now.
const currentTask = (w: Work, task: TaskId): TaskId => {
  let t = task
  for (let end = w.tasks.get(t)?.end; end?._tag === 'Replaced'; end = w.tasks.get(t)?.end) {
    t = end.next
  }
  return t
}
// The top of a task's tree as it was opened: the task that serves no other.
const rootOf = (w: Work, task: TaskId): TaskId => {
  let t = task
  for (let s = w.tasks.get(t)?.serves; s?._tag === 'Serves'; s = w.tasks.get(t)?.serves) {
    t = s.task
  }
  return t
}
// The top task of a host run: the task opened from one of its drafts.
const topOfRun = (w: Work, run: RunId): TaskId | undefined => {
  for (const d of w.taskDrafts.values()) {
    if (d.run === run && d.opened._tag === 'Opened') return d.opened.task
  }
  return undefined
}
// The run whose top task, after its remakes, is the top of the task's tree.
export const runOf = (w: Work, task: TaskId): Run | undefined => {
  const top = rootOf(w, task)
  return [...w.runs.values()].find((r) => {
    const t = r._tag === 'Host' ? topOfRun(w, r.id) : undefined
    return t !== undefined && (t === top || currentTask(w, t) === top)
  })
}
// The open Sol in the session of the run that holds the top of the task's tree.
// (derived: HostOfTree, BUILD.md 3.4 row 18, owns this state; the fold keeps it for the answerer
// that a question stores.)
export const hostOf = (w: Work, task: TaskId): AssignmentId | undefined => {
  const top = rootOf(w, task)
  const run = runOf(w, top)
  if (run === undefined || run.end._tag === 'Closed') return undefined
  return [...w.sessions.values()].find((s) => {
    const a = w.assignments.get(s.assignment)
    return a?.task === top && a.end._tag === 'NotEnded' && s.session === run.session
  })?.assignment
}

// --- the versions of a direction -----------------------------------------------------------------

export const officialAt = (w: Work, d: DirectionId): OfficialDirection | undefined => {
  const direction = w.directions.get(d)
  return direction?._tag === 'Official' ? direction : undefined
}
export const versionAt = (w: Work, d: DirectionId, n: number): Version<Direction> => {
  const v = officialAt(w, d)?.versions[n - 1]
  if (v === undefined) throw new Error(`the work has no version ${d}@${n}`)
  return v
}
export const currentOf = (w: Work, d: DirectionId): Version<Direction> => {
  const official = officialAt(w, d)
  const v = official?.versions[official.versions.length - 1]
  if (v === undefined) throw new Error(`the work has no official direction ${d}`)
  return v
}
// The versions of a task's directions now: the snapshot of a brief, and of a person's review.
export const underNowOf = (w: Work, task: Task): Under =>
  new Map(
    task.descriptionAi.directions.flatMap((d) => {
      const official = officialAt(w, d)
      return official ? [[d, currentOf(w, d).number] as const] : []
    }),
  )
