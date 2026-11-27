import { Schema } from 'effect'
import { ProjectPhase } from './activation.ts'
import { Proposal, StaffingAccepted, staffing } from './proposal.ts'
import { Human, Roles, StaffSession } from './staff.ts'
import {
  EventNumber, recordsByKey,
  ProposalKey, QuestionKey, ReadPosition, StaffSessionKey,
  TaskKey, type Of,
} from './values.ts'
import { Task } from './task.ts'
import { Question } from './question.ts'

export const Project = Schema.Struct({
  owner: Human,
  roles: Roles,
  openedIn: EventNumber,
  staffing: Schema.Union([staffing, StaffingAccepted]), proposals: recordsByKey(Proposal, ProposalKey),
  sessions: recordsByKey(StaffSession, StaffSessionKey), tasks: recordsByKey(Task, TaskKey), questions: recordsByKey(Question, QuestionKey), phase: ProjectPhase,
  changedIn: EventNumber, read: ReadPosition,
})
export type Project = Of<typeof Project>
export const Projection = Schema.NullOr(Project)
export type Projection = Of<typeof Projection>
