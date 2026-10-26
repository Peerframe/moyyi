import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ContentPart,
  EntryId,
  SessionId,
  Timestamp,
  TranscriptEntry,
} from "../contracts/index.ts";
import { SqliteSessionStore } from "./index.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-catalog-"));
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  const store = new SqliteSessionStore(join(directory, "data"));
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function sessions(...ids: string[]) {
    await store.commit({
      entries: [],
      effects: [],
      durability: "normal",
      sessions: ids.map((sessionId) => ({
        sessionId: sessionId as SessionId,
        workspaceRoot: workspace,
        headEntryId: null,
      })),
    });
  }
  let count = 0;
  async function entry(
    sessionId: string,
    body: TranscriptEntry["body"],
    createdAt = "2026-10-27T00:00:00.000Z",
  ) {
    await store.commit({
      effects: [],
      durability: "normal",
      entries: [
        {
          id: `entry_${count++}` as EntryId,
          sessionId: sessionId as SessionId,
          parentId: null,
          runId: null,
          createdAt: createdAt as Timestamp,
          body,
        },
      ],
    });
  }
  const user = (sessionId: string, content: readonly ContentPart[]) =>
    entry(sessionId, { kind: "user_message", content, steering: false });
  return { directory, workspace, store, sessions, entry, user };
}

it("orders by latest recorded ordinal, preserves empty sessions and pages stable ID ties", async () => {
  const h = setup();
  await h.sessions("empty_z", "early", "empty_a", "recent");
  await h.entry(
    "early",
    { kind: "notice", code: "test", text: "early" },
    "2029-01-01T00:00:00.000Z",
  );
  await h.entry(
    "recent",
    { kind: "notice", code: "test", text: "recent" },
    "2020-01-01T00:00:00.000Z",
  );
  const one = await h.store.listSessionSummaries({ offset: 0, limit: 2 });
  expect(one.sessions.map((s) => s.sessionId)).toEqual(["recent", "early"]);
  expect(one.sessions[0]?.lastActivityAt).toBe("2020-01-01T00:00:00.000Z");
  expect(one.hasMore).toBe(true);
  const two = await h.store.listSessionSummaries({ offset: 2, limit: 2 });
  expect(two.sessions).toEqual(
    ["empty_a", "empty_z"].map((sessionId) => ({
      sessionId,
      workspaceRoot: one.sessions[0]?.workspaceRoot,
      lastActivityAt: null,
      promptPreview: null,
    })),
  );
  expect(two.hasMore).toBe(false);
  expect(await h.store.listSessionSummaries({ offset: 4, limit: 2 })).toEqual({
    offset: 4,
    limit: 2,
    sessions: [],
    hasMore: false,
  });
});

it("returns only the last user entry's first text, bounded in UTF-16 without transcript/blob loads", async () => {
  const h = setup();
  await h.sessions("text", "no_text");
  await h.user("text", [{ type: "text", text: "old prompt" }]);
  await h.user("text", [
    { type: "reasoning", kind: "opaque" },
    { type: "text", text: `${"x".repeat(159)}😀${"tail".repeat(50_000)}` },
    { type: "text", text: "second text must not appear" },
  ]);
  await h.entry("text", { kind: "notice", code: "test", text: "not a title or prompt" });
  await h.user("no_text", [{ type: "text", text: "do not fall back here" }]);
  await h.user("no_text", [{ type: "reasoning", kind: "opaque" }]);
  const load = vi.spyOn(h.store, "loadSession"),
    blob = vi.spyOn(h.store, "getBlob");
  const page = await h.store.listSessionSummaries({ offset: 0, limit: 20 });
  expect(page.sessions.find((s) => s.sessionId === "text")?.promptPreview).toBe("x".repeat(159));
  expect(page.sessions.find((s) => s.sessionId === "no_text")?.promptPreview).toBeNull();
  expect(load).not.toHaveBeenCalled();
  expect(blob).not.toHaveBeenCalled();
});

it("retains sessions and schema across close/reopen without changing heads or records", async () => {
  const h = setup();
  await h.sessions("persisted");
  await h.user("persisted", [{ type: "text", text: "Continue tomorrow" }]);
  const before = await h.store.loadSession("persisted" as SessionId);
  const page = await h.store.listSessionSummaries({ offset: 0, limit: 1 });
  h.store.close();
  const reopened = new SqliteSessionStore(join(h.directory, "data"));
  try {
    expect(await reopened.listSessionSummaries({ offset: 0, limit: 1 })).toEqual(page);
    expect(await reopened.loadSession("persisted" as SessionId)).toEqual(before);
    expect(reopened.diagnostics()).toMatchObject({
      schemaVersion: 2,
      persistedFormat: 1,
      integrity: "ok",
    });
  } finally {
    reopened.close();
  }
});

it("uses limit plus one for hasMore and accepts the exact page bounds", async () => {
  const h = setup();
  await h.sessions(...Array.from({ length: 51 }, (_, i) => `s_${String(i).padStart(2, "0")}`));
  const page = await h.store.listSessionSummaries({ offset: 0, limit: 50 });
  expect(page.sessions).toHaveLength(50);
  expect(page.hasMore).toBe(true);
  expect((await h.store.listSessionSummaries({ offset: 50, limit: 1 })).hasMore).toBe(false);
  expect((await h.store.listSessionSummaries({ offset: 10_000, limit: 1 })).sessions).toEqual([]);
});

it.each([
  { offset: -1, limit: 20 },
  { offset: 10_001, limit: 20 },
  { offset: 0.5, limit: 20 },
  { offset: 0, limit: 0 },
  { offset: 0, limit: 51 },
  { offset: 0, limit: NaN },
])("rejects invalid catalog page %j", async (page) => {
  const { store } = setup();
  await expect(store.listSessionSummaries(page)).rejects.toThrow("Invalid session catalog page");
});
