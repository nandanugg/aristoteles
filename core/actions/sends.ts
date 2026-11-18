// The actions of the person's typed sends to a pane: the send, and its fate (delivered or dropped)
// that the supervisor records.
import { Effect } from 'effect'
import type { Derived } from '../derived/index.ts'
import { create, move, type SessionId } from '../schema/index.ts'
import { allowed, current, no, type RefusalsOf } from './support.ts'
import type { Action } from './types.ts'

const REFUSALS = {
  Send: {},
  SendDelivered: {
    noSend: (send: string) => no(`${send} is no send`, 'Pick', 'name a send that waits'),
  },
  SendDropped: {
    noSend: (send: string) => no(`${send} is no send`, 'Pick', 'name a send that waits'),
  },
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS

const tmux = (session: SessionId) => ({ _tag: 'Terminal', session, via: { _tag: 'Tmux' } }) as const

// The person's input for the terminal of a pane; the author is the sender.
const Send: Action<'Send'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    // A pane that is not live drops the send when the supervisor tries it (DeliverSends).
    const from = { _tag: 'Person' as const, to: tmux(input.target.session) }
    return [create('Send', { _tag: 'Sent', from, keys: input.content.keys })]
  })

// A send that is no longer pending makes no event: it was delivered or dropped already (D12).
const sendState = (d: Derived, send: string) => d.states.sends.get(send as never)?._tag

const SendDelivered: Action<'SendDelivered'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { send } = input.target
    const state = sendState(d, send)
    if (state === undefined) return yield* Effect.fail(R.SendDelivered.noSend(send))
    if (state !== 'Pending') return []
    return [move('Send', send, { _tag: 'Delivered' })]
  })

const SendDropped: Action<'SendDropped'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { send } = input.target
    const state = sendState(d, send)
    if (state === undefined) return yield* Effect.fail(R.SendDropped.noSend(send))
    if (state === 'Delivered' || state === 'Dropped') return []
    return [move('Send', send, { _tag: 'Dropped', why: input.content.why })]
  })

export const ACTIONS = { Send, SendDelivered, SendDropped }
