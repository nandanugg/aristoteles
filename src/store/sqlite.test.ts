// The live store (P1, part b): create, write and read, a busy store, the refusals of open, a
// damaged row, and the files that it opens and the ones that it refuses.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer, Schema, type Scope } from 'effect'
import { refuse } from '../domain/errors.ts'
import { type Draft, Event } from '../domain/events.ts'
import { Env } from '../services/io.ts'
import { type DirStore, type ReaderRow, Store } from '../services/store.ts'
import { INSERT_EVENT, StoreLive } from './sqlite.ts'

// A dir with its aristoteles.yaml, and the path of a store file that does not exist yet.
const newDir = () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'store-')), 'report-export')
  mkdirSync(dir)
  writeFileSync(join(dir, 'aristoteles.yaml'), 'people: [Nanda]\n')
  return { dir, file: join(dir, '.work', 'aristoteles.db') }
}

// Runs one use of the store of a dir; the scope closes the file at the end.
const withStore = <A, E>(
  file: string,
  dir: string,
  create: boolean,
  use: (store: DirStore) => Effect.Effect<A, E, Scope.Scope>,
): Effect.Effect<A, unknown> =>
  Effect.gen(function* () {
    const store = yield* Store
    return yield* use(yield* store.open(dir, { create }))
  }).pipe(
    Effect.scoped,
    Effect.provide(
      StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: { ARISTOTELES_DB: file } }))),
    ),
  )
const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect)
const failure = (effect: Effect.Effect<unknown, unknown>) => Effect.runPromise(Effect.flip(effect))

const event = Schema.decodeUnknownSync(Event)
// An agent: it writes both kinds of these tests (events.ts WRITTEN_BY).
const AGENT = { _tag: 'Agent', assignment: 'a1' as never } as const
const draftOf = (minute: number, data: unknown): Draft => ({
  at: `2026-10-25T09:${String(minute).padStart(2, '0')}:00.000Z` as Draft['at'],
  author: AGENT,
  event: event(data),
})
const SOURCE = {
  _tag: 'Source',
  create: { _tag: 'Moved', source: { _tag: 'Outside', name: 'page', revision: 'v4' } },
}
const freed = (a: string) => ({ _tag: 'Assignment', id: a, move: { _tag: 'Freed' } })
const written = (draft: Draft, rows: ReadonlyArray<ReaderRow> = []) =>
  Effect.succeed({ draft, rows })

const tableOf = (file: string, sql: string) => {
  const db = new Database(file, { readonly: true })
  try {
    return db.query(sql).all()
  } finally {
    db.close()
  }
}

