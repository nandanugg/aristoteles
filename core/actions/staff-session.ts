import { Effect, Result } from 'effect'
import {
  Rationale, ReadPosition, refuse, liveSession, staffingAt, type LiveSession, type Of, type Pane, type Project, type Refusal, type Staff,
  type StaffSessionKey, type EventNumber, type TaskKey,
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
    : Effect.fail(refuse('RetiredSession', Rationale.make('This staff session is unavailable. Run work wait when the session is live.')))
}

export const reserveSession = (
  journal: Journal, project: Project, key: Of<typeof StaffSessionKey>, staff: Staff,
  staffing: Of<typeof EventNumber>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, {
  line: 'Session', key, from: null, move: 'open', input: { staff, staffing },
})

export const acknowledgeSession = (
  journal: Journal, project: Project, key: Of<typeof StaffSessionKey>, pane: Of<typeof Pane>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, {
  line: 'Session', key, from: 'Starting', move: 'next', input: { pane },
})

export const cancelSession = (
  journal: Journal, project: Project, key: Of<typeof StaffSessionKey>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, {
  line: 'Session', key, from: 'Starting', move: 'cancel', input: {},
})

export const observeSession = (
  journal: Journal, project: Project, key: Of<typeof StaffSessionKey>, observed: 'Live' | 'Paused' | 'Ended',
): Effect.Effect<Committed, Refusal> => {
  const session = project.sessions.get(key)
  const actor = { _tag: 'Human' } as const
  if (session?._tag === 'Live' && observed !== 'Live')
    return recordObserved(journal, actor, project.read, { line: 'Session', key, from: 'Live', move: 'next', input: { observed } })
  if (session?._tag === 'Paused' && observed !== 'Paused')
    return recordObserved(journal, actor, project.read, { line: 'Session', key, from: 'Paused', move: 'next', input: { observed } })
  return Effect.fail(refuse('WrongMove', Rationale.make('The observation does not change this session.')))
}

export const startChild = (
  journal: Journal, project: Project, key: Of<typeof TaskKey>, session: LiveSession, work: 'Work' | 'Review',
): Effect.Effect<Committed, Refusal> => {
  const actor = { _tag: 'Session', key: session.key } as const
  const input = { staffing: staffingAt(project) }
  return work === 'Review' ? assignTaskReview(journal, project, key, session)
    : recordObserved(journal, actor, project.read, { line: 'Task', key, from: 'Sent', move: 'next', input: { ...input, where: 'Subagent' } })
}
