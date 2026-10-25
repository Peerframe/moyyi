import type { DatabaseSync } from "node:sqlite";
import { PERSISTED_FORMAT_VERSION } from "../contracts/persisted/index.ts";

export const SCHEMA_VERSION = 2;
const APPLICATION_ID = 0x4d4f5959;

const SCHEMA_V1_SQL = `CREATE TABLE metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT;
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL,
          head_entry_id TEXT REFERENCES entries(id) DEFERRABLE INITIALLY DEFERRED
        ) STRICT;
        CREATE TABLE runs (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
          status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'interrupted'))
        ) STRICT;
        CREATE UNIQUE INDEX one_active_run ON runs(session_id) WHERE status = 'active';
        CREATE TABLE entries (
          ordinal INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
          session_id TEXT NOT NULL REFERENCES sessions(id),
          parent_id TEXT REFERENCES entries(id) DEFERRABLE INITIALLY DEFERRED,
          run_id TEXT REFERENCES runs(id), payload TEXT NOT NULL
        ) STRICT;
        CREATE INDEX entries_session ON entries(session_id, ordinal);
        CREATE TABLE effects (
          id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), call_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('intended', 'awaiting_approval', 'approved', 'denied',
            'started', 'succeeded', 'failed', 'cancelled', 'unknown')),
          payload TEXT NOT NULL, UNIQUE(run_id, call_id)
        ) STRICT;
        CREATE TABLE workspace_leases (
          workspace_root TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(id)
        ) STRICT;`;

const SNAPSHOT_SQL = `CREATE TABLE workspace_snapshots (
          ordinal INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
          effect_id TEXT NOT NULL UNIQUE REFERENCES effects(id),
          run_id TEXT NOT NULL REFERENCES runs(id),
          restore_of TEXT REFERENCES workspace_snapshots(id), payload TEXT NOT NULL
        ) STRICT;`;
const SCHEMA_SQL = `${SCHEMA_V1_SQL}\n${SNAPSHOT_SQL}`;

function validateSchema(db: DatabaseSync, sql: string): void {
  // Validate before migrating: adding a table must never repair missing prior guarantees.
  const expected = sql
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
  const actual = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'")
    .all()
    .map((row) => row.sql as string)
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("Unsupported or damaged database schema; refusing automatic repair");
  if (
    db.prepare("SELECT value FROM metadata WHERE key = 'persisted_format'").get()?.value !==
    PERSISTED_FORMAT_VERSION
  )
    throw new Error("Unsupported persisted format; a migration is required");
  if (
    db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length !== 0
  )
    throw new Error("Damaged database integrity; refusing automatic repair");
}

/** Schema migrations are separate from the version of the JSON records they contain. */
export function migrate(db: DatabaseSync, beforeCommit: () => void): void {
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  const app = db.prepare("PRAGMA application_id").get()?.application_id;
  if (version === 0 && app === 0) {
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'")
      .all();
    if (tables.length !== 0)
      throw new Error("Refusing to initialize a non-empty, unversioned database");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(SCHEMA_SQL);
      db.exec(`PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.prepare("INSERT INTO metadata VALUES ('persisted_format', ?)").run(
        PERSISTED_FORMAT_VERSION,
      );
      beforeCommit();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } else if (version === 1 && app === APPLICATION_ID) {
    validateSchema(db, SCHEMA_V1_SQL);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(SNAPSHOT_SQL);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      beforeCommit();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } else if (version !== SCHEMA_VERSION || app !== APPLICATION_ID) {
    throw new Error(`Unsupported database schema/application: ${String(version)}/${String(app)}`);
  }
  validateSchema(db, SCHEMA_SQL);
}
