// The runs of the UI and the trees
// they hold. One function decides which run holds a task (bug 1: four predicates disagreed); the
// engine, the replay, the CLI and the UI all use it (src/engine/runs.ts). Types: ui-model.ts.
import { topOfRun } from '../domain/derived.ts'
import type { TaskDraftId, Time } from '../domain/ids.ts'
import type { Run, RunState, TaskDraftState } from '../domain/ui-model.ts'
import type { Work } from '../domain/work.ts'
import { taskAccepted } from '../engine/queries.ts'
import { currentTask } from '../engine/runs.ts'

export { currentTask, hostOf, rootOf, runOf, topOf } from '../engine/runs.ts'

// The state of a run, as the sidebar shows it: it talks (no task yet), works, waits for the
// person's accept of its end, is done, or is closed (by hand, or its top task closed).
export const runState = (work: Work, run: Run, when: Time): RunState => {
  if (run.end._tag === 'Closed') return { _tag: 'Closed', at: run.end.at }
  if (run.end._tag === 'Done') return { _tag: 'Done', at: run.end.at }
  const opened = run._tag === 'Host' ? topOfRun(work, run.id) : undefined
  if (opened === undefined) return { _tag: 'Talking' }
  const top = currentTask(work, opened)
  const end = work.tasks.get(top)?.end
  if (end !== undefined && end._tag !== 'NotEnded') return { _tag: 'Closed', at: end.when }
  // The Sol of the top task accepted it: the end of the project waits for the person.
  return taskAccepted(work, top, when)
    ? { _tag: 'AwaitingEndAccept', top }
    : { _tag: 'Working', top }
}

// A draft waits for the person; another draft of its run was opened, or its run ended.
export const taskDraftState = (work: Work, draft: TaskDraftId): TaskDraftState => {
  const x = work.taskDrafts.get(draft)
  if (x === undefined) throw new Error(`the work has no task draft ${draft}`)
  if (x.opened._tag === 'Opened') return { _tag: 'Opened', task: x.opened.task }
  const run = work.runs.get(x.run)
  if (run === undefined || run.end._tag !== 'NotEnded') return { _tag: 'Dropped' }
  return topOfRun(work, x.run) === undefined ? { _tag: 'Waiting' } : { _tag: 'Dropped' }
}
