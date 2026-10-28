import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  type EntryId,
  type SessionId,
  type Timestamp,
  type TranscriptEntry,
  UNKNOWN_USAGE,
} from "../contracts/index.ts";
import { SqliteSessionStore } from "./index.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
const now = "2026-10-28T00:00:00.000Z" as Timestamp;
const sid = "session" as SessionId;
async function setup(ids = [sid]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-session-management-")));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const directory = join(root, "store");
  const store = new SqliteSessionStore(directory);
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  await store.commit({
    entries: [],
    effects: [],
    durability: "normal",
    sessions: ids.map((sessionId) => ({ sessionId, workspaceRoot: workspace, headEntryId: null })),
  });
  let count = 0;
  async function entry(
    body: TranscriptEntry["body"],
    sessionId = sid,
    parentId: EntryId | null = null,
    runId: TranscriptEntry["runId"] = null,
  ) {
    const entry: TranscriptEntry = {
      id: `entry_${count++}` as EntryId,
      sessionId,
      parentId,
      runId,
      createdAt: now,
      body,
    };
    await store.commit({ entries: [entry], effects: [], durability: "normal" });
    return entry;
  }
  return { root, directory, workspace, store, api: store.sessionManagement, entry };
}

it("pages the entire history without workspace access or transcript/blob bulk loading", async () => {
  const h = await setup();
  for (let i = 0; i < 140; i++)
    await h.entry({
      kind: "user_message",
      steering: false,
      content: [{ type: "text", text: `${i}:${"x".repeat(5000)}` }],
    });
  rmSync(h.workspace, { recursive: true });
  const load = vi.spyOn(h.store, "loadSession"),
    blob = vi.spyOn(h.store, "getBlob");
  const pages = [];
  let cursor: string | undefined;
  do {
    const page = await h.api.history({ sessionId: sid, ...(cursor ? { cursor } : {}), limit: 50 });
    expect(Buffer.byteLength(JSON.stringify(page.items))).toBeLessThanOrEqual(262_144);
    pages.unshift(page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const items = pages.flat();
  expect(items).toHaveLength(140);
  expect(new Set(items.map((item) => item.id)).size).toBe(140);
  expect(items.map((item) => Number(item.text.split(":")[0]))).toEqual(
    Array.from({ length: 140 }, (_, i) => i),
  );
  expect(load).not.toHaveBeenCalled();
  expect(blob).not.toHaveBeenCalled();
});

it("reads long text completely in bounded Unicode-safe chunks, including the last byte", async () => {
  const h = await setup();
  const text = `${"a".repeat(16_383)}😀${"中文".repeat(20_000)}END`;
  await h.entry({ kind: "user_message", steering: false, content: [{ type: "text", text }] });
  const item = (await h.api.history({ sessionId: sid })).items[0];
  expect(item).toMatchObject({ textLength: text.length, truncated: true });
  expect(item?.text).toHaveLength(16_383);
  let actual = "",
    offset = 0;
  do {
    const chunk = await h.api.readMessage({ sessionId: sid, messageId: item?.id ?? "", offset });
    expect(chunk.text.length).toBeLessThanOrEqual(16_384);
    expect(chunk.text.isWellFormed()).toBe(true);
    actual += chunk.text;
    if (chunk.nextOffset === null) break;
    expect(chunk.nextOffset).toBeGreaterThan(offset);
    offset = chunk.nextOffset;
  } while (offset < text.length);
  expect(actual).toBe(text);
  await expect(
    h.api.readMessage({ sessionId: sid, messageId: item?.id ?? "", offset: 16_384 }),
  ).rejects.toThrow("boundary");
});

it("keeps stable part IDs, refusal and partial notices while excluding reasoning and request blobs", async () => {
  const h = await setup();
  const blob = await h.store.putBlob(Buffer.from("PRIVATE_REQUEST"));
  const e = await h.entry({
    kind: "assistant_message",
    origin: { provider: "test", model: "test" },
    content: [
      { type: "reasoning", kind: "visible", text: "PRIVATE_REASONING" },
      { type: "refusal", text: "Cannot do that." },
      { type: "text", text: "Partial text" },
    ],
    stopReason: "interrupted",
    providerStopReason: null,
    usage: UNKNOWN_USAGE,
    request: { rendererVersion: "private-renderer", system: blob, tools: blob, messages: [blob] },
  });
  const page = await h.api.history({ sessionId: sid, limit: 1 });
  expect(page.items[0]?.state).toBe("interrupted");
  const older = await h.api.history({ sessionId: sid, cursor: page.nextCursor ?? "", limit: 20 });
  expect(older.items.map((item) => item.id)).toEqual([`${e.id}:1`, `${e.id}:2`]);
  expect(older.items[0]?.text).toBe("Cannot do that.");
  expect(JSON.stringify([page, older])).not.toMatch(/PRIVATE|private-renderer|rendererVersion/);
  await expect(h.api.readMessage({ sessionId: sid, messageId: `${e.id}:0` })).rejects.toThrow(
    "not found",
  );
});

it("retains original entries around a compaction and labels the recorded summary", async () => {
  const h = await setup();
  const first = await h.entry({
    kind: "user_message",
    steering: false,
    content: [{ type: "text", text: "original" }],
  });
  const second = await h.entry({ kind: "notice", code: "test", text: "second" }, sid, first.id);
  await h.entry(
    {
      kind: "compaction",
      replaces: { fromEntryId: first.id, toEntryId: second.id },
      summary: [{ type: "text", text: "summary" }],
      producedBy: { origin: { provider: "test", model: "test" }, promptVersion: "one" },
    },
    sid,
    second.id,
  );
  const page = await h.api.history({ sessionId: sid });
  expect(page.items.map((item) => item.text)).toEqual([
    "original",
    "second",
    expect.stringContaining("summary"),
  ]);
  expect(page.items.at(-1)?.state).toBe("compaction");
});

it("binds history cursors and messages to their session and excludes later appends from older pages", async () => {
  const other = "other" as SessionId;
  const h = await setup([sid, other]);
  const old = await h.entry({ kind: "notice", code: "test", text: "old" });
  await h.entry({ kind: "notice", code: "test", text: "new" });
  const page = await h.api.history({ sessionId: sid, limit: 1 });
  await h.entry({ kind: "notice", code: "test", text: "later" });
  const earlier = await h.api.history({ sessionId: sid, cursor: page.nextCursor ?? "" });
  expect(earlier.items.map((m) => m.text)).toEqual(["old"]);
  await expect(h.api.history({ sessionId: other, cursor: page.nextCursor ?? "" })).rejects.toThrow(
    "cursor",
  );
  await expect(h.api.readMessage({ sessionId: other, messageId: `${old.id}:0` })).rejects.toThrow(
    "not found",
  );
});

it("resolves tool names across page boundaries by run and preceding call identity", async () => {
  const h = await setup();
  const blob = await h.store.putBlob(Buffer.from("[]"));
  const runId = "tool-run" as never;
  await h.store.commit({
    entries: [],
    effects: [],
    runs: [{ runId, sessionId: sid, status: "active" }],
    durability: "normal",
  });
  const assistant = (name: string): TranscriptEntry["body"] => ({
    kind: "assistant_message",
    origin: { provider: "test", model: "test" },
    content: [
      {
        type: "tool_call",
        name,
        callId: "call" as never,
        providerCallId: "call",
        providerItemId: null,
        rawArguments: "{}",
        argumentsSource: "verbatim",
      },
    ],
    stopReason: "tool_use",
    providerStopReason: null,
    usage: UNKNOWN_USAGE,
    request: { rendererVersion: "test", system: blob, tools: blob, messages: [] },
  });
  await h.entry(assistant("read"), sid, null, runId);
  await h.entry(
    {
      kind: "tool_results",
      results: [
        {
          type: "tool_result",
          callId: "call" as never,
          status: "denied",
          content: [{ type: "text", text: "Denied evidence retained" }],
        },
      ],
    },
    sid,
    null,
    runId,
  );
  // A later conflicting declaration must not relabel the earlier observation.
  await h.entry(assistant("later-tool"), sid, null, runId);
  const last = await h.api.history({ sessionId: sid, limit: 1 });
  const older = await h.api.history({ sessionId: sid, cursor: last.nextCursor ?? "", limit: 1 });
  expect(older.items[0]).toMatchObject({
    tool: "read",
    state: "denied",
    text: "Denied evidence retained",
  });
});

it("returns a continuation across pages containing only private reasoning", async () => {
  const h = await setup();
  await h.entry({ kind: "notice", code: "old", text: "old visible record" });
  for (let index = 0; index < 101; index++)
    await h.entry({
      kind: "user_message",
      steering: false,
      content: [{ type: "reasoning", kind: "visible", text: "PRIVATE" }],
    });
  const page = await h.api.history({ sessionId: sid });
  expect(page.items).toEqual([]);
  expect(page.nextCursor).not.toBeNull();
  const next = await h.api.history({ sessionId: sid, cursor: page.nextCursor ?? "" });
  expect(next.items[0]?.text).toBe("old visible record");
  expect(next.nextCursor).toBeNull();
});

it("persists names, groups, pin/mute, revision and recoverable removal without changing transcript", async () => {
  const h = await setup();
  await h.entry({
    kind: "user_message",
    steering: false,
    content: [{ type: "text", text: "Prompt label" }],
  });
  const before = await h.store.loadSession(sid);
  expect((await h.api.list()).items[0]?.metadata.revision).toBe(0);
  const changed = await h.api.update(
    {
      sessionId: sid,
      expectedRevision: 0,
      patch: { title: " Named work ", group: "Research", pinned: true, muted: true, removed: true },
    },
    now,
  );
  expect(changed.metadata).toEqual({
    title: "Named work",
    group: "Research",
    pinned: true,
    muted: true,
    removedAt: now,
    revision: 1,
  });
  expect((await h.api.list()).items).toEqual([]);
  expect(
    (await h.api.list({ removed: "removed", group: "Research", search: "named" })).items,
  ).toHaveLength(1);
  expect(await h.store.listSessions()).toEqual([sid]);
  expect(await h.store.isSessionRemoved(sid)).toBe(true);
  expect(await h.store.loadSession(sid)).toEqual(before);
  await expect(
    h.api.update({ sessionId: sid, expectedRevision: 0, patch: { title: "stale" } }, now),
  ).rejects.toThrow("changed");
  h.store.close();
  const reopened = new SqliteSessionStore(h.directory);
  try {
    const restored = await reopened.sessionManagement.update(
      { sessionId: sid, expectedRevision: 1, patch: { removed: false } },
      now,
    );
    expect(restored.metadata).toMatchObject({
      title: "Named work",
      muted: true,
      removedAt: null,
      revision: 2,
    });
    expect(await reopened.loadSession(sid)).toEqual(before);
  } finally {
    reopened.close();
  }
});

it("catalog keyset pages preserve pin/activity order and reject stale or foreign query cursors", async () => {
  const ids = [sid, "second", "third"].map((id) => id as SessionId);
  const h = await setup(ids);
  for (const id of ids)
    await h.entry(
      { kind: "user_message", steering: false, content: [{ type: "text", text: id }] },
      id,
    );
  await h.api.update({ sessionId: sid, expectedRevision: 0, patch: { pinned: true } }, now);
  const page = await h.api.list({ limit: 1 });
  expect(page.items[0]?.sessionId).toBe(sid);
  const rest = await h.api.list({ cursor: page.nextCursor ?? "" });
  expect(rest.items.map((s) => s.sessionId)).toEqual(["third", "second"]);
  await expect(h.api.list({ search: "third", cursor: page.nextCursor ?? "" })).rejects.toThrow(
    "refresh",
  );
  await h.api.update({ sessionId: sid, expectedRevision: 1, patch: { title: "changed" } }, now);
  await expect(h.api.list({ cursor: page.nextCursor ?? "" })).rejects.toThrow("refresh");
});

it("uses literal bounded name search rather than historical-content or SQL wildcard search", async () => {
  const h = await setup();
  await h.entry({
    kind: "user_message",
    steering: false,
    content: [{ type: "text", text: "old-hidden-text" }],
  });
  await h.entry({
    kind: "user_message",
    steering: false,
    content: [{ type: "text", text: "100% current_name" }],
  });
  expect((await h.api.list({ search: "%" })).items).toHaveLength(1);
  expect((await h.api.list({ search: "old-hidden" })).items).toHaveLength(0);
  expect((await h.api.list({ search: "' OR 1=1 --" })).items).toHaveLength(0);
});

it.each([
  { limit: 51 },
  { limit: -1 },
  { cursor: "not valid" },
  { search: "x".repeat(161) },
  { removed: "wrong" },
  { extra: true },
])("rejects invalid catalog queries: %j", async (query) => {
  const h = await setup();
  await expect(h.api.list(query as never)).rejects.toThrow();
});

it("rejects active work removal and never mutates it on failure", async () => {
  const h = await setup();
  await h.store.commit({
    entries: [],
    effects: [],
    runs: [{ runId: "run" as never, sessionId: sid, status: "active" }],
    durability: "normal",
  });
  await expect(
    h.api.update({ sessionId: sid, expectedRevision: 0, patch: { removed: true } }, now),
  ).rejects.toThrow("unsettled");
  expect((await h.api.list()).items[0]?.metadata.revision).toBe(0);
});

it("does not hide an interrupted run whose external effect remains unknown", async () => {
  const h = await setup();
  const runId = "unknown-run" as never;
  await h.store.commit({
    entries: [],
    effects: [],
    runs: [{ runId, sessionId: sid, status: "active" }],
    durability: "normal",
  });
  for (const state of ["intended", "approved", "started", "unknown"] as const)
    await h.store.commit({
      entries: [],
      effects: [
        {
          id: "effect" as never,
          runId,
          callId: "call" as never,
          tool: "external",
          profile: { class: "external", reversibility: "none", verification: "none" },
          digest: "digest" as never,
          state,
          updatedAt: now,
        },
      ],
      durability: "normal",
    });
  await h.store.commit({
    entries: [],
    effects: [],
    runs: [{ runId, sessionId: sid, status: "interrupted" }],
    durability: "normal",
  });
  await expect(
    h.api.update({ sessionId: sid, expectedRevision: 0, patch: { removed: true } }, now),
  ).rejects.toThrow("unsettled");
  expect((await h.api.list()).items).toHaveLength(1);
  expect((await h.store.unsettledEffects())[0]?.state).toBe("unknown");
});

it("backs up managed original bytes and references even when no transcript contains their blob", async () => {
  const h = await setup();
  const id = "material_11111111-2222-3333-4444-555555555555";
  const bytes = Buffer.from("Selected material original bytes");
  const pending = await h.store.materials.create({
    id,
    workspaceRoot: h.workspace,
    path: `moyyi-materials/${id}.txt`,
    name: "source.txt",
    format: "txt",
    bytes,
    createdAt: now,
  });
  await h.store.materials.activate(id, pending.revision);
  await h.store.materials.attach(sid, [id]);
  await h.api.update(
    { sessionId: sid, expectedRevision: 0, patch: { title: "saved", removed: true } },
    now,
  );
  const destination = join(h.root, "backup");
  await h.store.backup(destination);
  const reopened = new SqliteSessionStore(destination);
  try {
    expect(await reopened.materials.read(id)).toEqual(bytes);
    expect((await reopened.materials.get(id))?.referenceCount).toBe(1);
    expect((await reopened.materials.listSession(sid)).map((m) => m.id)).toEqual([id]);
    expect(
      (await reopened.sessionManagement.list({ removed: "removed" })).items[0]?.metadata.title,
    ).toBe("saved");
    const recycled = await reopened.materials.recycle(
      id,
      (await reopened.materials.get(id))?.revision ?? -1,
    );
    await expect(reopened.materials.purge(id, recycled.revision)).rejects.toThrow();
  } finally {
    reopened.close();
  }
});
