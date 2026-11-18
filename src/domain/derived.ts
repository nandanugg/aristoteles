// What follows from one fact of a record: each one was a second field that could disagree with
// the first (plan/types REVIEW-1 section 3). Small and pure; a state that the rules of the work
// decide is core/derived's.
import type { DirectionId, VersionId } from './ids.ts'
import { versionId } from './ids.ts'
import type { Direction, OfficialDirection, Review, Source, Version } from './model.ts'
import type { Work } from './work.ts'

// The id of a version, as the CLI prints it: tsd-writing@2.
export const versionIdOf = (v: Version<Direction>): VersionId => versionId(v.of, v.number)

// The current version of an official direction: its last.
export const currentVersion = (d: OfficialDirection): Version<Direction> =>
  d.versions[d.versions.length - 1] ?? d.versions[0]

// The official directions of the dir, in their order.
export const officialDirections = (work: Work): ReadonlyArray<OfficialDirection> =>
  [...work.directions.values()].flatMap((d) => (d._tag === 'Official' ? [d] : []))

export const officialOf = (work: Work, id: DirectionId): OfficialDirection | undefined => {
  const d = work.directions.get(id)
  return d?._tag === 'Official' ? d : undefined
}

// The decision of a review in words (the reader table review.decision).
export const decisionOf = (review: Review): 'Accept' | 'Reject' => review._tag

// The revision of an outside source.
export const revisionOf = (source: Source): string => source.revision
