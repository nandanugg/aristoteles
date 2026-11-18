// The step of a review: one record at the engine's clock. The owner's accept of a draft makes its
// version at once; a reject ends the draft (its state follows from the review, core/derived).
import {
  type RejectId,
  type Review,
  type ReviewWritten,
  type Stepped,
  type Work,
} from '../../schema/index.ts'
import { type Act, built, put } from '../act.ts'
import { makeVersion } from './directions.ts'

export const review = (work: Work, d: ReviewWritten, act: Act): Stepped =>
  built(work, (b) => {
    if (act.by._tag !== 'Human') throw new Error(`${act.by.name} decides no draft`)
    const base = { by: act.by, when: act.when }
    const id = b.name('review')
    const made: Review =
      d._tag === 'Accept'
        ? { ...base, _tag: 'Accept', id, reason: d.reason, of: d.of, at: b.tick() }
        : { ...base, _tag: 'Reject', id: id as RejectId, of: d.of, at: b.tick() }
    b.work = { ...b.work, reviews: put(b.work.reviews, made.id, made) }
    if (made._tag === 'Accept') makeVersion(b, made.of.id, act.when)
  })
