import { Effect, Schema } from 'effect'
import {
  Rationale, refuse, type Refusal,
} from '../schema/project.ts'

export const decodeQuestionInput = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S, input: unknown,
): Effect.Effect<S['Type'], Refusal> => Effect.mapError(
  Schema.decodeUnknownEffect(schema, { onExcessProperty: 'error' })(input),
  () => refuse('InvalidInput', Rationale.make('Use the checked question or answer form.')),
)
