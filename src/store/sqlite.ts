// The live Store on bun:sqlite: open, the strict decode of each row
// (decodeRecorded), and the write in one BEGIN IMMEDIATE transaction with the rows of the reader
// tables (INSERT OR IGNORE). "database is locked" becomes OutsideFailed("the store is busy; run
// the same command again"). A file that is not a store of this work is refused.
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Effect, Exit, Layer, Schema, type Scope } from 'effect'
import { CONFIG } from '../config/config.ts'
import { OutsideFailed, type Refused, refuse, StoreDamaged } from '../domain/errors.ts'
import type { Author } from '../domain/actor.ts'
import {
  decodeRecorded,
  encodeAuthor,
  encodeEvent,
  type Event,
  memberOf,
  type Recorded,
} from '../domain/events.ts'
import { Env } from '../services/io.ts'
import { type DirStore, type ReaderRow, Store, type Written } from '../services/store.ts'
import { dbPath } from './path.ts'
import { EVENT_TABLE, FORMAT, READER_TABLES } from './schema.ts'

const noStore = (dir: string): Refused =>
  refuse(
    `no work store in ${dir}`,
    'run work in the dir that your parent named; ' +
      `a new dir starts with the person running work init next to its ${CONFIG}`,
  )

const busy = () =>
  new OutsideFailed({
    system: 'store',
    message: 'the store is busy; run the same command again',
    next: null,
  })

// One step on the file. "database is locked" means that another write held the file longer than
// the busy timeout; any other SQL error is a bug of this code.
const sql = <A>(step: () => A): Effect.Effect<A, OutsideFailed> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(step())
    } catch (error) {
      const locked = error instanceof Error && error.message.includes('database is locked')
      return locked ? Effect.fail(busy()) : Effect.die(error)
    }
  })

// An empty file is a new store; a file with user_version FORMAT is a store of this work.
type FileFormat = 'empty' | 'current' | 'other'

const formatOf = (db: Database): FileFormat => {
  const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()
  if (version?.user_version === FORMAT) return 'current'
  const tables = db.query('SELECT 1 FROM sqlite_master').get()
  return version?.user_version === 0 && !tables ? 'empty' : 'other'
}

const notAStore = (path: string) =>
  new OutsideFailed({
    system: 'store',
    message: `the file ${path} is not a store of this work`,
    next: 'to start fresh, move the file away; then work init makes a new store',
  })

// Makes a new file (the tables and the format), or checks that the file is a store of this work.
// A file that is not a database at all is also not a store of this work. An empty file is not
// filled by a command that may not create the store.
const prepare = (
  db: Database,
  path: string,
  dir: string,
  create: boolean,
): Effect.Effect<void, Refused | OutsideFailed> =>
  Effect.gen(function* () {
    const format = yield* sql(() => formatOf(db)).pipe(
      Effect.catchDefect((defect) => {
        const text = defect instanceof Error ? defect.message : ''
        return text.includes('not a database') ? Effect.fail(notAStore(path)) : Effect.die(defect)
      }),
    )
    if (format === 'other') return yield* notAStore(path)
    if (format === 'current') {
      // A reader table that came after this file was made (run_host, 2026-11-13) is made now:
      // reader rows come from the events, so the next act fills it.
      const names = [...READER_TABLES.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1])
      const have = yield* sql(() =>
        db
          .query("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((t) => (t as { readonly name: string }).name),
      )
      if (names.every((n) => n !== undefined && have.includes(n))) return
      yield* sql(() => db.transaction(() => db.exec(READER_TABLES)).immediate())
      return
    }
    if (!create) return yield* noStore(dir)
    yield* sql(() =>
      db
        .transaction(() => {
          db.exec(EVENT_TABLE + READER_TABLES)
          db.exec(`PRAGMA user_version = ${FORMAT}`)
        })
        .immediate(),
    )
  })

interface EventRow {
  readonly seq: number
  readonly at: string
  readonly author: string
  readonly record: string
  readonly member: string
  readonly event: string
}

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ')

// A stored row that is not JSON, or does not decode strictly, or whose record and member
// columns differ from its event, is a damaged store at its seq.
const decodeRow = (row: EventRow): Recorded => {
  let recorded: Recorded
  try {
    const { seq, at } = row
    const [author, event] = [JSON.parse(row.author), JSON.parse(row.event)]
    recorded = decodeRecorded({ seq, at, author, event })
  } catch (error) {
    if (!(error instanceof SyntaxError) && !Schema.isSchemaError(error)) throw error
    const issue = `the stored event does not decode: ${oneLine(error.message)}`
    throw new StoreDamaged({ seq: row.seq, issue })
  }
  const columns = `${row.record} ${row.member}`
  const event = `${recorded.event._tag} ${memberOf(recorded.event)}`
  if (columns !== event) {
    const issue = `the columns record and member say ${columns}, and the event is ${event}`
    throw new StoreDamaged({ seq: row.seq, issue })
  }
  return recorded
}

