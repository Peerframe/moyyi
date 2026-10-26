import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  type ActionDigest,
  type BlobRef,
  type EffectId,
  type EffectRecord,
  type EntryId,
  type ModelStreamEvent,
  type RunId,
  type RuntimeEvent,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type Timestamp,
  type ToolCallId,
  type ToolResultPart,
  type TranscriptEntry,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { historyPage, sessionCatalog, sessionResults } from "../src/runtime/history.ts";
import { createRuntime, type RuntimeOptions } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const sid = "session_history" as SessionId,
  run = "run_history" as RunId;
const at = "2026-10-27T00:00:00.000Z" as Timestamp;
const done: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
function emptyStore(snapshot: SessionSnapshot | null = null): SessionStore {
  return {
    listSessions: async () => [],
    loadSession: async () => snapshot,
    commit: async () => {},
    unsettledEffects: async () => [],
    putBlob: async () => {
      throw Error("unused blob write");
    },
    getBlob: async () => null,
  };
}
function effect(
  id: string,
  state: EffectRecord["state"] = "succeeded",
  tool = "create",
): EffectRecord {
  return {
    id: id as EffectId,
    runId: run,
    callId: `call_${id}` as ToolCallId,
    tool,
    profile:
      tool === "shell"
        ? { class: "process", reversibility: "none", verification: "none" }
        : { class: "workspace_write", reversibility: "snapshot", verification: "postcheck" },
    digest: "sha256:test" as ActionDigest,
    state,
    updatedAt: at,
  };
}
function result(e: EffectRecord): ToolResultPart {
  return {
    type: "tool_result",
    callId: e.callId,
    status: e.state as ToolResultPart["status"],
    content: [
      {
        type: "text",
        text: JSON.stringify(
          e.tool === "shell"
            ? { exitCode: 7, termination: "exited", truncated: true, output: "not part of receipt" }
            : { path: "report.md", snapshotId: e.id, beforeHash: null, afterHash: "a".repeat(64) },
        ),
      },
    ],
  };
}
function entry(
  id: string,
  body: TranscriptEntry["body"],
  runId: RunId | null = run,
): TranscriptEntry {
  return { id: id as EntryId, sessionId: sid, parentId: null, runId, createdAt: at, body };
}
function snapshot(
  effects: readonly EffectRecord[],
  entries: readonly TranscriptEntry[],
): SessionSnapshot {
  return {
    sessionId: sid,
    workspaceRoot: "/workspace",
    headEntryId: null,
    entries,
    effects,
    runs: [{ runId: run, sessionId: sid, status: "completed" }],
    leases: [],
  };
}

it("defaults and bounds history pages without coercing invalid client values", () => {
  expect(historyPage()).toEqual({ offset: 0, limit: 20 });
  expect(historyPage(10_000, 50)).toEqual({ offset: 10_000, limit: 50 });
  for (const [offset, limit] of [
    [-1, 20],
    [10_001, 20],
    [0.5, 20],
    [0, 0],
    [0, 51],
    [0, NaN],
    [null, 20],
    ["0", 20],
  ])
    expect(historyPage(offset as number, limit as number)).toBeNull();
});

it("pages every owned journal state with stable timestamps/IDs and bounded matched receipts", async () => {
  const effects = [
    effect("z", "unknown"),
    effect("c", "succeeded"),
    effect("b", "failed", "shell"),
    effect("a", "denied"),
    {
      ...effect("read", "succeeded", "read"),
      profile: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
    } satisfies EffectRecord,
  ];
  const s = snapshot(
    effects,
    effects.map((e) => entry(`entry_${e.id}`, { kind: "tool_results", results: [result(e)] })),
  );
  const store = emptyStore(s);
  const first = await sessionResults(store, sid, { offset: 0, limit: 2 });
  expect(first?.effects.map((e) => [e.effectId, e.state])).toEqual([
    ["a", "denied"],
    ["b", "failed"],
  ]);
  expect(first?.effects[0]?.receipt).toBeNull();
  expect(first?.effects[1]?.receipt).toEqual({
    kind: "process",
    exitCode: 7,
    termination: "exited",
    outputTruncated: true,
  });
  expect(first?.hasMore).toBe(true);
  const rest = await sessionResults(store, sid, { offset: 2, limit: 50 });
  expect(rest?.effects.map((e) => e.effectId)).toEqual(["c", "read", "z"]);
  expect(rest?.effects[0]?.receipt).toEqual({
    kind: "file",
    path: "report.md",
    snapshotId: "c",
    beforeHash: null,
    afterHash: "a".repeat(64),
  });
  expect(rest?.effects.slice(1).every((e) => e.receipt === null)).toBe(true);
  expect(rest?.hasMore).toBe(false);
  expect(JSON.stringify(rest)).not.toContain("not part of receipt");
  const later = { ...effect("latest"), updatedAt: "2026-10-28T00:00:00.000Z" as Timestamp };
  expect(
    (
      await sessionResults(emptyStore(snapshot([...effects, later], [])), sid, {
        offset: 0,
        limit: 1,
      })
    )?.effects[0]?.effectId,
  ).toBe("latest");
});

