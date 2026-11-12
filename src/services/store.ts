// The port of the store: one SQLite file for every dir on this machine. The live layer is
// src/store/sqlite.ts (package P1). A write is one BEGIN IMMEDIATE transaction that reads the
// dir's events, lets the caller check its new event against them, appends it, and adds the
// rows of the reader tables, so two agents cannot both pass a check that only one may pass.
import { Context, type Effect, type Scope } from 'effect'
import type { OutsideFailed, Refused, StoreDamaged } from '../domain/errors.ts'
import type { Draft, Recorded } from '../domain/events.ts'

// One row of a reader table (src/store/rows.ts): the table and its columns.
export type ReaderRow = readonly [
  table: string,
  row: Readonly<Record<string, string | number | null>>,
]

// What the caller of a write gives back: the new event and the rows after it, or null to
// write nothing (a refresh that found no change).
export interface Written {
  readonly draft: Draft
  readonly rows: ReadonlyArray<ReaderRow>
}

// The store of one dir, open for one command.
export interface DirStore {
  // The key of the dir: its full path. The name that people read is its folder name.
  readonly dir: string
  readonly name: string
  // The events of the dir in seq order, decoded strictly.
  readonly events: Effect.Effect<ReadonlyArray<Recorded>, StoreDamaged>
  // Returns the seq of the new event, or null when build wrote nothing. A busy store is an
  // OutsideFailed with the words "the store is busy; run the same command again".
  readonly write: <E>(
    build: (events: ReadonlyArray<Recorded>) => Effect.Effect<Written | null, E>,
  ) => Effect.Effect<number | null, E | StoreDamaged | OutsideFailed>
  // A read-only query of the reader tables (work search).
  readonly query: (
    sql: string,
    ...params: ReadonlyArray<string | number>
  ) => Effect.Effect<ReadonlyArray<Readonly<Record<string, unknown>>>>
}

export class Store extends Context.Service<
  Store,
  {
    // The path of the file: ARISTOTELES_DB, or ~/.aristoteles/aristoteles.db.
    readonly path: string
    // Opens the store of a dir; the scope closes it. With create (work init) a new file and a
    // new dir are made; without it, a dir with no store is refused ("no work store in <dir>").
    // A file that is not a store of this work is refused (OutsideFailed).
    readonly open: (
      dir: string,
      options: { readonly create: boolean },
    ) => Effect.Effect<DirStore, Refused | OutsideFailed | StoreDamaged, Scope.Scope>
  }
>()('aristoteles/Store') {}
