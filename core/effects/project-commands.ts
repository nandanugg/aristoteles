import { Effect, Schema } from 'effect'
import { readOpenProject } from '../actions/staff-session.ts'
import { recordTaskCommands } from '../actions/task.ts'
import {
  CommandOutcome, OptionIndex, Rationale, refuse, taskRules, activeWork,
  type Command, type CommandOutput, type EventNumber, type Of, type Refusal, type TaskAddress, type WholeFile,
} from '../schema/project.ts'
import type { CommandCapture, CommandRecord, Committed, Journal } from '../services/project.ts'

export interface TaskCommands {
  readonly files: (files: readonly WholeFile[]) => Effect.Effect<void, Refusal>
  readonly read: (receipt: CommandRecord) => Effect.Effect<CommandCapture, Refusal>
  readonly reserve: (receipt: CommandRecord) => Effect.Effect<'Reserved' | 'Exists', Refusal>
  readonly save: (receipt: CommandRecord, outcome: CommandOutcome) => Effect.Effect<void, Refusal>
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
  const task = project.tasks.get(line.key)
  if (!activeWork(project) || task?.phase._tag !== 'ReadyToReview')
    return yield* Effect.fail(refuse('WrongMove', Rationale.make('Run commands for a committed result awaiting review.')))
  const { result } = task.phase
  const outcomes: CommandOutcome[] = []
  for (const [index, rule] of taskRules(task).entries()) {
    const command = rule.verification
    if (command._tag !== 'Command') continue
    const receipt = { directory: journal.directory, database: journal.database, result: result.at, slot: OptionIndex.make(index), rule }
    let capture = yield* commands.read(receipt)
    if (capture._tag === 'NotStarted') {
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
  const task = project.tasks.get(line.key)
  if (task?.phase._tag !== 'ReadyToReview') return null
  const { at } = task.phase.result
  for (const [index, rule] of taskRules(task).entries()) {
    if (rule.verification._tag !== 'Command') continue
    const state = yield* commands.read({ directory: journal.directory, database: journal.database, result: at, slot: OptionIndex.make(index), rule })
    if (state._tag === 'Running') return blocked().why
  }
  return null
})

// A provider can recover an exact capture after losing the response to an issued command.
export const recoverTaskCommand = (
  journal: Journal, line: Of<typeof TaskAddress>, result: Of<typeof EventNumber>,
  outcome: CommandOutcome, commands: TaskCommands,
): Effect.Effect<void, Refusal> => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  const task = project.tasks.get(line.key)
  if (task?.phase._tag !== 'ReadyToReview' || task.phase.result.at !== result)
    return yield* Effect.fail(refuse('Stale', Rationale.make('The committed work result has changed.')))
  if (!Schema.is(CommandOutcome)(outcome)) return yield* Effect.fail(invalid())
  const matches = taskRules(task).flatMap((rule, index) => JSON.stringify(rule) === JSON.stringify(outcome.rule)
    ? [{ directory: journal.directory, database: journal.database, result, slot: OptionIndex.make(index), rule: outcome.rule }] : [])
  const running: CommandRecord[] = []
  for (const receipt of matches) {
    if ((yield* commands.read(receipt))._tag === 'Running') running.push(receipt)
  }
  const [receipt] = running.length ? running : matches
  if (!receipt || (running.length ? running.length !== 1 : matches.length !== 1)) return yield* Effect.fail(invalid())
  if ((yield* commands.read(receipt))._tag === 'NotStarted') return yield* Effect.fail(invalid())
  yield* commands.save(receipt, outcome)
})
