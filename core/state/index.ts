// The state: the fold of the stored events into one Work, the Moment that a derive reads, and the
// cache of the Work in the long process (plan/rebuild/BUILD.md 3.1, 3.3). The fold makes the same
// records, ids, counters and created lists as the old replay (fold.test.ts pins them). It never
// refuses: every stored event was checked when it was written.
// The fold is the one code outside core/derived that reads a state field of a record, to apply a
// move (src/domain/moves.ts makes every change of a state field).
import { Effect } from 'effect'
import type { Time, Work } from '../schema/index.ts'
import type { Outside } from '../schema/outside.ts'
import { Readings } from '../services/index.ts'

export { type Fold, fold, type FoldStep, foldStep } from './fold.ts'
export { type Cached, type LoadWork, loadWork, WorkCache, workCacheLayer } from './cache.ts'

// --- the moment ----------------------------------------------------------------------------------

// The Work at one time, with the readings of the outside at that time: all that a derive reads.
export interface Moment {
  readonly work: Work
  readonly at: Time
  readonly outside: Outside
}
export type MomentOf = (work: Work, at: Time) => Effect.Effect<Moment, never, Readings>
export const momentOf: MomentOf = (work, at) =>
  Effect.gen(function* () {
    const readings = yield* Readings
    const outside = yield* readings.read(work, at)
    return { work, at, outside }
  })
