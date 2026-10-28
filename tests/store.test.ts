import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  effects as fixtureEffects,
  entries as fixtureEntries,
} from "../src/contracts/persisted/fixtures/v1.ts";
import type {
  ActionDigest,
  BlobRef,
  EffectRecord,
  EntryId,
  RunId,
  SessionId,
  TranscriptEntry,
} from "../src/contracts/persisted/index.ts";
import type { SessionState, StoreBatch } from "../src/contracts/ports.ts";
import {
  BackupDurabilityError,
  SqliteSessionStore,
  type StoreOptions,
} from "../src/store/index.ts";

const roots: string[] = [];
const stores: SqliteSessionStore[] = [];
const sessionId = "ses_1" as SessionId;
const runId = "run_1" as RunId;
const empty: StoreBatch = { entries: [], effects: [], durability: "normal" };
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}
const intended: EffectRecord = { ...required(fixtureEffects[0]), state: "intended" };

function setup(options: StoreOptions = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-store-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const directory = join(root, "data");
  const store = open(directory, options);
  const session: SessionState = { sessionId, workspaceRoot: workspace, headEntryId: null };
  return { root, workspace, directory, store, session };
}

function open(directory: string, options: StoreOptions = {}) {
  const store = new SqliteSessionStore(directory, options);
  stores.push(store);
  return store;
}

async function initialize(store: SqliteSessionStore, session: SessionState) {
  await store.commit({
    ...empty,
    sessions: [session],
    runs: [{ runId, sessionId, status: "active" }],
  });
}

function notice(id = "notice", parentId: EntryId | null = null): TranscriptEntry {
  return {
    ...required(fixtureEntries[4]),
    id: id as EntryId,
    parentId,
    runId,
    body: { kind: "notice", code: "test", text: "synthetic" },
  };
}

async function settleTo(
  store: SqliteSessionStore,
  state: "started" | "unknown",
  workspace: string,
) {
  await store.commit({
    ...empty,
    effects: [intended, { ...intended, state: "approved" }, { ...intended, state: "started" }],
    leases: [{ kind: "acquire", runId, workspaceRoot: workspace }],
    durability: "before_side_effect",
  });
  if (state === "unknown")
    await store.commit({
      ...empty,
      effects: [required(fixtureEffects[0])],
    });
}

