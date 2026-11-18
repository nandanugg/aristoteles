// The selectors of the effects (BUILD.md 3.4 end, 3.7): pure reads of Derived that each effect
// reacts to. An irrelevant send is never pending (C5). Under ruling 10.1 no wake, retry of a
// problem or ask for words is typed: those are steps of nextFor (notices.ts).
import type { SessionId, Work } from '../schema/index.ts'
import { sendSessionOf } from './catalog.ts'
import type { SendsPending } from './types.ts'

// A terminal has run once when its wait took an assignment (a session names it): only then has its
// AI CLI a conversation to resume. Before that, a start or a restart launches it again.
export const ranOnce = (w: Work, sid: SessionId): boolean =>
  [...w.sessions.values()].some((s) => s.session === sid)

// C5: each Pending send (an irrelevant one is not), with the terminal that it goes into now.
export const sendsPending: SendsPending = (d) =>
  d.moment.work.sends.flatMap((send) => {
    if (d.states.sends.get(send.id)?._tag !== 'Pending') return []
    const to = sendSessionOf(d.moment, send, d.states)
    return to === undefined ? [] : [{ send: send.id, to }]
  })