describe('a new store', () => {
  test('create makes the file and the dir; a write appends at the next seq', async () => {
    const { dir, file } = newDir()
    const task = {
      project: dir,
      id: 't1',
      name: 'Intro',
      text: 'Write it.',
      serves: null,
      owner: 'Nanda',
    }
    const seqs = await run(
      withStore(file, dir, true, (store) =>
        Effect.gen(function* () {
          const first = yield* store.write(() => written(draftOf(1, SOURCE), [['task', task]]))
          // The second write sees the first event, and adds a row that is there already.
          const second = yield* store.write((events) =>
            written(draftOf(2, freed(`a${events.length}`)), [['task', task]]),
          )
          return [first, second]
        }),
      ),
    )
    expect(seqs).toEqual([1, 2])
    const events = await run(withStore(file, dir, false, (store) => store.events))
    expect<unknown>(events).toEqual([
      { seq: 1, at: '2026-10-25T09:01:00.000Z', author: AGENT, event: SOURCE },
      { seq: 2, at: '2026-10-25T09:02:00.000Z', author: AGENT, event: freed('a1') },
    ])
    // The record and the member of each event are columns of their own.
    expect(tableOf(file, 'SELECT seq, record, member FROM event')).toEqual([
      { seq: 1, record: 'Source', member: 'Moved' },
      { seq: 2, record: 'Assignment', member: 'Freed' },
    ])
    expect(tableOf(file, 'SELECT * FROM project')).toEqual([
      { name: dir, folder: dir, made_at: '2026-10-25T09:01:00.000Z' },
    ])
    expect(tableOf(file, 'SELECT * FROM task')).toEqual([task])
    expect(tableOf(file, 'PRAGMA user_version')).toEqual([{ user_version: 2 }])
    const found = await run(
      withStore(file, dir, false, (store) =>
        store.query('SELECT id, name FROM task WHERE project = ?', dir),
      ),
    )
    expect(found).toEqual([{ id: 't1', name: 'Intro' }])
  })

  test('a build that writes nothing stores nothing', async () => {
    const { dir, file } = newDir()
    const seq = await run(
      withStore(file, dir, true, (store) => store.write(() => Effect.succeed(null))),
    )
    expect(seq).toBeNull()
    expect(tableOf(file, 'SELECT * FROM event')).toEqual([])
    expect(tableOf(file, 'SELECT * FROM project')).toEqual([])
  })

  test('a refused build, and a step that fails after the event, change nothing', async () => {
    const { dir, file } = newDir()
    await run(withStore(file, dir, true, (store) => store.write(() => written(draftOf(1, SOURCE)))))
    const refused = await failure(
      withStore(file, dir, false, (store) =>
        store.write(() => Effect.fail(refuse('t9 is closed'))),
      ),
    )
    expect(refused).toMatchObject({ _tag: 'Refused', message: 't9 is closed' })
    // A row for a table that does not exist fails after the event is in: a bug, rolled back.
    const broken = withStore(file, dir, false, (store) =>
      store.write(() => written(draftOf(2, SOURCE), [['no_such_table', { project: dir }]])),
    )
    await expect(Effect.runPromise(broken)).rejects.toThrow('no such table: no_such_table')
    expect(tableOf(file, 'SELECT seq FROM event')).toEqual([{ seq: 1 }])
  })
})

describe('open refuses a dir with no store', () => {
  const words = (dir: string) => ({
    _tag: 'Refused',
    message: `no work store in ${dir}`,
    next:
      'run work in the dir that your parent named; ' +
      'a new dir starts with the person running work init next to its aristoteles.yaml',
  })

  test('no file, a file with no such dir, and a dir with no aristoteles.yaml', async () => {
    const { dir, file } = newDir()
    expect(await failure(withStore(file, dir, false, () => Effect.void))).toMatchObject(words(dir))
    const other = newDir()
    await run(withStore(file, other.dir, true, (s) => s.write(() => written(draftOf(1, SOURCE)))))
    expect(await failure(withStore(file, dir, false, () => Effect.void))).toMatchObject(words(dir))
    const bare = join(mkdtempSync(join(tmpdir(), 'store-')), 'bare')
    mkdirSync(bare)
    expect(await failure(withStore(file, bare, true, () => Effect.void))).toMatchObject(words(bare))
  })
})

describe('the files of a store', () => {
  const NOT_A_STORE = (file: string) => ({
    _tag: 'OutsideFailed',
    system: 'store',
    message: `the file ${file} is not a store of this work`,
    next: 'to start fresh, move the file away; then work init makes a new store',
  })
  // A file at the path of the store, made by the test.
  const fileWith = (make: (file: string) => void) => {
    const { dir, file } = newDir()
    mkdirSync(join(dir, '.work'))
    make(file)
    return { dir, file }
  }
  const sqlite = (sql: string) => (file: string) => {
    const db = new Database(file)
    db.exec(sql)
    db.close()
  }

  test('an empty file becomes a new store', async () => {
    const { dir, file } = fileWith((f) => writeFileSync(f, ''))
    const write = (n: number) => (s: DirStore) => s.write(() => written(draftOf(n, SOURCE)))
    const seq = await run(withStore(file, dir, true, write(1)))
    expect(seq).toBe(1)
    expect(tableOf(file, 'PRAGMA user_version')).toEqual([{ user_version: 2 }])
  })

  test('an empty file is not filled by a command that does not create', async () => {
    const { dir, file } = fileWith((f) => writeFileSync(f, ''))
    expect(await failure(withStore(file, dir, false, () => Effect.void))).toMatchObject({
      _tag: 'Refused',
      message: `no work store in ${dir}`,
    })
    expect(tableOf(file, 'SELECT name FROM sqlite_master')).toEqual([])
  })

  test('a file of this format opens again, and keeps its events', async () => {
    const { dir, file } = newDir()
    await run(withStore(file, dir, true, (s) => s.write(() => written(draftOf(1, SOURCE)))))
    const events = await run(withStore(file, dir, false, (s) => s.events))
    expect(events.length).toBe(1)
    const seq = await run(
      withStore(file, dir, true, (s) => s.write(() => written(draftOf(2, SOURCE)))),
    )
    expect(seq).toBe(2)
  })

  test.each([
    ['a text file', (f: string) => writeFileSync(f, 'this is not a database\n'.repeat(20))],
    ['a database of the old work (a table act)', sqlite('CREATE TABLE act (seq INTEGER)')],
    ['a database of another program', sqlite('CREATE TABLE notes (text TEXT)')],
    ['a database of another format', sqlite('PRAGMA user_version = 7')],
    ['a database of format 1 with tables', sqlite('CREATE TABLE event (x); PRAGMA user_version = 1')],
  ])('%s is refused, with the way to start fresh, and is left as it was', async (_name, make) => {
    const { dir, file } = fileWith(make)
    const before = await Bun.file(file).arrayBuffer()
    for (const create of [true, false]) {
      expect(await failure(withStore(file, dir, create, () => Effect.void))).toMatchObject(
        NOT_A_STORE(file),
      )
    }
    expect(new Uint8Array(await Bun.file(file).arrayBuffer())).toEqual(new Uint8Array(before))
  })
})

