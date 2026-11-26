import { Effect, Result } from 'effect'
import {
  Rationale, ReadPosition, refuse, liveSession, type LiveSession, type Of, type Project, type Refusal,
  type SessionAddress, type SessionBegan, type SessionId, type SessionObservation, type StaffingPlan, type TaskAddress,
} from '../schema/project.ts'
import type { Committed, ProjectJournal } from '../services/project.ts'
import { fold } from '../state/project.ts'
import { recordObserved } from './project.ts'

export const readOpenProject = (journal: ProjectJournal): Effect.Effect<Project, Refusal> =>
  Effect.flatMap(journal.eventsAfter(ReadPosition.make(0)), (events) => {
    const state = fold(events)
    if (Result.isFailure(state)) return Effect.fail(state.failure)
    if (state.success._tag === 'Open') return Effect.succeed(state.success.value)
    return Effect.fail(state.success._tag === 'Ended'
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

export const acceptStaffing = (
  journal: ProjectJournal, project: Project, plan: StaffingPlan,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, project.owner, project.read, { _tag: 'StaffingAccepted', plan })

export const startSession = (
  journal: ProjectJournal, project: Project, session: Of<typeof SessionBegan>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, project.owner, project.read, { _tag: 'SessionStarted', session })

export const observeSession = (
  journal: ProjectJournal, project: Project, line: Of<typeof SessionAddress>, fact: SessionObservation,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, project.owner, project.read, { _tag: 'SessionObserved', line, fact })

export const startChild = (
  journal: ProjectJournal, project: Project, line: Of<typeof TaskAddress>, session: LiveSession, work: 'Work' | 'Review',
): Effect.Effect<Committed, Refusal> =>
  recordObserved(journal, { _tag: 'Staff', id: session.staff.id }, project.read, {
    _tag: work === 'Review' ? 'Reviewing' : 'Began', line, session, staffing: project.staffingAt,
  })
