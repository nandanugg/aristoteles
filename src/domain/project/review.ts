import { Schema } from 'effect'
import { Outcome } from './evidence.ts'
import { Staff } from './staff.ts'
import { EventNumber, Rationale, type Of } from './values.ts'

export const ReviewFacts = Schema.Struct({
  outcomes: Schema.NonEmptyArray(Outcome),
  findings: Schema.Array(Rationale),
})
export type ReviewFacts = Of<typeof ReviewFacts>
export const reviewOutcome = (facts: ReviewFacts): 'Holds' | 'Breaks' =>
  facts.findings.length === 0 && facts.outcomes.every((outcome) => outcome._tag === 'Holds') ? 'Holds' : 'Breaks'

const Assignment = Schema.Union([
  Schema.TaggedStruct('Waiting', {}),
  Schema.TaggedStruct('Assigned', { by: Staff, review: EventNumber }),
])
export const reviewing = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.TaggedStruct('Reviewing', { ...fields, assignment: Assignment })
