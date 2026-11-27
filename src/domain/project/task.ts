import { hostRole } from './roles.ts'
import { Schema } from 'effect'
import { Direction, Fact, Rule, Stage, sameStage } from './direction.ts'
import { CommandOutput, Evidence, Lines, outcomeOf } from './evidence.ts'
import { PromptOutcome, reviewing } from './review.ts'
import { versionOf } from './version.ts'
import { Question } from './question.ts'
import type { Project } from './records.ts'
import { Responsibility, staffOf } from './staff.ts'
import {
  AttemptNumber, EventNumber, FileContents, FilePath, Goal, Name,
  QuestionKey, ResultSummary, RetryCount, RoleKey, StoredActor, TaskKey, recordsByKey, type Of,
} from './values.ts'

export const DirectionVersion = versionOf(Direction)
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
export const CommandOutcomes = Schema.Array(CommandOutcome)

const RuleOutcome = Schema.Union([CommandOutcome, PromptOutcome])
export type RuleOutcome = Of<typeof RuleOutcome>
const BreakingOutcome = RuleOutcome.pipe(Schema.refine(
  (outcome): outcome is Extract<RuleOutcome, { _tag: 'Breaks' }> => outcome._tag === 'Breaks',
))
export type BreakingOutcome = Of<typeof BreakingOutcome>
export const ReviewFeedback = Schema.Union([
  Schema.TaggedStruct('None', {}),
  Schema.TaggedStruct('Review', { breaks: Schema.NonEmptyArray(BreakingOutcome) }),
])
export const Attempt = Schema.Struct({
  number: AttemptNumber, actor: StoredActor.members[1], where: Schema.Literals(['Session', 'Subagent']), feedback: ReviewFeedback,
})
const Result = Schema.Struct({ ...WorkResult.fields, attempt: Attempt, reportedIn: EventNumber })
export const RaiseReason = Schema.Literals(['Tries', 'Misses', 'NoRule', 'TooBig', 'WrongTask', 'ContractWrong', 'RejectedByHuman'])
export const TaskPhase = Schema.Union([
  Schema.TaggedStruct('Sent', { feedback: ReviewFeedback }),
  Schema.TaggedStruct('Working', { attempt: Attempt }),
  Schema.TaggedStruct('ReadyToReview', { result: Result }),
  reviewing({ result: Result, outcomes: CommandOutcomes }),
  Schema.TaggedStruct('Done', { result: Result, outcomes: Schema.Array(RuleOutcome) }),
  Schema.TaggedStruct('Raised', { reason: RaiseReason, evidence: Schema.NonEmptyArray(Evidence) }),
])
export type TaskPhase = Of<typeof TaskPhase>
export const TaskStages = Schema.NonEmptyArray(Stage)
  .check(Schema.makeFilter((stages) => stages.every(({ role }) => role === stages[0].role)))
export const Task = Schema.Struct({
  key: TaskKey, name: Name, goal: Goal, reviewer: RoleKey,
  responsibility: versionOf(Responsibility), reviewerResponsibility: versionOf(Responsibility), direction: DirectionVersion,
  stages: TaskStages, facts: Schema.Array(Fact),
  questions: recordsByKey(Question, QuestionKey),
  retryCount: RetryCount, phase: TaskPhase, changedIn: EventNumber,
  lastAttempt: Schema.Union([
    Schema.TaggedStruct('None', {}),
    Schema.TaggedStruct('Attempted', { number: AttemptNumber }),
  ]),
})
export type Task = Of<typeof Task>
export type WholeFile = Of<typeof WholeFile>

export const activeWork = ({ phase }: Project) => {
  if (phase._tag !== 'Active') return null
  const { work } = phase
  return work._tag === 'NotStarted' ? null : { ...phase, work }
}

export const taskRules = (task: Task): readonly Of<typeof Rule>[] =>
  task.direction.value.standards.filter(({ scope }) =>
    scope._tag === 'Everywhere' ||
    (scope.stages._tag === 'AllStages' || scope.stages.stages.some((named) => task.stages.some((stage) => sameStage(stage, named)))) &&
    scope.facts.every((required) => task.facts.some((fact) => fact.name === required.name && fact.value === required.value)),
  ).flatMap(({ rules }) => rules)

export const taskRole = (task: Task) => task.stages[0].role

export const taskReviewStaff = (project: Project, task: Task) => {
  const reviewer = staffOf(project, task.reviewer)
  return reviewer?.subagents === 0 ? staffOf(project, hostRole(project).key) : reviewer
}
