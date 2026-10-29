import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSnapshot } from "../contracts/files.ts";
import type {
  ActionDigest,
  BlobRef,
  EffectId,
  EffectRecord,
  RunId,
  SessionId,
  Timestamp,
  ToolCallId,
} from "../contracts/persisted/index.ts";
import { SqliteSessionStore, type StoreOptions } from "./index.ts";

const roots: string[] = [];
const stores: SqliteSessionStore[] = [];
const sessionId = "snapshot-session" as SessionId;
const runId = "snapshot-run" as RunId;
const empty = { entries: [], effects: [], durability: "normal" as const };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function open(directory: string, options: StoreOptions = {}) {
  const store = new SqliteSessionStore(directory, options);
  stores.push(store);
  return store;
}
async function setup(options: StoreOptions = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-snapshots-")));
  roots.push(root);
  const workspaceRoot = join(root, "workspace");
  mkdirSync(workspaceRoot);
  const directory = join(root, "data");
  const store = open(directory, options);
  await store.commit({
    ...empty,
    sessions: [{ sessionId, workspaceRoot, headEntryId: null }],
    runs: [{ runId, sessionId, status: "active" }],
  });
  return { root, directory, workspaceRoot, store };
}
async function started(
  store: SqliteSessionStore,
  workspaceRoot: string,
  effectId = "snapshot-effect",
  profile: EffectRecord["profile"] = {
    class: "workspace_write",
    reversibility: "snapshot",
    verification: "postcheck",
  },
) {
  const effect: EffectRecord = {
    id: effectId as EffectId,
    runId,
    callId: effectId as ToolCallId,
    tool: "edit",
    profile,
    digest: "digest" as ActionDigest,
    state: "intended",
    updatedAt: "2026-10-25T00:00:00.000Z" as Timestamp,
  };
  await store.commit({
    ...empty,
    effects: [effect, { ...effect, state: "approved" }, { ...effect, state: "started" }],
    leases: [{ kind: "acquire", workspaceRoot, runId }],
    durability: "before_side_effect",
  });
  return { ...effect, state: "started" as const };
}
async function snapshot(
  store: SqliteSessionStore,
  workspaceRoot: string,
  effectId = "snapshot-effect",
): Promise<WorkspaceSnapshot> {
  return {
    version: 1,
    id: effectId,
    effectId: effectId as EffectId,
    runId,
    workspaceRoot,
    path: "notes.txt",
    beforeBlob: await store.putBlob(Buffer.from("before")),
    beforeHash: digest("before"),
    afterHash: digest("after"),
    beforeMode: 0o644,
    afterMode: 0o644,
  };
}
function mutate(directory: string, sql: string) {
  const db = new DatabaseSync(join(directory, "data.sqlite"));
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable workspace snapshots", () => {
  it("blocks reentrant backup/save at both publication checkpoints", async () => {
    let value: WorkspaceSnapshot | undefined;
    let store: SqliteSessionStore | undefined;
    let destination = "";
    const rejected: Promise<unknown>[] = [];
    const f = await setup({
      checkpoint(point) {
        if (!store || !value) return;
        if (point === "snapshot:before_commit")
          rejected.push(
            store.backup(destination).then(
              () => "unexpected success",
              (error: unknown) => error,
            ),
          );
        if (point === "backup:before_publish")
          rejected.push(
            store.saveSnapshot(value).then(
              () => "unexpected success",
              (error: unknown) => error,
            ),
          );
      },
    });
    store = f.store;
    destination = join(f.root, "backup");
    await started(f.store, f.workspaceRoot);
    value = await snapshot(f.store, f.workspaceRoot);
    await f.store.saveSnapshot(value);
    await f.store.backup(destination);
    const results = await Promise.all(rejected);
    expect(results).toHaveLength(2);
    for (const error of results)
      expect(error).toMatchObject({ message: "Reentrant store operation" });
    expect(await open(destination).getSnapshot(value.id)).toEqual(value);
  });

  it("serializes concurrently requested backup and snapshot publication without mixed references", async () => {
    const f = await setup();
    await started(f.store, f.workspaceRoot);
    const value = await snapshot(f.store, f.workspaceRoot);
    const before = join(f.root, "before");
    const after = join(f.root, "after");
    await Promise.all([f.store.backup(before), f.store.saveSnapshot(value), f.store.backup(after)]);
    expect(await open(before).getSnapshot(value.id)).toBeNull();
    const later = open(after);
    expect(await later.getSnapshot(value.id)).toEqual(value);
    expect(await later.getBlob(value.beforeBlob as BlobRef)).toEqual(Buffer.from("before"));
  });

  it("retains immutable recovery evidence after close and settlement without changing v1 records", async () => {
    const f = await setup();
    const effect = await started(f.store, f.workspaceRoot);
    const value = await snapshot(f.store, f.workspaceRoot);
    await f.store.saveSnapshot(value);
    expect(await f.store.getSnapshot(value.id)).toEqual(value);
    expect(await f.store.getSnapshotForEffect(effect.id)).toEqual(value);
    await expect(f.store.saveSnapshot(value)).rejects.toThrow(/UNIQUE/);
    await expect(f.store.saveSnapshot({ ...value, path: "other.txt" })).rejects.toThrow(/UNIQUE/);
    await f.store.commit({
      ...empty,
      effects: [{ ...effect, state: "succeeded" }],
      runs: [{ runId, sessionId, status: "completed" }],
      leases: [{ kind: "release", runId, workspaceRoot: f.workspaceRoot }],
    });
    f.store.close();
    const reopened = open(f.directory);
    expect(await reopened.getSnapshot(value.id)).toEqual(value);
    expect(reopened.diagnostics()).toMatchObject({
      schemaVersion: 3,
      persistedFormat: 2,
      synchronous: 2,
    });
    expect((await reopened.loadSession(sessionId))?.effects[0]?.state).toBe("succeeded");
  });

  it("rolls back snapshot failure before commit and permits a later save", async () => {
    let fail = true;
    const f = await setup({
      checkpoint(point) {
        if (point === "snapshot:before_commit" && fail) throw Error("snapshot fault");
      },
    });
    await started(f.store, f.workspaceRoot);
    const value = await snapshot(f.store, f.workspaceRoot);
    await expect(f.store.saveSnapshot(value)).rejects.toThrow("snapshot fault");
    expect(await f.store.getSnapshot(value.id)).toBeNull();
    expect(await f.store.getBlob(value.beforeBlob as BlobRef)).toEqual(Buffer.from("before"));
    fail = false;
    await f.store.saveSnapshot(value);
    expect(await f.store.getSnapshot(value.id)).toEqual(value);
  });

  it.each([
    ["unknown version", { version: 2 }],
    ["different ID", { id: "another-effect" }],
    ["different run", { runId: "another-run" }],
    ["different workspace", { workspaceRoot: "/another-workspace" }],
    ["absolute path", { path: "/outside.txt" }],
    ["parent traversal", { path: "../outside.txt" }],
    ["ambiguous path", { path: "a/./notes.txt" }],
    ["backslash", { path: "a\\notes.txt" }],
    ["invalid hash", { afterHash: "sha256:wrong" }],
    ["blob/hash mismatch", { beforeHash: digest("different") }],
    ["missing mode", { beforeMode: null }],
    ["setuid mode", { afterMode: 0o4644 }],
    ["unapproved deletion", { afterHash: null, afterMode: null }],
    ["extra fields", { secret: "not accepted" }],
  ])("rejects %s without inserting", async (_name, change) => {
    const f = await setup();
    await started(f.store, f.workspaceRoot);
    const value = await snapshot(f.store, f.workspaceRoot);
    await expect(
      f.store.saveSnapshot({ ...value, ...change } as WorkspaceSnapshot),
    ).rejects.toThrow();
    expect(await f.store.getSnapshot(value.id)).toBeNull();
  });

  it.each(["missing-effect", "unstarted", "read-profile", "missing-lease", "finished-run"])(
    "requires current write authority: %s",
    async (kind) => {
      const f = await setup();
      const value = await snapshot(f.store, f.workspaceRoot);
      if (kind !== "missing-effect") {
        await started(
          f.store,
          f.workspaceRoot,
          value.id,
          kind === "read-profile"
            ? { class: "read", reversibility: "not_applicable", verification: "not_applicable" }
            : undefined,
        );
        // Deliberate disk corruption checks the store boundary independently of commit's own gate.
        if (kind === "unstarted") mutate(f.directory, "UPDATE effects SET state='approved'");
        if (kind === "missing-lease") mutate(f.directory, "DELETE FROM workspace_leases");
        if (kind === "finished-run") mutate(f.directory, "UPDATE runs SET status='interrupted'");
      }
      await expect(f.store.saveSnapshot(value)).rejects.toThrow(/Snapshot/);
      expect(await f.store.getSnapshot(value.id)).toBeNull();
    },
  );

  it.each(["missing", "corrupt"])(
    "rejects %s before-image blobs on save, read, session read and backup",
    async (kind) => {
      const f = await setup();
      await started(f.store, f.workspaceRoot);
      const value = await snapshot(f.store, f.workspaceRoot);
      const file = join(f.directory, "blobs", value.beforeHash as string);
      const breakBlob = () =>
        kind === "missing" ? unlinkSync(file) : writeFileSync(file, "corrupted");
      breakBlob();
      await expect(f.store.saveSnapshot(value)).rejects.toThrow(/blob|Blob/);
      writeFileSync(file, "before");
      await f.store.saveSnapshot(value);
      breakBlob();
      await expect(f.store.getSnapshot(value.id)).rejects.toThrow(/blob|Blob/);
      await expect(f.store.loadSession(sessionId)).rejects.toThrow(/blob|Blob/);
      await expect(f.store.backup(join(f.root, "backup"))).rejects.toThrow(/blob|Blob/);
      expect(existsSync(join(f.root, "backup"))).toBe(false);
    },
  );

  it("backs up snapshot-only blobs and restores usable evidence, excluding orphans", async () => {
    const f = await setup();
    await started(f.store, f.workspaceRoot);
    const value = await snapshot(f.store, f.workspaceRoot);
    await f.store.saveSnapshot(value);
    const orphan = await f.store.putBlob(Buffer.from("orphan"));
    const destination = join(f.root, "backup");
    await f.store.backup(destination);
    const restored = open(destination);
    expect(await restored.getSnapshot(value.id)).toEqual(value);
    expect(await restored.getBlob(value.beforeBlob as BlobRef)).toEqual(Buffer.from("before"));
    expect(await restored.getBlob(orphan)).toBeNull();
  });

  it("records creation and its exact inverse deletion as distinct effect snapshots", async () => {
    const f = await setup();
    const effect = await started(f.store, f.workspaceRoot);
    const original = {
      ...(await snapshot(f.store, f.workspaceRoot)),
      beforeBlob: null,
      beforeHash: null,
      beforeMode: null,
    };
    await f.store.saveSnapshot(original);
    await f.store.commit({ ...empty, effects: [{ ...effect, state: "succeeded" }] });
    await started(f.store, f.workspaceRoot, "undo-effect");
    const undo: WorkspaceSnapshot = {
      ...original,
      id: "undo-effect",
      effectId: "undo-effect" as EffectId,
      beforeBlob: await f.store.putBlob(Buffer.from("after")),
      beforeHash: original.afterHash,
      beforeMode: original.afterMode,
      afterHash: null,
      afterMode: null,
      restoreOf: original.id,
    };
    for (const change of [
      { restoreOf: "absent" },
      { path: "other.txt" },
      { beforeMode: 0o600 },
      { afterHash: digest("wrong"), afterMode: 0o644 },
    ])
      await expect(f.store.saveSnapshot({ ...undo, ...change })).rejects.toThrow();
    await f.store.saveSnapshot(undo);
    expect(await f.store.getSnapshot(undo.id)).toEqual(undo);
    const destination = join(f.root, "backup");
    await f.store.backup(destination);
    expect(await open(destination).getSnapshot(undo.id)).toEqual(undo);
  });

  it.each(["version", "columns", "restore", "effect"])(
    "rejects on-disk %s corruption on read and backup",
    async (kind) => {
      const f = await setup();
      await started(f.store, f.workspaceRoot);
      const value = await snapshot(f.store, f.workspaceRoot);
      await f.store.saveSnapshot(value);
      if (kind === "version")
        mutate(
          f.directory,
          "UPDATE workspace_snapshots SET payload=json_set(payload,'$.version',2)",
        );
      if (kind === "columns")
        mutate(
          f.directory,
          "UPDATE workspace_snapshots SET payload=json_set(payload,'$.runId','other')",
        );
      if (kind === "restore")
        mutate(
          f.directory,
          "UPDATE workspace_snapshots SET restore_of=id, payload=json_set(payload,'$.restoreOf',id)",
        );
      if (kind === "effect")
        mutate(
          f.directory,
          "UPDATE effects SET payload=json_set(payload,'$.profile.class','read')",
        );
      await expect(f.store.getSnapshot(value.id)).rejects.toThrow();
      await expect(f.store.backup(join(f.root, "backup"))).rejects.toThrow();
      expect(existsSync(join(f.root, "backup"))).toBe(false);
    },
  );

  it("rejects snapshot operations after close", async () => {
    const f = await setup();
    const value = await snapshot(f.store, f.workspaceRoot);
    f.store.close();
    await expect(f.store.saveSnapshot(value)).rejects.toThrow("closed");
    await expect(f.store.getSnapshot(value.id)).rejects.toThrow("closed");
    await expect(f.store.getSnapshotForEffect(value.effectId)).rejects.toThrow("closed");
  });
});
