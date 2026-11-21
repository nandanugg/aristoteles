// The fold of the Work events of a store into the c16 state (protocol.qnt Store): the start state
// of Work.Opened, then `take` of each Acted act. Before Work.Opened there is no top: null.
import type { Recorded } from '../../schema/index.ts'
import { damaged } from '../act.ts'
import { take } from './effect.ts'
import { epochOf } from './reads.ts'
import { initState, type WorkState } from './state.ts'
import { type ActorKey, actorOf, type Body } from './types.ts'

// The tokens of each actor, one per epoch in order: an old epoch's token still names that epoch.
export interface WorkToken {
  readonly ep: number
  readonly hash: string
}
// A forward that waits for the person: the host's carry of their act (`id` is f<seq>).
export interface PendingForward {
  readonly id: string
  readonly act: Body
  readonly on: number | null
  readonly quote: string
}
export interface HostPane {
  readonly socket: string
  readonly pane: string
}
export interface WorkFolded {
  readonly state: WorkState
  // An act id to the seq of the event that stored it.
  readonly ids: ReadonlyMap<string, number>
  readonly tokens: ReadonlyMap<ActorKey, ReadonlyArray<WorkToken>>
  // The host's pane in the person's tmux (the last one recorded), bookkeeping, not an act.
  readonly hostPane: HostPane | null
  readonly forwards: ReadonlyArray<PendingForward>
}

export const foldWork = (events: ReadonlyArray<Recorded>): WorkFolded | null => {
  let state: WorkState | null = null
  const ids = new Map<string, number>()
  const tokens = new Map<ActorKey, Array<WorkToken>>()
  let hostPane: HostPane | null = null
  let forwards: ReadonlyArray<PendingForward> = []
  for (const recorded of events) {
    const e = recorded.event
    if (e._tag !== 'Work') continue
    const c = e.create
    if (c._tag === 'Opened') {
      if (state !== null) return damaged(recorded, 'the top is opened once')
      const start = initState(c.top, new Map(c.items), new Map(c.cards), c.maxTries)
      // A project opens with every persistent actor down: the engine revives them.
      state = { ...start, down: new Set(['host', 'pipe', ...[...start.cards.keys()].map((r) => `role:${r}`)]) }
      for (const [who, hash] of c.tokens) tokens.set(who, [{ ep: 0, hash }])
    } else if (c._tag === 'HostPane') {
      if (state === null) return damaged(recorded, 'a host pane before the top is opened')
      hostPane = { socket: c.socket, pane: c.pane }
    } else if (c._tag === 'Forwarded') {
      if (state === null) return damaged(recorded, 'a forward before the top is opened')
      forwards = [...forwards, { id: c.id, act: c.act, on: c.on, quote: c.quote }]
    } else if (c._tag === 'ForwardDropped') {
      forwards = forwards.filter((f) => f.id !== c.id)
    } else {
      if (state === null) return damaged(recorded, 'an act before the top is opened')
      state = take(state, c.act)
      ids.set(c.act.id, recorded.seq)
      if (c.forward) forwards = forwards.filter((f) => f.id !== c.forward)
      if (c.token !== null) {
        const [who, hash] = c.token
        tokens.set(who, [...(tokens.get(who) ?? []), { ep: epochOf(state, actorOf(who)), hash }])
      }
    }
  }
  return state === null ? null : { state, ids, tokens, hostPane, forwards }
}