describe('a stored event that does not decode', () => {
  test('is a damaged store at its seq', async () => {
    const { dir, file } = newDir()
    await run(withStore(file, dir, true, (store) => store.write(() => written(draftOf(1, SOURCE)))))
    const db = new Database(file)
    const agent = JSON.stringify({ _tag: 'Agent', assignment: 'a1' })
    const at = '2026-10-25T09:02:00.000Z'
    db.run(INSERT_EVENT, [dir, 2, at, agent, 'Assignment', 'Freed', JSON.stringify(freed('b1'))])
    db.close()
    const damage = (await failure(withStore(file, dir, false, (store) => store.events))) as {
      readonly _tag: string
      readonly seq: number
      readonly issue: string
    }
    expect(damage).toMatchObject({ _tag: 'StoreDamaged', seq: 2 })
    // A move and a creation of one record share its tag: the words say why each one fails.
    expect(damage.issue).toStartWith('the stored event does not decode: ')
    expect(damage.issue).toContain('Expected a string matching the RegExp ^a\\d+$ at ["event"]["id"]')
  })

  test('a row whose record and member columns differ from its event is damaged too', async () => {
    const { dir, file } = newDir()
    await run(withStore(file, dir, true, (store) => store.write(() => written(draftOf(1, SOURCE)))))
    const db = new Database(file)
    const [person, at] = [JSON.stringify(AGENT), '2026-10-25T09:02:00.000Z']
    const data = JSON.stringify(freed('a1'))
    db.run(INSERT_EVENT, [dir, 2, at, person, 'Assignment', 'Finished', data])
    db.close()
    expect(await failure(withStore(file, dir, false, (store) => store.events))).toEqual(
      expect.objectContaining({
        _tag: 'StoreDamaged',
        seq: 2,
        issue:
          'the columns record and member say Assignment Finished, ' +
          'and the event is Assignment Freed',
      }),
    )
  })
})

describe('a busy store', () => {
  test('a write that waits past the busy timeout fails; the next one goes in', async () => {
    const { dir, file } = newDir()
    await run(withStore(file, dir, true, (store) => store.write(() => written(draftOf(1, SOURCE)))))
    const other = new Database(file)
    other.exec('BEGIN IMMEDIATE')
    const busy = await failure(
      withStore(file, dir, false, (store) => store.write(() => written(draftOf(2, SOURCE)))),
    )
    expect(busy).toMatchObject({
      _tag: 'OutsideFailed',
      system: 'store',
      message: 'the store is busy; run the same command again',
    })
    other.exec('ROLLBACK')
    other.close()
    const seq = await run(
      withStore(file, dir, false, (store) => store.write(() => written(draftOf(3, SOURCE)))),
    )
    expect(seq).toBe(2)
  }, 20000)
})
