import { Schema } from 'effect'
import { EventNumber, ReadPosition, StoredActor, Timestamp } from './values.ts'

export type Party = 'Anyone' | 'Assignee' | 'Reviewer' | 'Owner' | 'Recipient' | 'Proposer' | 'Engine' | 'Host' | 'None'
type Edges<Table> = {
  readonly [Phase in keyof Table]: {
    readonly from: Schema.Top
    readonly owes: Party
    readonly moves: {
      readonly [Move in keyof (Table[Phase] extends { readonly moves: infer M } ? M : never)]:
        {
          readonly to: readonly (keyof Table)[]
          readonly input: Schema.Top
          readonly owes?: Party
          readonly submission?: { readonly input: Schema.Top; readonly move: string }
        }
    }
  }
}
export const line = <const Table extends Edges<Table>>(states: Table & {
  readonly [Phase in keyof Table]: { readonly from: Phase extends 'null' ? typeof Schema.Null : Schema.Literal<Phase & string> }
}): Table => states

type MoveOf<Table extends Edges<Table>> = {
  [Phase in keyof Table]: keyof Table[Phase]['moves']
}[keyof Table]

export const edge = <Table extends Edges<Table>>(
  table: Table, from: keyof Table, move: MoveOf<Table>, to: keyof Table,
): 'Allowed' | 'Blocked' => {
  for (const [key, entry] of Object.entries<{ readonly to: readonly (keyof Table)[] }>(table[from].moves))
    if (key === move && entry.to.includes(to)) return 'Allowed'
  return 'Blocked'
}

const entry = { number: EventNumber, actor: StoredActor, read: ReadPosition, at: Timestamp }
export const protocol = <const Fields extends Schema.Struct.Fields, const Table extends Edges<Table>>(
  fields: Fields, states: Table,
) => {
  return {
    event<Phase extends keyof Table, Move extends keyof Table[Phase]['moves'] & string>(phase: Phase, move: Move) {
      const from: Table[Phase]['from'] = states[phase].from
      const moves: Table[Phase]['moves'] = states[phase].moves
      const input: Table[Phase]['moves'][Move]['input'] = moves[move].input
      return Schema.Struct({ ...entry, ...fields, from, move: Schema.Literal(move), input })
    },
    request<Phase extends keyof Table, Input extends { readonly input: Schema.Top; readonly move: string }>(
      phase: Phase, definition: Table[NoInfer<Phase>]['moves'][keyof Table[NoInfer<Phase>]['moves']] & { readonly submission: Input },
    ) {
      const input: Input['input'] = definition.submission.input
      const name: Input['move'] = definition.submission.move
      return {
        schema: Schema.Struct({ read: ReadPosition, ...fields, move: Schema.Literal(name), input }),
        party: definition.owes ?? states[phase].owes,
      }
    },
  }
}
