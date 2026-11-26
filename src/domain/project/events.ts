import { Schema } from 'effect'
import { projectLine, taskLine, type MoveOf } from './lines.ts'
import { Human, LiveSession, Role, Staff, TaskDraft } from './records.ts'
import {
  AttemptNumber, EventNumber, FileContents, FilePath, HumanId, ProjectId, Rationale, ReadPosition,
  ResultSummary, StaffId, TaskId, Timestamp, type Of,
} from './values.ts'

export const ProjectAddress = Schema.TaggedStruct('Project', { id: ProjectId })
export const TaskAddress = Schema.TaggedStruct('Task', { id: TaskId })
const StoredActor = Schema.Union([
  Schema.TaggedStruct('Human', { id: HumanId }),
  Schema.TaggedStruct('Staff', { id: StaffId }),
])
export type StoredActor = Of<typeof StoredActor>

const configuration = { owner: Human, host: Role, pipeline: Role, staff: Staff }
const ProjectOpened = Schema.TaggedStruct('ProjectOpened', configuration)
const TaskSent = Schema.TaggedStruct('TaskSent', { draft: TaskDraft })
const ProjectEnded = Schema.TaggedStruct('ProjectEnded', {})
const Began = Schema.TaggedStruct('Began', { session: LiveSession, place: Schema.Literals(['Main', 'Child']) })
const WorkResult = Schema.TaggedStruct('Result', {
  attempt: AttemptNumber, summary: ResultSummary,
  files: Schema.Array(Schema.Struct({ path: FilePath, contents: FileContents })),
})
const WorkReport = Schema.Union([Began, WorkResult])
const CommandOutcomes = Schema.TaggedStruct('CommandOutcomes', { outcomes: Schema.Tuple([]) })
const ReviewFacts = Schema.TaggedStruct('ReviewFacts', { why: Rationale })

type Payloads<Move extends 'next' | 'back'> = {
  readonly [M in Move]: Schema.Top & { readonly Type: { readonly _tag: M } }
}
const projectInput = {
  next: Schema.TaggedStruct('next', { fact: Schema.Union([ProjectOpened, TaskSent, ProjectEnded]) }),
} satisfies Payloads<MoveOf<typeof projectLine>>
const taskInput = {
  next: Schema.TaggedStruct('next', { fact: Schema.Union([Began, WorkResult, CommandOutcomes]) }),
  back: Schema.TaggedStruct('back', { fact: ReviewFacts }),
} satisfies Payloads<MoveOf<typeof taskLine>>

const projectInputs = Schema.Union(Object.values(projectInput))
const taskInputs = Schema.Union(Object.values(taskInput))
const matchesProject = Schema.is(projectInputs)
const matchesTask = Schema.is(taskInputs)
type Move = MoveOf<typeof projectLine> | MoveOf<typeof taskLine>
const Move = Schema.declare((value): value is Move =>
  typeof value === 'string' && [projectLine, taskLine].some((line) =>
    Object.values(line).some((phase) => Object.hasOwn(phase.moves, value)),
  ),
)
const entry = { number: EventNumber, actor: StoredActor, read: ReadPosition, at: Timestamp }
export const StoredEvent = Schema.Struct({
  ...entry,
  line: Schema.Union([ProjectAddress, TaskAddress]),
  move: Move,
  input: Schema.Union([projectInputs, taskInputs]),
}).check(Schema.makeFilter((event) =>
  event.read < event.number && event.move === event.input._tag &&
  (event.line._tag === 'Project' ? matchesProject(event.input) : matchesTask(event.input)),
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
