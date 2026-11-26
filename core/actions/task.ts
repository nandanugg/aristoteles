import { Effect } from 'effect'
import { Rationale, refuse, liveSession, activeWork, type CommandOutcome, type LiveSession, type Of, type Refusal, type Task, type TaskAddress, type TaskDraft, type WorkReport, type ReadPosition } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { Authority, recordObserved, submit } from './project.ts'
import { readOpenProject } from './staff-session.ts'

export const sendTask = (
  journal: Journal, read: Of<typeof ReadPosition>, draft: Of<typeof TaskDraft>,
): Effect.Effect<Committed, Refusal, Authority> =>
  submit(journal, { _tag: 'SendTask', read, project: { _tag: 'Project', id: journal.id }, draft })

export const reportWork = (
  journal: Journal, line: Of<typeof TaskAddress>, read: Of<typeof ReadPosition>, report: Of<typeof WorkReport>,
): Effect.Effect<Committed, Refusal, Authority> =>
  submit(journal, { _tag: 'StaffReport', read, report: { _tag: 'Work', line, report } })

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
      const servesTask = (value: LiveSession) => value.staff.roles.some(({ id }) => id === task.role.id || id === task.reviewer.id)
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
