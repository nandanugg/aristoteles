// The SQL of the store (format 2). The reader tables are for the tests and for people with sqlite3.
// The acts are in the event table, one row per stored event: its author and the event as JSON of
// src/domain/events.ts, and beside them the record that it happens to and its member (Task, Opened;
// Review, Reject), so that a person with sqlite3 reads each kind of act with no JSON. The store
// writes the two from the event, and a read checks that they agree with it.

// PRAGMA user_version of a store that this code reads.
export const FORMAT = 2

export const EVENT_TABLE = `
CREATE TABLE IF NOT EXISTS event (
  project TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, author TEXT NOT NULL,
  record TEXT NOT NULL, member TEXT NOT NULL, event TEXT NOT NULL, PRIMARY KEY (project, seq));
`

export const READER_TABLES = `
CREATE TABLE IF NOT EXISTS project (name TEXT PRIMARY KEY, folder TEXT NOT NULL, made_at TEXT NOT NULL);
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
CREATE TABLE IF NOT EXISTS run (
  project TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, session TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS run_closed (
  project TEXT NOT NULL, run TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project, run));
CREATE TABLE IF NOT EXISTS run_task (
  project TEXT NOT NULL, run TEXT NOT NULL, task TEXT NOT NULL, PRIMARY KEY (project, run, task));
CREATE TABLE IF NOT EXISTS assignment_session (
  project TEXT NOT NULL, assignment TEXT NOT NULL, session TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (project, assignment, session));
CREATE TABLE IF NOT EXISTS task_draft (
  project TEXT NOT NULL, id TEXT NOT NULL, run TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, role TEXT NOT NULL,
  opened_as TEXT, at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS problem (
  project TEXT NOT NULL, id TEXT NOT NULL, task TEXT NOT NULL, stopped TEXT NOT NULL, says TEXT NOT NULL, by TEXT NOT NULL,
  at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS problem_fixed (
  project TEXT NOT NULL, problem TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project, problem));
CREATE TABLE IF NOT EXISTS terminal_event (
  project TEXT NOT NULL, on_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, tries INTEGER NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (project, on_id, at));
CREATE TABLE IF NOT EXISTS task_before (
  project TEXT NOT NULL, task TEXT NOT NULL, file TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (project, task, file));
CREATE TABLE IF NOT EXISTS result_file (
  project TEXT NOT NULL, result TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY (project, result, file));
CREATE TABLE IF NOT EXISTS words (
  project TEXT NOT NULL, place TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (project, place));
CREATE VIRTUAL TABLE IF NOT EXISTS words_search USING fts5(project UNINDEXED, place UNINDEXED, kind UNINDEXED, text);
CREATE TRIGGER IF NOT EXISTS words_indexed AFTER INSERT ON words BEGIN
  INSERT INTO words_search (project, place, kind, text) VALUES (new.project, new.place, new.kind, new.text);
END;
`
