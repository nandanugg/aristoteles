// F4: time is a derived edge. The next time at which the Derived changes by the clock alone, with
// no new event and no new reading: a hold for the host's words ends (holdOf), an outside source
// expires (sourceStatesOf), a permission starts, ends or is revoked (permissionStateOf, covers).
// Each edge comes from the reader of its state. The page server sends `changed` at it, and
// `work wait` derives again at it; null when no state waits for the clock.
import type { Time } from '../schema/index.ts'
import { lastFreshAt, permissionEdges } from './catalog.ts'
import type { Derived } from './types.ts'
import { allItems } from './waiting.ts'

export const nextChangeAt = (d: Derived): Time | null => {
  const m = d.moment
  const holds = allItems(d).flatMap((i) =>
    'hold' in i && i.hold._tag === 'HeldForHost' ? [Date.parse(i.hold.until)] : [],
  )
  const hours = m.outside.settings.outsideSourceHours
  const sources = d.states.sources.flatMap((s) =>
    s.state._tag === 'Fresh' ? [lastFreshAt(s.state.seenAt, hours) + 1] : [],
  )
  const grants = [...m.work.permissions.values()].flatMap(permissionEdges)
  const now = Date.parse(m.at)
  const next = Math.min(...[...holds, ...sources, ...grants].filter((t) => t > now))
  return Number.isFinite(next) ? (new Date(next).toISOString() as Time) : null
}
