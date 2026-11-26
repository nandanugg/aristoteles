import { Effect, Result } from 'effect'
import {
  observeSession, readOpenProject, staffAuthority, startChild, startSession,
} from '../../core/actions/staff-session.ts'
import {
  Rationale, refuse, sessionMayStart, staffOf, subagentCapacity,
  type EventNumber, type LiveSession, type Of, type Pane, type Project, type Refusal,
  type SessionAddress, type SessionId, type Staff, type StaffId, type TaskAddress,
} from '../../core/schema/project.ts'
import { activationLock } from '../../core/services/index.ts'
import type { Committed, ProjectJournal } from '../../core/services/project.ts'

export interface Sessions {
  // The provider keeps its launch intent, credentials and the checkpoint by lifetime in private storage.
  // Reconciliation adopts the committed launches and confirms that every losing launch is stopped.
  readonly reconcile: (project: Project) => Effect.Effect<void, Refusal>
  readonly launch: (staff: Staff, id: Of<typeof SessionId>, previous: Of<typeof SessionId> | null) => Effect.Effect<Of<typeof Pane>, Refusal>
  readonly observe: (session: LiveSession) => Effect.Effect<'Running' | 'Unknown' | 'Paused' | 'Ended', Refusal>
  readonly child: (session: LiveSession, line: Of<typeof TaskAddress>, work: 'Work' | 'Review') => Effect.Effect<void, Refusal>
}

export interface StaffSessionOperations {
  readonly launch: (
    staff: Of<typeof StaffId>, id: Of<typeof SessionId>, staffing: Of<typeof EventNumber>,
    previous: Of<typeof SessionAddress> | null,
  ) => Effect.Effect<Committed, Refusal>
  readonly observe: (session: Of<typeof SessionAddress>) => Effect.Effect<Committed | null, Refusal>
  readonly child: (
    session: Of<typeof SessionId>, line: Of<typeof TaskAddress>, work: 'Work' | 'Review', staffing: Of<typeof EventNumber>,
  ) => Effect.Effect<Committed, Refusal>
}

export const staffSessionOperations = (
  directory: string, journal: ProjectJournal, provider: Sessions,
): StaffSessionOperations => {
  const locked = <A>(run: (project: Project) => Effect.Effect<A, Refusal>) =>
    Effect.scoped(Effect.gen(function* () {
      yield* Effect.mapError(activationLock(directory), () =>
        refuse('Unavailable', Rationale.make('Could not acquire the project session lock.')))
      const project = yield* readOpenProject(journal)
      yield* provider.reconcile(project)
      return yield* run(project)
    }))
  const changed = (operation: Effect.Effect<Committed, Refusal>) =>
    Effect.uninterruptible(Effect.catch(operation, (failure) =>
      Effect.andThen(Effect.flatMap(readOpenProject(journal), provider.reconcile), Effect.fail(failure)),
    ))
  const stale = () => Effect.fail(refuse('Stale', Rationale.make('Staffing or the addressed session has changed.')))
  const wrongMove = () => Effect.fail(refuse('WrongMove', Rationale.make('The addressed task or session cannot take that move.')))
  return {
    launch: (staff, id, staffing, previous) => locked((project) => Effect.gen(function* () {
      if (project.sessions.has(id)) return yield* stale()
      const from = previous && project.sessions.get(previous.id)
      if (previous && (!from || from._tag !== 'Paused' || from.staff.id !== staff)) return yield* wrongMove()
      const eligible = sessionMayStart(project, staff, staffing, from || null)
      if (Result.isFailure(eligible)) return yield* Effect.fail(eligible.failure)
      return yield* changed(Effect.flatMap(provider.launch(eligible.success, id, previous?.id ?? null), ({ address }) => {
        const pane = { address }
        return previous
          ? observeSession(journal, project, previous, { _tag: 'Resumed', id, pane, staffing })
          : startSession(journal, project, { id, staff, pane, staffing })
      }))
    })),
    observe: (address) => locked((project) => Effect.gen(function* () {
      const live = yield* staffAuthority(project, address.id)
      const fact = yield* provider.observe(live)
      if (fact === 'Unknown' || fact === 'Running') return null
      return yield* observeSession(journal, project, address, { _tag: fact })
    })),
    child: (id, line, work, staffing) => locked((project) => Effect.gen(function* () {
      if (staffing !== project.staffingAt) return yield* stale()
      const session = yield* staffAuthority(project, id)
      const task = project.tasks.get(line.id)
      if (!task || (work === 'Work' ? task.phase._tag !== 'Sent' :
          task.phase._tag !== 'Reviewing' || task.phase.review._tag !== 'Waiting')) return yield* wrongMove()
      const staff = staffOf(project, work === 'Work' ? task.role : task.reviewer)
      if (!staff || staff.id !== session.staff.id)
        return yield* Effect.fail(refuse('WrongActor', Rationale.make('This staff does not serve the assigned role.')))
      if (subagentCapacity(project, staff).freeSubagents === 0)
        return yield* Effect.fail(refuse('NoCapacity', Rationale.make('The staff has no free subagent slot.')))
      return yield* changed(Effect.andThen(provider.child(session, line, work), startChild(journal, project, line, session, work)))
    })),
  }
}
