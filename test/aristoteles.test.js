// aristoteles (Nanda, 2026-11-10): one SQLite file, and SQL keeps the links, so a task that ran
// under an old version still reaches that version's rules with a join.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rowsOf } from '../aristoteles.js'
import { replay } from '../state.js'
import { openStore } from '../store.js'
import { ok, reported, tokenIn } from './harness.js'

const COST = 'add:\n  - { id: cost-first, says: Say what the problem costs., rules: [ { id: names-cost, says: "The introduction names the cost", checkedBy: linter } ] }\n'
const SEEN_EVIDENCE = '--evidence="the draft, its new standard | the linter can check its rule"'
const dbOf = (p) => join(p.dir, '.work', 'aristoteles.db')

describe('aristoteles keeps the links in SQL', () => {
  test('a task under version 1 reaches the rules of version 1 after version 2 is official', async () => {
    const { p } = await reported()
    const sol = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    p.write('cost.yaml', COST)
    ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml`))
    ok(await p.nanda(`review d2 accept ${SEEN_EVIDENCE}`, 'accept'))
    const db = new Database(dbOf(p), { readonly: true })
    const rules = (version) => db.query(`
      SELECT DISTINCT r.key FROM result_version rv
      JOIN version v ON v.project = rv.project AND v.id = rv.version
      JOIN draft_standard ds ON ds.project = v.project AND ds.draft = v.draft
      JOIN standard_rule sr ON sr.project = ds.project AND sr.standard = ds.standard
      JOIN rule r ON r.project = sr.project AND r.id = sr.rule
      WHERE rv.result = 'r1' AND v.id = ? ORDER BY r.key`).all(version).map((x) => x.key)
    expect(rules('tsd-writing@1')).toEqual(['no-code-proof', 'no-ticket-ids', 'repeatable'])
    expect(db.query("SELECT number FROM version WHERE direction = 'tsd-writing' ORDER BY number").all().map((x) => x.number)).toEqual([1, 2])
    const used = db.query("SELECT t.name FROM task t JOIN result r ON r.project = t.project AND r.task = t.id JOIN result_version rv ON rv.project = r.project AND rv.result = r.id WHERE rv.version = 'tsd-writing@1'").all()
    expect(used.map((x) => x.name)).toEqual(['The Introduction'])
    db.close()
  })

  test('the rows that a replay of the acts makes are the rows that the store holds', async () => {
    const { p } = await reported()
    const store = openStore({ cwd: p.dir, env: { ARISTOTELES_DB: dbOf(p) } })
    try {
      const rows = rowsOf(replay(store.events()), store.project)
      const tables = [...new Set(rows.map(([table]) => table))]
      for (const table of tables) {
        const want = new Set(rows.filter(([t]) => t === table).map(([, row]) => JSON.stringify(Object.values(row).map((x) => x ?? null))))
        const have = store.query(`SELECT * FROM ${table} WHERE project = ?`, store.project).map((row) => JSON.stringify(Object.values(row)))
        expect({ table, rows: [...have].sort() }).toEqual({ table, rows: [...want].sort() })
      }
    } finally {
      store.close()
    }
  })

  test('two folders with one project name share no store', async () => {
    const { p } = await reported()
    const copy = mkdtempSync(join(tmpdir(), 'work-copy-'))
    cpSync(join(p.dir, 'work.yaml'), join(copy, 'work.yaml'))
    expect(() => openStore({ cwd: copy, env: { ARISTOTELES_DB: dbOf(p) } }, { create: true }))
      .toThrow(`the project report-export is in aristoteles for the folder ${p.dir}`)
  })
})
