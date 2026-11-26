import { Schema } from 'effect'
import { line } from './lines.ts'
import { Human, TaskDraft, type TaskPhase } from './records.ts'
import { LiveSession, Pane, Role, Staff, StaffingPlan } from './staff.ts'
import {
  AttemptNumber, EventNumber, FileContents, FilePath, HumanId, ProjectId, Rationale, ReadPosition,
  ResultSummary, SessionId, StaffId, TaskId, Timestamp, type Of,
} from './values.ts'

export const ProjectAddress = Schema.TaggedStruct('Project', { id: ProjectId })
export const TaskAddress = Schema.TaggedStruct('Task', { id: TaskId })
export const SessionAddress = Schema.TaggedStruct('Session', { id: SessionId })
const StoredActor = Schema.Union([
  Schema.TaggedStruct('Human', { id: HumanId }),
  Schema.TaggedStruct('Staff', { id: StaffId }),
])
export type StoredActor = Of<typeof StoredActor>

const configuration = { owner: Human, host: Role, pipeline: Role, staff: Staff, roles: Schema.Array(Role) }
const result = Schema.Struct({
  attempt: AttemptNumber, summary: ResultSummary,
  files: Schema.Array(Schema.Struct({ path: FilePath, contents: FileContents })),
})
const projectOpen = { to: 'Open', input: Schema.Struct(configuration) } as const
const sessionOpen = { to: 'Live', input: Schema.Struct({ staff: StaffId, pane: Pane, staffing: EventNumber }) } as const

export const projectLine = line({
  Open: { owes: 'Owner', moves: {
    next: { to: ['Open'], input: Schema.Union([
      Schema.TaggedStruct('TaskSent', { draft: TaskDraft }),
      Schema.TaggedStruct('StaffingAccepted', { plan: StaffingPlan }),
    ]) },
    end: { to: ['Ended'], input: Schema.Struct({}) },
  } },
  Ended: { owes: 'None', moves: {} },
})
export const taskLine = line({
  Sent: { owes: 'Assignee', moves: { next: {
    to: ['Working'], input: Schema.Struct({ session: LiveSession, staffing: EventNumber, place: Schema.Literals(['Main', 'Child']) }),
  } } },
  Working: { owes: 'Assignee', moves: {
    next: { to: ['ReadyToReview'], input: result },
    restart: { to: ['Sent'], input: Schema.Struct({ session: SessionId }) },
  } },
  ReadyToReview: { owes: 'Engine', moves: {
    next: { to: ['Reviewing'], input: Schema.Struct({ outcomes: Schema.Tuple([]) }) },
  } },
  Reviewing: { owes: 'Reviewer', moves: {
    next: { to: ['Reviewing'], input: Schema.Struct({ session: LiveSession, staffing: EventNumber }) },
    back: { to: ['Working'], input: Schema.Struct({ why: Rationale }) },
  } },
}) satisfies Readonly<Record<TaskPhase['_tag'], object>>
export const sessionLine = line({
  Live: { owes: 'Engine', moves: {
    next: { to: ['Paused', 'Ended'], input: Schema.Struct({ observed: Schema.Literals(['Paused', 'Ended']) }) },
  } },
  Paused: { owes: 'Engine', moves: {
    next: { to: ['Live'], input: Schema.Struct({ id: SessionId, pane: Pane, staffing: EventNumber }) },
  } },
  Ended: { owes: 'None', moves: {} },
})

const entry = { number: EventNumber, actor: StoredActor, read: ReadPosition, at: Timestamp }
const on = <A extends Schema.Top, F extends Schema.Top, M extends 'next' | 'end' | 'back', I extends Schema.Top>(
  address: A, from: F, move: M, definition: { readonly input: I },
) => Schema.Struct({ ...entry, line: address, from, move: Schema.Literal(move), input: definition.input })

export const ProjectEvent = Schema.Union([
  on(ProjectAddress, Schema.Null, 'next', projectOpen),
  on(ProjectAddress, Schema.Literal('Open'), 'next', projectLine.Open.moves.next),
  on(ProjectAddress, Schema.Literal('Open'), 'end', projectLine.Open.moves.end),
])
export type ProjectEvent = Of<typeof ProjectEvent>
export const TaskEvent = Schema.Union([
  on(TaskAddress, Schema.Literal('Sent'), 'next', taskLine.Sent.moves.next),
  on(TaskAddress, Schema.Literal('Working'), 'next', taskLine.Working.moves.next),
  on(TaskAddress, Schema.Literal('ReadyToReview'), 'next', taskLine.ReadyToReview.moves.next),
  on(TaskAddress, Schema.Literal('Reviewing'), 'next', taskLine.Reviewing.moves.next),
  on(TaskAddress, Schema.Literal('Reviewing'), 'back', taskLine.Reviewing.moves.back),
])
export type TaskEvent = Of<typeof TaskEvent>
export const SessionEvent = Schema.Union([
  on(SessionAddress, Schema.Null, 'next', sessionOpen),
  on(SessionAddress, Schema.Literal('Live'), 'next', sessionLine.Live.moves.next),
  on(SessionAddress, Schema.Literal('Paused'), 'next', sessionLine.Paused.moves.next),
])
export type SessionEvent = Of<typeof SessionEvent>

export const StoredEvent = Schema.Union([ProjectEvent, TaskEvent, SessionEvent])
  .check(Schema.makeFilter((event) => event.read < event.number))
export type StoredEvent = Of<typeof StoredEvent>
export const StoredEvents = Schema.Array(StoredEvent)

export const Submission = Schema.Union([
  Schema.TaggedStruct('StaffReport', {
    read: ReadPosition,
    report: Schema.TaggedStruct('Work', { line: TaskAddress, report: Schema.NullOr(result) }),
  }),
  Schema.TaggedStruct('HumanChoice', {
    read: ReadPosition,
    choice: Schema.Union([
      Schema.TaggedStruct('NewProject', { project: ProjectAddress, ...configuration }),
      Schema.TaggedStruct('EndProject', { line: ProjectAddress }),
    ]),
  }),
])
export type Submission = Of<typeof Submission>
