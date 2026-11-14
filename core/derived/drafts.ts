// The drafts and suggestions that wait, read from RevisionState (S6: every reader reads its one
// order): the open drafts of a direction, a vetoed draft that waits for a new one, and the
// suggestions that no draft answers yet.
import type {
  Direction,
  DirectionId,
  Revision,
  Suggestion,
  SuggestionId,
  Work,
} from '../schema/index.ts'
import type { Derived } from './types.ts'

// The drafts of a direction that wait for their deciders.
export const openDrafts = (
  d: Derived,
  direction: DirectionId,
): ReadonlyArray<Revision<Direction>> =>
  [...d.moment.work.drafts.values()].filter(
    (x) => x.of === direction && d.states.revisions.get(x.id)?._tag === 'Waiting',
  )

// A vetoed draft waits for a new draft, until a later draft answers the Reject or its reviser
// writes a later draft. The reviser of an imported draft is the refresh: a later import of the
// direction (ruling 10.4: the same commit again, or a newer one) is its new draft.
export const waitsForNewDraft = (d: Derived, x: Revision<Direction>): boolean => {
  const state = d.states.revisions.get(x.id)
  const veto = state?._tag === 'Vetoed' ? state.by : undefined
  const sameReviser = (y: Revision<Direction>) =>
    x.origin._tag === 'Imported'
      ? y.origin._tag === 'Imported'
      : y.origin._tag === 'Written' &&
        (typeof x.origin.by === 'string' || typeof y.origin.by === 'string'
          ? x.origin.by === y.origin.by
          : x.origin.by.run === y.origin.by.run && x.origin.by.name === y.origin.by.name)
  return [...d.moment.work.drafts.values()].every(
    (y) =>
      !(veto !== undefined && y.answers.includes(veto)) &&
      !(y.of === x.of && sameReviser(y) && y.at > x.at),
  )
}

// A suggestion answered by a draft: official, open, or vetoed with no newer draft yet.
export const drafted = (d: Derived, id: SuggestionId): boolean =>
  [...d.moment.work.drafts.values()].some((x) => {
    if (!x.answers.includes(id)) return false
    const state = d.states.revisions.get(x.id)?._tag
    return (
      state === 'Official' || state === 'Waiting' || (state === 'Vetoed' && waitsForNewDraft(d, x))
    )
  })

// The official direction that a suggestion is about: the direction, or the holder of its
// standard or rule in the current version.
export const holderOf = (w: Work, about: Suggestion['about']): Direction | undefined => {
  for (const d of w.directions.values()) {
    if (d._tag !== 'Official') continue
    const v = d.versions[d.versions.length - 1] ?? d.versions[0]
    if (about._tag === 'Direction' && about.direction === d.id) return d
    if (about._tag === 'Standard' && v.standards.includes(about.standard)) return d
    if (
      about._tag === 'Rule' &&
      v.standards.some((s) => w.standards.get(s)?.rules.includes(about.rule))
    ) {
      return d
    }
  }
  return undefined
}

// The suggestions that wait for a draft, each with the official direction that it is about.
export const suggestionsToDraft = (
  d: Derived,
): ReadonlyArray<{ readonly y: Suggestion; readonly direction: DirectionId }> =>
  [...d.moment.work.suggestions.values()].flatMap((y) => {
    if (y.about._tag === 'NewDirection' || drafted(d, y.id)) return []
    const holder = holderOf(d.moment.work, y.about)
    return holder ? [{ y, direction: holder.id }] : []
  })
