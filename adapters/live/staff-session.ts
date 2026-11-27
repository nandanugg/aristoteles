import { Effect, Result } from 'effect'
import { checkTaskReview } from '../../core/actions/task-review.ts'
import {
  acknowledgeSession, cancelSession, observeSession, readOpenProject, reserveSession, staffAuthority, startChild,
} from '../../core/actions/staff-session.ts'
import {
  Rationale, refuse, sessionMayStart, latestSession, staffByKey, staffOf, staffingAt, taskRole, subagentCapacity, activeWork,
  type EventNumber, type LiveSession, type Starting, type Of, type Pane, type Project, type Refusal,
  type StaffSessionKey, type Staff, type StaffKey, type TaskKey,
} from '../../core/schema/project.ts'
import { projectLock } from '../../core/services/project.ts'
import type { Committed, Journal } from '../../core/services/project.ts'

export interface Sessions {
  // The provider keeps its launch intent, credentials and the checkpoint by lifetime in private storage.
  // Reconciliation adopts the committed launches and confirms that every losing launch is stopped.
  readonly reconcile: (project: Project) => Effect.Effect<void, Refusal>
  readonly launch: (staff: Staff, key: Of<typeof StaffSessionKey>, previous: Of<typeof StaffSessionKey> | null) => Effect.Effect<Of<typeof Pane> | null, Refusal>
  readonly stop: (session: Of<typeof Starting>) => Effect.Effect<void, Refusal>
  readonly observe: (session: LiveSession | Of<typeof Starting>) => Effect.Effect<'Running' | 'Unknown' | 'Paused' | 'Ended', Refusal>
  readonly child: (session: LiveSession, taskKey: Of<typeof TaskKey>,
    work: { readonly _tag: 'Work' } | { readonly _tag: 'Review'; readonly review: Of<typeof EventNumber> }) => Effect.Effect<void, Refusal>
}

export interface StaffSessionOperations {
  readonly launch: (
    staff: Of<typeof StaffKey>, key: Of<typeof StaffSessionKey>, staffing: Of<typeof EventNumber>,
    previous: Of<typeof StaffSessionKey> | null,
  ) => Effect.Effect<Committed, Refusal>
  readonly observe: (session: Of<typeof StaffSessionKey>) => Effect.Effect<Committed | null, Refusal>
  readonly child: (
    session: Of<typeof StaffSessionKey>, taskKey: Of<typeof TaskKey>, work: 'Work' | 'Review', staffing: Of<typeof EventNumber>,
  ) => Effect.Effect<Committed, Refusal>
}

export const staffSessionOperations = (
  directory: string, journal: Journal, provider: Sessions, review?: Effect.Effect<Committed | null, Refusal>,
): StaffSessionOperations => {
  const locked = <A>(run: (project: Project) => Effect.Effect<A, Refusal>) =>
    Effect.scoped(Effect.gen(function* () {
      yield* Effect.mapError(projectLock(directory), () =>
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
    launch: (staff, key, staffing, previous) => locked((project) => Effect.gen(function* () {
      if (project.sessions.has(key)) return yield* stale()
      const from = previous && project.sessions.get(previous)
      if (previous && (!from || from._tag !== 'Paused' || from.staff.key !== staff)) return yield* wrongMove()
      const assigned = staffByKey(project, staff)
      if (!assigned) return yield* wrongMove()
      const activation = project.activation
      if ((activation._tag === 'Activating' || activation._tag === 'RollingBack' ||
          activation._tag === 'Active' && activation.work._tag === 'NotStarted') &&
          activation.staff.key === assigned.key) return yield* wrongMove()
      const pending = latestSession(project, assigned)
      let state = project
      if (pending?._tag === 'Starting') {
        yield* provider.stop(pending)
        state = (yield* cancelSession(journal, state, pending.key)).state
      }
      const eligible = sessionMayStart(state, staff, staffing, from || null)
      if (Result.isFailure(eligible)) return yield* Effect.fail(eligible.failure)
      const reserved = yield* reserveSession(journal, state, key, eligible.success, staffing, previous ?? undefined)
      const started = yield* Effect.result(provider.launch(eligible.success, key, previous))
      if (Result.isFailure(started)) {
        const pending = reserved.state.sessions.get(key)
        if (pending?._tag === 'Starting') {
          yield* provider.stop(pending)
          yield* cancelSession(journal, reserved.state, key)
        }
        return yield* Effect.fail(started.failure)
      }
      return started.success ? yield* acknowledgeSession(journal, reserved.state, key, started.success) : reserved
    })).pipe(Effect.tap(() => review ? Effect.asVoid(Effect.result(review)) : Effect.void)),
    observe: (key) => locked((project) => Effect.gen(function* () {
      const session = project.sessions.get(key)
      if (session?._tag !== 'Starting' && session?._tag !== 'Live') return null
      const fact = yield* provider.observe(session)
      if (fact === 'Unknown' || fact === 'Running') return null
      return session._tag === 'Starting'
        ? yield* cancelSession(journal, project, key)
        : yield* observeSession(journal, project, key, fact)
    })),
    child: (key, taskKey, work, staffing) => locked((project) => Effect.gen(function* () {
      if (!activeWork(project)) return yield* wrongMove()
      if (staffing !== staffingAt(project)) return yield* stale()
      const session = yield* staffAuthority(project, key)
      const task = project.tasks.get(taskKey)
      const open = (child: Parameters<Sessions['child']>[2]) =>
        changed(Effect.andThen(provider.child(session, taskKey, child), startChild(journal, project, taskKey, session, work)))
      if (work === 'Review') {
        const review = yield* checkTaskReview(journal, project, taskKey, session)
        return yield* open({ _tag: 'Review', review })
      }
      if (task?.phase._tag !== 'Sent') return yield* wrongMove()
      const staff = staffOf(project, taskRole(task))
      if (!staff || staff.key !== session.staff.key)
        return yield* Effect.fail(refuse('WrongActor', Rationale.make('This staff does not serve the assigned role.')))
      if (subagentCapacity(project, staff).freeSubagents === 0)
        return yield* Effect.fail(refuse('NoCapacity', Rationale.make('The staff has no free subagent slot.')))
      return yield* open({ _tag: 'Work' })
    })),
  }
}
