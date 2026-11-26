import type { TaskPhase } from './records.ts'

type Duty = 'Assignee' | 'Reviewer' | 'Owner' | 'Engine' | 'None'

type Edges<Table> = {
  readonly [Phase in keyof Table]: {
    readonly owes: Duty
    readonly moves: {
      readonly [Move in keyof (Table[Phase] extends { readonly moves: infer M } ? M : never)]: readonly (keyof Table)[]
    }
  }
}
const line = <const Table extends Edges<Table>>(states: Table) => states

export const projectLine = line({
  BeforeProject: { owes: 'Owner', moves: { next: ['Open'] } },
  Open: { owes: 'None', moves: { next: ['Open', 'Ended'] } },
  Ended: { owes: 'None', moves: {} },
})
export const taskLine = line({
  Sent: { owes: 'Assignee', moves: { next: ['Working'] } },
  Working: { owes: 'Assignee', moves: { next: ['ReadyToReview'], restart: ['Sent'] } },
  ReadyToReview: { owes: 'Engine', moves: { next: ['Reviewing'] } },
  Reviewing: { owes: 'Reviewer', moves: { next: ['Reviewing'], back: ['Working'] } },
}) satisfies Readonly<Record<TaskPhase['_tag'], object>>

export const sessionLine = line({
  Live: { owes: 'Engine', moves: { next: ['Paused', 'Ended'] } },
  Paused: { owes: 'Engine', moves: { next: ['Live'] } },
  Ended: { owes: 'None', moves: {} },
})

export type MoveOf<Table extends Edges<Table>> = {
  [Phase in keyof Table]: keyof Table[Phase]['moves']
}[keyof Table]

export const edge = <Table extends Edges<Table>>(
  table: Table, from: keyof Table, move: MoveOf<Table>, to: keyof Table,
): 'Allowed' | 'Blocked' => {
  for (const [key, destinations] of Object.entries<readonly (keyof Table)[]>(table[from].moves)) {
    if (key === move && destinations.includes(to)) return 'Allowed'
  }
  return 'Blocked'
}
