// The person's act that the top agent forwarded with the person's words. An act that only stops
// work or informs counts at once (a reject, a question, a comment); one that moves work on waits
// for the person's confirm (an accept, a resolve, an answer), and counts at the confirm.
import {
  type ConfirmableAct,
  type CountedAct,
  type EventOf,
  type EventRef,
  type ForwardedAct,
  human,
  Moves,
  type RecordedOf,
  type Stepped,
  type Time,
  type Work,
} from '../../schema/index.ts'
import { type Act, damaged, put, unchanged } from '../act.ts'
import { answererBy } from '../records.ts'
import { answered, asked, noted } from './questions.ts'
import { review } from './reviews.ts'
import { eventRef } from './ui.ts'

type Seq = { readonly seq: number }

const counts = (inner: ForwardedAct): inner is CountedAct => {
  if (inner._tag === 'Note') return true
  if (inner._tag === 'Question') return 'create' in inner
  return 'create' in inner && inner.create._tag === 'Reject'
}

// The inner act, as the person's own act at the time of the forward or of the confirm.
const applyInner = (work: Work, inner: ForwardedAct, act: Act, r: Seq): Stepped => {
  switch (inner._tag) {
    case 'Review':
      return review(work, inner.create, act)
    case 'Note':
      return noted(work, inner.create, act)
    case 'Question':
      return 'create' in inner
        ? asked(work, inner.create, act)
        : answered(work, inner.id, inner.move.text, answererBy(work, act.by), act, r)
  }
}
const personAct = (person: string, r: { readonly at: Time }): Act => ({
  by: human(person),
  when: r.at,
})

export const forwarded = (
  work: Work,
  e: EventOf<'Forward.Forwarded'>,
  r: RecordedOf<'Forward.Forwarded'>,
): Stepped => {
  const ref = eventRef(r.seq)
  const { inner, person } = e.create
  if (counts(inner)) {
    const stepped = applyInner(work, inner, personAct(person, r), r)
    const forward = { event: ref, _tag: 'Counted' as const, inner }
    return {
      ...stepped,
      work: { ...stepped.work, forwards: put(stepped.work.forwards, ref, forward) },
    }
  }
  const waiting = Moves.waitForConfirm(ref, inner as ConfirmableAct)
  return unchanged({ ...work, forwards: put(work.forwards, ref, waiting) })
}

// The person that a forward is for: its Forwarded event, in the log before this step.
const forwardOf = (work: Work, ref: EventRef) => {
  const logged = work.events.find((l) => eventRef(l.recorded.seq) === ref)
  const e = logged?.recorded.event
  return e?._tag === 'Forward' && 'create' in e ? e.create : undefined
}
export const confirmed = (
  work: Work,
  e: EventOf<'Forward.Confirmed'>,
  r: RecordedOf<'Forward.Confirmed'>,
): Stepped => {
  const f = work.forwards.get(e.id)
  if (f?._tag !== 'Confirmable' || f.state._tag !== 'Waiting') {
    return damaged(r, `${e.id} is no forward that waits`)
  }
  const done = Moves.MOVES['Forward.Confirmed']({ ...f, state: f.state }, eventRef(r.seq))
  const next = { ...work, forwards: put(work.forwards, e.id, done) }
  const person = forwardOf(work, e.id)?.person ?? damaged(r, `${e.id} is no forward`)
  return applyInner(next, f.inner, personAct(person, r), r)
}
