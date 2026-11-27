import { Effect, Schema } from 'effect'
import { readOpenProject, staffAuthority } from '../../../core/actions/staff-session.ts'
import { nextStep } from '../../../core/derived/project/next-step.ts'
import { reportWork, sendTask, taskBrief } from '../../../core/actions/task.ts'
import { runTaskCommands, taskCommandBlock, type TaskCommands } from '../../../core/effects/project-commands.ts'
import { projectTaskWords } from '../../words/project.ts'
import { Authority as ProjectAuthority, submit, submitChecked, type AuthenticatedActor } from '../../../core/actions/project.ts'
import { reportTaskReview } from '../../../core/actions/task-review.ts'
import { decodeQuestionInput } from '../../../core/actions/question.ts'
import {
  Answer as ProjectAnswer, ProposalSubmission, ReadPosition, StaffSessionKey, Rationale, questionLine, TaskDraft, TaskKey, ReviewFacts, taskLine, refuse as projectRefuse,
  type Of, type Refusal as ProjectRefusal,
} from '../../../core/schema/project.ts'
import type { Committed, Journal } from '../../../core/services/project.ts'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Opening supplies the owner in YAML. Answers use the full address printed by wait.
export const projectQuestionCommand = (
  journal: Journal, command: 'question' | 'answer', target: string, read: Of<typeof ReadPosition>, yaml: string,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const raw = yield* Effect.try({
    try: (): unknown => Bun.YAML.parse(yaml),
    catch: () => projectRefuse('InvalidInput', Rationale.make('Load a valid YAML question or answer.')),
  })
  if (command === 'answer') {
    const [subject, key, ...extra] = target.split('/')
    if (!subject || !key || extra.length)
      return yield* Effect.fail(projectRefuse('InvalidInput', Rationale.make('Use the full question address printed by work wait.')))
    const owner = subject === 'project' ? { _tag: 'Project' }
      : { _tag: subject.startsWith('proposal:') ? 'Proposal' : 'Task', key: subject }
    const answer = yield* decodeQuestionInput(ProjectAnswer, raw)
    return yield* submit(journal, { read, line: 'Question', owner, key, move: 'answer', input: { answer } })
  }
  const to = yield* decodeQuestionInput(questionLine.null.moves.open.input.fields.to, target === 'owner' ? { _tag: 'Human' } : { _tag: 'Staff', key: target })
  if (!isRecord(raw) || 'to' in raw) {
    return yield* Effect.fail(projectRefuse('InvalidInput', Rationale.make('Address the recipient in the command.')))
  }
  const { key, owner, ...fields } = raw
  return yield* submit(journal, { read, line: 'Question', owner, key, move: 'open', input: { ...fields, to } })
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
  const { key, ...draft } = yield* checkedTaskInput(Schema.Struct({ key: TaskKey, ...TaskDraft.fields }), yield* loadTaskYaml(yaml))
  return yield* sendTask(journal, key, read, draft)
})

export const projectReportCommand = (
  journal: Journal, target: string, read: Of<typeof ReadPosition>, yaml: string,
  commands?: TaskCommands,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const key = yield* checkedTaskInput(TaskKey, target)
  const report = yield* checkedTaskInput(Schema.Union([taskLine.Working.moves.next.submission.input, taskLine.Working.moves.raise.submission.input, taskLine.Sent.moves.raise.submission.input, taskLine.Sent.moves.next.submission.input]),
    yield* loadTaskYaml(yaml))
  if (Schema.is(taskLine.Sent.moves.raise.submission.input)(report))
    return yield* submitChecked(journal, { read, line: 'Task', key, move: 'tooBig', input: report })
  const committed = yield* reportWork(journal, key, read, report)
  // A failure to run or append command evidence leaves the accepted report available for recovery.
  if (commands && 'files' in report) yield* Effect.result(runTaskCommands(journal, key, commands))
  return committed
})

export const projectReviewCommand = (
  journal: Journal, target: string, read: Of<typeof ReadPosition>, yaml: string,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const key = yield* checkedTaskInput(TaskKey, target)
  const facts = yield* checkedTaskInput(ReviewFacts, yield* loadTaskYaml(yaml))
  return yield* reportTaskReview(journal, key, read, facts)
})

export const projectBriefCommand = (journal: Journal, target: string, commands?: TaskCommands) => Effect.gen(function* () {
  const key = yield* checkedTaskInput(TaskKey, target)
  const { project, task } = yield* taskBrief(journal, key)
  const blocked = commands && task.phase._tag === 'ReadyToReview' ? yield* taskCommandBlock(journal, key, commands) : null
  return projectTaskWords(project, task, blocked)
})

// Authored YAML uses the same proposal intake as the page.
export const projectOnboard = (
  journal: Journal, read: Of<typeof ReadPosition>, yaml: string, review?: Effect.Effect<Committed | null, ProjectRefusal>,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const input = yield* Effect.try({
    try: () => Bun.YAML.parse(yaml),
    catch: () => projectRefuse('InvalidInput', Rationale.make('Load a valid YAML proposal or response.')),
  })
  const checked = Schema.decodeUnknownOption(ProposalSubmission, { onExcessProperty: 'error' })(isRecord(input) ? { ...input, read } : input)
  if (checked._tag === 'None')
    return yield* Effect.fail(projectRefuse('InvalidInput', Rationale.make('Use the checked onboarding submission.')))
  const committed = yield* submitChecked(journal, checked.value)
  if (review && (committed.event.from !== null || committed.event.move === 'submit')) yield* Effect.result(review)
  return committed
})

// The credential adapter resolves a token to its lifetime before using the shared selection.
export const waitOnProject = (
  journal: Journal, authenticate: Effect.Effect<Of<typeof StaffSessionKey>, ProjectRefusal>, on?: Of<typeof ReadPosition>,
) => Effect.gen(function* () {
  const key = yield* authenticate
  const project = yield* readOpenProject(journal)
  const session = yield* staffAuthority(project, key)
  const events = (yield* journal.eventsAfter(ReadPosition.make(0))).filter((event) => event.number <= project.read)
  return { project, session, events, step: nextStep(project, session, events, on) }
})

export const waitOnTaskReview = (
  journal: Journal, authenticate: Effect.Effect<AuthenticatedActor, ProjectRefusal>,
) => Effect.gen(function* () {
  const actor = yield* authenticate
  const project = yield* readOpenProject(journal)
  if (actor._tag === 'Review' && actor.line === 'Task') {
    const session = yield* staffAuthority(project, actor.session.key)
    const task = project.tasks.get(actor.key)
    if (task?.phase._tag === 'Reviewing' && task.phase.assignment._tag === 'Assigned' &&
        task.phase.assignment.actor.key === session.key && actor.session.staff.key === session.staff.key &&
        task.phase.assignment.queuedIn === actor.queuedIn) {
      return { project, task }
    }
  }
  return yield* Effect.fail(projectRefuse('RetiredSession', Rationale.make('Use the current child assigned to review this task.')))
})
