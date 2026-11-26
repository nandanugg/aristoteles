import { Schema, SchemaGetter } from 'effect'
import {
  AccountName, AttemptNumber, DutyText, EventNumber, FileContents, FilePath, Goal, HumanId, Introduction,
  LaunchText, ModelName, Name, PaneAddress, PlanName, ProjectId, ProviderName, Rationale,
  ReadPosition, ResponsibilityId, ResultSummary, RetryCount, RoleId, SessionCount, SessionId, StaffId,
  SubagentCount, SubscriptionId, Summary, TaskId, VersionNumber, WindowMinutes, WindowShare, type Of,
} from './values.ts'

export const Human = Schema.TaggedStruct('Human', { id: HumanId, name: Name })
export const Responsibility = Schema.Struct({
  id: ResponsibilityId, summary: Summary, introduction: Introduction, duties: Schema.NonEmptyArray(DutyText),
})
const ResponsibilityVersion = Schema.Struct({
  id: Schema.Struct({ subject: ResponsibilityId, number: VersionNumber }),
  value: Responsibility,
  acceptedAt: EventNumber,
}).check(Schema.makeFilter((version) => version.id.subject === version.value.id))
export const Role = Schema.Struct({ id: RoleId, name: Name, responsibility: ResponsibilityVersion })
export const Subscription = Schema.Struct({
  id: SubscriptionId,
  provider: ProviderName,
  account: AccountName,
  plan: PlanName,
  usageWindow: WindowMinutes,
  sessions: Schema.Union([Schema.TaggedStruct('Unlimited', {}), Schema.TaggedStruct('Limited', { max: SessionCount })]),
  estimate: Schema.Union([
    Schema.TaggedStruct('NoEstimate', {}),
    Schema.TaggedStruct('Estimated', { share: WindowShare, why: Rationale }),
  ]),
})
export const Staff = Schema.TaggedStruct('Staff', {
  id: StaffId, name: Name, model: ModelName, launch: LaunchText, subagents: SubagentCount,
  roles: Schema.NonEmptyArray(Role), subscription: Subscription, why: Rationale,
})
export const LiveSession = Schema.TaggedStruct('Live', {
  id: SessionId, staff: Staff, startedAt: EventNumber, pane: Schema.Struct({ address: PaneAddress }),
})

export const TaskDraft = Schema.Struct({ id: TaskId, name: Name, goal: Goal, role: Role, reviewer: Role })
const Attempt = Schema.Struct({
  number: AttemptNumber, retryCount: RetryCount, session: LiveSession, place: Schema.Literals(['Main', 'Child']),
})
const WholeFile = Schema.Struct({ path: FilePath, contents: FileContents })
const Result = Schema.Struct({ summary: ResultSummary, files: Schema.Array(WholeFile), attempt: Attempt })
const Sent = Schema.TaggedStruct('Sent', { retryCount: RetryCount })
const Working = Schema.TaggedStruct('Working', { attempt: Attempt })
const ReadyToReview = Schema.TaggedStruct('ReadyToReview', { result: Result })
const Reviewing = Schema.TaggedStruct('Reviewing', { result: Result })
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

const taskMap = () => Schema.Array(Task)
  .check(Schema.makeFilter((entries) => new Set(entries.map((task) => task.id)).size === entries.length))
  .pipe(Schema.decodeTo(Schema.ReadonlyMap(Schema.toType(TaskId), Schema.toType(Task)), {
    decode: SchemaGetter.transform((entries) => new Map(entries.map((task) => [task.id, task]))),
    encode: SchemaGetter.transform((map) => [...map.values()]),
  }))
const ProjectStatus = Schema.Union([
  Schema.TaggedStruct('Open', {}),
  Schema.TaggedStruct('Ended', { at: EventNumber }),
])
export const Project = Schema.Struct({
  id: ProjectId, owner: Human, host: Role, pipeline: Role, staff: Staff,
  tasks: taskMap(), status: ProjectStatus, activation: Schema.TaggedStruct('Onboarding', {}),
  lastChange: EventNumber, read: ReadPosition,
})
export type Project = Of<typeof Project>
export const Projection = Schema.Union([
  Schema.TaggedStruct('BeforeProject', {}),
  Schema.TaggedStruct('Open', { value: Project }),
  Schema.TaggedStruct('Ended', { value: Project }),
]).check(Schema.makeFilter((state) => state._tag === 'BeforeProject' || state._tag === state.value.status._tag))
export type Projection = Of<typeof Projection>
