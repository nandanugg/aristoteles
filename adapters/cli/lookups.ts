// A record by the id that a person typed, for the kinds that the domain lookup has no helper for.
// The refusal words are lookup's (golden).
import { join } from 'node:path'
import { Effect } from 'effect'
import { type Found, lookup, type Refused, type Work } from '../../core/schema/index.ts'

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

// The guides of the tool (guides/*.md and fitness.yaml): files of the tool, not of the dir.
export const GUIDES = join(import.meta.dir, '..', '..', 'guides')