export const INSERT_EVENT =
  'INSERT INTO event (project, seq, at, author, record, member, event) VALUES (?, ?, ?, ?, ?, ?, ?)'

// The columns of one event: its author and the event as JSON, its record and its member.
export const eventColumns = (r: { readonly author: Author; readonly event: Event }) =>
  [
    JSON.stringify(encodeAuthor(r.author)),
    r.event._tag,
    memberOf(r.event),
    JSON.stringify(encodeEvent(r.event)),
  ] as const

// The store of one dir on an open file.
const dirStore = (db: Database, dir: string): DirStore => {
  const eventRows = db.query<EventRow, [string]>(
    'SELECT seq, at, author, record, member, event FROM event WHERE project = ? ORDER BY seq',
  )
  const events: Effect.Effect<ReadonlyArray<Recorded>, StoreDamaged> = Effect.suspend(() => {
    try {
      return Effect.succeed(eventRows.all(dir).map(decodeRow))
    } catch (error) {
      return error instanceof StoreDamaged ? Effect.fail(error) : Effect.die(error)
    }
  })

  const inserts = new Map<string, ReturnType<Database['query']>>()
  // A reader row is only added, never changed: a row that is there already stays as it is.
  const addRow = ([table, row]: ReaderRow) => {
    const keys = Object.keys(row)
    const columns = keys.map((k) => `"${k}"`).join(', ')
    const values = keys.map(() => '?').join(', ')
    const text = `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${values})`
    let insert = inserts.get(text)
    if (!insert) {
      insert = db.query(text)
      inserts.set(text, insert)
    }
    insert.run(...keys.map((k) => row[k] ?? null))
  }

  // The event at the next seq of the dir, and its rows; the first event also names the dir.
  const append = ({ draft, rows }: Written): number => {
    db.query('INSERT OR IGNORE INTO project (name, folder, made_at) VALUES (?, ?, ?)').run(
      dir,
      dir,
      draft.at,
    )
    const last = db
      .query<{ seq: number | null }, [string]>(
        'SELECT MAX(seq) AS seq FROM event WHERE project = ?',
      )
      .get(dir)
    const seq = (last?.seq ?? 0) + 1
    db.query(INSERT_EVENT).run(dir, seq, draft.at, ...eventColumns(draft))
    for (const row of rows) addRow(row)
    return seq
  }

  const write = <E>(
    build: (events: ReadonlyArray<Recorded>) => Effect.Effect<Written | null, E>,
  ): Effect.Effect<number | null, E | StoreDamaged | OutsideFailed> =>
    Effect.acquireUseRelease(
      sql(() => db.exec('BEGIN IMMEDIATE')),
      () =>
        Effect.gen(function* () {
          const written = yield* build(yield* events)
          const seq = written === null ? null : yield* sql(() => append(written))
          yield* sql(() => db.exec('COMMIT'))
          return seq
        }),
      // A refused build, a failed step or an interrupt leaves the file as it was.
      (_, exit) =>
        Effect.sync(() => {
          if (Exit.isFailure(exit) && db.inTransaction) db.exec('ROLLBACK')
        }),
    )

  return {
    dir,
    name: basename(dir),
    events,
    write,
    query: (text, ...params) => Effect.sync(() => db.query(text).all(...params) as never),
  }
}

const open = (
  path: string,
  dir: string,
  options: { readonly create: boolean },
): Effect.Effect<DirStore, Refused | OutsideFailed, Scope.Scope> =>
  Effect.gen(function* () {
    if (!existsSync(join(dir, CONFIG))) return yield* noStore(dir)
    if (!existsSync(path) && !options.create) return yield* noStore(dir)
    const db = yield* Effect.acquireRelease(
      sql(() => {
        mkdirSync(dirname(path), { recursive: true })
        const db = new Database(path)
        db.exec('PRAGMA busy_timeout = 5000')
        return db
      }),
      (db) => Effect.sync(() => db.close()),
    )
    yield* prepare(db, path, dir, options.create)
    const known = db.query('SELECT 1 FROM project WHERE name = ?').get(dir)
    if (!known && !options.create) return yield* noStore(dir)
    return dirStore(db, dir)
  })

export const StoreLive: Layer.Layer<Store, never, Env> = Layer.effect(
  Store,
  Effect.gen(function* () {
    const env = yield* Env
    const path = dbPath(env.vars)
    return { path, open: (dir, options) => open(path, dir, options) }
  }),
)
