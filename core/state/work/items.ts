// The items and their versions (DESIGN 9; work.qnt applies, appliesTo, vsum, oldFor, briefOld,
// testRule, changedBy). An item applies to a task: a direction the task serves; a standard of
// such a direction whose `where` meets the task's sections (no `where`: every task); a rule of
// such a standard.
import type { ItemKey, ItemRec, Task, Versions, WorkState } from './types.ts'

export const verOf = (v: Versions, x: ItemKey): number => v.get(x) ?? 0

export const applies = (s: WorkState, x: ItemKey, t: Task): boolean => {
  const r = s.items.get(x)
  if (r === undefined) return false
  if (r.kind === 'dir') return t.directions.includes(x.slice('dir:'.length))
  if (r.parent === null || !applies(s, r.parent, t)) return false
  if (r.kind === 'rule') return true
  return r.where === null || r.where.some((w) => t.sections.includes(w))
}
export const appliesTo = (s: WorkState, t: Task): ReadonlyArray<ItemKey> =>
  [...s.items.keys()].filter((x) => applies(s, x, t))

// The sum of all versions: it grows with every change (an act's view of the versions).
export const vsum = (s: WorkState): number => [...s.ver.values()].reduce((a, b) => a + b, 0)

// The items that apply to the task and moved since its result was made or last checked.
export const oldFor = (s: WorkState, t: Task): ReadonlyArray<ItemKey> =>
  appliesTo(s, t).filter((x) => verOf(t.checked, x) < verOf(s.ver, x))

// The maker's brief is old: an item that applies to its task moved since it read it.
export const briefOld = (s: WorkState, brief: Versions, t: Task): boolean =>
  appliesTo(s, t).some((x) => verOf(brief, x) < verOf(s.ver, x))

// A rule the harness alone rechecks: a test command and no reader.
export const testRule = (s: WorkState, x: ItemKey): boolean => s.items.get(x)?.form === 'mech'

// The items a draft's content changes (classify: the store diffs the records).
const same = (a: ItemRec | undefined, b: ItemRec | null): boolean =>
  b === null ? a === undefined : a !== undefined && JSON.stringify(a) === JSON.stringify(b)
export const changedBy = (
  s: WorkState,
  draft: ReadonlyMap<ItemKey, ItemRec | null>,
): ReadonlySet<ItemKey> =>
  new Set([...draft].filter(([x, r]) => !same(s.items.get(x), r)).map(([x]) => x))
