import { Effect, Result } from 'effect'
import {
  Rationale, ReadPosition, refuse, liveSession, type LiveSession, type Of, type Pane, type Project, type Refusal,
  type SessionAddress, type SessionId, type StaffId, type EventNumber, type SessionEvent, type TaskAddress,
} from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { fold } from '../state/project.ts'
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
  project: Project, id: Of<typeof SessionId>,
): Effect.Effect<LiveSession, Refusal> => {
  const session = liveSession(project, id)
  return session ? Effect.succeed(session)
    : Effect.fail(refuse('RetiredSession', Rationale.make('This staff session is retired.')))
}

export const startSession = (
  journal: Journal, project: Project, session: {
    readonly id: Of<typeof SessionId>; readonly staff: Of<typeof StaffId>
    readonly pane: Of<typeof Pane>; readonly staffing: Of<typeof EventNumber>
  },
): Effect.Effect<Committed, Refusal> => {
  const { id, ...input } = session
  return recordObserved(journal, project.owner, project.read, {
    line: { _tag: 'Session', id }, from: null, move: 'next', input,
  })
}

export const observeSession = (
  journal: Journal, project: Project, address: Of<typeof SessionAddress>, observed: 'Paused' | 'Ended',
): Effect.Effect<Committed, Refusal> => recordObserved(journal, project.owner, project.read, {
  line: address, from: 'Live', move: 'next', input: { observed },
})

export const resumeSession = (
  journal: Journal, project: Project, address: Of<typeof SessionAddress>,
  input: Extract<SessionEvent, { from: 'Paused' }>['input'],
): Effect.Effect<Committed, Refusal> => recordObserved(journal, project.owner, project.read, {
  line: address, from: 'Paused', move: 'next', input,
})

export const startChild = (
  journal: Journal, project: Project, line: Of<typeof TaskAddress>, session: LiveSession, work: 'Work' | 'Review',
): Effect.Effect<Committed, Refusal> => {
  const actor = { _tag: 'Staff', id: session.staff.id } as const
  const input = { session, staffing: project.staffingAt }
  return recordObserved(journal, actor, project.read, work === 'Review'
    ? { line, from: 'Reviewing', move: 'next', input }
    : { line, from: 'Sent', move: 'next', input: { ...input, place: 'Child' } })
}
