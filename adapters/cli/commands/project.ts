import { Effect, Schema } from 'effect'
import { readOpenProject, staffAuthority } from '../../../core/actions/staff-session.ts'
import { nextStep, type Selection } from '../../../core/derived/project/next-step.ts'
import { reportWork, sendTask, taskBrief } from '../../../core/actions/task.ts'
import { runTaskCommands, taskCommandBlock, type TaskCommands } from '../../../core/effects/project-commands.ts'
import { projectTaskWords } from '../../words/project.ts'
import { Authority as ProjectAuthority, submit, type AuthenticatedActor } from '../../../core/actions/project.ts'
import { reportTaskReview } from '../../../core/actions/task-review.ts'
import { decodeQuestionInput } from '../../../core/actions/question.ts'
import {
  Answer as ProjectAnswer, ProposalSubmission, QuestionId, ReadPosition, SessionId, Rationale, StoredActor, TaskDraft, TaskId, ReviewFacts, taskLine, refuse as projectRefuse,
  type Of, type Refusal as ProjectRefusal,
} from '../../../core/schema/project.ts'
import type { Committed, Journal } from '../../../core/services/project.ts'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Format 16 question and answer commands bind the addressed recipient or question before intake.
export const projectQuestionCommand = (
  journal: Journal, command: 'question' | 'answer', target: string, read: Of<typeof ReadPosition>, yaml: string,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const raw = yield* Effect.try({
    try: (): unknown => Bun.YAML.parse(yaml),
    catch: () => projectRefuse('InvalidInput', Rationale.make('Load a valid YAML question or answer.')),
  })
  if (command === 'answer') {
    const id = yield* decodeQuestionInput(QuestionId, target)
    const answer = yield* decodeQuestionInput(ProjectAnswer, raw)
    return yield* submit(journal, { read, line: { _tag: 'Question', id }, move: 'answer', input: { answer } })
  }
  const to = yield* decodeQuestionInput(StoredActor, { _tag: target.startsWith('human:') ? 'Human' : 'Staff', id: target })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'to' in raw) {
    return yield* Effect.fail(projectRefuse('InvalidInput', Rationale.make('Address the recipient in the command.')))
  }
  if (!('id' in raw)) return yield* Effect.fail(projectRefuse('InvalidInput', Rationale.make('Name the question.')))
  const { id, ...fields } = raw
  return yield* submit(journal, { read, line: { _tag: 'Question', id }, move: 'open', input: { ...fields, to } })
})

const loadTaskYaml = (yaml: string) => Effect.try({
  try: () => Bun.YAML.parse(yaml),
  catch: () => projectRefuse('InvalidInput', Rationale.make('Load a valid YAML task or work report.')),
})
const checkedTaskInput = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown) => Effect.mapError(
  Schema.decodeUnknownEffect(schema, { onExcessProperty: 'error' })(value),
  () => projectRefuse('InvalidInput', Rationale.make('Use the checked task or work report form.')),
)

export const projectSendCommand = (
  journal: Journal, read: Of<typeof ReadPosition>, yaml: string,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const { id, ...draft } = yield* checkedTaskInput(Schema.Struct({ id: TaskId, ...TaskDraft.fields }), yield* loadTaskYaml(yaml))
  return yield* sendTask(journal, { _tag: 'Task', id }, read, draft)
})

export const projectReportCommand = (
  journal: Journal, target: unknown, read: Of<typeof ReadPosition>, yaml: string,
  commands?: TaskCommands,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const id = yield* checkedTaskInput(TaskId, target)
  const line = { _tag: 'Task', id } as const
  const report = yield* checkedTaskInput(Schema.Union([taskLine.Working.moves.next.submission.input, taskLine.Working.moves.raise.submission.input, taskLine.Sent.moves.next.submission.input]),
    yield* loadTaskYaml(yaml))
  const committed = yield* reportWork(journal, line, read, report)
  // A failure to run or append command evidence leaves the accepted report available for recovery.
  if (commands && 'files' in report) yield* Effect.result(runTaskCommands(journal, line, commands))
  return committed
})

export const projectReviewCommand = (
  journal: Journal, target: unknown, read: Of<typeof ReadPosition>, yaml: string,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const id = yield* checkedTaskInput(TaskId, target)
  const facts = yield* checkedTaskInput(ReviewFacts, yield* loadTaskYaml(yaml))
  return yield* reportTaskReview(journal, { _tag: 'Task', id }, read, facts)
})

export const projectBriefCommand = (journal: Journal, target: unknown, commands?: TaskCommands) => Effect.gen(function* () {
  const id = yield* checkedTaskInput(TaskId, target)
  const line = { _tag: 'Task', id } as const
  const task = yield* taskBrief(journal, line)
  const blocked = commands && task.phase._tag === 'ReadyToReview' ? yield* taskCommandBlock(journal, line, commands) : null
  return projectTaskWords(task, blocked)
})

// Format 16 loads authored YAML, then uses the same proposal intake as the page.
export const projectOnboard = (
  journal: Journal, read: Of<typeof ReadPosition>, yaml: string, review?: Effect.Effect<unknown, ProjectRefusal>,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const input = yield* Effect.try({
    try: () => Bun.YAML.parse(yaml),
    catch: () => projectRefuse('InvalidInput', Rationale.make('Load a valid YAML proposal or response.')),
  })
  const checked = Schema.decodeUnknownOption(ProposalSubmission, { onExcessProperty: 'error' })(isRecord(input) ? { ...input, read } : input)
  if (checked._tag === 'None')
    return yield* Effect.fail(projectRefuse('InvalidInput', Rationale.make('Use the checked onboarding submission.')))
  const committed = yield* submit(journal, checked.value)
  if (review && committed.event.from !== null) yield* Effect.result(review)
  return committed
})

// The credential adapter resolves a token to its lifetime before using the shared selection.
export const waitOnProject = (
  journal: Journal, authenticate: Effect.Effect<Of<typeof SessionId>, ProjectRefusal>,
): Effect.Effect<Selection, ProjectRefusal> => Effect.gen(function* () {
  const id = yield* authenticate
  const project = yield* readOpenProject(journal)
  const session = yield* staffAuthority(project, id)
  const events = yield* journal.eventsAfter(ReadPosition.make(0))
  return nextStep(project, session, events.filter((event) => event.number <= project.read))
})

export const waitOnTaskReview = (
  journal: Journal, authenticate: Effect.Effect<AuthenticatedActor, ProjectRefusal>,
): Effect.Effect<Selection, ProjectRefusal> => Effect.gen(function* () {
  const actor = yield* authenticate
  const project = yield* readOpenProject(journal)
  if (actor._tag === 'Review' && actor.line._tag === 'Task') {
    const session = yield* staffAuthority(project, actor.session.id)
    const task = project.tasks.get(actor.line.id)
    if (task?.phase._tag === 'Reviewing' && task.phase.assignment._tag === 'Assigned' &&
        task.phase.assignment.by.id === session.staff.id && actor.session.staff.id === session.staff.id &&
        task.phase.assignment.review === actor.review) {
      return { _tag: 'Available', subject: { _tag: 'Task', task }, for: 'Review', read: project.read }
    }
  }
  return yield* Effect.fail(projectRefuse('RetiredSession', Rationale.make('Use the current child assigned to review this task.')))
})
