import { Schema, SchemaGetter } from 'effect'
import { Human, LiveSession, Role, Staff, StaffSession, Subscription } from './staff.ts'
import {
  AttemptNumber, EventNumber, FileContents, FilePath, Goal, Name,
  ProjectId, QuestionId, ReadPosition, QuestionText, ResultSummary, RetryCount, RoleId, SessionId, StaffId,
  SubscriptionId, TaskId, type Of,
} from './values.ts'
import { Answer, QuestionForm, questionAbout } from './question.ts'

export const TaskDraft = Schema.Struct({ id: TaskId, name: Name, goal: Goal, role: Role, reviewer: Role })
const Attempt = Schema.Struct({
  number: AttemptNumber, retryCount: RetryCount, session: LiveSession, place: Schema.Literals(['Main', 'Child']),
})
const WholeFile = Schema.Struct({ path: FilePath, contents: FileContents })
const Result = Schema.Struct({ summary: ResultSummary, files: Schema.Array(WholeFile), attempt: Attempt })
const Sent = Schema.TaggedStruct('Sent', { retryCount: RetryCount })
const Working = Schema.TaggedStruct('Working', { attempt: Attempt })
const ReadyToReview = Schema.TaggedStruct('ReadyToReview', { result: Result })
const Reviewing = Schema.TaggedStruct('Reviewing', {
  result: Result,
  review: Schema.Union([Schema.TaggedStruct('Waiting', {}), Schema.TaggedStruct('By', { session: LiveSession })]),
})
export const TaskPhase = Schema.Union([Sent, Working, ReadyToReview, Reviewing])
export type TaskPhase = Of<typeof TaskPhase>
const AttemptHistory = Schema.Union([
  Schema.TaggedStruct('First', {}),
  Schema.TaggedStruct('PreviouslyWorked', { last: AttemptNumber }),
])
export const Task = Schema.Struct({
  ...TaskDraft.fields, phase: TaskPhase, attempts: AttemptHistory, lastChange: EventNumber,
})
export type Task = Of<typeof Task>

const Actor = Schema.Union([Human, Staff])
const QuestionState = Schema.Union([
  Schema.TaggedStruct('Open', {}),
  Schema.TaggedStruct('Answered', { by: Actor, answer: Answer }),
])
export const Question = Schema.Struct({
  id: QuestionId, from: Actor, to: Actor, text: QuestionText, form: QuestionForm, state: QuestionState,
  about: Schema.Union([
    ...questionAbout,
    Schema.TaggedStruct('Task', { task: Task }),
  ]),
  lastChange: EventNumber,
})
export type Question = Of<typeof Question>

const recordsById = <S extends Schema.Top, K extends Schema.Top>(
  value: S & { readonly Type: { readonly id: K['Type'] }; readonly DecodingServices: never; readonly EncodingServices: never },
  key: K,
) => Schema.Array(value)
  .check(Schema.makeFilter((entries) => new Set(entries.map((item) => item.id)).size === entries.length))
  .pipe(Schema.decodeTo(Schema.ReadonlyMap(Schema.toType(key), Schema.toType(value)), {
    decode: SchemaGetter.transform((entries) => new Map(entries.map((item) => [item.id, item]))),
    encode: SchemaGetter.transform((map) => [...map.values()]),
  }))
const ProjectStatus = Schema.Union([
  Schema.TaggedStruct('Open', {}),
  Schema.TaggedStruct('Ended', { at: EventNumber }),
])
export const Project = Schema.Struct({
  id: ProjectId, owner: Human, host: Role, pipeline: Role,
  roles: recordsById(Role, RoleId), staff: recordsById(Staff, StaffId),
  subscriptions: recordsById(Subscription, SubscriptionId), staffingAt: EventNumber,
  sessions: recordsById(StaffSession, SessionId), tasks: recordsById(Task, TaskId), questions: recordsById(Question, QuestionId), status: ProjectStatus, activation: Schema.TaggedStruct('Onboarding', {}),
  lastChange: EventNumber, read: ReadPosition,
})
export type Project = Of<typeof Project>
export const Projection = Schema.NullOr(Project)
export type Projection = Of<typeof Projection>
