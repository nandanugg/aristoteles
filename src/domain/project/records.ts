import { Schema, SchemaGetter } from 'effect'
import { Activation } from './activation.ts'
import { Proposal, StaffingAccepted } from './proposal.ts'
import { Human, Role, Staff, StaffSession, Subscription } from './staff.ts'
import {
  EventNumber,
  ProjectId, ProposalId, QuestionId, ReadPosition, QuestionText, RoleId, SessionId, StaffId,
  SubscriptionId, TaskId, type Of,
} from './values.ts'
import { Task } from './task.ts'
import { Answer, QuestionForm, questionAbout } from './question.ts'

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
  staffing: Schema.NullOr(StaffingAccepted), proposals: recordsById(Proposal, ProposalId),
  sessions: recordsById(StaffSession, SessionId), tasks: recordsById(Task, TaskId), questions: recordsById(Question, QuestionId), status: ProjectStatus, activation: Activation,
  lastChange: EventNumber, read: ReadPosition,
})
export type Project = Of<typeof Project>
export const Projection = Schema.NullOr(Project)
export type Projection = Of<typeof Projection>
