// What a direction says: a version or a draft's proposal, and when two standards or rules say the
// same.
import type {
  Direction,
  DirectionId,
  Rule,
  Standard,
  StandardEntry,
  Version,
  Where,
  Work,
} from '../schema/index.ts'
import { currentOf, ruleAt, standardAt } from './records.ts'

// A version, or a draft's proposal: what one direction says. number: null for a proposal.
export interface Content {
  readonly of: DirectionId
  readonly number: number | null
  readonly says: string
  readonly standards: ReadonlyArray<StandardEntry>
}
export const contentOf = (v: Version<Direction>): Content => ({
  of: v.of,
  number: v.number,
  says: v.says,
  standards: v.standards,
})
export const contentNow = (w: Work, d: DirectionId): Content => contentOf(currentOf(w, d))

// A rule by its id in the official version of each direction now.
export const findRule = (w: Work, id: string): Rule | undefined => {
  for (const d of w.directions.values()) {
    if (d._tag !== 'Official') continue
    for (const e of contentNow(w, d.id).standards) {
      const rule = standardAt(w, e)
        .rules.map((r) => ruleAt(w, r))
        .find((r) => r.id === id)
      if (rule) return rule
    }
  }
  return undefined
}
// --- the same words ------------------------------------------------------------------------------

export const sameChecker = (a: Rule['checkedBy'], b: Rule['checkedBy']): boolean =>
  a._tag === 'Decider' ? b._tag === 'Decider' : b._tag === 'Role' && a.role === b.role
// Two rules are the same when they have the same id, words, and checker.
const sameRule = (a: Rule, b: Rule): boolean =>
  a.entry === b.entry ||
  (a.id === b.id && a.says === b.says && sameChecker(a.checkedBy, b.checkedBy))
// The order of the keys of a where says nothing, and nor does the order of the values of a key.
const sameWhere = (a: Where, b: Where): boolean => {
  if (a._tag === 'Everywhere' || b._tag === 'Everywhere') return a._tag === b._tag
  return (
    a.conditions.size === b.conditions.size &&
    [...a.conditions].every(([k, values]) => {
      const others = b.conditions.get(k)
      return (
        others !== undefined &&
        others.length === values.length &&
        values.every((v) => others.includes(v))
      )
    })
  )
}
// Two drafts' standards have the same words, rule by rule: each draft makes its own entries.
export const sameWords = (w: Work, x: Standard, y: Standard): boolean =>
  x.id === y.id &&
  x.says === y.says &&
  sameWhere(x.where, y.where) &&
  x.rules.length === y.rules.length &&
  x.rules.every((r) => y.rules.some((q) => sameRule(ruleAt(w, r), ruleAt(w, q))))
