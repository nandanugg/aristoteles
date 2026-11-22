// Shared item and payload schemas for the C16 acts.
import { Schema, SchemaGetter } from 'effect'

const setOf = <V extends Schema.Top>(value: V) =>
  Schema.Array(value).pipe(
    Schema.decodeTo(Schema.ReadonlySet(value), {
      decode: SchemaGetter.transform((xs) => new Set(xs)),
      encode: SchemaGetter.transform((set) => [...set]),
    }),
  )

const Str = Schema.String
const Strs = Schema.Array(Str)
const Int = Schema.Number.pipe(Schema.check(Schema.isInt()))

export const Form = Schema.Literals(['none', 'mech', 'ref', 'both'])
export const ItemRec = Schema.Struct({
  kind: Schema.Literals(['dir', 'std', 'rule']),
  parent: Schema.NullOr(Str),
  name: Str,
  says: Str,
  where: Schema.NullOr(Strs),
  test: Schema.NullOr(Str),
  ref: Schema.NullOr(Str),
  form: Form,
  knownBreaks: Schema.optionalKey(Strs),
  examples: Schema.Array(
    Schema.Struct({ fits: Schema.Literals(['follows', 'breaks']), sample: Str }),
  ),
})
export type ItemRec = typeof ItemRec.Type

export const Level = Schema.Literals(['Split', 'Fit', 'Principle', 'Direct', 'Standard'])
export const Verdict = Schema.Literals(['Pass', 'Fail', 'RaiseTries', 'RaiseNoRule', 'RaiseMisses'])
export const RoleDraft = Schema.Struct({ role: Str, words: Str, model: Str })
export const TaskSpec = Schema.Struct({ name: Str, goal: Str, sections: Strs, role: Str })
export const Versions = Schema.Array(Schema.Tuple([Str, Int])).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Str, Int), {
    decode: SchemaGetter.transform((pairs) => new Map(pairs)),
    encode: SchemaGetter.transform((map) => [...map]),
  }),
)
const Drafted = Schema.NullOr(ItemRec)
export const DraftItems = Schema.Array(Schema.Tuple([Str, Drafted])).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Str, Drafted), {
    decode: SchemaGetter.transform((pairs) => new Map(pairs)),
    encode: SchemaGetter.transform((map) => [...map]),
  }),
)
export const Keys = setOf(Str)
