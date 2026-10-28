import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { BlobStore } from "./files.ts";
import { SqliteSessionStore } from "./index.ts";

// Exact schema-1 DDL from the merged batch-3 implementation. Keep this historical fixture fixed.
const legacySchema = `CREATE TABLE metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT;
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
// Exact schema-2 addition; do not replace this fixture with current generated DDL.
const legacySnapshots = `CREATE TABLE workspace_snapshots (
          ordinal INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
          effect_id TEXT NOT NULL UNIQUE REFERENCES effects(id),
          run_id TEXT NOT NULL REFERENCES runs(id),
          restore_of TEXT REFERENCES workspace_snapshots(id), payload TEXT NOT NULL
        ) STRICT;`;
const roots: string[] = [];
const stores: SqliteSessionStore[] = [];
function legacy() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-schema-")));
  roots.push(root);
  const directory = join(root, "data");
  const workspaceRoot = join(root, "workspace");
  mkdirSync(directory);
  mkdirSync(workspaceRoot);
  const file = join(directory, "data.sqlite");
  const db = new DatabaseSync(file);
  db.exec(legacySchema);
  db.exec("PRAGMA application_id = 1297045849; PRAGMA user_version = 1");
  db.exec("INSERT INTO metadata VALUES ('persisted_format',1)");
  db.prepare("INSERT INTO sessions VALUES ('legacy-session',?,NULL)").run(workspaceRoot);
  db.exec("INSERT INTO runs VALUES ('legacy-run','legacy-session','active')");
  const entry = {
    id: "legacy-entry",
    sessionId: "legacy-session",
    parentId: null,
    runId: "legacy-run",
    createdAt: "2026-10-25T00:00:00.000Z",
    body: { kind: "notice", code: "legacy", text: "Historical persisted v1" },
  };
  db.prepare(
    "INSERT INTO entries(id,session_id,parent_id,run_id,payload) VALUES (?,?,NULL,?,?)",
  ).run(entry.id, entry.sessionId, entry.runId, JSON.stringify(entry));
  db.close();
  return { root, directory, file, entry };
}
function open(directory: string) {
  const store = new SqliteSessionStore(directory);
  stores.push(store);
  return store;
}

function legacyTwo() {
  const fixture = legacy();
  const db = new DatabaseSync(fixture.file);
  db.exec(legacySnapshots);
  db.exec("PRAGMA user_version=2");
  db.close();
  return fixture;
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("additive schema 2 to 3 migration", () => {
  it("adds management/material tables while retaining exact old transcript bytes", async () => {
    const f = legacyTwo();
    const store = open(f.directory);
    expect(store.diagnostics()).toMatchObject({ schemaVersion: 3, persistedFormat: 1 });
    expect((await store.sessionManagement.list()).items[0]?.metadata.revision).toBe(0);
    expect((await store.loadSession("legacy-session" as never))?.entries).toEqual([f.entry]);
    store.close();
    const db = new DatabaseSync(f.file);
    expect(db.prepare("SELECT payload FROM entries").get()?.payload).toBe(JSON.stringify(f.entry));
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    for (const table of [
      "session_metadata",
      "material_assets",
      "material_references",
      "material_selections",
      "material_settings",
    ])
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name=?").get(table)).toBeDefined();
    db.close();
  });

  it("rolls back all schema-3 additions atomically and preserves a reusable schema-2 backup", () => {
    const f = legacyTwo();
    expect(
      () =>
        new SqliteSessionStore(f.directory, {
          checkpoint(point) {
            if (point === "migration:before_commit") throw Error("schema 3 fault");
          },
        }),
    ).toThrow("schema 3 fault");
    const db = new DatabaseSync(f.file);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(db.prepare("SELECT payload FROM entries").get()?.payload).toBe(JSON.stringify(f.entry));
    for (const table of [
      "session_metadata",
      "material_assets",
      "material_references",
      "material_selections",
      "material_settings",
    ])
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name=?").get(table)).toBeUndefined();
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name='workspace_snapshots'").get(),
    ).toBeDefined();
    db.close();
    expect(open(f.directory).diagnostics().schemaVersion).toBe(3);
  });

  it("refuses a damaged schema-2 database before adding any new table", () => {
    const f = legacyTwo();
    const db = new DatabaseSync(f.file);
    db.exec("DROP INDEX one_active_run");
    db.close();
    const before = readFileSync(f.file);
    expect(() => open(f.directory)).toThrow("damaged database schema");
    expect(readFileSync(f.file)).toEqual(before);
  });
});
describe("additive legacy schema migration", () => {
  it("restores a schema-1 backup with referenced user blobs and migrates only that copy", async () => {
    const f = legacy();
    const bytes = Buffer.from("Synthetic legacy user attachment");
    const ref = new BlobStore(f.directory).put(bytes);
    const user = {
      ...f.entry,
      id: "legacy-user",
      parentId: f.entry.id,
      body: {
        kind: "user_message",
        steering: false,
        content: [{ type: "image", mediaType: "image/png", blob: ref }],
      },
    };
    const destination = join(f.root, "schema-one-backup");
    mkdirSync(destination);
    const db = new DatabaseSync(f.file);
    db.prepare(
      "INSERT INTO entries(id,session_id,parent_id,run_id,payload) VALUES (?,?,?,?,?)",
    ).run(user.id, user.sessionId, user.parentId, user.runId, JSON.stringify(user));
    db.prepare("VACUUM INTO ?").run(join(destination, "data.sqlite"));
    db.close();
    cpSync(join(f.directory, "blobs"), join(destination, "blobs"), { recursive: true });
    const restored = open(destination);
    const sessionId = (await restored.listSessions())[0];
    if (!sessionId) throw Error("Missing restored session");
    expect((await restored.loadSession(sessionId))?.entries).toEqual([f.entry, user]);
    expect(await restored.getBlob(ref)).toEqual(bytes);
    expect(restored.diagnostics()).toMatchObject({ schemaVersion: 3, persistedFormat: 1 });
    const original = new DatabaseSync(f.file);
    expect(original.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(
      original.prepare("SELECT name FROM sqlite_schema WHERE name='workspace_snapshots'").get(),
    ).toBeUndefined();
    original.close();
  });

  it("upgrades a genuine schema-1 database and preserves v1 payload bytes", async () => {
    const f = legacy();
    const store = open(f.directory);
    expect(store.diagnostics()).toMatchObject({
      schemaVersion: 3,
      persistedFormat: 1,
      synchronous: 2,
      integrity: "ok",
    });
    const ids = await store.listSessions();
    expect(ids).toEqual(["legacy-session"]);
    const sessionId = ids[0];
    if (!sessionId) throw Error("Missing migrated session");
    expect((await store.loadSession(sessionId))?.entries).toEqual([f.entry]);
    expect(await store.getSnapshot("missing")).toBeNull();
    store.close();
    const db = new DatabaseSync(f.file);
    expect(db.prepare("SELECT payload FROM entries").get()?.payload).toBe(JSON.stringify(f.entry));
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
    db.close();
  });

  it("rolls back schema-1 migration failure without losing old data, then retries", () => {
    const f = legacy();
    expect(
      () =>
        new SqliteSessionStore(f.directory, {
          checkpoint(point) {
            if (point === "migration:before_commit") throw Error("migration fault");
          },
        }),
    ).toThrow("migration fault");
    const db = new DatabaseSync(f.file);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name='workspace_snapshots'").get(),
    ).toBeUndefined();
    expect(db.prepare("SELECT payload FROM entries").get()?.payload).toBe(JSON.stringify(f.entry));
    db.close();
    expect(open(f.directory).diagnostics().schemaVersion).toBe(3);
  });

  it.each([
    "DROP INDEX one_active_run",
    "DROP TABLE workspace_leases",
    "CREATE TRIGGER extra AFTER INSERT ON runs BEGIN DELETE FROM effects; END",
    "CREATE TABLE extra(id INTEGER)",
    "UPDATE metadata SET value=99",
    "DELETE FROM metadata",
    "INSERT INTO runs VALUES ('orphan','missing','active')",
  ])("refuses damaged old schema or integrity without adding the new table: %s", (sql) => {
    const f = legacy();
    let db = new DatabaseSync(f.file);
    db.exec("PRAGMA foreign_keys=OFF");
    db.exec(sql);
    db.close();
    const before = readFileSync(f.file);
    expect(() => open(f.directory)).toThrow(/damaged|Unsupported|Damaged/);
    expect(readFileSync(f.file)).toEqual(before);
    db = new DatabaseSync(f.file);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(1);
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name='workspace_snapshots'").get(),
    ).toBeUndefined();
    db.close();
  });
});
