import type { DatabaseSync } from "node:sqlite";
import {
  type EffectRecord,
  PERSISTED_FORMAT_VERSION,
  type TranscriptEntry,
} from "../contracts/persisted/index.ts";
import { MATERIALS_SQL } from "./materials.ts";
import { encodeEffect, encodeEntry } from "./records.ts";
import { SESSION_METADATA_SQL } from "./session-management.ts";

export const SCHEMA_VERSION = 3;
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
const SCHEMA_V2_SQL = `${SCHEMA_V1_SQL}\n${SNAPSHOT_SQL}`;
const SCHEMA_V3_ADDITIONS = `${SESSION_METADATA_SQL}\n${MATERIALS_SQL}`;
const SCHEMA_SQL = `${SCHEMA_V2_SQL}\n${SCHEMA_V3_ADDITIONS}`;

function validateSchema(db: DatabaseSync, sql: string, formatVersion: number): void {
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
    formatVersion
  )
    throw new Error("Unsupported persisted format; a migration is required");
  if (
    db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length !== 0
  )
    throw new Error("Damaged database integrity; refusing automatic repair");
}

/** Format 2 adds optional output references; every format-1 payload remains byte-identical. */
function migrateRecords(db: DatabaseSync): void {
  for (const row of db.prepare("SELECT payload FROM entries").iterate())
    encodeEntry(JSON.parse(row.payload as string) as TranscriptEntry, 1);
  for (const row of db.prepare("SELECT payload FROM effects").iterate())
    encodeEffect(JSON.parse(row.payload as string) as EffectRecord);
  db.prepare("UPDATE metadata SET value=? WHERE key='persisted_format'").run(
    PERSISTED_FORMAT_VERSION,
  );
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
  } else if ((version === 1 || version === 2 || version === 3) && app === APPLICATION_ID) {
    const format = db
      .prepare("SELECT value FROM metadata WHERE key='persisted_format'")
      .get()?.value;
    const sql = version === 1 ? SCHEMA_V1_SQL : version === 2 ? SCHEMA_V2_SQL : SCHEMA_SQL;
    if (format === PERSISTED_FORMAT_VERSION && version === SCHEMA_VERSION) {
      validateSchema(db, SCHEMA_SQL, PERSISTED_FORMAT_VERSION);
      return;
    }
    validateSchema(db, sql, 1);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (version === 1) db.exec(SNAPSHOT_SQL);
      if (version < 3) db.exec(SCHEMA_V3_ADDITIONS);
      migrateRecords(db);
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
  validateSchema(db, SCHEMA_SQL, PERSISTED_FORMAT_VERSION);
}
