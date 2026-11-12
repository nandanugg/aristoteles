// The OPEN block of a brief (package P5a): what
// stops the latest result of a task and the task itself, one line each with its ids, as work
// blockers prints them (show.ts blockerLines and taskLines), seen as one assignment sees them.
// Not re-exported by index.ts.
import type { ResultId, TaskId, Time } from '../domain/ids.ts'
import type { Assignment, Blocker } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { blockerItems } from '../engine/queries.ts'
import { latestResult } from './common.ts'
import { lowChecker, outsideFor, rulesForAt, tierOfAssignment } from './reads.ts'
import { blockerLines, taskLines } from './show.ts'

const isDecider = (item: Blocker): boolean =>
  item._tag === 'DeciderAcceptedUnderOld' ||
  item._tag === 'DeciderWaits' ||
  item._tag === 'DeciderAnyApprover'

// The open items of one result, with ids. A low maker sees what to fix; a low checker only its
// own checks; medium and high see everything. cwd: the dir, to compare the work now with the
// report.
export const resultItems = (
  w: Work,
  result: ResultId,
  a: Assignment,
  at: Time,
  cwd: string,
): ReadonlyArray<string> => {
  const r = w.results.get(result)
  if (r === undefined) throw new Error(`the work has no result ${result}`)
  const checker = lowChecker(w, a, at)
  const checks = rulesForAt(w, a, at).map((x) => x.entry)
  const low = tierOfAssignment(w, a) === 'low'
  const wanted = (item: Blocker): boolean => {
    if (checker) return item._tag === 'Evidence' && checks.includes(item.ref)
    if (!low) return true
    // The decider's accept is not a low maker's act, so its OPEN does not show it.
    if (isDecider(item)) return false
    return item._tag !== 'Evidence' || item.rejects.length > 0
  }
  const outside = outsideFor(w, cwd, [r])
  const lines: Array<string> = []
  if (outside.changed.has(result)) {
    lines.push(`${result} changed after it was reported; the maker reports it again`)
  }
  const stale = outside.stale.get(result)
  if (stale && !checker) {
    lines.push(
      `${result} was built on ${stale.source}@${stale.was}; ${stale.source} is now at ${stale.now}`,
    )
  }
  for (const item of blockerItems(w, result, at).filter(wanted)) {
    lines.push(...blockerLines(w, result, item))
  }
  return lines
}

// The OPEN lines of a task for an assignment: those of its latest result, then those of the task,
// each once (a low checker sees only its result's).
export const openItems = (
  w: Work,
  task: TaskId,
  a: Assignment,
  at: Time,
  cwd: string,
): ReadonlyArray<string> => {
  const result = latestResult(w, task)
  const own = result ? resultItems(w, result.id, a, at, cwd) : []
  if (lowChecker(w, a, at)) return own
  return [...new Set([...own, ...taskLines(w, task)])]
}
