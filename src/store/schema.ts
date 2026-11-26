// The SQL of the store (format 10). The reader tables are for the tests and for people with sqlite3.
// The acts are in the event table, one row per stored event: its author and the event as JSON of
// src/domain/events.ts, and beside them the record that it happens to and its member (Revision,
// Drafted; Review, Reject), so that a person with sqlite3 reads each kind of act with no JSON.
// The store writes the two from the event, and a read checks that they agree with it. act is the
// id of a Work.Acted act (null for every other event): a second copy of an act id cannot be
// stored.

// PRAGMA user_version of a store that this code reads.
export const FORMAT = 10

export const EVENT_TABLE = `
CREATE TABLE IF NOT EXISTS event (
  project TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, author TEXT NOT NULL,
  record TEXT NOT NULL, member TEXT NOT NULL, event TEXT NOT NULL, act TEXT,
  PRIMARY KEY (project, seq));
CREATE UNIQUE INDEX IF NOT EXISTS event_act ON event (project, act);
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
CREATE TABLE IF NOT EXISTS answer (
  project TEXT NOT NULL, draft TEXT NOT NULL, answers TEXT NOT NULL, PRIMARY KEY (project, draft, answers));
CREATE TABLE IF NOT EXISTS review (
  project TEXT NOT NULL, id TEXT NOT NULL, of TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT,
  by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project, id));
CREATE TABLE IF NOT EXISTS item_version (
  project TEXT NOT NULL, item TEXT NOT NULL, version INTEGER NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY (project, item, version));
CREATE TABLE IF NOT EXISTS words (
  project TEXT NOT NULL, place TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (project, place));
CREATE VIRTUAL TABLE IF NOT EXISTS words_search USING fts5(project UNINDEXED, place UNINDEXED, kind UNINDEXED, text);
CREATE TRIGGER IF NOT EXISTS words_indexed AFTER INSERT ON words BEGIN
  INSERT INTO words_search (project, place, kind, text) VALUES (new.project, new.place, new.kind, new.text);
END;
`

// The new Project entry points use their own format until the CLI and page cut over together.
export const PROJECT_FORMAT = 16
export const PROJECT_APPLICATION_ID = 0x41524953

export const PROJECT_EVENTS = `
CREATE TABLE project_event (
  project TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  event TEXT NOT NULL,
  PRIMARY KEY (project, number)
) STRICT, WITHOUT ROWID;
`
