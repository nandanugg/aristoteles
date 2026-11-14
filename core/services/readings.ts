// The readings of the outside for one derive (plan/rebuild/BUILD.md D4): git, the files of the dir,
// the settings, the terminals. The live Layer is in adapters/live (the CLI gives no terminals; the
// server gives the pump's status); a test gives a fixed Outside.
import { Context, type Effect } from 'effect'
import type { Time, Work } from '../schema/index.ts'
import type { Outside } from '../schema/outside.ts'

export class Readings extends Context.Service<
  Readings,
  {
    // Reads what the derive of this Work needs at this time: the changed results, the stale
    // sources, the commits on their base, the settings, the terminals.
    readonly read: (work: Work, at: Time) => Effect.Effect<Outside>
  }
>()('aristoteles/Readings') {}
