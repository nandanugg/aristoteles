// The reads of the facts of a Work that the states and the actions of the drafts read: the
// records by id, the versions of a direction, and the owner's decisions of its drafts.
// A missing record is a bug here: callers look ids up first (canAct does).
import type {
  Direction,
  DirectionId,
  OfficialDirection,
  RejectId,
  Revision,
  RevisionId,
  Rule,
  RuleEntry,
  Standard,
  StandardEntry,
  Version,
  VersionId,
  Work,
} from '../schema/index.ts'

// --- getters -------------------------------------------------------------------------------------

const need = <K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V => {
  const value = map.get(key)
  if (value === undefined) throw new Error(`the work has no ${what} ${String(key)}`)
  return value
}
export const draftAt = (w: Work, id: RevisionId): Revision<Direction> => need(w.drafts, id, 'draft')
export const directionAt = (w: Work, id: DirectionId): Direction =>
  need(w.directions, id, 'direction')
export const standardAt = (w: Work, e: StandardEntry): Standard => need(w.standards, e, 'standard')
export const ruleAt = (w: Work, e: RuleEntry): Rule => need(w.rules, e, 'rule')
export const rulesOfStandard = (w: Work, s: Standard): ReadonlyArray<Rule> =>
  s.rules.map((e) => ruleAt(w, e))

// --- versions ------------------------------------------------------------------------------------

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
export const versionNumberOf = (id: VersionId): number => Number(id.slice(id.lastIndexOf('@') + 1))
// A draft is official when a version has it as its revision.
export const madeBy = (w: Work, draft: RevisionId): Version<Direction> | undefined => {
  const d = w.directions.get(draftAt(w, draft).of)
  return d?._tag === 'Official' ? d.versions.find((v) => v.revision === draft) : undefined
}

// --- the owner's rejects of drafts ---------------------------------------------------------------

// A Reject of a draft: it ends the draft, and its reviser revises the current version again.
export interface Rejection {
  readonly id: RejectId
  readonly draft: RevisionId
  readonly reason: string
}
export const rejectionAt = (w: Work, id: string): Rejection | undefined => {
  const v = w.reviews.get(id as never)
  return v?._tag === 'Reject' && v.of._tag === 'Revision'
    ? { id: v.id, draft: v.of.id, reason: v.of.reason }
    : undefined
}
export const vetoOf = (w: Work, draft: RevisionId): Rejection | undefined => {
  for (const v of w.reviews.values()) {
    if (v._tag === 'Reject' && v.of._tag === 'Revision' && v.of.id === draft) {
      return { id: v.id, draft, reason: v.of.reason }
    }
  }
  return undefined
}
