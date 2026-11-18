// The reads of the records that a fold step needs: a record by its id (a missing one is a bug,
// since the store was checked) and the versions of a direction. They read facts of the Work only.
import {
  type Direction,
  type DirectionId,
  type OfficialDirection,
  type Revision,
  type RevisionId,
  type Rule,
  type RuleEntry,
  type Standard,
  type StandardEntry,
  type Version,
  type Work,
} from '../schema/index.ts'

const need = <K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V => {
  const value = map.get(key)
  if (value === undefined) throw new Error(`the work has no ${what} ${String(key)}`)
  return value
}
export const draftAt = (w: Work, id: RevisionId): Revision<Direction> => need(w.drafts, id, 'draft')
export const directionAt = (w: Work, id: DirectionId): Direction =>
  need(w.directions, id, 'direction')
export const standardAt = (w: Work, entry: StandardEntry): Standard =>
  need(w.standards, entry, 'standard')
export const ruleAt = (w: Work, entry: RuleEntry): Rule => need(w.rules, entry, 'rule')

// --- versions ------------------------------------------------------------------------------------

export const officialAt = (w: Work, d: DirectionId): OfficialDirection | undefined => {
  const direction = w.directions.get(d)
  return direction?._tag === 'Official' ? direction : undefined
}
export const currentOf = (w: Work, d: DirectionId): Version<Direction> => {
  const official = officialAt(w, d)
  const v = official?.versions[official.versions.length - 1]
  if (v === undefined) throw new Error(`the work has no official direction ${d}`)
  return v
}
