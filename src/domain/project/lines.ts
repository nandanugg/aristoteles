import { Schema } from 'effect'
import { EventNumber, ReadPosition, StoredActor, Timestamp } from './values.ts'

export type Party = 'Actor' | 'Assignee' | 'Reviewer' | 'Owner' | 'Recipient' | 'Proposer' | 'Engine' | 'Host' | 'None'
type Edges<Table> = {
  readonly [Phase in keyof Table]: {
    readonly owes: Party
    readonly moves: {
      readonly [Move in keyof (Table[Phase] extends { readonly moves: infer M } ? M : never)]:
        {
          readonly to: readonly (keyof Table)[]
          readonly input: Schema.Top
          readonly owes?: Party
          readonly submission?: { readonly input: Schema.Top; readonly move?: string }
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

const entry = { number: EventNumber, actor: StoredActor, read: ReadPosition, at: Timestamp }
export const protocol = <A extends Schema.Top, const T extends Edges<T>>(address: A, states: T) => {
  type EventSchema<F, M, I extends Schema.Top> = Schema.Struct<typeof entry & {
    line: A; from: F extends 'null' ? typeof Schema.Null : Schema.Literal<F & string>; move: Schema.Literal<M & string>; input: I
  }>
  type SubmissionSchema<M, I extends Schema.Top> = Schema.Struct<{
    read: typeof ReadPosition; line: A; move: Schema.Literal<M & string>; input: I
  }>
  type EventOf<Table extends Edges<Table>> = {
    [F in keyof Table]: { [M in keyof Table[F]['moves']]: EventSchema<F, M, Table[F]['moves'][M]['input']> }[keyof Table[F]['moves']]
  }[keyof Table]
  type SubmissionOf<Table extends Edges<Table>> = {
    [F in keyof Table]: { [M in keyof Table[F]['moves']]: Table[F]['moves'][M] extends {
      readonly submission: { readonly input: infer I extends Schema.Top; readonly move: infer Alias }
    } ? SubmissionSchema<Alias, I> : Table[F]['moves'][M] extends {
      readonly submission: { readonly input: infer I extends Schema.Top }
    } ? SubmissionSchema<M, I> : never }[keyof Table[F]['moves']]
  }[keyof Table]
  // Defer the schema calculation until the caller supplies a concrete table.
  type Events<Table extends Edges<Table>> = Table extends unknown ? EventOf<Table> : never
  type Submissions<Table extends Edges<Table>> = Table extends unknown ? SubmissionOf<Table> : never

  const events = []
  const submissions = []
  const authorities: { readonly matches: (value: unknown) => boolean; readonly party: Party }[] = []
  type Table = Edges<Record<string, { readonly moves: Record<string, object> }>>
  for (const [from, state] of Object.entries(states) as readonly (readonly [string, Table[string]])[]) {
    for (const [move, definition] of Object.entries(state.moves)) {
      events.push(Schema.Struct({
        ...entry, line: address, from: from === 'null' ? Schema.Null : Schema.Literal(from),
        move: Schema.Literal(move), input: definition.input,
      }))
      if (!definition.submission) continue
      const request = Schema.Struct({
        read: ReadPosition, line: address, move: Schema.Literal(definition.submission.move ?? move),
        input: definition.submission.input,
      })
      submissions.push(request)
      authorities.push({ matches: Schema.is(request), party: definition.owes ?? state.owes })
    }
  }
  // Object.entries erases literal keys. The mapped types above preserve their pairing with each input.
  const submission = Schema.Union(submissions as unknown as readonly Submissions<T>[])
  return {
    event: Schema.Union(events as unknown as readonly Events<T>[]),
    submission,
    party: (request: typeof submission.Type) => authorities.find(({ matches }) => matches(request))?.party,
  }
}
