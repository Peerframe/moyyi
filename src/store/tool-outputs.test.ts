import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type {
  BlobRef,
  EntryId,
  RunId,
  SessionId,
  Timestamp,
  ToolCallId,
  TranscriptEntry,
} from "../contracts/persisted/index.ts";
import { SqliteSessionStore, type StoreOptions } from "./index.ts";
import { backupLocalStore, restoreLocalStore } from "./maintenance.ts";

const roots: string[] = [];
const stores: SqliteSessionStore[] = [];
const sessionId = "output-session" as SessionId;
const otherSession = "other-session" as SessionId;
const runId = "output-run" as RunId;
const callId = "output-call" as ToolCallId;
const empty = { entries: [], effects: [], durability: "normal" } as const;
function open(directory: string, options: StoreOptions = {}) {
  const store = new SqliteSessionStore(directory, options);
  stores.push(store);
  return store;
}
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-output-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const data = join(root, "data");
  const store = open(data);
  await store.commit({
    ...empty,
    sessions: [sessionId, otherSession].map((id) => ({
      sessionId: id,
      workspaceRoot: workspace,
      headEntryId: null,
    })),
    runs: [{ runId, sessionId, status: "active" }],
  });
  const bytes = Buffer.from("Full text before clipping: 中文\n".repeat(2000));
  const blob = await store.putBlob(bytes);
  const entry: TranscriptEntry = {
    id: "output-entry" as EntryId,
    sessionId,
    parentId: null,
    runId,
    createdAt: "2026-10-29T00:00:00.000Z" as Timestamp,
    body: {
      kind: "tool_results",
      results: [
        {
          type: "tool_result",
          callId,
          status: "succeeded",
          content: [{ type: "text", text: "preview" }],
        },
      ],
      outputBlobs: [{ callId, blob, bytes: bytes.byteLength }],
    },
  };
  const save = (value = entry) =>
    store.commit({
      ...empty,
      entries: [value],
      sessions: [{ sessionId, workspaceRoot: workspace, headEntryId: entry.id }],
      runs: [{ runId, sessionId, status: "completed" }],
    });
  return { root, workspace, data, store, bytes, blob, entry, save };
}
function withReference(entry: TranscriptEntry, blob: BlobRef, bytes: number): TranscriptEntry {
  if (entry.body.kind !== "tool_results") throw Error("Expected tool results");
  return { ...entry, body: { ...entry.body, outputBlobs: [{ callId, blob, bytes }] } };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable full tool output", () => {
  it("reopens with the complete UTF-8 blob and retains session ownership", async () => {
    const f = await fixture();
    await f.save();
    f.store.close();
    const later = open(f.data);
    expect((await later.loadSession(sessionId))?.entries).toEqual([f.entry]);
    expect((await later.loadSession(otherSession))?.entries).toEqual([]);
    expect(await later.getBlob(f.blob)).toEqual(f.bytes);
    await expect(
      later.commit({
        ...empty,
        entries: [{ ...f.entry, id: "foreign-output" as EntryId, sessionId: otherSession }],
      }),
    ).rejects.toThrow("another session");
    expect((await later.loadSession(otherSession))?.entries).toEqual([]);
  });

  it.each(["missing", "length", "utf8"] as const)(
    "rejects %s output before committing its result",
    async (kind) => {
      const f = await fixture();
      const blob =
        kind === "missing"
          ? (`sha256:${"0".repeat(64)}` as BlobRef)
          : kind === "utf8"
            ? await f.store.putBlob(Uint8Array.of(0xc3, 0x28))
            : f.blob;
      const bytes = kind === "utf8" ? 2 : f.bytes.length + (kind === "length" ? 1 : 0);
      await expect(f.save(withReference(f.entry, blob, bytes))).rejects.toThrow();
      const state = await f.store.loadSession(sessionId);
      expect(state?.entries).toEqual([]);
      expect(state?.runs[0]?.status).toBe("active");
    },
  );

  it("keeps an unpublished blob orphan after a failed transaction", async () => {
    const f = await fixture();
    f.store.close();
    const failing = open(f.data, {
      checkpoint(point) {
        if (point === "commit:before_commit") throw Error("commit fault");
      },
    });
    await expect(failing.commit({ ...empty, entries: [f.entry] })).rejects.toThrow("commit fault");
    expect((await failing.loadSession(sessionId))?.entries).toEqual([]);
    expect(await failing.getBlob(f.blob)).toEqual(f.bytes);
    failing.close();
    const backup = join(f.root, "orphan-backup");
    await backupLocalStore({ dataDirectory: f.data, destination: backup });
    expect(await open(backup).getBlob(f.blob)).toBeNull();
  });

  it("includes tool-only blobs in backup, restore and rescue without exporting orphans", async () => {
    const f = await fixture();
    await f.save();
    const orphan = await f.store.putBlob(Buffer.from("unreferenced"));
    f.store.close();
    const backup = join(f.root, "backup");
    expect(await backupLocalStore({ dataDirectory: f.data, destination: backup })).toMatchObject({
      persistedFormat: 2,
      schemaVersion: 3,
    });
    expect(readFileSync(join(backup, "blobs", f.blob.slice(7)))).toEqual(f.bytes);
    const target = join(f.root, "restored");
    open(target).close();
    await restoreLocalStore({
      dataDirectory: target,
      backupDirectory: backup,
      rescueDestination: join(f.root, "empty-rescue"),
    });
    const restored = open(target);
    expect((await restored.loadSession(sessionId))?.entries).toEqual([f.entry]);
    expect(await restored.getBlob(f.blob)).toEqual(f.bytes);
    expect(await restored.getBlob(orphan)).toBeNull();
    restored.close();
    const rescue = join(f.root, "output-rescue");
    await restoreLocalStore({
      dataDirectory: target,
      backupDirectory: backup,
      rescueDestination: rescue,
    });
    expect(await open(rescue).getBlob(f.blob)).toEqual(f.bytes);
  });

  it.each(["length", "utf8", "hash"] as const)(
    "rejects %s corruption during load and backup",
    async (kind) => {
      const f = await fixture();
      await f.save();
      const invalid = await f.store.putBlob(Uint8Array.of(0xc3, 0x28));
      f.store.close();
      if (kind === "hash") writeFileSync(join(f.data, "blobs", f.blob.slice(7)), "changed");
      else {
        const entry =
          kind === "length"
            ? withReference(f.entry, f.blob, f.bytes.length + 1)
            : withReference(f.entry, invalid, 2);
        const db = new DatabaseSync(join(f.data, "data.sqlite"));
        db.prepare("UPDATE entries SET payload=? WHERE id=?").run(
          JSON.stringify(entry),
          f.entry.id,
        );
        db.close();
      }
      const later = open(f.data);
      await expect(later.loadSession(sessionId)).rejects.toThrow();
      await expect(later.backup(join(f.root, "invalid-backup"))).rejects.toThrow();
    },
  );
});