it("rejects ambiguous, foreign-session/run and assistant-claimed receipts without hiding owned effects", async () => {
  const good = effect("good"),
    duplicate = effect("duplicate"),
    foreignResult = effect("foreign_result"),
    missing = effect("missing");
  const foreignRun = "other_run" as RunId;
  const foreignEffect = { ...effect("private_foreign"), runId: foreignRun };
  const s = snapshot(
    [good, duplicate, foreignResult, missing, foreignEffect],
    [
      entry("good", { kind: "tool_results", results: [result(good)] }),
      entry("duplicate1", { kind: "tool_results", results: [result(duplicate)] }),
      entry("duplicate2", { kind: "tool_results", results: [result(duplicate)] }),
      entry("wrongrun", { kind: "tool_results", results: [result(foreignResult)] }, foreignRun),
      {
        ...entry("wrongsession", { kind: "tool_results", results: [result(foreignResult)] }),
        sessionId: "another" as SessionId,
      },
      entry("userclaim", { kind: "user_message", content: [result(missing)], steering: false }),
      entry("assistantclaim", {
        kind: "assistant_message",
        content: [result(missing)],
        origin: scriptedProfile.origin,
        stopReason: "end_turn",
        providerStopReason: null,
        usage: UNKNOWN_USAGE,
        request: {
          rendererVersion: "test",
          system: "sha256:unused" as BlobRef,
          tools: "sha256:unused" as BlobRef,
          messages: [],
        },
      }),
    ],
  );
  const page = await sessionResults(emptyStore(s), sid, { offset: 0, limit: 50 });
  expect(page?.effects).toHaveLength(4);
  expect(JSON.stringify(page)).not.toContain("private_foreign");
  expect(page?.effects.filter((e) => e.receipt !== null).map((e) => e.effectId)).toEqual(["good"]);
  const mismatch = { ...s, sessionId: "another" as SessionId };
  await expect(sessionResults(emptyStore(mismatch), sid, { offset: 0, limit: 20 })).rejects.toThrow(
    "identity",
  );
});

it("does not confuse the same call ID in different owned runs", async () => {
  const first = effect("first"),
    second = { ...effect("second"), callId: first.callId, runId: "second_run" as RunId };
  const s = snapshot(
    [first, second],
    [
      entry("first-result", { kind: "tool_results", results: [result(first)] }),
      entry("second-result", { kind: "tool_results", results: [result(second)] }, second.runId),
    ],
  );
  const store = emptyStore({
    ...s,
    runs: [...s.runs, { runId: second.runId, sessionId: sid, status: "completed" }],
  });
  expect(
    (await sessionResults(store, sid, { offset: 0, limit: 20 }))?.effects.map((e) =>
      e.receipt?.kind === "file" ? e.receipt.snapshotId : null,
    ),
  ).toEqual(["first", "second"]);
});

it("bounds custom catalogs and excludes store-only extra fields", async () => {
  const store = emptyStore();
  const row = {
    sessionId: sid,
    workspaceRoot: "/workspace",
    lastActivityAt: at,
    promptPreview: "prompt",
    privateTranscript: "DO_NOT_FORWARD",
  };
  store.listSessionSummaries = async (page) => ({
    ...page,
    sessions: [row],
    hasMore: false,
    privateBlob: "DO_NOT_FORWARD",
  });
  expect(JSON.stringify(await sessionCatalog(store, { offset: 0, limit: 20 }))).not.toContain(
    "DO_NOT_FORWARD",
  );
  for (const patch of [
    { workspaceRoot: "x".repeat(4097) },
    { lastActivityAt: "x".repeat(129) as Timestamp },
    { promptPreview: "x".repeat(161) },
  ]) {
    store.listSessionSummaries = async (page) => ({
      ...page,
      sessions: [{ ...row, ...patch }],
      hasMore: false,
    });
    await expect(sessionCatalog(store, { offset: 0, limit: 20 })).rejects.toThrow("catalog record");
  }
});

