import { Schema } from 'effect'
import { Activation } from './activation.ts'
import { Proposal, StaffingAccepted, staffing } from './proposal.ts'
import { Human, Role, StaffSession, Subscription } from './staff.ts'
import {
  EventNumber, recordsByKey,
  ProposalKey, QuestionKey, ReadPosition, RoleKey, StaffSessionKey,
  SubscriptionKey, TaskKey, type Of,
} from './values.ts'
import { Task } from './task.ts'
import { Question } from './question.ts'

const ProjectStatus = Schema.Union([
  Schema.TaggedStruct('Open', {}),
  Schema.TaggedStruct('Ended', { at: EventNumber }),
])
export const Project = Schema.Struct({
  owner: Human,
  roles: Schema.Struct({ host: Role, pipeline: Role, work: recordsByKey(Role, RoleKey) }).check(
    Schema.makeFilter(({ host, pipeline, work }) => host.key !== pipeline.key && !work.has(host.key) && !work.has(pipeline.key)),
  ),
  subscriptions: recordsByKey(Subscription, SubscriptionKey), openedAt: EventNumber,
  staffing: Schema.Union([staffing, StaffingAccepted]), proposals: recordsByKey(Proposal, ProposalKey),
  sessions: recordsByKey(StaffSession, StaffSessionKey), tasks: recordsByKey(Task, TaskKey), questions: recordsByKey(Question, QuestionKey), status: ProjectStatus, activation: Activation,
  lastChange: EventNumber, read: ReadPosition,
})
export type Project = Of<typeof Project>
export const Projection = Schema.NullOr(Project)
export type Projection = Of<typeof Projection>
