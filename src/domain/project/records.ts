import { Schema } from 'effect'
import { ProjectPhase } from './activation.ts'
import { Proposal, StaffingAccepted, staffing } from './proposal.ts'
import { Human, Role, StaffSession } from './staff.ts'
import {
  EventNumber, recordsByKey,
  ProposalKey, QuestionKey, ReadPosition, RoleKey, StaffSessionKey,
  TaskKey, type Of,
} from './values.ts'
import { Task } from './task.ts'
import { Question } from './question.ts'

export const Project = Schema.Struct({
  owner: Human,
  roles: Schema.Struct({ host: Role, pipeline: Role, work: recordsByKey(Role, RoleKey) }).check(
    Schema.makeFilter(({ host, pipeline, work }) => host.key !== pipeline.key && !work.has(host.key) && !work.has(pipeline.key)),
  ),
  openedIn: EventNumber,
  staffing: Schema.Union([staffing, StaffingAccepted]), proposals: recordsByKey(Proposal, ProposalKey),
  sessions: recordsByKey(StaffSession, StaffSessionKey), tasks: recordsByKey(Task, TaskKey), questions: recordsByKey(Question, QuestionKey), phase: ProjectPhase,
  changedIn: EventNumber, read: ReadPosition,
})
export type Project = Of<typeof Project>
export const Projection = Schema.NullOr(Project)
export type Projection = Of<typeof Projection>
