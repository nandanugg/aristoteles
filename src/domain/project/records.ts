import { Schema, SchemaGetter } from 'effect'
import { Activation } from './activation.ts'
import { Proposal, StaffingAccepted } from './proposal.ts'
import { Human, Role, Staff, StaffSession, Subscription } from './staff.ts'
import {
  EventNumber,
  ProposalKey, QuestionKey, ReadPosition, RoleKey, StaffSessionKey, StaffKey,
  SubscriptionKey, TaskKey, type Of,
} from './values.ts'
import { Task } from './task.ts'
import { Question } from './question.ts'

const recordsByKey = <S extends Schema.Top, K extends Schema.Top>(
  value: S & { readonly Type: { readonly key: K['Type'] }; readonly DecodingServices: never; readonly EncodingServices: never },
  key: K,
) => Schema.Array(value)
  .check(Schema.makeFilter((entries) => new Set(entries.map((item) => item.key)).size === entries.length))
  .pipe(Schema.decodeTo(Schema.ReadonlyMap(Schema.toType(key), Schema.toType(value)), {
    decode: SchemaGetter.transform((entries) => new Map(entries.map((item) => [item.key, item]))),
    encode: SchemaGetter.transform((map) => [...map.values()]),
  }))
const ProjectStatus = Schema.Union([
  Schema.TaggedStruct('Open', {}),
  Schema.TaggedStruct('Ended', { at: EventNumber }),
])
export const Project = Schema.Struct({
  owner: Human,
  roles: Schema.Struct({ host: Role, pipeline: Role, work: recordsByKey(Role, RoleKey) }).check(
    Schema.makeFilter(({ host, pipeline, work }) => host.key !== pipeline.key && !work.has(host.key) && !work.has(pipeline.key)),
  ), staff: recordsByKey(Staff, StaffKey),
  subscriptions: recordsByKey(Subscription, SubscriptionKey), openedAt: EventNumber,
  staffing: Schema.NullOr(StaffingAccepted), proposals: recordsByKey(Proposal, ProposalKey),
  sessions: recordsByKey(StaffSession, StaffSessionKey), tasks: recordsByKey(Task, TaskKey), questions: recordsByKey(Question, QuestionKey), status: ProjectStatus, activation: Activation,
  lastChange: EventNumber, read: ReadPosition,
})
export type Project = Of<typeof Project>
export const Projection = Schema.NullOr(Project)
export type Projection = Of<typeof Projection>