/** Old typed fixtures use placeholder hashes. Materialize only those external references. */
async function materializeFixture(store: SqliteSessionStore): Promise<readonly TranscriptEntry[]> {
  let serialized = JSON.stringify(fixtureEntries);
  for (let n = 1; n <= 4; n++) {
    const ref = await store.putBlob(new TextEncoder().encode(`synthetic fixture blob ${n}`));
    serialized = serialized.replaceAll(`sha256:${String(n).padStart(64, "0")}`, ref);
  }
  return JSON.parse(serialized) as TranscriptEntry[];
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite transactions and frozen v1 records", () => {
  it("initializes the versioned schema with WAL/FULL and checks integrity", () => {
    const { store } = setup();
    expect(store.diagnostics()).toMatchObject({
      schemaVersion: 3,
      persistedFormat: 1,
      journalMode: "wal",
      synchronous: 2,
      fullfsync: 1,
      integrity: "ok",
    });
    expect(store.diagnostics().sqliteVersion).toMatch(/^3\./);
  });

  it("round-trips every amended v1 record, real blobs, replay bytes, raw arguments and unknown effects", async () => {
    const { store, session, directory, workspace } = setup();
    const entries = await materializeFixture(store);
    await initialize(store, session);
    await settleTo(store, "unknown", workspace);
    await store.commit({
      ...empty,
      entries,
      effects: fixtureEffects,
      sessions: [{ ...session, headEntryId: required(entries.at(-1)).id }],
    });
    const before = await store.loadSession(sessionId);
    expect(before?.entries).toEqual(entries);
    expect(before?.effects).toEqual(fixtureEffects);
    const original = required(fixtureEntries[1]).body;
    const stored = required(before?.entries[1]).body;
    if (original.kind !== "assistant_message" || stored.kind !== "assistant_message")
      throw new Error("Missing assistant fixture");
    expect({ ...stored, request: original.request }).toEqual(original);
    expect(await store.unsettledEffects()).toEqual(fixtureEffects);
    store.close();
    const reopened = open(directory);
    expect(await reopened.loadSession(sessionId)).toEqual(before);
    expect(await reopened.unsettledEffects()).toEqual(fixtureEffects);
  });

  it("rolls back entries, effects, heads, runs and leases together after an injected failure", async () => {
    let fail = false;
    const { store, session, directory, workspace } = setup({
      checkpoint(point) {
        if (point === "commit:before_commit" && fail) throw new Error("injected");
      },
    });
    await initialize(store, session);
    fail = true;
    await expect(
      store.commit({
        ...empty,
        entries: [notice()],
        effects: [intended],
        sessions: [{ ...session, headEntryId: "notice" as EntryId }],
        leases: [{ kind: "acquire", runId, workspaceRoot: workspace }],
      }),
    ).rejects.toThrow("injected");
    fail = false;
    store.close();
    const reopened = open(directory);
    expect(await reopened.loadSession(sessionId)).toMatchObject({
      headEntryId: null,
      entries: [],
      effects: [],
      leases: [],
      runs: [{ runId, sessionId, status: "active" }],
    });
    await reopened.commit({ ...empty, entries: [notice()], effects: [intended] });
    expect((await reopened.loadSession(sessionId))?.entries).toHaveLength(1);
  });

  it("supports both durability labels without lowering synchronous", async () => {
    const { store } = setup();
    for (const durability of ["normal", "before_side_effect"] as const) {
      await store.commit({ ...empty, durability });
      expect(store.diagnostics().synchronous).toBe(2);
    }
    await expect(store.commit({ ...empty, durability: "off" as "normal" })).rejects.toThrow(
      "durability",
    );
  });

  it("rejects history rewrites and accepts only exact entry repeats", async () => {
    const { store, session } = setup();
    await initialize(store, session);
    const entry = notice();
    await store.commit({ ...empty, entries: [entry, entry] });
    await expect(
      store.commit({
        ...empty,
        entries: [{ ...entry, body: { kind: "notice", code: "changed", text: "edited" } }],
      }),
    ).rejects.toThrow("immutable");
    expect((await store.loadSession(sessionId))?.entries).toEqual([entry]);
  });

  it("keeps branches and accepts unordered parents while rejecting cycles and foreign heads", async () => {
    const { store, session } = setup();
    await initialize(store, session);
    const root = notice("root");
    const left = notice("left", root.id);
    const right = notice("right", root.id);
    await store.commit({
      ...empty,
      entries: [left, root, right],
      sessions: [{ ...session, headEntryId: right.id }],
    });
    expect((await store.loadSession(sessionId))?.entries).toEqual([left, root, right]);
    await expect(
      store.commit({
        ...empty,
        entries: [notice("a", "b" as EntryId), notice("b", "a" as EntryId)],
      }),
    ).rejects.toThrow("cycle");
    await expect(
      store.commit({
        ...empty,
        sessions: [{ ...session, sessionId: "other" as SessionId, headEntryId: root.id }],
      }),
    ).rejects.toThrow("head");
    await expect(
      store.commit({ ...empty, entries: [notice("missing", "no-parent" as EntryId)] }),
    ).rejects.toThrow("parent");
  });

  it("rejects cross-session parents and runs and invalid compaction spans", async () => {
    const { store, session } = setup();
    await initialize(store, session);
    await store.commit({
      ...empty,
      entries: [notice("root")],
      sessions: [{ ...session, sessionId: "other" as SessionId }],
    });
    await expect(
      store.commit({
        ...empty,
        entries: [{ ...notice("foreign"), sessionId: "other" as SessionId }],
      }),
    ).rejects.toThrow("another session");
    await expect(
      store.commit({
        ...empty,
        entries: [
          { ...notice("foreign", "root" as EntryId), runId: null, sessionId: "other" as SessionId },
        ],
      }),
    ).rejects.toThrow("another session");
    await expect(
      store.commit({
        ...empty,
        entries: [{ ...required(fixtureEntries[3]), parentId: "root" as EntryId }],
      }),
    ).rejects.toThrow("Compaction");
  });

  it("rejects a missing/corrupt blob without committing any entry and detects later corruption", async () => {
    const { store, session, directory } = setup();
    await initialize(store, session);
    const image = required(fixtureEntries[0]);
    await expect(store.commit({ ...empty, entries: [image] })).rejects.toThrow();
    expect((await store.loadSession(sessionId))?.entries).toEqual([]);
    const entries = await materializeFixture(store);
    await store.commit({ ...empty, entries: [required(entries[0])] });
    const body = required(entries[0]).body;
    if (body.kind !== "user_message") throw new Error("fixture lacks user message");
    const ref = body.content.find((part) => part.type === "image");
    if (ref?.type !== "image") throw new Error("fixture lacks image");
    writeFileSync(join(directory, "blobs", ref.blob.slice(7)), "corrupt");
    await expect(store.loadSession(sessionId)).rejects.toThrow();
    await expect(store.getBlob(ref.blob)).rejects.toThrow();
    await expect(store.commit({ ...empty, entries: [required(entries[0])] })).rejects.toThrow();
  });
});

