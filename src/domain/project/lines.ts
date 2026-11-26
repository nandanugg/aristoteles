import type { Schema } from 'effect'

type Duty = 'Assignee' | 'Reviewer' | 'Owner' | 'Recipient' | 'Proposer' | 'Engine' | 'None'

type Edges<Table> = {
  readonly [Phase in keyof Table]: {
    readonly owes: Duty
    readonly moves: {
      readonly [Move in keyof (Table[Phase] extends { readonly moves: infer M } ? M : never)]: {
        readonly to: readonly (keyof Table)[]
        readonly input: Schema.Top
      }
    }
  }
}
export const line = <const Table extends Edges<Table>>(states: Table) => states

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
