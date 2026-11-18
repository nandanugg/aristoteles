// The workflow of a dir: its first event (work init, or the store start of onboarding with the
// accepted directions) makes the Work; a later event changes the words of roles; a role fit
// records the yes and why of each question.
import {
  type EventOf,
  type GroupOf,
  Moves,
  noCounters,
  type RecordedOf,
  type Stepped,
  type Time,
  type Work,
} from '../../schema/index.ts'
import { built, put, unchanged } from '../act.ts'
import { onboarded } from './directions.ts'
import { eventRef } from './ui.ts'

// The Work of a new dir from its first event.
type Defined = Extract<GroupOf<'Workflow'>, { readonly create: unknown }>
const newWork = (event: Defined): Work => {
  const { config, hashes, texts } = event.create
  return {
    config,
    hashes,
    texts,
    fits: new Map(),
    directions: new Map(),
    drafts: new Map(),
    standards: new Map(),
    rules: new Map(),
    reviews: new Map(),
    sources: new Map(),
    sends: [],
    events: [],
    counters: noCounters,
    clock: 0,
  }
}

// The first event: the Work, and version 1 of each direction that onboarding accepted (Question
// 20, option A), whose draft names this event as its origin.
export const defined = (
  event: Defined,
  recorded: { readonly seq: number; readonly at: Time },
): Stepped =>
  built(newWork(event), (b) => {
    for (const d of event.create.directions) onboarded(b, d, eventRef(recorded.seq), recorded.at)
  })

export const roleWordsChanged = (
  work: Work,
  e: EventOf<'Workflow.RoleWordsChanged'>,
): Stepped => {
  const d = e.move
  return unchanged({
    ...work,
    config: Moves.MOVES['Workflow.RoleWordsChanged'](work.config, d.roles),
    hashes: d.hashes,
    texts: d.texts,
  })
}

export const roleFitted = (
  work: Work,
  e: EventOf<'Role.Fitted'>,
  r: RecordedOf<'Role.Fitted'>,
): Stepped => {
  const fit = { hash: e.move.hash, by: r.author, answers: e.move.answers }
  return unchanged({ ...work, fits: put(work.fits, e.id, fit) })
}
