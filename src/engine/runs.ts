// Which run of the UI holds a task, and
// its host. One function decides it (bug 1: four predicates disagreed); the engine (a question
// of a model goes to its host), the replay, the CLI and the UI all use these.
import { topOfRun } from '../domain/derived.ts'
import type { AssignmentId, TaskId } from '../domain/ids.ts'
import type { Run } from '../domain/ui-model.ts'
import type { Work } from '../domain/work.ts'

// A remade task is replaced by its remake: the task of now.
export const currentTask = (w: Work, task: TaskId): TaskId => {
  let t = task
  for (let end = w.tasks.get(t)?.end; end?._tag === 'Replaced'; end = w.tasks.get(t)?.end) {
    t = end.next
  }
  return t
}
// The top of a task's tree as it was opened: the task that serves no other.
export const rootOf = (w: Work, task: TaskId): TaskId => {
  let t = task
  for (let s = w.tasks.get(t)?.serves; s?._tag === 'Serves'; s = w.tasks.get(t)?.serves) {
    t = s.task
  }
  return t
}
// The top task of a task's tree, after its remakes: one tree, one project.
export const topOf = (w: Work, task: TaskId): TaskId => currentTask(w, rootOf(w, task))

// The run whose top task, after its remakes, is the top of the task's tree.
export const runOf = (w: Work, task: TaskId): Run | undefined => {
  const top = rootOf(w, task)
  return [...w.runs.values()].find((r) => {
    const t = r._tag === 'Host' ? topOfRun(w, r.id) : undefined
    return t !== undefined && (t === top || currentTask(w, t) === top)
  })
}

// The host of a task: the open Sol in the session of the run that holds the top of its tree. A
// tree that no run holds (a task opened at a terminal) has no host.
export const hostOf = (w: Work, task: TaskId): AssignmentId | undefined => {
  const top = rootOf(w, task)
  const run = runOf(w, top)
  if (run === undefined || run.end._tag === 'Closed') return undefined
  return [...w.sessions.values()].find((s) => {
    const a = w.assignments.get(s.assignment)
    return a?.task === top && a.end._tag === 'NotEnded' && s.session === run.session
  })?.assignment
}