describe("effect and concurrency constraints", () => {
  it("requires intended first, validates transitions and binds identity/approval digest", async () => {
    const { store, session, workspace } = setup();
    await initialize(store, session);
    await expect(
      store.commit({ ...empty, effects: [required(fixtureEffects[0])] }),
    ).rejects.toThrow("intended");
    await store.commit({ ...empty, effects: [intended] });
    await expect(
      store.commit({ ...empty, effects: [{ ...intended, state: "succeeded" }] }),
    ).rejects.toThrow("transition");
    await expect(
      store.commit({ ...empty, effects: [{ ...intended, state: "approved", tool: "other" }] }),
    ).rejects.toThrow("identity");
    await expect(
      store.commit({
        ...empty,
        effects: [{ ...intended, state: "approved", digest: "new" as ActionDigest }],
      }),
    ).rejects.toThrow("digest");
    await store.commit({ ...empty, effects: [{ ...intended, state: "approved" }] });
    const changed = { ...intended, digest: "new" as ActionDigest };
    await store.commit({
      ...empty,
      effects: [
        { ...changed, state: "awaiting_approval" },
        { ...changed, state: "approved" },
      ],
    });
    await expect(
      store.commit({ ...empty, effects: [{ ...changed, state: "started" }] }),
    ).rejects.toThrow("lease");
    await store.commit({
      ...empty,
      effects: [
        { ...changed, state: "started" },
        { ...changed, state: "unknown" },
        { ...changed, state: "succeeded", evidence: "verified" },
      ],
      leases: [{ kind: "acquire", runId, workspaceRoot: workspace }],
    });
    await expect(
      store.commit({
        ...empty,
        effects: [{ ...changed, state: "succeeded", evidence: "rewrite" }],
      }),
    ).rejects.toThrow("transition");
    await store.commit({
      ...empty,
      effects: [{ ...changed, state: "succeeded", evidence: "verified" }],
    });
    expect(await store.unsettledEffects()).toEqual([]);
  });

  it("cannot reuse a tool call under another effect ID", async () => {
    const { store, session } = setup();
    await initialize(store, session);
    await store.commit({ ...empty, effects: [intended] });
    await expect(
      store.commit({ ...empty, effects: [{ ...intended, id: "other" as EffectRecord["id"] }] }),
    ).rejects.toThrow("UNIQUE");
    expect(await store.unsettledEffects()).toEqual([intended]);
  });

  it("enforces one active run, keeps interrupted unknowns, and allows evidence-based settlement", async () => {
    const { store, session, directory, workspace } = setup();
    await initialize(store, session);
    await expect(
      store.commit({ ...empty, runs: [{ runId: "run_2" as RunId, sessionId, status: "active" }] }),
    ).rejects.toThrow("UNIQUE");
    await settleTo(store, "unknown", workspace);
    await expect(
      store.commit({ ...empty, runs: [{ runId, sessionId, status: "completed" }] }),
    ).rejects.toThrow();
    await store.commit({ ...empty, runs: [{ runId, sessionId, status: "interrupted" }] });
    store.close();
    const reopened = open(directory);
    expect(await reopened.unsettledEffects()).toEqual(fixtureEffects);
    expect((await reopened.loadSession(sessionId))?.leases).toHaveLength(1);
    await expect(
      reopened.commit({ ...empty, runs: [{ runId, sessionId, status: "active" }] }),
    ).rejects.toThrow("restarted");
    await expect(
      reopened.commit({ ...empty, leases: [{ kind: "release", runId, workspaceRoot: workspace }] }),
    ).rejects.toThrow("lease");
    await reopened.commit({
      ...empty,
      effects: [{ ...required(fixtureEffects[0]), state: "failed", evidence: "postcheck failed" }],
      leases: [{ kind: "release", runId, workspaceRoot: workspace }],
    });
    expect(await reopened.unsettledEffects()).toEqual([]);
  });

  it("canonicalizes workspace aliases and atomically hands off a finished run/lease", async () => {
    const { store, session, root, workspace } = setup();
    await initialize(store, session);
    const alias = join(root, "alias");
    symlinkSync(workspace, alias);
    await store.commit({
      ...empty,
      leases: [{ kind: "acquire", runId, workspaceRoot: alias }],
      sessions: [{ ...session, sessionId: "ses_2" as SessionId }],
      runs: [{ runId: "run_2" as RunId, sessionId: "ses_2" as SessionId, status: "active" }],
    });
    await expect(
      store.commit({
        ...empty,
        leases: [{ kind: "acquire", runId: "run_2" as RunId, workspaceRoot: workspace }],
      }),
    ).rejects.toThrow("already leased");
    await expect(
      store.commit({
        ...empty,
        leases: [{ kind: "release", runId: "run_2" as RunId, workspaceRoot: workspace }],
      }),
    ).rejects.toThrow("holder");
    await store.commit({
      ...empty,
      runs: [
        { runId: "run_3" as RunId, sessionId, status: "active" },
        { runId, sessionId, status: "completed" },
      ],
      leases: [
        { kind: "release", runId, workspaceRoot: workspace },
        { kind: "acquire", runId: "run_3" as RunId, workspaceRoot: alias },
      ],
    });
    expect((await store.loadSession(sessionId))?.leases).toEqual([
      { runId: "run_3", workspaceRoot: workspace },
    ]);
  });

  it.each([true, false])(
    "rejects overlapping parent/child leases (parent first: %s), permits siblings",
    async (parentFirst) => {
      const { store, session, workspace } = setup();
      const child = join(workspace, "child");
      const sibling = join(workspace, "sibling");
      mkdirSync(child);
      mkdirSync(sibling);
      const first = parentFirst ? workspace : child;
      const second = parentFirst ? child : workspace;
      const secondId = "second" as SessionId;
      const secondRun = "second" as RunId;
      await initialize(store, { ...session, workspaceRoot: first });
      await store.commit({
        ...empty,
        leases: [{ kind: "acquire", runId, workspaceRoot: first }],
        sessions: [{ sessionId: secondId, workspaceRoot: second, headEntryId: null }],
        runs: [{ runId: secondRun, sessionId: secondId, status: "active" }],
      });
      await expect(
        store.commit({
          ...empty,
          leases: [{ kind: "acquire", runId: secondRun, workspaceRoot: second }],
        }),
      ).rejects.toThrow("Overlapping");
      if (!parentFirst) {
        await store.commit({
          ...empty,
          sessions: [
            { sessionId: "sibling" as SessionId, workspaceRoot: sibling, headEntryId: null },
          ],
          runs: [
            { runId: "sibling" as RunId, sessionId: "sibling" as SessionId, status: "active" },
          ],
          leases: [{ kind: "acquire", runId: "sibling" as RunId, workspaceRoot: sibling }],
        });
        expect((await store.loadSession("sibling" as SessionId))?.leases).toHaveLength(1);
      }
    },
  );

  it("allows the recorded lease holder to release a moved workspace", async () => {
    const { store, session, workspace } = setup();
    await initialize(store, session);
    await store.commit({
      ...empty,
      leases: [{ kind: "acquire", runId, workspaceRoot: workspace }],
    });
    renameSync(workspace, `${workspace}-moved`);
    await expect(
      store.commit({
        ...empty,
        leases: [{ kind: "release", runId: "wrong" as RunId, workspaceRoot: workspace }],
      }),
    ).rejects.toThrow();
    await store.commit({
      ...empty,
      runs: [{ runId, sessionId, status: "completed" }],
      leases: [{ kind: "release", runId, workspaceRoot: workspace }],
    });
    expect((await store.loadSession(sessionId))?.leases).toEqual([]);
  });
});

