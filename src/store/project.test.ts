import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Effect } from 'effect'
import { ReadPosition } from '../../core/schema/project.ts'
import { readPosition } from '../../core/state/project.ts'
import { create, open, staffInput, withJournal } from './project.probe.ts'
import { promptDirection, resultInput, toWorking } from './task.probe.ts'
import { PROJECT_FORMAT } from './schema.ts'

const start = ReadPosition.make(0)
const query = (path: string, action: (db: Database) => void) => {
  const db = new Database(path)
  try { action(db) } finally { db.close() }
}

test('a missing journal stays missing in read mode and fresh creation uses format 22', () => withJournal(async (path) => {
  expect(await Effect.runPromise(Effect.scoped(Effect.result(open(path, 'Read'))))).toMatchObject({
    _tag: 'Failure', failure: { code: 'InvalidInput' },
  })
  expect(existsSync(path)).toBe(false)
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    expect(yield* journal.eventsAfter(start)).toEqual([])
    expect(Number((yield* create(journal)).event.number)).toBe(1)
  })))
  query(path, (db) => expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: PROJECT_FORMAT }))
}))

test.each([
  ['old store', 'CREATE TABLE event (seq); PRAGMA user_version = 10'],
  ['previous project format', 'PRAGMA user_version = 21'],
  ['foreign SQLite database', 'CREATE TABLE unrelated (row)'],
  ['foreign matching version', 'CREATE TABLE project_event (row); PRAGMA user_version = 22'],
  ['regular file', ''],
])('refuses a foreign or old journal before modifying it: %s', (_name, sql) => withJournal(async (path) => {
  if (sql) query(path, (db) => db.exec(sql))
  else writeFileSync(path, 'regular file contents')
  const before = readFileSync(path)
  const outcome = await Effect.runPromise(Effect.scoped(Effect.result(open(path))))
  expect(outcome).toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidInput' } })
  expect(readFileSync(path)).toEqual(before)
}))

test('write allocation is per project even with interleaved commits in one file', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const first = yield* open(path)
    const other = yield* open(path, 'Create', new URL('other/', first.directory.href + '/'))
    const working = yield* toWorking(first)
    const second = yield* create(other)
    const report = yield* staffInput(first, resultInput(readPosition(working.state)))
    expect([Number(second.event.number), Number(report.event.number)]).toEqual([1, working.event.number + 1])
    expect((yield* first.eventsAfter(start)).map((event) => Number(event.number))).toEqual(Array.from({ length: report.event.number }, (_, index) => index + 1))
    expect(yield* other.eventsAfter(start)).toEqual([second.event])
  }))),
))

test('a SQLite append failure rolls back and leaves the report retryable', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const input = resultInput(readPosition(working.state))
    query(path, (db) => db.exec(
      `CREATE TRIGGER interrupted BEFORE INSERT ON project_event
       BEGIN SELECT RAISE(ABORT, 'lost write'); END;`,
    ))
    const failed = yield* Effect.result(staffInput(journal, input))
    expect(failed).toMatchObject({ _tag: 'Failure', failure: { code: 'Unavailable' } })
    expect(yield* journal.eventsAfter(readPosition(working.state))).toEqual([])
    query(path, (db) => db.exec('DROP TRIGGER interrupted'))
    const retried = yield* staffInput(journal, input)
    expect(Number(retried.event.number)).toBe(working.event.number + 1)
  }))),
))

test.each([
  ['invalid JSON', "UPDATE project_event SET event = 'bad json' WHERE number = 2"],
  ['missing number', 'DELETE FROM project_event WHERE number = 2'],
  ['row and envelope disagree', "UPDATE project_event SET event = json_set(event, '$.number', 4) WHERE number = 3"],
  ['singleton carries a key', "UPDATE project_event SET event = json_set(event, '$.key', 'project:first') WHERE number = 1"],
])('refuses corruption on read and before a later write: %s', (_name, sql) => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    query(path, (db) => db.exec(sql))
    const reopened = yield* open(path, 'Read')
    const read = yield* Effect.result(reopened.eventsAfter(start))
    const write = yield* Effect.result(staffInput(journal, resultInput(readPosition(working.state))))
    expect([read, write]).toEqual([
      expect.objectContaining({ _tag: 'Failure', failure: expect.objectContaining({ code: 'InvalidInput' }) }),
      expect.objectContaining({ _tag: 'Failure', failure: expect.objectContaining({ code: 'InvalidInput' }) }),
    ])
  }))),
))

test('a stored rule must carry its known breaks', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    yield* toWorking(journal, promptDirection)
    query(path, (db) => {
      const result = db.query(`
        UPDATE project_event
        SET event = json_remove(event, '$.input.value.standards[0].rules[0].knownBreaks')
        WHERE json_type(event, '$.input.value.standards[0].rules[0].knownBreaks') = 'array'
      `).run()
      expect(result.changes).toBeGreaterThan(0)
    })
    const reopened = yield* open(path, 'Read')
    expect(yield* Effect.result(reopened.eventsAfter(start))).toMatchObject({
      _tag: 'Failure', failure: { code: 'InvalidInput' },
    })
  }))),
))
