import { Effect, Schema } from 'effect'
import { readOpenProject } from '../actions/staff-session.ts'
import { recordTaskCommands } from '../actions/task.ts'
import {
  CommandOutcome, Rationale, refuse, taskRules, activeWork,
  type Command, type CommandOutput, type EventNumber, type Of, type Refusal, type TaskAddress, type WholeFile,
} from '../schema/project.ts'
import type { CommandCapture, CommandReceipt, Committed, Journal } from '../services/project.ts'

export interface TaskCommands {
  readonly files: (files: readonly WholeFile[]) => Effect.Effect<void, Refusal>
  readonly read: (receipt: CommandReceipt) => Effect.Effect<CommandCapture, Refusal>
  readonly reserve: (receipt: CommandReceipt) => Effect.Effect<'Reserved' | 'Exists', Refusal>
  readonly save: (receipt: CommandReceipt, outcome: CommandOutcome) => Effect.Effect<void, Refusal>
  readonly run: (command: Of<typeof Command>) => Effect.Effect<Of<typeof CommandOutput>, Refusal>
}

const blocked = () => refuse('Unavailable', Rationale.make(
  'A command’s completion is unconfirmed. Recover its captured output before continuing.',
))
const invalid = () => refuse('InvalidEvidence', Rationale.make('The captured result must match the pinned command rule.'))

export const runTaskCommands = (
  journal: Journal, line: Of<typeof TaskAddress>, commands: TaskCommands,
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  const task = project.tasks.get(line.id)
  if (!activeWork(project) || task?.phase._tag !== 'ReadyToReview')
    return yield* Effect.fail(refuse('WrongMove', Rationale.make('Run commands for a committed result awaiting review.')))
  const { result } = task.phase
  const outcomes: CommandOutcome[] = []
  for (const rule of taskRules(task)) {
    const command = rule.verification
    if (command._tag !== 'Command') continue
    const receipt = { project: project.id, task: task.id, result: result.at, rule: rule.id }
    let capture = yield* commands.read(receipt)
    if (capture._tag === 'Unstarted') {
      yield* commands.files(result.files)
      if ((yield* commands.reserve(receipt)) === 'Reserved') {
        const evidence = yield* commands.run(command)
        yield* commands.files(result.files)
        const outcome = { _tag: evidence.exit === 0 ? 'Holds' : 'Breaks', evidence, rule } as const
        if (!Schema.is(CommandOutcome)(outcome)) return yield* Effect.fail(invalid())
        yield* commands.save(receipt, outcome)
      }
      capture = yield* commands.read(receipt)
    }
    if (capture._tag !== 'Captured') return yield* Effect.fail(blocked())
    if (!Schema.is(CommandOutcome)(capture.outcome) || JSON.stringify(capture.outcome.rule) !== JSON.stringify(rule))
      return yield* Effect.fail(invalid())
    outcomes.push(capture.outcome)
  }
  return yield* recordTaskCommands(journal, line, project.read, outcomes)
})

export const taskCommandBlock = (
  journal: Journal, line: Of<typeof TaskAddress>, commands: TaskCommands,
): Effect.Effect<Refusal['why'] | null, Refusal> => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  const task = project.tasks.get(line.id)
  if (task?.phase._tag !== 'ReadyToReview') return null
  const { at } = task.phase.result
  for (const rule of taskRules(task)) {
    if (rule.verification._tag !== 'Command') continue
    const state = yield* commands.read({ project: project.id, task: task.id, result: at, rule: rule.id })
    if (state._tag === 'Unconfirmed') return blocked().why
  }
  return null
})

// A provider can recover an exact capture after losing the response to an issued command.
export const recoverTaskCommand = (
  journal: Journal, line: Of<typeof TaskAddress>, result: Of<typeof EventNumber>,
  outcome: CommandOutcome, commands: TaskCommands,
): Effect.Effect<void, Refusal> => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  const task = project.tasks.get(line.id)
  if (task?.phase._tag !== 'ReadyToReview' || task.phase.result.at !== result)
    return yield* Effect.fail(refuse('Stale', Rationale.make('The committed work result has changed.')))
  if (!Schema.is(CommandOutcome)(outcome) || !taskRules(task).some((rule) =>
    JSON.stringify(rule) === JSON.stringify(outcome.rule))) return yield* Effect.fail(invalid())
  const receipt = { project: project.id, task: task.id, result, rule: outcome.rule.id }
  if ((yield* commands.read(receipt))._tag === 'Unstarted') return yield* Effect.fail(invalid())
  yield* commands.save(receipt, outcome)
})