async function harness(
  responses: readonly (readonly ModelStreamEvent[])[] = [],
  extra: Partial<RuntimeOptions> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-runtime-history-"));
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  const store = new SqliteSessionStore(join(directory, "data"));
  const provider = scriptedProvider(responses);
  const runtime = await createRuntime({
    store,
    model: scriptedProfile.origin,
    plugins: [{ plugin: provider.plugin }],
    ...(extra.store ? {} : { workspaceWrites: { roots: [workspace], approval: "allow" as const } }),
    ...extra,
  });
  cleanups.push(async () => {
    await runtime.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((e) => events.push(e));
  const session = async () => {
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    const ready = events.findLast((e) => e.type === "session.ready");
    if (ready?.type !== "session.ready") throw Error("No session");
    return ready.sessionId;
  };
  return { runtime, store, provider, events, workspace, session };
}

it("lists and inspects actual SQLite writes without changing selection, files, permissions or model usage", async () => {
  const h = await harness([
    [
      {
        type: "part_completed",
        index: 0,
        part: {
          type: "tool_call",
          name: "create",
          callId: "call_write" as ToolCallId,
          providerCallId: "call_write",
          providerItemId: null,
          rawArguments: JSON.stringify({ path: "report.md", text: "created" }),
          argumentsSource: "verbatim",
        },
      },
      { ...done, type: "completed", stopReason: "tool_use" },
    ],
    [{ type: "part_completed", index: 0, part: { type: "text", text: "Done" } }, done],
  ]);
  const original = await h.session();
  await h.runtime.send({
    type: "run.start",
    sessionId: original,
    input: [{ type: "text", text: "Create the report" }],
  });
  await h.runtime.idle();
  await h.session(); // A client has selected a different session; inspection must not emit ready.
  writeFileSync(join(h.workspace, "report.md"), "changed later by owner");
  const before = await h.store.loadSession(original),
    requests = h.provider.client.requests.length,
    start = h.events.length;
  await h.runtime.send({ type: "session.list" });
  await h.runtime.send({ type: "session.results", sessionId: original });
  const events = h.events.slice(start);
  expect(events.map((e) => e.type)).toEqual(["session.listed", "session.results"]);
  const listed = events[0];
  if (listed?.type !== "session.listed") throw Error();
  expect(listed.page.limit).toBe(20);
  expect(listed.page.sessions[0]?.sessionId).toBe(original);
  const results = events[1];
  if (results?.type !== "session.results") throw Error();
  expect(results.page.effects[0]?.receipt).toMatchObject({ kind: "file", path: "report.md" });
  expect(h.provider.client.requests).toHaveLength(requests);
  expect(await h.store.loadSession(original)).toEqual(before);
  expect(readFileSync(join(h.workspace, "report.md"), "utf8")).toBe("changed later by owner");
});

it("clearly rejects unsupported custom catalogs and redacts storage failures while load remains usable", async () => {
  const custom = emptyStore();
  const h = await harness([], { store: custom });
  await h.runtime.send({ type: "session.list" });
  expect(h.events.at(-1)).toMatchObject({
    type: "command.rejected",
    reason: "Configured store does not support the session catalog",
  });
  custom.loadSession = async () => ({ ...snapshot([], []), workspaceRoot: h.workspace });
  await h.runtime.send({ type: "session.load", sessionId: sid });
  expect(h.events.at(-1)).toEqual({ type: "session.ready", sessionId: sid });
  custom.listSessionSummaries = async () => {
    throw Error("/private/credential SECRET_CANARY");
  };
  await h.runtime.send({ type: "session.list" });
  custom.loadSession = async () => {
    throw Error("/private/credential SECRET_CANARY");
  };
  await h.runtime.send({ type: "session.results", sessionId: sid });
  expect(
    h.events
      .slice(-2)
      .every(
        (e) => e.type === "command.rejected" && e.reason === "Session history could not be read",
      ),
  ).toBe(true);
  expect(JSON.stringify(h.events)).not.toContain("SECRET_CANARY");
  expect(h.provider.client.requests).toHaveLength(0);
});

it("rejects invalid pages and unknown sessions without a model request", async () => {
  const h = await harness();
  await h.runtime.send({ type: "session.list", limit: 51 });
  await h.runtime.send({ type: "session.results", sessionId: sid, offset: -1 });
  await h.runtime.send({ type: "session.results", sessionId: sid });
  expect(h.events.every((e) => e.type === "command.rejected")).toBe(true);
  expect(h.events.at(-1)).toMatchObject({ reason: "Session not found" });
  expect(h.provider.client.requests).toHaveLength(0);
});

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it("admits only one inspection, rejects reload/run/load during it and suppresses its result on close", async () => {
  const h = await harness();
  const sessionId = await h.session(),
    gate = deferred();
  const original = h.store.loadSession.bind(h.store);
  vi.spyOn(h.store, "loadSession").mockImplementation(async (id) => {
    await gate.promise;
    return original(id);
  });
  const pending = h.runtime.send({ type: "session.results", sessionId });
  for (const command of [
    { type: "session.list" },
    { type: "session.load", sessionId },
    { type: "plugin.reload", name: "none" },
    { type: "run.start", sessionId, input: [{ type: "text", text: "must not run" }] },
  ] as const)
    await h.runtime.send(command);
  expect(h.events.filter((e) => e.type === "command.rejected")).toHaveLength(4);
  expect(
    h.events
      .filter((e) => e.type === "command.rejected")
      .every((e) => e.reason === "Session inspection is in progress"),
  ).toBe(true);
  let closed = false;
  const closing = h.runtime.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  await h.runtime.send({ type: "session.list" });
  expect(h.events.at(-1)).toMatchObject({ reason: "Runtime is closed" });
  gate.resolve();
  await pending;
  await closing;
  expect(h.events.some((e) => e.type === "session.results")).toBe(false);
  expect(h.provider.client.requests).toHaveLength(0);
});

it("rejects inspection during an active run and allows it after idle", async () => {
  const h = await harness([
    [{ type: "part_completed", index: 0, part: { type: "text", text: "Done" } }, done],
  ]);
  const sessionId = await h.session(),
    gate = deferred();
  const stream = h.provider.client.stream.bind(h.provider.client);
  vi.spyOn(h.provider.client, "stream").mockImplementation(async function* (request, signal) {
    await gate.promise;
    yield* stream(request, signal);
  });
  await h.runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: "test" }] });
  await h.runtime.send({ type: "session.list" });
  expect(h.events.at(-1)).toMatchObject({ reason: "Session inspection requires an idle runtime" });
  gate.resolve();
  await h.runtime.idle();
  await h.runtime.send({ type: "session.list" });
  expect(h.events.at(-1)?.type).toBe("session.listed");
});

