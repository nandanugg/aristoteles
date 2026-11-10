// The store: aristoteles, one SQLite file for every project on this machine
// (~/.aristoteles/aristoteles.db, or ARISTOTELES_DB). A project is the name in its work.yaml.
// Every write is one transaction that replays the project's acts, checks the new act against
// that state, appends it, and adds the rows of the records that it made (aristoteles.js).

import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { SCHEMA } from './aristoteles.js'

export const dbPath = (env = {}) => env.ARISTOTELES_DB ?? join(homedir(), '.aristoteles', 'aristoteles.db')

const noStore = (dir) => Object.assign(new Error(`no work store in ${dir}`), {
  next: 'run work in the project folder that your parent named; a new project starts with the person running work init',
})

// The project of a folder: the name in its work.yaml.
function projectOf(dir) {
  const path = join(dir, 'work.yaml')
  if (!existsSync(path)) throw noStore(dir)
  let name
  try {
    name = Bun.YAML.parse(readFileSync(path, 'utf8'))?.project
  } catch {}
  if (typeof name !== 'string') throw noStore(dir)
  return name
}

export function openStore({ cwd, env }, { create = false } = {}) {
  const project = projectOf(cwd)
  const path = dbPath(env)
  if (!existsSync(path) && !create) throw noStore(cwd)
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA)
  const known = db.query('SELECT folder FROM project WHERE name = ?').get(project)
  if (!known && !create) {
    db.close()
    throw noStore(cwd)
  }
  // One name is one project: a second folder with the same name gets no store of its own.
  if (known && known.folder !== cwd) {
    db.close()
    throw Object.assign(new Error(`the project ${project} is in aristoteles for the folder ${known.folder}`), {
      next: `run work in ${known.folder}, or give this project another name in its work.yaml`,
    })
  }
  const read = () =>
    db.query('SELECT seq AS id, at, who, channel, type, data FROM act WHERE project = ? ORDER BY seq').all(project)
      .map((row) => ({ ...row, data: JSON.parse(row.data) }))
  const insert = new Map()
  const addRow = (table, row) => {
    const keys = Object.keys(row)
    const sql = `INSERT OR IGNORE INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    if (!insert.has(sql)) insert.set(sql, db.query(sql))
    insert.get(sql).run(...keys.map((k) => row[k] ?? null))
  }
  return {
    project,
    events: read,
    // Runs check(events) and appends what it returns, in one BEGIN IMMEDIATE transaction,
    // so two agents cannot both pass a check that only one of them may pass. rows() gives
    // the rows of the state after the act.
    write(check, rows = (project) => []) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const event = check(read())
        let id
        if (event) {
          if (!known) db.query('INSERT OR IGNORE INTO project (name, folder, made_at) VALUES (?, ?, ?)').run(project, cwd, event.at)
          const last = db.query('SELECT MAX(seq) AS seq FROM act WHERE project = ?').get(project)
          id = (last?.seq ?? 0) + 1
          db.query('INSERT INTO act (project, seq, at, who, channel, type, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(project, id, event.at, event.who, event.channel, event.type, JSON.stringify(event.data))
          for (const [table, row] of rows(project)) addRow(table, row)
        }
        db.exec('COMMIT')
        return id
      } catch (error) {
        db.exec('ROLLBACK')
        if (String(error.message).includes('database is locked')) {
          throw new Error('the store is busy; run the same command again')
        }
        throw error
      }
    },
    query: (sql, ...params) => db.query(sql).all(...params),
    close: () => db.close(),
  }
}
