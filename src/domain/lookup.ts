// A record by the id that a person or an agent typed. The refusal words are
// golden text: '"x9" is not a draft id (d..)' and 'there is no draft d9'.
import { Effect } from 'effect'
import { refuse, type Refused } from './errors.ts'
import { isPrefix, NOUN, prefixOf } from './ids.ts'
import type { Direction, Review, Revision, Suggestion } from './model.ts'
import type { Work } from './work.ts'

// What an id names: v4 is a Review, s2 a suggestion, d3 a draft.
export type Found =
  | { readonly _tag: 'Review'; readonly review: Review }
  | { readonly _tag: 'Suggestion'; readonly suggestion: Suggestion }
  | { readonly _tag: 'Revision'; readonly revision: Revision<Direction> }

const get = <K, V>(map: ReadonlyMap<K, V>, id: string): V | undefined => map.get(id as K)

// The record of an id, or undefined.
export const find = (work: Work, id: string): Found | undefined => {
  switch (prefixOf(id)) {
    case 'v': {
      const review = get(work.reviews, id)
      return review === undefined ? undefined : { _tag: 'Review', review }
    }
    case 's': {
      const suggestion = get(work.suggestions, id)
      return suggestion === undefined ? undefined : { _tag: 'Suggestion', suggestion }
    }
    case 'd': {
      const revision = get(work.drafts, id)
      return revision === undefined ? undefined : { _tag: 'Revision', revision }
    }
    default:
      return undefined
  }
}

const nounOf = (prefix: string) =>
  isPrefix(prefix) ? NOUN[prefix] : `record with the prefix ${prefix}`

// The record of a typed id, of one of the expected prefixes, or a refusal.
export const lookup = (
  work: Work,
  id: string,
  expected: ReadonlyArray<string>,
): Effect.Effect<Found, Refused> => {
  const prefix = prefixOf(id) ?? ''
  if (expected.length && !expected.includes(prefix)) {
    const kinds = expected.map((p) => `a ${nounOf(p)} id (${p}..)`).join(' or ')
    return Effect.fail(refuse(`"${id}" is not ${kinds}`))
  }
  const found = find(work, id)
  return found ? Effect.succeed(found) : Effect.fail(refuse(`there is no ${nounOf(prefix)} ${id}`))
}