it("rejects inspection during development reload without using storage", async () => {
  const gate = deferred();
  let loads = 0;
  const h = await harness([], {
    developmentPlugins: [
      {
        name: "history-dev",
        load: async () => {
          if (loads++) await gate.promise;
          return { plugin: { name: "history-dev", apiVersion: 1, setup() {} } };
        },
      },
    ],
  });
  const catalog = vi.spyOn(h.store, "listSessionSummaries");
  const reload = h.runtime.send({ type: "plugin.reload", name: "history-dev" });
  await h.runtime.send({ type: "session.list" });
  expect(h.events.at(-1)).toMatchObject({ reason: "Plugin reload is in progress" });
  expect(catalog).not.toHaveBeenCalled();
  gate.resolve();
  await reload;
});

it("rejects inspection while an accepted session load is pending", async () => {
  const h = await harness();
  const sessionId = await h.session(),
    gate = deferred();
  const load = h.store.loadSession.bind(h.store);
  vi.spyOn(h.store, "loadSession").mockImplementation(async (id) => {
    await gate.promise;
    return load(id);
  });
  const loading = h.runtime.send({ type: "session.load", sessionId });
  await h.runtime.send({ type: "session.list" });
  expect(h.events.at(-1)).toMatchObject({ reason: "Session inspection requires an idle runtime" });
  gate.resolve();
  await loading;
  await h.runtime.send({ type: "session.list" });
  expect(h.events.at(-1)?.type).toBe("session.listed");
});
