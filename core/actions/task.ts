import { Effect } from 'effect'
import { Rationale, refuse, liveSession, activeWork, taskRole, taskLine, type CommandOutcome, type LiveSession, type Of, type Refusal, type Task, type TaskAddress, type TaskDraft, type ReadPosition } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { Authority, recordObserved, submit } from './project.ts'
import { readOpenProject } from './staff-session.ts'

export const sendTask = (
  journal: Journal, line: Of<typeof TaskAddress>, read: Of<typeof ReadPosition>, input: Of<typeof TaskDraft>,
): Effect.Effect<Committed, Refusal, Authority> =>
  submit(journal, { read, line, move: 'open', input })

export const reportWork = (
  journal: Journal, line: Of<typeof TaskAddress>, read: Of<typeof ReadPosition>, input: Of<typeof taskLine.Sent.moves.next.submission.input | typeof taskLine.Working.moves.next.submission.input>,
): Effect.Effect<Committed, Refusal, Authority> =>
  submit(journal, { read, line, move: 'next', input })

export const taskBrief = (journal: Journal, line: Of<typeof TaskAddress>): Effect.Effect<Task, Refusal, Authority> =>
  Effect.gen(function* () {
    const actor = yield* (yield* Authority).actor
    const project = yield* readOpenProject(journal)
    const task = project.tasks.get(line.id)
    if (!task || !activeWork(project))
      return yield* Effect.fail(refuse('WrongMove', Rationale.make('This task is unavailable.')))
    if (actor._tag === 'Human' && actor.actor.id === project.owner.id) return task
    if (actor._tag === 'Host' && project.activation._tag === 'Active' &&
      actor.id === project.activation.binding.id && actor.staff.id === project.activation.staff.id) return task
    if (actor._tag === 'Staff' || actor._tag === 'Review') {
      const session = liveSession(project, actor.session.id)
      if (session?.staff.id !== actor.session.staff.id)
        return yield* Effect.fail(refuse('RetiredSession', Rationale.make('Read from the current task session.')))
      const servesTask = (value: LiveSession) => value.staff.roles.some(({ id }) => id === taskRole(task).id || id === task.reviewer.id)
      if (servesTask(session)) return task
    }
    return yield* Effect.fail(refuse('WrongActor', Rationale.make('Read the brief as the owner, host or assigned staff.')))
  })

export const recordTaskCommands = (
  journal: Journal, line: Of<typeof TaskAddress>, read: Of<typeof ReadPosition>, outcomes: readonly CommandOutcome[],
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  return yield* recordObserved(journal, project.owner, read, { line, from: 'ReadyToReview', move: 'next', input: { outcomes } })
})
