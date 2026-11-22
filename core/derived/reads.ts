// The reads of the facts of a Work that the states and the actions of the drafts read: the
// records by id, the versions of a direction, and the owner's decisions of its drafts.
// A missing record is a bug here: callers look ids up first (canAct does).
import {
  currentVersion,
  type Direction,
  type DirectionId,
  type OfficialDirection,
  type RejectId,
  type Revision,
  type RevisionId,
  type Rule,
  type RuleEntry,
  type Standard,
  type StandardEntry,
  type Version,
  type VersionId,
  type Work,
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
  if (official === undefined) throw new Error(`the work has no official direction ${d}`)
  return currentVersion(official)
}
export const versionNumberOf = (id: VersionId): number => Number(id.slice(id.lastIndexOf('@') + 1))
// An accepted draft either made a numbered version or updated its base's evidence.
export const madeBy = (w: Work, draft: RevisionId): Version<Direction> | undefined => {
  const x = draftAt(w, draft)
  const d = officialAt(w, x.of)
  const made = d?.versions.find((v) => v.revision === draft)
  if (made !== undefined || d === undefined || x._tag !== 'Change') return made
  for (const review of w.reviews.values()) {
    if (review._tag === 'Accept' && review.of.id === draft) {
      return d.versions[versionNumberOf(x.base) - 1]
    }
  }
  return undefined
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