describe("migrations, backup and lifecycle", () => {
  it("rolls back a failed schema migration and can initialize it on retry", () => {
    const { directory, store } = setup();
    store.close();
    rmSync(directory, { recursive: true });
    expect(() =>
      open(directory, {
        checkpoint() {
          throw new Error("migration fault");
        },
      }),
    ).toThrow("migration fault");
    const db = new DatabaseSync(join(directory, "data.sqlite"));
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all()).toEqual([]);
    db.close();
    expect(open(directory).diagnostics().integrity).toBe("ok");
  });

  it.each(["future-schema", "future-format", "foreign-database"])(
    "rejects %s without rewriting it",
    (kind) => {
      const { directory, store } = setup();
      store.close();
      const file = join(directory, "data.sqlite");
      const db = new DatabaseSync(file);
      db.exec("PRAGMA journal_mode = DELETE");
      if (kind === "future-schema") db.exec("PRAGMA user_version = 99");
      if (kind === "future-format") db.exec("UPDATE metadata SET value = 99");
      if (kind === "foreign-database")
        db.exec("PRAGMA user_version = 0; PRAGMA application_id = 0");
      db.close();
      const bytes = readFileSync(file);
      expect(() => open(directory)).toThrow(/Unsupported|unversioned/);
      expect(readFileSync(file)).toEqual(bytes);
    },
  );

  it.each([
    "DROP INDEX one_active_run",
    "CREATE TRIGGER injected AFTER INSERT ON runs BEGIN DELETE FROM effects; END",
    "CREATE TABLE unrelated (id INTEGER)",
    "CREATE TRIGGER sqliteX_extra AFTER INSERT ON sessions BEGIN UPDATE sessions SET head_entry_id=NULL WHERE id=NEW.id; END",
  ])("rejects modified schema without repairing it: %s", (sql) => {
    const { directory, store } = setup();
    store.close();
    const file = join(directory, "data.sqlite");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec(sql);
    db.close();
    const before = readFileSync(file);
    expect(() => open(directory)).toThrow("damaged database schema");
    expect(readFileSync(file)).toEqual(before);
  });

  it("backs up a consistent database with referenced blobs, omits orphans and restores unchanged", async () => {
    const { store, session, root } = setup();
    await initialize(store, session);
    const entries = await materializeFixture(store);
    const orphan = await store.putBlob(new TextEncoder().encode("unreferenced"));
    await store.commit({
      ...empty,
      entries,
      sessions: [{ ...session, headEntryId: required(entries.at(-1)).id }],
    });
    const before = await store.loadSession(sessionId);
    const destination = join(root, "backup");
    await store.backup(destination);
    expect(readdirSync(destination)).not.toContain("writer-lock.sqlite");
    const restored = open(destination);
    expect(await restored.loadSession(sessionId)).toEqual(before);
    expect(await restored.getBlob(orphan)).toBeNull();
    expect(restored.diagnostics().integrity).toBe("ok");
    await store.commit({ ...empty, entries: [notice("later", required(entries.at(-1)).id)] });
    expect((await restored.loadSession(sessionId))?.entries).toHaveLength(entries.length);
    await expect(store.backup(destination)).rejects.toThrow("new directory");
    await expect(store.backup(join(store.directory, "backup"))).rejects.toThrow("outside");
  });

  it("does not publish a failed backup or conceal corrupt referenced blobs", async () => {
    let fail = true;
    const { store, session, root, directory } = setup({
      checkpoint(point) {
        if (point === "backup:before_publish" && fail) throw new Error("backup fault");
      },
    });
    await initialize(store, session);
    await store.commit({ ...empty, entries: await materializeFixture(store) });
    await expect(store.backup(join(root, "backup"))).rejects.toThrow("backup fault");
    expect(readdirSync(root)).toEqual(expect.not.arrayContaining(["backup"]));
    expect(readdirSync(root).some((name) => name.startsWith(".moyyi-backup-"))).toBe(false);
    fail = false;
    writeFileSync(
      join(directory, "blobs", required(readdirSync(join(directory, "blobs"))[0])),
      "corruption",
    );
    await expect(store.backup(join(root, "backup"))).rejects.toThrow();
    expect(readdirSync(root)).not.toContain("backup");
  });

  it("reports an unconfirmed publication if the final directory sync fails", async () => {
    const { store, root } = setup({
      checkpoint(point) {
        if (point === "backup:before_parent_sync") throw new Error("injected sync failure");
      },
    });
    const destination = join(root, "backup");
    await expect(store.backup(destination)).rejects.toMatchObject({
      name: "BackupDurabilityError",
      destination,
    });
    expect(readdirSync(destination)).toContain("data.sqlite");
    expect(open(destination).diagnostics().integrity).toBe("ok");
    expect(BackupDurabilityError.prototype).toBeInstanceOf(Error);
  });

  it("rejects operations after close", async () => {
    const { store } = setup();
    store.close();
    store.close();
    await expect(store.commit(empty)).rejects.toThrow("closed");
    await expect(store.loadSession(sessionId)).rejects.toThrow("closed");
    await expect(store.getBlob("sha256:bad" as BlobRef)).rejects.toThrow("closed");
    expect(() => store.diagnostics()).toThrow("closed");
  });
});
