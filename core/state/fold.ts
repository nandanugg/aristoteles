// The fold of the stored events into one Work: one total table from the kind of an event to its
// step, so a new kind fails the compile here until it has one. Each step builds the records of
// the old replay with the same ids and the same created lists (BUILD.md 3.3). The fold reads
// the record fields only to apply a move (src/domain/moves.ts makes each change of a state).
import {
  type Event,
  type EventOf,
  human,
  type Kind,
  kindOf,
  type Logged,
  type Recorded,
  type RecordedOf,
  type Stepped,
  type Work,
} from '../schema/index.ts'
import { actOf, damaged, put, unchanged } from './act.ts'
import { checkpointStep } from './checkpoint.ts'
import { briefed, finish, freed, given, report } from './steps/assignments.ts'
import { drafted, suggested } from './steps/directions.ts'
import { confirmed, forwarded } from './steps/forwards.ts'
import {
  answered,
  asked,
  escalated,
  evaluated,
  granted,
  noted,
  revoked,
} from './steps/questions.ts'
import { review } from './steps/reviews.ts'
import { close, described, open, remake, split } from './steps/tasks.ts'
import {
  delivered,
  dropped,
  hostJoined,
  hostMoved,
  hostStarted,
  hostWords,
  problemFixed,
  problemRecorded,
  runClosed,
  runDone,
  sent,
  taskDrafted,
  terminalReported,
  terminalStarted,
} from './steps/ui.ts'
import {
  newWork,
  roleFitted,
  roleWordsChanged,
  roleWordsDrafted,
  roleWordsRejected,
} from './steps/workflow.ts'

type Step<K extends Kind> = (work: Work, event: EventOf<K>, recorded: RecordedOf<K>) => Stepped

const STEPS: { readonly [K in Kind]: Step<K> } = {
  'Workflow.Defined': (_w, _e, r) => damaged(r, 'the workflow of a dir is defined once'),
  'Workflow.RoleWordsChanged': (w, e) => roleWordsChanged(w, e),
  'Role.Fitted': roleFitted,
  'Role.WordsDrafted': roleWordsDrafted,
  'Role.WordsRejected': roleWordsRejected,
  'Run.HostJoined': hostJoined,
  'Run.HostStarted': hostStarted,
  'Run.HostMoved': hostMoved,
  'Run.Done': runDone,
  'Run.Closed': runClosed,
  'TaskDraft.Drafted': taskDrafted,
  'Problem.Recorded': problemRecorded,
  'Problem.Fixed': problemFixed,
  'Terminal.Started': terminalStarted,
  'Terminal.Failed': terminalReported,
  'Terminal.Prompted': terminalReported,
  'Terminal.Stopped': terminalReported,
  'Terminal.Resumed': terminalReported,
  'Terminal.Closed': terminalReported,
  'Send.Sent': sent,
  'Send.Delivered': delivered,
  'Send.Dropped': dropped,
  'HostWords.ProblemWords': hostWords,
  'HostWords.DraftWords': hostWords,
  'HostWords.EndWords': hostWords,
  'Task.Opened': (w, e, r) => open(w, e, actOf(r), r),
  'Task.OpenedFromDraft': (w, e, r) => open(w, e, actOf(r), r),
  'Task.Remade': (w, e, r) => remake(w, e, actOf(r)),
  'Task.Split': (w, e, r) => split(w, e, actOf(r)),
  'Task.Closed': (w, e, r) => close(w, e, actOf(r)),
  'Task.Described': (w, e, r) => described(w, e, r),
  'Assignment.GivenMaker': (w, e, r) => given(w, e, actOf(r)),
  'Assignment.GivenReviewer': (w, e, r) => given(w, e, actOf(r)),
  'Assignment.Briefed': (w, e, r) => briefed(w, e, actOf(r)),
  'Assignment.BriefedToCheck': (w, e, r) => briefed(w, e, actOf(r)),
  'Assignment.BriefedFirst': (w, e, r) => briefed(w, e, actOf(r)),
  'Assignment.Freed': (w, e, r) => freed(w, e, r),
  'Assignment.Finished': (w, e, r) => finish(w, e, actOf(r)),
  'Result.Result': (w, e, r) => report(w, e, actOf(r)),
  'Review.Accept': (w, e, r) => review(w, e.create, actOf(r)),
  'Review.Reject': (w, e, r) => review(w, e.create, actOf(r)),
  'Review.Recheck': (w, e, r) => review(w, e.create, actOf(r)),
  'Review.Escalate': (w, e, r) => review(w, e.create, actOf(r)),
  'Review.Resolve': (w, e, r) => review(w, e.create, actOf(r)),
  'Question.Asked': (w, e, r) => asked(w, e.create, actOf(r)),
  'Question.Escalated': (w, e, r) => escalated(w, e, actOf(r)),
  // Only an agent or the person answers: the agent by its assignment, the person by name.
  'Question.Answered': (w, e, r) => {
    const by = r.author._tag === 'Agent' ? r.author.assignment : human(r.author.name)
    return answered(w, e.id, e.move.text, by, actOf(r), r)
  },
  'Note.Message': (w, e, r) => noted(w, e.create, actOf(r)),
  'Note.Finding': (w, e, r) => noted(w, e.create, actOf(r)),
  'Evaluation.Evaluation': (w, e, r) => evaluated(w, e, actOf(r)),
  'Suggestion.Suggestion': (w, e, r) => suggested(w, e, actOf(r), r),
  'Revision.Drafted': (w, e, r) => drafted(w, e, actOf(r), r),
  'Revision.Revised': (w, e, r) => drafted(w, e, actOf(r), r),
  'Revision.Imported': (w, e, r) => drafted(w, e, actOf(r), r),
  'Permission.Granted': (w, e, r) => granted(w, e, actOf(r)),
  'Permission.Revoked': (w, e, r) => revoked(w, e, actOf(r), r),
  'Source.Moved': (w, e) =>
    unchanged({ ...w, sources: put(w.sources, e.create.source.name, e.create.source) }),
  // The same revision read again: when it was seen is the time of this event (the log's).
  'Source.Checked': (w, e, r) =>
    w.sources.get(e.id)?._tag === 'Outside'
      ? unchanged(w)
      : damaged(r, `${e.id} is no outside source`),
  'Checkpoint.Checkpoint': (w, e, r) => checkpointStep(w, e, actOf(r)),
  'Forward.Forwarded': forwarded,
  'Forward.Confirmed': confirmed,
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
  const who = first.author._tag === 'Person' ? first.author.name : first.author._tag
  // One log for the whole fold, so a long store folds in linear time; each step reads the
  // events before it.
  const log: Array<Logged> = [{ recorded: first, created: [] }]
  let work: Work = { ...newWork(e, who), events: log }
  for (const recorded of rest) {
    const stepped = stepOf(work, recorded)
    log.push({ recorded, created: stepped.created })
    work = { ...stepped.work, events: log }
  }
  return work
}
