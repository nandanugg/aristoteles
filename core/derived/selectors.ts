// The selector of the effects (BUILD.md 3.4 end, 3.7): a pure read of Derived that DeliverSends
// reacts to. A send that is not Pending is not selected (C5).
import { sendSessionOf } from './catalog.ts'
import type { SendsPending } from './types.ts'

// C5: each Pending send, with the terminal that it goes into.
export const sendsPending: SendsPending = (d) =>
  d.moment.work.sends.flatMap((send) => {
    if (d.states.sends.get(send.id)?._tag !== 'Pending') return []
    const to = sendSessionOf(send)
    return to === undefined ? [] : [{ send: send.id, to }]
  })
