// The steps of the person's typed sends: the send, and its fate (delivered or dropped).
import {
  type EventOf,
  type EventRef,
  Moves,
  type RecordedOf,
  type Stepped,
  type Work,
} from '../../schema/index.ts'
import { damaged, unchanged } from '../act.ts'

export const eventRef = (seq: number) => `e${seq}` as EventRef

export const sent = (work: Work, e: EventOf<'Send.Sent'>, r: RecordedOf<'Send.Sent'>): Stepped => {
  const { from, keys } = e.create
  const send = Moves.sendText({ id: eventRef(r.seq), from, keys, at: r.at })
  return unchanged({ ...work, sends: [...work.sends, send] })
}
export const delivered = (
  work: Work,
  e: EventOf<'Send.Delivered'>,
  r: RecordedOf<'Send.Delivered'>,
): Stepped => {
  const s = work.sends.find((x) => x.id === e.id)
  if (s?.state._tag !== 'Pending') return damaged(r, `${e.id} is no pending send`)
  const done = Moves.MOVES['Send.Delivered']({ ...s, state: s.state }, r.at)
  return unchanged({ ...work, sends: work.sends.map((x) => (x.id === e.id ? done : x)) })
}
export const dropped = (
  work: Work,
  e: EventOf<'Send.Dropped'>,
  r: RecordedOf<'Send.Dropped'>,
): Stepped => {
  const s = work.sends.find((x) => x.id === e.id)
  if (s?.state._tag !== 'Pending') return damaged(r, `${e.id} is no pending send`)
  const done = Moves.MOVES['Send.Dropped']({ ...s, state: s.state }, r.at, e.move.why)
  return unchanged({ ...work, sends: work.sends.map((x) => (x.id === e.id ? done : x)) })
}
