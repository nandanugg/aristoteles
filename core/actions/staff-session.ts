import { Effect, Result } from 'effect'
import {
  Rationale, ReadPosition, refuse, liveSession, staffingAt, type LiveSession, type Of, type Pane, type Project, type Refusal, type Staff,
  type SessionAddress, type StaffSessionKey, type EventNumber, type TaskAddress,
} from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { fold } from '../state/project.ts'
import { assignTaskReview } from './task-review.ts'
import { recordObserved } from './project.ts'

export const readOpenProject = (journal: Journal): Effect.Effect<Project, Refusal> =>
  Effect.flatMap(journal.eventsAfter(ReadPosition.make(0)), (events) => {
    const state = fold(events)
    if (Result.isFailure(state)) return Effect.fail(state.failure)
    if (state.success?.status._tag === 'Open') return Effect.succeed(state.success)
    return Effect.fail(state.success
      ? refuse('ProjectEnded', Rationale.make('This project has ended.'))
      : refuse('WrongMove', Rationale.make('Open the project first.')))
  })

export const staffAuthority = (
  project: Project, key: Of<typeof StaffSessionKey>,
): Effect.Effect<LiveSession, Refusal> => {
  const session = liveSession(project, key)
  return session ? Effect.succeed(session)
    : Effect.fail(refuse('RetiredSession', Rationale.make('This staff session is retired.')))
}

export const reserveSession = (
  journal: Journal, project: Project, address: Of<typeof SessionAddress>, staff: Staff,
  staffing: Of<typeof EventNumber>, previous?: Of<typeof SessionAddress>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, {
  line: address, from: null, move: 'open', input: { staff, staffing, previous: previous ?? { _tag: 'None' } },
})

export const acknowledgeSession = (
  journal: Journal, project: Project, address: Of<typeof SessionAddress>, pane: Of<typeof Pane>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, {
  line: address, from: 'Starting', move: 'next', input: { pane },
})

export const cancelSession = (
  journal: Journal, project: Project, address: Of<typeof SessionAddress>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, {
  line: address, from: 'Starting', move: 'cancel', input: {},
})

export const observeSession = (
  journal: Journal, project: Project, address: Of<typeof SessionAddress>, observed: 'Paused' | 'Ended',
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, {
  line: address, from: 'Live', move: 'next', input: { observed },
})

export const startChild = (
  journal: Journal, project: Project, line: Of<typeof TaskAddress>, session: LiveSession, work: 'Work' | 'Review',
): Effect.Effect<Committed, Refusal> => {
  const actor = { _tag: 'Staff', key: session.staff.key } as const
  const input = { session, staffing: staffingAt(project) }
  return work === 'Review' ? assignTaskReview(journal, project, line, session)
    : recordObserved(journal, actor, project.read, { line, from: 'Sent', move: 'next', input: { ...input, where: 'Subagent' } })
}
