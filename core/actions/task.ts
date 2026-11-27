import { Effect } from 'effect'
import { Rationale, refuse, liveSession, activeWork, boundHostSession, staffByKey, taskRole, taskLine, type CommandOutcome, type Of, type Refusal, type Task, type TaskKey, type TaskDraft, type ReadPosition } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { Authority, recordObserved, submit } from './project.ts'
import { readOpenProject } from './staff-session.ts'

export const sendTask = (
  journal: Journal, key: Of<typeof TaskKey>, read: Of<typeof ReadPosition>, input: Of<typeof TaskDraft>,
): Effect.Effect<Committed, Refusal, Authority> =>
  submit(journal, { read, line: 'Task', key, move: 'open', input })

export const reportWork = (
  journal: Journal, key: Of<typeof TaskKey>, read: Of<typeof ReadPosition>, input: Of<typeof taskLine.Sent.moves.next.submission.input | typeof taskLine.Working.moves.next.submission.input | typeof taskLine.Working.moves.raise.submission.input>,
): Effect.Effect<Committed, Refusal, Authority> =>
  submit(journal, { read, line: 'Task', key, move: 'reason' in input ? 'raise' : 'next', input })

export const taskBrief = (journal: Journal, key: Of<typeof TaskKey>): Effect.Effect<Task, Refusal, Authority> =>
  Effect.gen(function* () {
    const actor = yield* (yield* Authority).actor
    const project = yield* readOpenProject(journal)
    const task = project.tasks.get(key)
    if (!task || !activeWork(project))
      return yield* Effect.fail(refuse('WrongMove', Rationale.make('This task is unavailable.')))
    if (actor._tag === 'Human') return task
    if (actor._tag === 'Host' && project.activation._tag === 'Active' &&
      actor.session.key === boundHostSession(project)?.key) return task
    if (actor._tag === 'Staff' || actor._tag === 'Review') {
      const session = liveSession(project, actor.session.key)
      if (session?.staff.key !== actor.session.staff.key)
        return yield* Effect.fail(refuse('RetiredSession', Rationale.make('Read from the current task session.')))
      if (actor._tag === 'Review') {
        const phase = task.phase
        if (actor.line === 'Task' && actor.key === key && phase._tag === 'Reviewing' &&
            phase.assignment._tag === 'Assigned' && phase.assignment.actor.key === session.key &&
            phase.assignment.queuedIn === actor.queuedIn) return task
        return yield* Effect.fail(refuse('RetiredSession', Rationale.make('Read from the current fresh review.')))
      }
      const staff = staffByKey(project, session.staff.key)
      if (staff?.roles.some(({ key }) => key === taskRole(task).key || key === task.reviewer.key)) return task
    }
    return yield* Effect.fail(refuse('WrongActor', Rationale.make('Read the brief as the owner, host or assigned staff.')))
  })

export const recordTaskCommands = (
  journal: Journal, key: Of<typeof TaskKey>, read: Of<typeof ReadPosition>, outcomes: readonly CommandOutcome[],
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  return yield* recordObserved(journal, project.owner, read, { line: 'Task', key, from: 'ReadyToReview', move: 'next', input: { outcomes } })
})
