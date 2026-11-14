// DeliverSends (C5, ruling 10.1): the only text that goes into a terminal is a host's `work send`
// (the answer to a permission dialog of its child's AI CLI): typed at once while the terminal
// runs, dropped when it is stopped or not live. A send whose SendState is not Pending (an
// Irrelevant one: its owner ended) is never typed. The supervisor types nothing: a line of an
// older watcher that still waits is dropped. A ProblemRetry stays: it is the person's ask, read
// as a step of the host.
import { Effect } from 'effect'
import { type Derived, type PendingSend, sendsPending } from '../derived/index.ts'
import type { Send } from '../schema/index.ts'
import { Pump } from '../services/index.ts'
import { deliver, dropped, stateIn, step, terminalsOf } from './acting.ts'
import type { WorkEffect } from './types.ts'

export const textOfKeys = (send: Send): string => (send.keys._tag === 'Line' ? send.keys.text : '')

const deliverOne = (d: Derived, x: PendingSend, send: Send) =>
  Effect.gen(function* () {
    if (send.from._tag === 'Supervisor') {
      if (send.from.reason._tag === 'ProblemRetry') return
      return yield* dropped(x.send, { _tag: 'BeforeRestart' })
    }
    const pump = yield* Pump
    const terminals = yield* terminalsOf(d.moment.work)
    const reading = (yield* pump.status)[x.to]
    if (stateIn(terminals, x.to)?._tag === 'Stopped') {
      return yield* dropped(x.send, { _tag: 'StoppedByPerson' })
    }
    if (reading?.live !== true) return yield* dropped(x.send, { _tag: 'TerminalNotLive' })
    yield* deliver(x.send, x.to, textOfKeys(send))
  })

export const DeliverSends: WorkEffect<'DeliverSends'> = {
  name: 'DeliverSends',
  select: sendsPending,
  react: (pending, d) =>
    Effect.forEach(
      pending,
      (x) => {
        const send = d.moment.work.sends.find((s) => s.id === x.send)
        return send === undefined ? Effect.void : step('send', deliverOne(d, x, send))
      },
      { discard: true },
    ),
}
