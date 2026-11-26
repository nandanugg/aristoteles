import { Schema } from 'effect'
import { projectLine, sessionLine, taskLine, type MoveOf } from './lines.ts'
import { Human, TaskDraft } from './records.ts'
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
const ProjectOpened = Schema.TaggedStruct('ProjectOpened', configuration)
const TaskSent = Schema.TaggedStruct('TaskSent', { draft: TaskDraft })
const ProjectEnded = Schema.TaggedStruct('ProjectEnded', {})
export const StaffingAccepted = Schema.TaggedStruct('StaffingAccepted', { plan: StaffingPlan })
export const SessionBegan = Schema.Struct({ id: SessionId, staff: StaffId, pane: Pane, staffing: EventNumber })
export const SessionStarted = Schema.TaggedStruct('SessionStarted', { session: SessionBegan })
export const SessionObservation = Schema.Union([
  Schema.TaggedStruct('Paused', {}),
  Schema.TaggedStruct('Ended', {}),
  Schema.TaggedStruct('Resumed', { id: SessionId, pane: Pane, staffing: EventNumber }),
])
export type SessionObservation = Of<typeof SessionObservation>
const Reviewing = Schema.TaggedStruct('Reviewing', { session: LiveSession, staffing: EventNumber })
const Began = Schema.TaggedStruct('Began', { session: LiveSession, place: Schema.Literals(['Main', 'Child']) })
const WorkBegan = Schema.TaggedStruct('Began', { ...Began.fields, staffing: EventNumber })
const WorkResult = Schema.TaggedStruct('Result', {
  attempt: AttemptNumber, summary: ResultSummary,
  files: Schema.Array(Schema.Struct({ path: FilePath, contents: FileContents })),
})
const WorkReport = Schema.Union([Began, WorkResult])
const CommandOutcomes = Schema.TaggedStruct('CommandOutcomes', { outcomes: Schema.Tuple([]) })
const ReviewFacts = Schema.TaggedStruct('ReviewFacts', { why: Rationale })

type Payloads<Move extends 'next' | 'back' | 'restart'> = {
  readonly [M in Move]: Schema.Top & { readonly Type: { readonly _tag: M } }
}
const projectInput = {
  next: Schema.TaggedStruct('next', { fact: Schema.Union([ProjectOpened, TaskSent, ProjectEnded, StaffingAccepted, SessionStarted]) }),
} satisfies Payloads<MoveOf<typeof projectLine>>
const taskInput = {
  next: Schema.TaggedStruct('next', { fact: Schema.Union([WorkBegan, WorkResult, CommandOutcomes, Reviewing]) }),
  back: Schema.TaggedStruct('back', { fact: ReviewFacts }),
} satisfies Payloads<Exclude<MoveOf<typeof taskLine>, 'restart'>>
const sessionInput = {
  next: Schema.TaggedStruct('next', { fact: SessionObservation }),
} satisfies Payloads<MoveOf<typeof sessionLine>>

const projectInputs = Schema.Union(Object.values(projectInput))
const taskInputs = Schema.Union(Object.values(taskInput))
const sessionInputs = Schema.Union(Object.values(sessionInput))
const matchesSession = Schema.is(sessionInputs)
const matchesProject = Schema.is(projectInputs)
const matchesTask = Schema.is(taskInputs)
type Move = MoveOf<typeof projectLine> | MoveOf<typeof sessionLine> | Exclude<MoveOf<typeof taskLine>, 'restart'>
const Move = Schema.declare((value): value is Move =>
  typeof value === 'string' && value !== 'restart' && [projectLine, taskLine, sessionLine].some((line) =>
    Object.values(line).some((phase) => Object.hasOwn(phase.moves, value)),
  ),
)
const entry = { number: EventNumber, actor: StoredActor, read: ReadPosition, at: Timestamp }
export const StoredEvent = Schema.Struct({
  ...entry,
  line: Schema.Union([ProjectAddress, TaskAddress, SessionAddress]),
  move: Move,
  input: Schema.Union([projectInputs, taskInputs, sessionInputs]),
}).check(Schema.makeFilter((event) =>
  event.read < event.number && event.move === event.input._tag &&
  (event.line._tag === 'Project' ? matchesProject(event.input) :
    event.line._tag === 'Task' ? matchesTask(event.input) : matchesSession(event.input)),
))
export type StoredEvent = Of<typeof StoredEvent>
export const StoredEvents = Schema.Array(StoredEvent)

export const Submission = Schema.Union([
  Schema.TaggedStruct('StaffReport', {
    read: ReadPosition,
    report: Schema.TaggedStruct('Work', { line: TaskAddress, report: WorkReport }),
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
