// DeliverSends (C5, ruling 10.1): the only text that goes into a terminal is a host's `work send`
// (the answer to a permission dialog of its child's AI CLI): typed at once while the terminal
// runs, dropped when it is not live. A send whose SendState is not Pending (an Irrelevant one:
// its owner ended) is never typed. The supervisor types nothing: a line of an older watcher that
// still waits is dropped.
import { Effect } from 'effect'
import { type PendingSend, sendsPending } from '../derived/index.ts'
import type { Send } from '../schema/index.ts'
import { Pump } from '../services/index.ts'
import { deliver, dropped, step } from './acting.ts'
import type { WorkEffect } from './types.ts'

export const textOfKeys = (send: Send): string => (send.keys._tag === 'Line' ? send.keys.text : '')

const deliverOne = (x: PendingSend, send: Send) =>
  Effect.gen(function* () {
    if (send.from._tag === 'Supervisor') return yield* dropped(x.send, { _tag: 'BeforeRestart' })
    const reading = (yield* (yield* Pump).status)[x.to]
    if (reading?._tag !== 'Live') return yield* dropped(x.send, { _tag: 'TerminalNotLive' })
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
        return send === undefined ? Effect.void : step('send', deliverOne(x, send))
      },
      { discard: true },
    ),
}
