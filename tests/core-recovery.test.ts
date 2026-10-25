import { type ChildProcess, fork } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  type EffectRecord,
  type EntryId,
  type RunId,
  type SessionId,
  type SessionStore,
  type StoreBatch,
  type ToolDefinition,
  type TranscriptEntry,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import type { Runtime } from "../src/runtime/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const roots: string[] = [],
  stores: SqliteSessionStore[] = [],
  runtimes: Runtime[] = [];
const children: { child: ChildProcess; closed: Promise<void> }[] = [];
afterEach(async () => {
  for (const { child, closed } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["started", "settled"])(
  "recovers a real process killed after %s without replaying any action",
  async (mode) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-core-crash-")));
    roots.push(root);
    const workspace = join(root, "workspace"),
      directory = join(root, "store");
    mkdirSync(workspace);
    const child = fork(
      fileURLToPath(new URL("./fixtures/core-process-child.ts", import.meta.url)),
      [mode, directory, workspace],
      { execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    children.push({ child, closed });
    await new Promise<void>((resolve, reject) => {
      let stdout = "",
        stderr = "";
      const timer = setTimeout(
        () => reject(new Error(`Child did not reach checkpoint: ${stderr}`)),
        10_000,
      );
      child.stderr?.on("data", (value) => {
        stderr += String(value);
      });
      child.stdout?.on("data", (value) => {
        stdout += String(value);
        if (stdout.includes("ready\n")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", () => {
        clearTimeout(timer);
        if (!stdout.includes("ready\n")) reject(new Error(stderr));
      });
    });
    child.kill("SIGKILL");
    await closed;
    const store = new SqliteSessionStore(directory);
    stores.push(store);
    const provider = scriptedProvider([]);
    const runtime = await createRuntime({
      store,
      model: { provider: "scripted", model: "scripted" },
      plugins: [{ plugin: provider.plugin }],
    });
    runtimes.push(runtime);
    const [sessionId] = await store.listSessions();
    if (!sessionId) throw new Error("Missing persisted session");
    const snapshot = await store.loadSession(sessionId);
    expect(snapshot?.runs.map((run) => run.status)).toEqual(["interrupted"]);
    expect(snapshot?.effects.map((effect) => effect.state)).toEqual([
      mode === "started" ? "unknown" : "succeeded",
    ]);
    const results = snapshot?.entries.flatMap((entry) =>
      entry.body.kind === "tool_results" ? entry.body.results : [],
    );
    expect(results).toHaveLength(1);
    expect(results?.[0]?.status).toBe(mode === "started" ? "unknown" : "succeeded");
    if (mode === "settled")
      expect(results?.[0]?.content).toEqual([{ type: "text", text: "exact durable result" }]);
    expect(snapshot?.leases).toHaveLength(mode === "started" ? 1 : 0);
    expect(provider.client.requests).toHaveLength(0);
    expect(readFileSync(join(workspace, "execution-count"), "utf8")).toBe("1");
    expect(store.diagnostics().integrity).toBe("ok");
    await runtime.close();
    const again = await createRuntime({
      store,
      model: { provider: "scripted", model: "scripted" },
      plugins: [{ plugin: scriptedProvider([]).plugin }],
    });
    runtimes.push(again);
    expect(await store.loadSession(sessionId)).toEqual(snapshot);
  },
);

it("atomically adds later reconciliation evidence without rewriting unknown history or replaying work", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-core-reconcile-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  const directory = join(root, "store");
  mkdirSync(workspace);
  const seed = new SqliteSessionStore(directory);
  stores.push(seed);
  const sessionId = "session_reconcile" as SessionId;
  const runId = "run_reconcile" as RunId;
  const request = await seed.putBlob(new TextEncoder().encode("[]"));
  const effect: EffectRecord = {
    id: "effect_reconcile",
    runId,
    callId: "call_reconcile",
    tool: "inspect",
    profile: { class: "read", reversibility: "not_applicable", verification: "postcheck" },
    digest: "sha256:synthetic",
    state: "intended",
    updatedAt: "2026-10-25T00:00:00Z",
  } as EffectRecord;
  const entry: TranscriptEntry = {
    id: "entry_call" as EntryId,
    sessionId,
    runId,
    parentId: null,
    createdAt: effect.updatedAt,
    body: {
      kind: "assistant_message",
      origin: { provider: "scripted", model: "scripted" },
      content: [
        {
          type: "tool_call",
          callId: effect.callId,
          providerCallId: "wire_call",
          providerItemId: null,
          name: "inspect",
          rawArguments: "{}",
          argumentsSource: "verbatim",
        },
      ],
      stopReason: "tool_use",
      providerStopReason: "tool_calls",
      usage: UNKNOWN_USAGE,
      request: { rendererVersion: "synthetic-v1", system: request, tools: request, messages: [] },
    },
  };
  await seed.commit({
    sessions: [{ sessionId, workspaceRoot: workspace, headEntryId: entry.id }],
    runs: [{ runId, sessionId, status: "active" }],
    entries: [entry],
    effects: [effect],
    durability: "normal",
  });
  await seed.commit({
    entries: [],
    effects: [{ ...effect, state: "approved" }],
    durability: "normal",
  });
  await seed.commit({
    entries: [],
    effects: [{ ...effect, state: "started" }],
    durability: "before_side_effect",
  });
  seed.close();

  const tool: ToolDefinition = {
    name: "inspect",
    description: "Synthetic read",
    inputSchema: { type: "object" },
    effect: effect.profile,
    prepare: vi.fn(async () => {
      throw Error("Recovery must not prepare");
    }),
    execute: vi.fn(async () => {
      throw Error("Recovery must not execute");
    }),
    reconcile: vi
      .fn<NonNullable<ToolDefinition["reconcile"]>>()
      .mockResolvedValueOnce({ resolved: false, reason: "Evidence not available yet" })
      .mockResolvedValue({
        resolved: true,
        status: "succeeded",
        evidence: "verified synthetic result",
      }),
  };
  const clients: ReturnType<typeof scriptedProvider>["client"][] = [];
  const reconciliationBatches: StoreBatch[] = [];
  async function boot(rejectReconciliation = false) {
    const store = new SqliteSessionStore(directory);
    stores.push(store);
    const delegated: SessionStore = {
      listSessions: () => store.listSessions(),
      loadSession: (id) => store.loadSession(id),
      unsettledEffects: () => store.unsettledEffects(),
      putBlob: (bytes) => store.putBlob(bytes),
      getBlob: (ref) => store.getBlob(ref),
      async commit(batch) {
        if (
          batch.entries.some(
            (record) => record.body.kind === "notice" && record.body.code === "effect_reconciled",
          )
        ) {
          reconciliationBatches.push(batch);
          if (rejectReconciliation) throw Error("Injected reconciliation transaction failure");
        }
        await store.commit(batch);
      },
    };
    const provider = scriptedProvider([]);
    clients.push(provider.client);
    const runtime = await createRuntime({
      store: delegated,
      model: { provider: "scripted", model: "scripted" },
      plugins: [
        { plugin: provider.plugin },
        {
          plugin: {
            name: "synthetic-reconciliation",
            apiVersion: 1,
            setup: (host) => host.registerTool(tool),
          },
        },
      ],
    });
    runtimes.push(runtime);
    return { runtime, store, snapshot: await store.loadSession(sessionId) };
  }

  const first = await boot();
  expect(first.snapshot?.effects[0]?.state).toBe("unknown");
  expect(first.snapshot?.runs[0]?.status).toBe("interrupted");
  const originalUnknown = first.snapshot?.entries.find(
    (record) => record.body.kind === "tool_results",
  );
  expect(originalUnknown?.body).toMatchObject({
    kind: "tool_results",
    results: [{ callId: effect.callId, status: "unknown" }],
  });
  expect(
    first.snapshot?.entries.filter(
      (record) => record.body.kind === "notice" && record.body.code === "effect_reconciled",
    ),
  ).toEqual([]);
  await first.runtime.close();
  first.store.close();

  const faulted = await boot(true);
  expect(reconciliationBatches).toHaveLength(1);
  const rejectedBatch = reconciliationBatches[0];
  expect(rejectedBatch?.effects).toHaveLength(1);
  expect(rejectedBatch?.effects[0]).toMatchObject({ id: effect.id, state: "succeeded" });
  expect(rejectedBatch?.entries).toHaveLength(1);
  expect(rejectedBatch?.entries[0]?.body).toMatchObject({
    kind: "notice",
    code: "effect_reconciled",
  });
  expect(rejectedBatch?.sessions).toEqual([
    { sessionId, workspaceRoot: workspace, headEntryId: rejectedBatch?.entries[0]?.id },
  ]);
  // Neither the terminal state nor its notice was published. A later startup must still be
  // able to reconcile rather than silently preserving an uncorrected unknown tool result.
  expect(faulted.snapshot).toEqual(first.snapshot);
  expect(faulted.snapshot?.effects[0]?.state).toBe("unknown");
  await faulted.runtime.close();
  faulted.store.close();

  const second = await boot();
  expect(reconciliationBatches).toHaveLength(2);
  expect(second.snapshot?.effects[0]).toMatchObject({
    state: "succeeded",
    evidence: "verified synthetic result",
  });
  expect(second.snapshot?.entries.find((record) => record.id === originalUnknown?.id)).toEqual(
    originalUnknown,
  );
  const notices = second.snapshot?.entries.filter(
    (record) => record.body.kind === "notice" && record.body.code === "effect_reconciled",
  );
  expect(notices).toHaveLength(1);
  expect(notices?.[0]?.body).toMatchObject({
    kind: "notice",
    text: expect.stringContaining("call_reconcile is now succeeded: verified synthetic result"),
  });
  await second.runtime.close();
  second.store.close();

  const third = await boot();
  expect(third.snapshot).toEqual(second.snapshot);
  expect(tool.reconcile).toHaveBeenCalledTimes(3);
  expect(reconciliationBatches).toHaveLength(2);
  expect(tool.prepare).not.toHaveBeenCalled();
  expect(tool.execute).not.toHaveBeenCalled();
  for (const client of clients) expect(client.requests).toEqual([]);
  expect(third.store.diagnostics().integrity).toBe("ok");
});

it("recovers an active run with no effects through persisted session enumeration", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-core-empty-recovery-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  const directory = join(root, "store");
  mkdirSync(workspace);
  const store = new SqliteSessionStore(directory);
  stores.push(store);
  const sessionId = "session_empty" as SessionId;
  const runId = "run_empty" as RunId;
  await store.commit({
    sessions: [{ sessionId, workspaceRoot: workspace, headEntryId: null }],
    runs: [{ runId, sessionId, status: "active" }],
    entries: [],
    effects: [],
    durability: "normal",
  });
  expect(await store.unsettledEffects()).toEqual([]);
  const provider = scriptedProvider([]);
  const runtime = await createRuntime({
    store,
    model: { provider: "scripted", model: "scripted" },
    plugins: [{ plugin: provider.plugin }],
  });
  runtimes.push(runtime);
  const recovered = await store.loadSession(sessionId);
  expect(recovered?.runs).toEqual([{ runId, sessionId, status: "interrupted" }]);
  expect(recovered?.effects).toEqual([]);
  expect(recovered?.entries).toHaveLength(1);
  expect(recovered?.entries[0]?.body).toMatchObject({ kind: "notice", code: "run_recovered" });
  expect(provider.client.requests).toEqual([]);
});
