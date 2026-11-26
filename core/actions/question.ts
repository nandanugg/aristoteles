import { Effect, Schema } from 'effect'
import {
  Rationale, refuse, Submission, type Of, type ReadPosition, type Refusal,
} from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { Authority, submit } from './project.ts'

type Input = Extract<Extract<Submission, { _tag: 'HumanChoice' }>['choice'], { _tag: 'Question' | 'Answer' }>

// CLI and other authenticated adapters enter through the same Submission codec as the page.
export const submitQuestion = (
  journal: Journal, read: Of<typeof ReadPosition>, input: Input,
): Effect.Effect<Committed, Refusal, Authority> => Effect.gen(function* () {
  const authority = yield* Authority
  const actor = yield* authority.actor
  const request: Submission = actor._tag === 'Human'
    ? { _tag: 'HumanChoice', read, choice: input }
    : { _tag: 'StaffReport', read, report: input }
  return yield* submit(journal, request).pipe(Effect.provideService(Authority, { actor: Effect.succeed(actor) }))
})

export const decodeQuestionInput = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S, input: unknown,
): Effect.Effect<S['Type'], Refusal> => Effect.mapError(
  Schema.decodeUnknownEffect(schema, { onExcessProperty: 'error' })(input),
  () => refuse('InvalidInput', Rationale.make('Use the checked question or answer form.')),
)
