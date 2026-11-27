import { Schema } from 'effect'
import { Question } from './question.ts'
import { Direction } from './direction.ts'
import { ReviewFacts, reviewing } from './review.ts'
import { Responsibility, StaffingPlan } from './staff.ts'
import { versionOf } from './version.ts'
import { EventNumber, FileContents, ProposalKey, RoleKey, QuestionKey, Rationale, recordsByKey, RetryCount, StoredActor, TaskKey, type Of } from './values.ts'

export const staffing = Schema.TaggedStruct('Staffing', StaffingPlan.fields)
export const ProposalValue = Schema.Union([
  Direction,
  staffing,
  Schema.TaggedStruct('Responsibility', { ...Responsibility.fields, role: RoleKey }),
])
export type ProposalValue = Of<typeof ProposalValue>

const encodeProposalValue = Schema.encodeSync(ProposalValue)
export const proposalText = (value: ProposalValue): Of<typeof FileContents> =>
  FileContents.make(JSON.stringify(encodeProposalValue(value), null, 2))

export const FixDraft = Schema.Union([Direction, staffing])

const proposalOf = <S extends Schema.Top>(value: S) => Schema.Struct({
  key: ProposalKey, value, questions: recordsByKey(Question, QuestionKey), basis: Schema.Union([Schema.TaggedStruct('None', {}), Schema.TaggedStruct('Version', { version: versionOf(ProposalValue) })]),
  proposer: StoredActor, retryCount: RetryCount,
  subject: Schema.Union([Schema.TaggedStruct('Onboarding', {}), Schema.TaggedStruct('Fix', { task: TaskKey })]),
  phase: Schema.Union([
    Schema.TaggedStruct('Drafting', { feedback: Schema.Union([
      Schema.TaggedStruct('None', {}),
      Schema.TaggedStruct('Review', { facts: ReviewFacts }),
      Schema.TaggedStruct('Owner', { why: Rationale }),
    ]) }),
    reviewing({}),
    Schema.TaggedStruct('WaitingForOwner', { queuedIn: EventNumber, facts: ReviewFacts }),
    Schema.TaggedStruct('Accepted', { version: versionOf(value) }),
    Schema.TaggedStruct('Removed', {}),
  ]),
  changedIn: EventNumber,
})

export const Proposal = proposalOf(ProposalValue)
export type Proposal<T extends ProposalValue = ProposalValue> = Of<ReturnType<typeof proposalOf<Schema.Schema<T>>>>

export const StaffingAccepted = Schema.TaggedStruct('StaffingAccepted', {
  version: versionOf(staffing),
})
