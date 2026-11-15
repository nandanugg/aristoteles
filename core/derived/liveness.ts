// P8 (Nanda, 2026-11-15): is an actor there? The one reader of the markers of `work wait`
// (Outside.markers), for the CLI, the server and the watcher alike. An actor waits now, returned
// within its model's silentMinutes, or is gone since its last return. A gone session is revived,
// never redirected: an agent restarts, a host is a problem for the person; its work waits for it.
import type { WaitMarker } from '../schema/outside.ts'

export type Liveness =
  | { readonly _tag: 'Waits' }
  | { readonly _tag: 'Returned'; readonly at: number }
  | { readonly _tag: 'Gone'; readonly since: number }
  | { readonly _tag: 'NeverWaited' }

export const livenessOf = (
  markers: ReadonlyArray<WaitMarker>,
  session: string,
  now: number,
  silentMs: number,
): Liveness => {
  const mine = markers.filter((m) => m.session === session)
  if (mine.length === 0) return { _tag: 'NeverWaited' }
  if (mine.some((m) => m.waits)) return { _tag: 'Waits' }
  const at = Math.max(...mine.map((m) => m.beat))
  return now - at < silentMs ? { _tag: 'Returned', at } : { _tag: 'Gone', since: at }
}

// The time of an actor's last sign of life in its markers; 0 when it never waited.
export const lastSeenOf = (l: Liveness, now: number): number =>
  l._tag === 'Waits' ? now : l._tag === 'Returned' ? l.at : l._tag === 'Gone' ? l.since : 0

// The clock time of a beat, for the person (14:05).
export const clockOf = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)
