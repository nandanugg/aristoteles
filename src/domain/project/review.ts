import { Schema } from 'effect'
import { Rationale, type Of } from './values.ts'

const Outcome = Schema.Union([
  Schema.TaggedStruct('Holds', { evidence: Rationale }),
  Schema.TaggedStruct('Breaks', { evidence: Rationale }),
])
export const ReviewFacts = Schema.Struct({
  outcomes: Schema.NonEmptyArray(Outcome),
  findings: Schema.Array(Rationale),
})
export type ReviewFacts = Of<typeof ReviewFacts>
export const reviewOutcome = (facts: ReviewFacts): 'Holds' | 'Breaks' =>
  facts.findings.length === 0 && facts.outcomes.every((outcome) => outcome._tag === 'Holds') ? 'Holds' : 'Breaks'
