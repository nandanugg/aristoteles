// The fold of the Work events of a store into the c16 state (protocol.qnt Store): the start state
// of Work.Opened, then `take` of each Acted act. Before Work.Opened there is no top: null.
import type { AdmissionPolicy, ChildReservation, Recorded } from '../../schema/index.ts'
import { childDown, emptyPermits, takePermits, type Permits } from '../admission.ts'
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
  readonly policy: ReadonlyMap<string, AdmissionPolicy>
  readonly permits: Permits
  // An act id to the seq of the event that stored it.
  readonly ids: ReadonlyMap<string, number>
  readonly tokens: ReadonlyMap<ActorKey, ReadonlyArray<WorkToken>>
  // The host's pane in the person's tmux (the last one recorded), bookkeeping, not an act.
  readonly hostPane: HostPane | null
  readonly forwards: ReadonlyArray<PendingForward>
  // The bound host's managed session at epoch 0 (an activated workflow), else null.
  readonly hostSession: string | null
}

export const foldWork = (events: ReadonlyArray<Recorded>): WorkFolded | null => {
  let state: WorkState | null = null
  const policy = new Map<string, AdmissionPolicy>()
  let permits = emptyPermits()
  const children = new Map<string, ChildReservation>()
  const settled = new Set<string>()
  const ids = new Map<string, number>()
  const tokens = new Map<ActorKey, Array<WorkToken>>()
  let hostPane: HostPane | null = null
  let forwards: ReadonlyArray<PendingForward> = []
  const runtimeMembers = new Map<string, ReadonlyArray<ActorKey>>()
  let hostSession: string | null = null
  for (const recorded of events) {
    const e = recorded.event
    if (e._tag === 'Runtime' && state !== null) {
      const runtime = e.create
      if (runtime._tag === 'ChildReserved') children.set(runtime.child, runtime)
      if (runtime._tag === 'ChildBound') {
        const child = children.get(runtime.child)
        if (child?.purpose === 'maker') tokens.set(child.actor, [...(tokens.get(child.actor) ?? []), {
          ep: child.epoch, hash: runtime.verifier,
        }])
      }
      if (runtime._tag === 'ChildReleased') {
        settled.add(runtime.child)
        const child = children.get(runtime.child)
        if (child?.purpose === 'maker' && epochOf(state, actorOf(child.actor)) === child.epoch) {
          state = childDown(state, child.actor)
        }
      }
      if (runtime._tag === 'WorkerReserved') {
        runtimeMembers.set(runtime.worker, runtime.members)
      }
      if (runtime._tag === 'WorkerFenced' || runtime._tag === 'WorkerEnded') {
        state = { ...(state as WorkState), down: new Set([...state.down, ...(runtimeMembers.get(runtime.worker) ?? [])]) }
      }
      if (runtime._tag === 'WorkerEnded') {
        for (const child of children.values()) {
          if (child.purpose === 'maker' && child.worker === runtime.worker && child.generation === runtime.generation &&
            epochOf(state, actorOf(child.actor)) === child.epoch) state = childDown(state, child.actor)
        }
      }
      if (runtime._tag === 'WorkerBound') {
        runtimeMembers.set(runtime.worker, runtime.members.map(({ actor }) => actor))
        const down: Set<ActorKey> = new Set(state.down)
        for (const { actor, epoch, verifier } of runtime.members) {
          down.delete(actor)
          tokens.set(actor, [...(tokens.get(actor) ?? []).filter((key) => key.ep !== epoch), { ep: epoch, hash: verifier }])
        }
        state = { ...(state as WorkState), down }
      }
      continue
    }
    if (e._tag !== 'Work') continue
    const c = e.create
    if (c._tag === 'Opened') {
      if (state !== null) return damaged(recorded, 'the top is opened once')
      const start = initState(c.top, new Map(c.items), new Map(c.cards), c.maxTries)
      // A project opens with every persistent actor down: the engine revives them. An activated
      // one opens with its bound host UP at epoch 0 in its managed session (as the model's
      // initStore: nobody down), so its bootstrap credential stays its token.
      hostSession = c.hostSession
      for (const entry of c.admission ?? []) policy.set(entry.actor, entry)
      const down = ['pipe', ...[...start.cards.keys()].map((r) => `role:${r}`)]
      state = { ...start, down: new Set(hostSession === null ? ['host', ...down] : down) }
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
      permits = takePermits(permits, policy, c.act, state)
      if (c.serialAssigned) {
        const { worker, actor, epoch, verifier } = c.serialAssigned
        tokens.set(actor, [...(tokens.get(actor) ?? []), { ep: epoch, hash: verifier }])
        runtimeMembers.set(worker, [...(runtimeMembers.get(worker) ?? []), actor])
      }
      if (c.childReserved) children.set(c.childReserved.child, c.childReserved)
      if (c.childReleased) {
        settled.add(c.childReleased.child)
        const child = children.get(c.childReleased.child)
        if (child) state = childDown(state, child.actor)
      }
      if (c.act.body._tag === 'Review' && c.act.body.verdict === 'Fail') {
        for (const child of children.values()) {
          if (child.purpose === 'maker' && settled.has(child.child) && epochOf(state, actorOf(child.actor)) === child.epoch) {
            state = childDown(state, child.actor)
          }
        }
      }
      ids.set(c.act.id, recorded.seq)
      if (c.forward) forwards = forwards.filter((f) => f.id !== c.forward)
      if (c.token !== null) {
        const [who, hash] = c.token
        tokens.set(who, [...(tokens.get(who) ?? []), { ep: epochOf(state, actorOf(who)), hash }])
      }
    }
  }
  if (state === null) return null
  return { state, policy, permits, ids, tokens, hostPane, forwards, hostSession }
}
