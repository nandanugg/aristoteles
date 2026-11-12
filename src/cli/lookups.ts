// A record by the id that a person typed, for the kinds that domain/lookup has no helper for.
// The refusal words are lookup's (golden); the prefix list makes the kind certain.
import { Effect } from 'effect'
import type { Refused } from '../domain/errors.ts'
import { type Found, lookup } from '../domain/lookup.ts'
import type { Work } from '../domain/work.ts'

type Of<K extends Found['_tag']> = Extract<Found, { readonly _tag: K }>

export const lookupKind = <K extends Found['_tag']>(
  kind: K,
  prefixes: ReadonlyArray<string>,
  work: Work,
  id: string,
): Effect.Effect<Of<K>, Refused> =>
  Effect.flatMap(lookup(work, id, prefixes), (found) =>
    found._tag === kind
      ? Effect.succeed(found as Of<K>)
      : Effect.die(`lookup of ${id} gave a ${found._tag}, not a ${kind}`),
  )
