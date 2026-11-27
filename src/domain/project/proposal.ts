import { Schema } from 'effect'
import { Question } from './question.ts'
import { Direction } from './direction.ts'
import { ReviewFacts, reviewing } from './review.ts'
import { Human, Responsibility, Role, Staff, StaffingPlan } from './staff.ts'
import { versionOf } from './version.ts'
import { EventNumber, ProposalKey, QuestionKey, Rationale, recordsByKey, RetryCount, type Of } from './values.ts'

const staffing = Schema.TaggedStruct('Staffing', StaffingPlan.fields)
export const ProposalValue = Schema.Union([
  Direction,
  staffing,
  Schema.TaggedStruct('Responsibility', { ...Responsibility.fields, role: Role }),
])
export type ProposalValue = Of<typeof ProposalValue>

const proposalOf = <S extends Schema.Top>(value: S) => Schema.Struct({
  key: ProposalKey, value, questions: recordsByKey(Question, QuestionKey), basis: Schema.Union([Schema.TaggedStruct('None', {}), Schema.TaggedStruct('Version', { version: versionOf(ProposalValue) })]),
  proposer: Schema.Union([Human, Staff]), owner: Human, reviewer: Role, retryCount: RetryCount,
  phase: Schema.Union([
    Schema.TaggedStruct('Drafting', { feedback: Schema.Union([
      Schema.TaggedStruct('None', {}),
      Schema.TaggedStruct('Review', { facts: ReviewFacts }),
      Schema.TaggedStruct('Owner', { why: Rationale }),
    ]) }),
    reviewing({}),
    Schema.TaggedStruct('WaitingForOwner', { by: Staff, review: EventNumber, facts: ReviewFacts }),
    Schema.TaggedStruct('Accepted', { version: versionOf(value) }),
    Schema.TaggedStruct('Removed', {}),
  ]),
  lastChange: EventNumber,
})

export const Proposal = proposalOf(ProposalValue)
export type Proposal<T extends ProposalValue = ProposalValue> = Of<ReturnType<typeof proposalOf<Schema.Schema<T>>>>

export const StaffingAccepted = Schema.TaggedStruct('StaffingAccepted', {
  version: versionOf(staffing),
})
