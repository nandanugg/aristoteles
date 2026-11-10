// aristoteles: the tables that hold every record of the work, with their links, so that a
// query (or a person with sqlite3) goes from a task to the version that it used, to that
// version's standards and rules. The act log (table act) is the order of the acts; the engine
// replays it to check each new act. The tables below are written in the same transaction as
// the act, and a row is only added, never changed: a close, a finish, or a new version is a
// new row.

import { kind } from './engine.js'
import { idOf, versionId } from './state.js'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS project (name TEXT PRIMARY KEY, folder TEXT NOT NULL, made_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS act (
  project TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, who TEXT NOT NULL,
  channel TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (project, seq));
CREATE TABLE IF NOT EXISTS direction (
  project TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL, principles TEXT,
  PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS draft (
  project TEXT NOT NULL, id TEXT NOT NULL, direction TEXT NOT NULL, base TEXT, says TEXT NOT NULL,
  by TEXT NOT NULL, why TEXT, at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS standard (
  project TEXT NOT NULL, id TEXT NOT NULL, key TEXT NOT NULL, says TEXT NOT NULL, "where" TEXT,
  PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS rule (
  project TEXT NOT NULL, id TEXT NOT NULL, key TEXT NOT NULL, says TEXT NOT NULL, checked_by TEXT,
  PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS draft_standard (
  project TEXT NOT NULL, draft TEXT NOT NULL, standard TEXT NOT NULL, PRIMARY KEY (project, draft, standard));
CREATE TABLE IF NOT EXISTS standard_rule (
  project TEXT NOT NULL, standard TEXT NOT NULL, rule TEXT NOT NULL, PRIMARY KEY (project, standard, rule));
CREATE TABLE IF NOT EXISTS version (
  project TEXT NOT NULL, id TEXT NOT NULL, direction TEXT NOT NULL, number INTEGER NOT NULL,
  draft TEXT, source TEXT, at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS suggestion (
  project TEXT NOT NULL, id TEXT NOT NULL, about TEXT, says TEXT NOT NULL, by TEXT NOT NULL,
  at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS answer (
  project TEXT NOT NULL, draft TEXT NOT NULL, answers TEXT NOT NULL, PRIMARY KEY (project, draft, answers));
CREATE TABLE IF NOT EXISTS review (
  project TEXT NOT NULL, id TEXT NOT NULL, of TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT,
  breaks TEXT, by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS evidence (
  project TEXT NOT NULL, review TEXT NOT NULL, n INTEGER NOT NULL, rule TEXT, place TEXT, says TEXT,
  PRIMARY KEY (project, review, n));
CREATE TABLE IF NOT EXISTS task (
  project TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, serves TEXT,
  owner TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS task_direction (
  project TEXT NOT NULL, task TEXT NOT NULL, direction TEXT NOT NULL, PRIMARY KEY (project, task, direction));
CREATE TABLE IF NOT EXISTS task_closed (
  project TEXT NOT NULL, task TEXT NOT NULL, reason TEXT, replaced_by TEXT, at TEXT,
  PRIMARY KEY (project, task));
CREATE TABLE IF NOT EXISTS assignment (
  project TEXT NOT NULL, id TEXT NOT NULL, task TEXT NOT NULL, role TEXT NOT NULL, parent TEXT,
  at TEXT, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS assignment_finished (
  project TEXT NOT NULL, assignment TEXT NOT NULL, PRIMARY KEY (project, assignment));
CREATE TABLE IF NOT EXISTS brief (
  project TEXT NOT NULL, assignment TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY (project, assignment, version));
CREATE TABLE IF NOT EXISTS result (
  project TEXT NOT NULL, id TEXT NOT NULL, task TEXT NOT NULL, assignment TEXT NOT NULL, output TEXT NOT NULL,
  at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS result_version (
  project TEXT NOT NULL, result TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY (project, result, version));
CREATE TABLE IF NOT EXISTS evaluation (
  project TEXT NOT NULL, id TEXT NOT NULL, answers TEXT NOT NULL, wrong TEXT NOT NULL, why TEXT NOT NULL,
  improve TEXT NOT NULL, level TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS words (
  project TEXT NOT NULL, place TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (project, place));
CREATE VIRTUAL TABLE IF NOT EXISTS words_search USING fts5(project UNINDEXED, place UNINDEXED, kind UNINDEXED, text);
CREATE TRIGGER IF NOT EXISTS words_indexed AFTER INSERT ON words BEGIN
  INSERT INTO words_search (project, place, kind, text) VALUES (new.project, new.place, new.kind, new.text);
END;
`

// Who did an act: an assignment by its id, a person by name, a model run outside any task by
// its name and run.
const actorText = (actor) => (actor?.run === undefined ? actor?.name : `${actor.name} run ${actor.run}`)
const byText = (state, by) => (by?.[kind] === 'Assignment' ? idOf(state, by) : actorText(by?.actor ?? by))

// A standard and a rule keep one row while the drafts keep the same object: the row id is the
// draft that made it first, then its key (d1/facts-not-proof, d1/facts-not-proof/no-code-proof).
export function entryIds(state) {
  const ids = new Map()
  for (const draft of state.engine?.read.drafts ?? []) {
    const did = idOf(state, draft) ?? `${draft.of.id}@config`
    for (const s of draft.standards) {
      if (!ids.has(s)) ids.set(s, `${did}/${s.id}`)
      for (const r of s.rules ?? []) if (!ids.has(r)) ids.set(r, `${ids.get(s)}/${r.id}`)
    }
  }
  return ids
}

// Every row of the state, as [table, row]. The store adds the rows that it does not have.
export function rowsOf(state, project) {
  const read = state.engine?.read
  if (!read) return []
  const rows = []
  const add = (table, row) => rows.push([table, { project, ...row }])
  const entry = entryIds(state)
  const text = (place, kindName, words) => words && add('words', { place, kind: kindName, text: words })
  const directions = new Set([...read.directions, ...read.drafts.map((x) => x.of)])
  for (const d of directions) {
    if (!d.id) continue
    add('direction', { id: d.id, name: d.name, owner: d.owner?.name ?? String(d.owner), principles: (d.from ?? []).join(', ') })
  }
  // The draft of a config file has no CLI id: its row id is <direction>@config.
  const draftId = (x) => idOf(state, x) ?? (x.of.id ? `${x.of.id}@config` : undefined)
  for (const x of read.drafts) {
    const did = draftId(x)
    if (!did) continue
    add('draft', { id: did, direction: x.of.id, base: x.base ? versionId(x.base) : null, says: x.says, by: byText(state, x.by), why: x.why ?? null, at: x.when })
    text(did, 'draft', x.says)
    for (const y of x.answers) add('answer', { draft: did, answers: idOf(state, y) })
    for (const s of x.standards) {
      add('standard', { id: entry.get(s), key: s.id, says: s.says, where: s.where ? JSON.stringify(s.where) : null })
      add('draft_standard', { draft: did, standard: entry.get(s) })
      text(entry.get(s), 'standard', s.says)
      for (const r of s.rules ?? []) {
        add('rule', { id: entry.get(r), key: r.id, says: r.says, checked_by: r.checkedBy?.role ?? null })
        add('standard_rule', { standard: entry.get(s), rule: entry.get(r) })
        text(entry.get(r), 'rule', r.says)
      }
    }
  }
  for (const d of read.directions) {
    for (const v of d.versions) {
      add('version', { id: versionId(v), direction: d.id, number: v.number, draft: draftId(v.revision) ?? null, source: v.source ? `${v.source.repo} ${v.source.path}@${v.source.commit}` : null, at: v.when })
    }
  }
  for (const y of read.suggestions) {
    const sid = idOf(state, y)
    const about = !y.about ? null : y.about[kind] === 'Direction' ? y.about.id : entry.get(y.about) ?? y.about.id
    add('suggestion', { id: sid, about, says: y.says, by: byText(state, y.by), at: y.when })
    text(sid, 'suggestion', y.says)
  }
  for (const v of read.reviews) {
    const vid = idOf(state, v)
    if (!vid) continue
    add('review', { id: vid, of: idOf(state, v.of) ?? (v.of?.id ?? ''), decision: v.decision, reason: v.reason ?? null,
      breaks: v.breaks ? entry.get(v.breaks) ?? v.breaks.id : null, by: byText(state, v.by), at: v.when })
    if (v.reason) text(vid, 'reason', v.reason)
    ;(v.evidence ?? []).forEach((e, n) => add('evidence', { review: vid, n, rule: e.meets ? entry.get(e.meets) ?? e.meets.id : null, place: e.at ?? null, says: e.says ?? null }))
  }
  for (const t of read.tasks) {
    const tid = idOf(state, t)
    add('task', { id: tid, name: t.name, text: t.aiDescription?.text ?? t.humanDescription ?? '', serves: t.serves ? idOf(state, t.serves) : null, owner: t.owner?.name ?? '' })
    for (const d of t.aiDescription?.directions ?? []) add('task_direction', { task: tid, direction: d.id })
    if (t.closed) add('task_closed', { task: tid, reason: t.closed.reason ?? null, replaced_by: t.closed.replacedBy ? idOf(state, t.closed.replacedBy) : null, at: t.closed.when ?? null })
  }
  for (const a of read.assignments) {
    const aid = idOf(state, a)
    add('assignment', { id: aid, task: idOf(state, a.task), role: a.role.role, parent: a.parent ? idOf(state, a.parent) : null, at: a.when ?? null })
    if (a.finished) add('assignment_finished', { assignment: aid })
    for (const v of a.under ?? []) if (v) add('brief', { assignment: aid, version: versionId(v) })
  }
  for (const r of read.results) {
    const rid = idOf(state, r)
    add('result', { id: rid, task: idOf(state, r.task), assignment: idOf(state, r.by), output: r.output, at: r.when })
    for (const v of r.under ?? []) if (v) add('result_version', { result: rid, version: versionId(v) })
  }
  for (const e of read.evaluations) {
    const eid = idOf(state, e)
    add('evaluation', { id: eid, answers: idOf(state, e.answers) ?? '', wrong: e.wrong, why: e.why, improve: e.improve.join('\n'), level: e.level, by: byText(state, e.by), at: e.when })
  }
  return rows
}
