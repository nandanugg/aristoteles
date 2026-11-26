import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Effect, Result, Schema, type Scope } from 'effect'
import { StoredEvent } from '../domain/project/events.ts'
import { EventNumber, Rationale, ReadPosition, refuse, type Of, type ProjectId, type Refusal } from '../domain/project/values.ts'
import { Env } from '../services/io.ts'
import type { Journal } from '../services/project.ts'
import { dbPath } from './path.ts'
import { PROJECT_APPLICATION_ID, PROJECT_EVENTS, PROJECT_FORMAT } from './schema.ts'

const eventJson = Schema.fromJsonString(StoredEvent)
const decode = Schema.decodeUnknownSync(eventJson, { onExcessProperty: 'error' })
const encode = Schema.encodeSync(eventJson)
const origin = ReadPosition.make(0)

class JournalError extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.why)
  }
}

const foreign = () => new JournalError(refuse('InvalidInput', Rationale.make(
  'The file is not a format 16 project journal. Choose a fresh database file.',
)))
const damaged = () => new JournalError(refuse('InvalidInput', Rationale.make(
  'The project journal has an invalid event row or a missing number.',
)))
const sql = <A>(operation: () => A): Effect.Effect<A, Refusal> => Effect.try({
  try: operation,
  catch: (error) => {
    if (error instanceof JournalError) return error.refusal
    if (error instanceof Error && error.message.includes('not a database')) return foreign().refusal
    return refuse('Unavailable', Rationale.make('The project journal could not complete the SQLite operation.'))
  },
})

const prepare = (db: Database, mode: 'Read' | 'Create'): void => {
  const { user_version } = db.query<{ user_version: number }, []>('PRAGMA user_version').get()!
  const { application_id } = db.query<{ application_id: number }, []>('PRAGMA application_id').get()!
  const tables = db.query<{ name: string }, []>('SELECT name FROM sqlite_master').all()
  if (user_version === PROJECT_FORMAT && application_id === PROJECT_APPLICATION_ID &&
      tables.some(({ name }) => name === 'project_event')) return
  if (mode === 'Read' || user_version !== 0 || application_id !== 0 || tables.length !== 0) throw foreign()
  db.exec(PROJECT_EVENTS)
  db.exec(`PRAGMA application_id = ${PROJECT_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${PROJECT_FORMAT}`)
}

const journal = (db: Database, id: Of<typeof ProjectId>): Journal => {
  const select = db.query<{ number: number; event: string }, [string, number]>(
    'SELECT number, event FROM project_event WHERE project = ? AND number > ? ORDER BY number',
  )
  const tail = db.query<{ number: number }, [string]>(
    'SELECT number FROM project_event WHERE project = ? ORDER BY number DESC LIMIT 1',
  )
  const hasPosition = db.query('SELECT 1 FROM project_event WHERE project = ? AND number = ?')
  const belongs = (event: StoredEvent) => event.line._tag !== 'Project' || event.line.id === id
  const eventsAfter = (after: Of<typeof ReadPosition>): readonly StoredEvent[] => {
    if (after > (tail.get(id)?.number ?? 0)) {
      throw new JournalError(refuse('Stale', Rationale.make('The journal does not contain that read position.')))
    }
    if (after > 0 && !hasPosition.get(id, after)) throw damaged()
    return select.all(id, after).map((row, index) => {
      let event: StoredEvent
      try {
        event = decode(row.event)
      } catch {
        throw damaged()
      }
      if (event.number !== row.number || event.number !== after + index + 1 || !belongs(event)) throw damaged()
      return event
    })
  }
  return {
    id,
    eventsAfter: (after) => sql(() => db.transaction(() => eventsAfter(after))()),
    transact: (edit) => sql(() => db.transaction(() => {
      const events = eventsAfter(origin)
      const next = (events.at(-1)?.number ?? 0) + 1
      if (!Schema.is(EventNumber)(next)) throw damaged()
      const result = edit(events, next)
      if (Result.isFailure(result)) throw new JournalError(result.failure)
      const { event } = result.success
      if (event.number !== next || !belongs(event) || !Schema.is(StoredEvent)(event)) throw damaged()
      db.query('INSERT INTO project_event (project, number, event) VALUES (?, ?, ?)').run(id, next, encode(event))
      return result.success
    }).immediate()),
  }
}

export const openProjectJournal = (
  id: Of<typeof ProjectId>, mode: 'Read' | 'Create',
): Effect.Effect<Journal, Refusal, Env | Scope.Scope> => Effect.gen(function* () {
  const path = dbPath((yield* Env).vars)
  const db = yield* Effect.acquireRelease(sql(() => {
    if (mode === 'Read' && !existsSync(path)) throw foreign()
    if (mode === 'Create') mkdirSync(dirname(path), { recursive: true })
    return new Database(path, { create: mode === 'Create', readonly: mode === 'Read' })
  }), (connection) => Effect.sync(() => connection.close()))
  yield* sql(() => {
    db.exec('PRAGMA busy_timeout = 5000')
    if (mode === 'Create') db.transaction(() => prepare(db, mode)).immediate()
    else prepare(db, mode)
  })
  return yield* sql(() => journal(db, id))
})
