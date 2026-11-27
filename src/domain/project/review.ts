import { Schema } from 'effect'
import { Rule } from './direction.ts'
import { Evidence, Outcome, Quote, outcomeOf } from './evidence.ts'
import { EventNumber, FileContents, Rationale, StoredActor, type Of } from './values.ts'

export const PromptOutcome = outcomeOf({ rule: Rule, evidence: Quote }).check(Schema.makeFilter(({ rule }) =>
  rule.verification._tag === 'Prompt'))
const Finding = Schema.Struct({ text: Rationale, evidence: Evidence })

export const ReviewFacts = Schema.Struct({
  outcomes: Schema.Array(Schema.Union([PromptOutcome, Outcome])),
  findings: Schema.Array(Finding),
})
export type ReviewFacts = Of<typeof ReviewFacts>
export const reviewOutcome = (facts: ReviewFacts): 'Holds' | 'Breaks' =>
  facts.findings.length === 0 && facts.outcomes.every((outcome) => outcome._tag === 'Holds') ? 'Holds' : 'Breaks'

const Assignment = Schema.Union([
  Schema.TaggedStruct('Waiting', {}),
  Schema.TaggedStruct('Assigned', { actor: StoredActor.members[1], review: EventNumber }),
])
export const reviewing = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.TaggedStruct('Reviewing', { ...fields, assignment: Assignment })

export const quoteIn = (quote: Of<typeof Quote>, contents: Of<typeof FileContents>): 'Found' | 'Missing' => {
  const lines = contents.split(/\r?\n/u)
  if (lines.at(-1) === '') lines.pop()
  return quote.lines.last <= lines.length &&
    lines.slice(quote.lines.first - 1, quote.lines.last).join('\n').includes(quote.text) ? 'Found' : 'Missing'
}
