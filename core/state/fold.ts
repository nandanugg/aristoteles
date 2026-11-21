// The fold of the stored events into one Work: one total table from the kind of an event to its
// step, so a new kind fails the compile here until it has one. Each step builds its records with
// their ids and its created list (BUILD.md 3.3). The fold reads
// the record fields only to apply a move (src/domain/moves.ts makes each change of a state).
import {
  type Event,
  type EventOf,
  type Kind,
  kindOf,
  type Logged,
  type Recorded,
  type RecordedOf,
  type Stepped,
  type Work,
} from '../schema/index.ts'
import { actOf, damaged, put, unchanged } from './act.ts'
import { examplesAdded, drafted } from './steps/directions.ts'
import { review } from './steps/reviews.ts'
import { delivered, dropped, sent } from './steps/ui.ts'
import { defined, roleFitted, roleWordsChanged } from './steps/workflow.ts'

type Step<K extends Kind> = (work: Work, event: EventOf<K>, recorded: RecordedOf<K>) => Stepped

const STEPS: { readonly [K in Kind]: Step<K> } = {
  'Workflow.Defined': (_w, _e, r) => damaged(r, 'the workflow of a dir is defined once'),
  'Workflow.RoleWordsChanged': (w, e) => roleWordsChanged(w, e),
  'Role.Fitted': roleFitted,
  'Send.Sent': sent,
  'Send.Delivered': delivered,
  'Send.Dropped': dropped,
  'Review.Accept': (w, e, r) => review(w, e.create, actOf(r)),
  'Review.Reject': (w, e, r) => review(w, e.create, actOf(r)),
  'Revision.Drafted': (w, e, r) => drafted(w, e, actOf(r), r),
  'Revision.Revised': (w, e, r) => drafted(w, e, actOf(r), r),
  'Revision.Imported': (w, e, r) => drafted(w, e, actOf(r), r),
  'Revision.ExamplesAdded': examplesAdded,
  'Source.Moved': (w, e) =>
    unchanged({ ...w, sources: put(w.sources, e.create.source.name, e.create.source) }),
  // The same revision read again: when it was seen is the time of this event (the log's).
  'Source.Checked': (w, e, r) =>
    w.sources.get(e.id)?._tag === 'Outside'
      ? unchanged(w)
      : damaged(r, `${e.id} is no outside source`),
  // The work model folds apart (core/state/c16/fold.ts); the Work stays as it is.
  'Work.Opened': (w) => unchanged(w),
  'Work.Acted': (w) => unchanged(w),
  'Work.HostPane': (w) => unchanged(w),
  'Work.Forwarded': (w) => unchanged(w),
  'Work.ForwardDropped': (w) => unchanged(w),
}

// The step of one stored event through the table: the Work after it, and the ids it made.
const stepOf = (work: Work, recorded: Recorded): Stepped =>
  (STEPS[kindOf(recorded.event)] as (w: Work, e: Event, r: Recorded) => Stepped)(
    work,
    recorded.event,
    recorded,
  )

// One more event on a Work, with its entry in the log (a confirm finds its forward there).
export type FoldStep = (work: Work, recorded: Recorded) => Stepped
export const foldStep: FoldStep = (work, recorded) => {
  const stepped = stepOf(work, recorded)
  const events = [...work.events, { recorded, created: stepped.created }]
  return { work: { ...stepped.work, events }, created: stepped.created }
}

// Every event of a dir, in seq order; the first one is the Workflow.Defined of work init. A
// store that cannot apply throws StoreDamaged at its seq; loadWork makes it a typed failure.
export type Fold = (events: ReadonlyArray<Recorded>) => Work
export const fold: Fold = (events) => {
  const [first, ...rest] = events
  const e = first?.event
  if (first === undefined || e?._tag !== 'Workflow' || !('create' in e)) {
    return damaged(first ?? { seq: 0 }, 'the first event does not define the workflow')
  }
  // One log for the whole fold, so a long store folds in linear time; each step reads the
  // events before it.
  const start = defined(e, first)
  const log: Array<Logged> = [{ recorded: first, created: start.created }]
  let work: Work = { ...start.work, events: log }
  for (const recorded of rest) {
    const stepped = stepOf(work, recorded)
    log.push({ recorded, created: stepped.created })
    work = { ...stepped.work, events: log }
  }
  return work
}
