import { Schema } from 'effect'
import { Direction, Fact, Rule, Stage } from './direction.ts'
import { CommandOutput, Lines, outcomeOf } from './evidence.ts'
import { reviewing } from './review.ts'
import { versionOf } from './proposal.ts'
import type { Project } from './records.ts'
import { LiveSession, Role } from './staff.ts'
import {
  AttemptNumber, EventNumber, FileContents, FilePath, Goal, Name,
  ResultSummary, RetryCount, TaskId, type Of,
} from './values.ts'

export const DirectionVersion = versionOf(Direction)
export const Attempt = Schema.Struct({
  number: AttemptNumber, retryCount: RetryCount, session: LiveSession, where: Schema.Literals(['Session', 'Subagent']),
})
export const WholeFile = Schema.Struct({
  path: FilePath,
  image: Schema.Union([
    Schema.TaggedStruct('Present', { contents: FileContents }),
    Schema.TaggedStruct('Deleted', { previousContents: FileContents }),
  ]),
  changed: Schema.Array(Lines),
}).check(Schema.makeFilter(({ image, changed }) => {
  const text = image._tag === 'Present' ? image.contents : image.previousContents
  const lineCount = text === '' ? 0 : text.split('\n').length - Number(text.endsWith('\n'))
  return changed.every(({ first, last }, index) => last <= lineCount &&
    (index === 0 || changed[index - 1]!.last < first))
}))
const WholeFiles = Schema.Array(WholeFile).check(
  Schema.makeFilter((files) => new Set(files.map(({ path }) => path)).size === files.length),
)
export const WorkResult = Schema.Struct({ attempt: AttemptNumber, summary: ResultSummary, files: WholeFiles })
export const CommandOutcome = outcomeOf({ rule: Rule, evidence: CommandOutput }).check(Schema.makeFilter((outcome) =>
  (outcome._tag === 'Holds') === (outcome.evidence.exit === 0) &&
  outcome.rule.verification._tag === 'Command' && outcome.rule.verification.text === outcome.evidence.command.text))
export type CommandOutcome = Of<typeof CommandOutcome>
export const CommandOutcomes = Schema.Array(CommandOutcome).check(
  Schema.makeFilter((values) => new Set(values.map(({ rule }) => rule.id)).size === values.length),
)

const Result = Schema.Struct({ ...WorkResult.fields, attempt: Attempt, at: EventNumber })
export const RaiseReason = Schema.Literals(['Tries', 'Misses', 'NoRule', 'TooBig', 'ContractWrong', 'RejectedByHuman'])
export const TaskPhase = Schema.Union([
  Schema.TaggedStruct('Sent', { retryCount: RetryCount }),
  Schema.TaggedStruct('Working', { attempt: Attempt }),
  Schema.TaggedStruct('ReadyToReview', { result: Result }),
  reviewing({ result: Result, outcomes: CommandOutcomes }),
  Schema.TaggedStruct('Done', { result: Result, outcomes: CommandOutcomes }),
  Schema.TaggedStruct('Raised', { reason: RaiseReason }),
])
export type TaskPhase = Of<typeof TaskPhase>
export const TaskStages = Schema.NonEmptyArray(Stage)
  .check(Schema.makeFilter((stages) => stages.every(({ role }) => role.id === stages[0].role.id)))
export const Task = Schema.Struct({
  id: TaskId, name: Name, goal: Goal, reviewer: Role, direction: DirectionVersion,
  stages: TaskStages, facts: Schema.Array(Fact),
  phase: TaskPhase, lastChange: EventNumber,
  lastAttempt: Schema.Union([
    Schema.TaggedStruct('None', {}),
    Schema.TaggedStruct('Attempted', { number: AttemptNumber }),
  ]),
})
export type Task = Of<typeof Task>
export type WholeFile = Of<typeof WholeFile>

export const activeWork = ({ status, activation }: Project) => {
  if (status._tag !== 'Open' || activation._tag !== 'Active') return null
  const { work } = activation
  return work._tag === 'NotStarted' ? null : { ...activation, work }
}

export const taskRules = (task: Task): readonly Of<typeof Rule>[] =>
  task.direction.value.standards.filter(({ scope }) =>
    scope._tag === 'Everywhere' ||
    (scope.stages._tag === 'AllStages' || scope.stages.stages.some(({ id }) => task.stages.some((stage) => stage.id === id))) &&
    scope.facts.every((required) => task.facts.some((fact) => fact.name === required.name && fact.value === required.value)),
  ).flatMap(({ rules }) => rules)

export const taskRole = (task: Task) => task.stages[0].role
