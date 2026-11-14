// What a direction says to a task: a version or a draft's proposal, the standards that apply in
// the task's context, its rules, and when two of them say the same.
import {
  applies,
  type Direction,
  type DirectionId,
  type Result,
  type RevisionId,
  type Rule,
  type RuleEntry,
  type Standard,
  type StandardEntry,
  type TaskId,
  type Version,
  type Where,
  type Work,
} from '../schema/index.ts'
import { currentOf, draftAt, officialAt, ruleAt, standardAt, taskAt, versionAt } from './records.ts'

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
export const contentAt = (w: Work, d: DirectionId, n: number): Content =>
  contentOf(versionAt(w, d, n))
export const contentNow = (w: Work, d: DirectionId): Content => contentOf(currentOf(w, d))

// A draft is official when a version has it as its revision.
export const madeBy = (w: Work, draft: RevisionId): Version<Direction> | undefined => {
  const d = w.directions.get(draftAt(w, draft).of)
  return d?._tag === 'Official' ? d.versions.find((v) => v.revision === draft) : undefined
}

// The directions that a task follows: official ones.
export const directionIdsOf = (w: Work, task: TaskId): ReadonlyArray<DirectionId> =>
  taskAt(w, task).descriptionAi.directions.filter((d) => officialAt(w, d) !== undefined)

// A standard applies where its "where" matches the context of the task; none means everywhere.
export const applicableIn = (w: Work, content: Content, task: TaskId): ReadonlyArray<Standard> => {
  const context = taskAt(w, task).descriptionAi.context
  return content.standards.map((e) => standardAt(w, e)).filter((s) => applies(s.where, context))
}
export const rulesOfStandard = (w: Work, s: Standard): ReadonlyArray<Rule> =>
  s.rules.map((e) => ruleAt(w, e))
// The rules of a task: those of its directions that apply to it, each once.
export const rulesOf = (w: Work, task: TaskId): ReadonlyArray<Rule> => {
  const entries = directionIdsOf(w, task).flatMap((d) =>
    applicableIn(w, contentNow(w, d), task).flatMap((s) => s.rules),
  )
  return [...new Set(entries)].map((e) => ruleAt(w, e))
}
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
// The rule of a task now that stands for the rule entry of a point: the entry itself; else the
// rule with its id (a changed rule keeps its id); else a rule that supersedes it.
export const ruleNowFor = (w: Work, task: TaskId, entry: RuleEntry): Rule | undefined => {
  const old = ruleAt(w, entry)
  const now = rulesOf(w, task)
  return (
    now.find((x) => x.entry === entry) ??
    now.find((x) => x.id === old.id) ??
    now.find((x) => x.supersedes.includes(entry))
  )
}

// --- the same words ------------------------------------------------------------------------------

export const sameChecker = (a: Rule['checkedBy'], b: Rule['checkedBy']): boolean =>
  a._tag === 'Decider' ? b._tag === 'Decider' : b._tag === 'Role' && a.role === b.role
// Two rules are the same when they have the same id, words, and checker.
export const sameRule = (a: Rule, b: Rule): boolean =>
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
// Two standards are the same when they say the same: the same id, words, where, and rules.
export const sameStandard = (x: Standard, y: Standard): boolean =>
  x.entry === y.entry ||
  (x.id === y.id &&
    x.says === y.says &&
    sameWhere(x.where, y.where) &&
    x.rules.length === y.rules.length &&
    x.rules.every((r) => y.rules.includes(r)))
// Two drafts' standards have the same words, rule by rule: each draft makes its own entries.
export const sameWords = (w: Work, x: Standard, y: Standard): boolean =>
  x.id === y.id &&
  x.says === y.says &&
  sameWhere(x.where, y.where) &&
  x.rules.length === y.rules.length &&
  x.rules.every((r) => y.rules.some((q) => sameRule(ruleAt(w, r), ruleAt(w, q))))

// Two versions say the same to a task when the spirit and the standards that apply are the same.
export const sameFor = (w: Work, v: Content, now: Content, task: TaskId): boolean => {
  if (v.of === now.of && v.number !== null && v.number === now.number) return true
  const [a, b] = [applicableIn(w, v, task), applicableIn(w, now, task)]
  return (
    v.says === now.says &&
    a.length === b.length &&
    a.every((s) => b.some((t) => sameStandard(s, t)))
  )
}
// A result made under versions that still say the same to its task.
export const underNow = (w: Work, result: Result): boolean =>
  directionIdsOf(w, result.task).every((d) => {
    const n = result.under.get(d)
    return n === undefined || sameFor(w, contentAt(w, d, n), contentNow(w, d), result.task)
  })
