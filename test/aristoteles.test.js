// aristoteles (Nanda, 2026-11-10): one SQLite file, and SQL keeps the links, so a task that ran
// under an old version still reaches that version's rules with a join.
import { describe, expect, test } from 'bun:test'
import { ok, project, reported, tokenIn } from './harness.js'
import { dbOf, panel, tables } from './outside.js'

const COST = 'add:\n  - { id: cost-first, says: Say what the problem costs., rules: [ { id: names-cost, says: "The introduction names the cost", checkedBy: linter } ] }\n'
const SEEN_EVIDENCE = '--evidence="the draft, its new standard | the linter can check its rule"'
// One act of a line of work log or of the time line, with no number and no time.
const act = (line) => line.replace(/^e\d+ \S+ /, '')

describe('aristoteles keeps the links in SQL', () => {
  test('a task under version 1 reaches the rules of version 1 after version 2 is official', async () => {
    const { p } = await reported()
    const sol = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    p.write('cost.yaml', COST)
    ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml`))
    ok(await p.nanda(`review d2 accept ${SEEN_EVIDENCE}`, 'accept'))
    const db = tables(p)
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

  // The tables are a reading of the acts, as the API is (the server replays the acts): each
  // table below holds the records that the panel of t1 and work log show, and no other row.
  test('the rows that the store holds are the records that a replay of the acts reads', async () => {
    const { p } = await reported()
    const t1 = await panel(p, 't1')
    const [tsd] = t1.directions
    const db = tables(p)
    // One dir in this store, so no row needs its project.
    const rows = (sql, ...args) => db.query(sql).all(...args)
    expect(rows('SELECT id, name, text, serves FROM task'))
      .toEqual([{ id: 't1', name: t1.name, text: t1.text, serves: null }])
    expect(rows('SELECT task, direction FROM task_direction')).toEqual([{ task: 't1', direction: tsd.id }])
    expect(rows('SELECT id, name, owner FROM direction')).toEqual([{ id: tsd.id, name: tsd.name, owner: tsd.owner }])
    expect(rows('SELECT id FROM version')).toEqual([{ id: tsd.version }])
    // The standards and the rules of that version.
    const standards = rows(`SELECT s.key AS id, s.says FROM version v
      JOIN draft_standard ds ON ds.draft = v.draft JOIN standard s ON s.id = ds.standard
      WHERE v.id = ? ORDER BY s.key`, tsd.version)
    expect(standards).toEqual(tsd.standards.map(({ id, says }) => ({ id, says })))
    const checks = rows(`SELECT s.key AS standard, r.key AS rule, r.says, r.checked_by FROM version v
      JOIN draft_standard ds ON ds.draft = v.draft JOIN standard s ON s.id = ds.standard
      JOIN standard_rule sr ON sr.standard = s.id JOIN rule r ON r.id = sr.rule
      WHERE v.id = ? ORDER BY s.key, r.key`, tsd.version)
    expect(checks).toEqual(tsd.standards.flatMap((x) => x.rules.map((r) =>
      ({ standard: x.id, rule: r.id, says: r.says, checked_by: r.checkedBy }))))
    expect(rows('SELECT id, assignment, output, at FROM result'))
      .toEqual(t1.results.map((r) => ({ id: r.id, assignment: r.by, output: r.output, at: r.at })))
    // Each assign of the time line: the person's has no parent.
    const assigns = t1.timeline.map((x) => act(x.line).match(/^(\S+) \(\w+\) assign (\S+) on (t\d+) -> (a\d+)$/))
      .filter(Boolean).map(([, by, role, task, id]) => ({ id, task, role, parent: by.startsWith('a') ? by : null }))
    expect(rows('SELECT id, task, role, parent FROM assignment ORDER BY id')).toEqual(assigns)
    // The person's accept of the first draft is the one review so far.
    const log = ok(await p.agent('log --last=100')).out.split('\n').map(act)
    const reviews = log.map((l) => l.match(/^(\S+) \(\w+\) review (\S+) (accept|reject).* -> (v\d+)/)).filter(Boolean)
      .map(([, by, of, decision, id]) => ({ id, of, decision: decision === 'accept' ? 'Accept' : 'Reject', by }))
    expect(reviews).toEqual([{ id: 'v1', of: 'd1', decision: 'Accept', by: 'Nanda' }])
    expect(rows('SELECT id, of, decision, by FROM review')).toEqual(reviews)
    db.close()
  })

  // The name of a dir is its folder name (Nanda, 2026-11-11); the store keys it by the full path.
  test('two folders with one name are two dirs, each with its own acts', async () => {
    const { p } = await reported()
    // Another folder named report-export, with the same aristoteles.yaml, on the same store.
    const copy = project()
    const env = { ARISTOTELES_DB: dbOf(p) }
    expect((await copy.run('log', { env })).err).toContain('no work store in <project>')
    expect(ok(await copy.run('init', { tty: true, env })).out)
      .toStartWith('store made for report-export in aristoteles')
    expect(ok(await copy.run('log', { env })).out.split('\n').map(act)).toEqual(['Nanda (terminal) config'])
    expect(ok(await p.agent('log --last=1')).out).toEndWith('a3 (agent) brief')
    // The store keys each dir by its full path.
    const db = tables(p)
    expect(db.query('SELECT name FROM project').all().map((x) => x.name).sort()).toEqual([p.dir, copy.dir].sort())
    db.close()
  })
})
