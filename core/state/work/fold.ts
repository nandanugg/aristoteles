// The fold of the Work events of a store into the work model's state (work.qnt Store), beside the
// old fold, which leaves these events alone. Before Work.Opened there is no top: null.
import type { Recorded } from '../../schema/index.ts'
import { damaged } from '../act.ts'
import { take } from './effect.ts'
import { epOf, initState } from './reads.ts'
import type { Actor, WorkState } from './types.ts'

// The tokens of each actor, one per epoch in order: an old epoch's token still names that epoch.
export interface WorkToken {
  readonly ep: number
  readonly hash: string
}
export interface WorkFolded {
  readonly state: WorkState
  // An act id to the seq of the event that stored it.
  readonly ids: ReadonlyMap<string, number>
  readonly tokens: ReadonlyMap<Actor, ReadonlyArray<WorkToken>>
}

export const foldWork = (events: ReadonlyArray<Recorded>): WorkFolded | null => {
  let state: WorkState | null = null
  const ids = new Map<string, number>()
  const tokens = new Map<Actor, Array<WorkToken>>()
  for (const recorded of events) {
    const e = recorded.event
    if (e._tag !== 'Work') continue
    const c = e.create
    if (c._tag === 'Opened') {
      if (state !== null) return damaged(recorded, 'the top is opened once')
      state = initState(c.top, new Map(c.items), new Map(c.cards), c.maxTries)
      for (const [who, hash] of c.tokens) tokens.set(who, [{ ep: 0, hash }])
    } else {
      if (state === null) return damaged(recorded, 'an act before the top is opened')
      state = take(state, c.act)
      ids.set(c.act.id, recorded.seq)
      if (c.token !== null) {
        const [who, hash] = c.token
        tokens.set(who, [...(tokens.get(who) ?? []), { ep: epOf(state, who), hash }])
      }
    }
  }
  return state === null ? null : { state, ids, tokens }
}
