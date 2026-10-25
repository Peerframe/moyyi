import { type ChildProcess, fork } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  type EffectRecord,
  type EntryId,
  type RunId,
  type SessionId,
  type SessionSnapshot,
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

interface CrashCheckpoint {
  readonly checkpoint: string;
  readonly requests: number;
  readonly batch?: StoreBatch;
}

async function killAt(
  mode: string,
  directory: string,
  workspace: string,
): Promise<CrashCheckpoint> {
  const child = fork(
    fileURLToPath(new URL("./fixtures/core-process-child.ts", import.meta.url)),
    [mode, directory, workspace],
    { execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  children.push({ child, closed });
  const checkpoint = await new Promise<CrashCheckpoint>((resolve, reject) => {
    let stdout = "",
      stderr = "";
    const timer = setTimeout(
      () => reject(new Error(`Child did not reach ${mode}: ${stderr}`)),
      10_000,
    );
    child.stderr?.on("data", (value) => {
      stderr = (stderr + String(value)).slice(-8_192);
    });
    child.stdout?.on("data", (value) => {
      stdout += String(value);
      if (stdout.includes("\nready\n")) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.split("\n")[0] as string) as CrashCheckpoint);
        } catch (error) {
          reject(error);
        }
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timer);
      if (!stdout.includes("\nready\n")) reject(new Error(`Exited before ${mode}: ${stderr}`));
    });
  });
  child.kill("SIGKILL");
  await closed;
  expect(child.signalCode).toBe("SIGKILL");
  return checkpoint;
}

function disposable() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-core-crash-")));
  roots.push(root);
  const workspace = join(root, "workspace"),
    directory = join(root, "store");
  mkdirSync(workspace);
  return { directory, workspace };
}
function executionCount(workspace: string) {
  const path = join(workspace, "execution-count");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
function calls(snapshot: SessionSnapshot) {
  return snapshot.entries.flatMap((entry) =>
    entry.body.kind === "assistant_message"
      ? entry.body.content.filter((part) => part.type === "tool_call")
      : [],
  );
}
function results(snapshot: SessionSnapshot) {
  return snapshot.entries.flatMap((entry) =>
    entry.body.kind === "tool_results" ? entry.body.results : [],
  );
}
function recoveredNotices(snapshot: SessionSnapshot) {
  return snapshot.entries.filter(
    (entry) => entry.body.kind === "notice" && entry.body.code === "run_recovered",
  );
}
async function openStore(directory: string) {
  const store = new SqliteSessionStore(directory);
  stores.push(store);
  const [sessionId] = await store.listSessions();
  if (!sessionId) throw new Error("Missing persisted session");
  const snapshot = await store.loadSession(sessionId);
  if (!snapshot) throw new Error("Missing persisted snapshot");
  return { store, sessionId, snapshot };
}
async function boot(store: SqliteSessionStore) {
  const provider = scriptedProvider([]);
  const prepare = vi.fn(async () => {
    throw new Error("Recovery must never prepare an available action");
  });
  const execute = vi.fn(async () => {
    throw new Error("Recovery must never execute an available action");
  });
  const runtime = await createRuntime({
    store,
    model: { provider: "scripted", model: "scripted" },
    plugins: [
      { plugin: provider.plugin },
      {
        plugin: {
          name: "synthetic-recovery-observer",
          apiVersion: 1,
          setup(host) {
            host.registerTool({
              name: "synthetic_write",
              description: "Available only to detect accidental recovery replay",
              inputSchema: { type: "object" },
              effect: { class: "workspace_write", reversibility: "none", verification: "none" },
              prepare,
              execute,
              reconcile: async () => ({ resolved: false, reason: "No new evidence" }),
            });
          },
        },
      },
    ],
    policy: {
      beforePrepare: () => ({ kind: "allow" }),
      beforeExecute: () => ({ kind: "allow" }),
    },
  });
  runtimes.push(runtime);
  expect(provider.client.requests).toEqual([]);
  expect(prepare).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  return runtime;
}

const crashMatrix = [
  { mode: "session-created", run: false, call: false, effect: null, executed: false, lease: false },
  { mode: "run-started", run: true, call: false, effect: null, executed: false, lease: false },
  { mode: "assistant-call", run: true, call: true, effect: null, executed: false, lease: false },
  { mode: "intended", run: true, call: true, effect: "intended", executed: false, lease: false },
  {
    mode: "awaiting_approval",
    run: true,
    call: true,
    effect: "awaiting_approval",
    executed: false,
    lease: false,
  },
  { mode: "approved", run: true, call: true, effect: "approved", executed: false, lease: false },
  {
    mode: "lease-acquired",
    run: true,
    call: true,
    effect: "approved",
    executed: false,
    lease: true,
  },
  {
    mode: "started-barrier",
    run: true,
    call: true,
    effect: "started",
    executed: false,
    lease: true,
  },
  { mode: "started", run: true, call: true, effect: "started", executed: true, lease: true },
  { mode: "settled", run: true, call: true, effect: "succeeded", executed: true, lease: true },
  {
    mode: "assistant-final",
    run: true,
    call: true,
    effect: "succeeded",
    executed: true,
    lease: true,
  },
  {
    mode: "run-finalized",
    run: true,
    call: true,
    effect: "succeeded",
    executed: true,
    lease: false,
  },
] as const;

it.each(crashMatrix)(
  "recovers SIGKILL after $mode without losing pairing or replaying an action",
  async (row) => {
    const { directory, workspace } = disposable();
    const checkpoint = await killAt(row.mode, directory, workspace);
    const { store, sessionId, snapshot: before } = await openStore(directory);
    const completed = row.mode === "run-finalized";
    expect(before.runs.map((run) => run.status)).toEqual(
      row.run ? [completed ? "completed" : "active"] : [],
    );
    expect(before.effects.map((effect) => effect.state)).toEqual(row.effect ? [row.effect] : []);
    expect(before.leases).toHaveLength(row.lease ? 1 : 0);
    if (row.lease)
      expect(before.leases).toEqual([{ workspaceRoot: workspace, runId: before.runs[0]?.runId }]);
    expect(calls(before)).toHaveLength(row.call ? 1 : 0);
    expect(results(before)).toHaveLength(row.effect === "succeeded" ? 1 : 0);
    expect(executionCount(workspace)).toBe(row.executed ? "1" : "");
    if (row.mode === "started-barrier")
      expect(checkpoint.batch?.durability).toBe("before_side_effect");
    if (row.mode === "settled") {
      expect(checkpoint.batch?.effects.map((effect) => effect.state)).toEqual(["succeeded"]);
      expect(checkpoint.batch?.entries.map((entry) => entry.body.kind)).toEqual(["tool_results"]);
    }
    if (completed)
      expect(checkpoint.batch?.leases?.map((lease) => lease.kind)).toEqual(["release"]);
    const runtime = await boot(store);
    const after = await store.loadSession(sessionId);
    if (!after) throw new Error("Session disappeared");
    const recoveredState =
      row.effect === "started" ? "unknown" : row.effect === "succeeded" ? "succeeded" : "cancelled";
    expect(after.runs.map((run) => run.status)).toEqual(
      row.run ? [completed ? "completed" : "interrupted"] : [],
    );
    expect(after.effects.map((effect) => effect.state)).toEqual(row.effect ? [recoveredState] : []);
    expect(results(after).map((result) => [result.callId, result.status])).toEqual(
      row.call ? [["call_crash", recoveredState]] : [],
    );
    expect(after.leases).toEqual(row.effect === "started" ? before.leases : []);
    expect(recoveredNotices(after)).toHaveLength(row.run && !completed ? 1 : 0);
    expect(after.entries.slice(0, before.entries.length)).toEqual(before.entries);
    if (row.effect === "succeeded")
      expect(results(after)[0]?.content).toEqual([{ type: "text", text: "exact durable result" }]);
    if (completed || !row.run) expect(after).toEqual(before);
    expect(executionCount(workspace)).toBe(row.executed ? "1" : "");
    expect(store.diagnostics().integrity).toBe("ok");
    await runtime.close();
    await boot(store);
    expect(await store.loadSession(sessionId)).toEqual(after);
    expect(executionCount(workspace)).toBe(row.executed ? "1" : "");
  },
);

it.each([
  { initial: "run-started", recovery: "recovery-normalized", status: null, count: "" },
  { initial: "lease-acquired", recovery: "recovery-normalized", status: "cancelled", count: "" },
  { initial: "started", recovery: "recovery-normalized", status: "unknown", count: "1" },
  { initial: "settled", recovery: "recovery-normalized", status: "succeeded", count: "1" },
  { initial: "started", recovery: "recovery-finalized", status: "unknown", count: "1" },
  { initial: "started", recovery: "recovery-reconciled", status: "succeeded", count: "1" },
])(
  "recovery survives another SIGKILL at $initial / $recovery",
  async ({ initial, recovery, status, count }) => {
    const { directory, workspace } = disposable();
    await killAt(initial, directory, workspace);
    const checkpoint = await killAt(recovery, directory, workspace);
    expect(checkpoint.requests).toBe(0);
    const { store, sessionId, snapshot: partial } = await openStore(directory);
    const runtime = await boot(store);
    const final = await store.loadSession(sessionId);
    if (!final) throw new Error("Session disappeared");
    expect(final.runs.map((run) => run.status)).toEqual(["interrupted"]);
    expect(final.effects.map((effect) => effect.state)).toEqual(status ? [status] : []);
    expect(results(final).map((result) => [result.callId, result.status])).toEqual(
      status ? [["call_crash", status]] : [],
    );
    expect(recoveredNotices(final)).toHaveLength(1);
    expect(final.leases).toHaveLength(status === "unknown" ? 1 : 0);
    if (status === "unknown") expect(final.leases).toEqual(partial.leases);
    expect(final.entries.slice(0, partial.entries.length)).toEqual(partial.entries);
    expect(executionCount(workspace)).toBe(count);
    if (recovery === "recovery-reconciled") {
      expect(checkpoint.batch?.effects.map((effect) => effect.state)).toEqual(["succeeded"]);
      expect(checkpoint.batch?.entries.map((entry) => entry.body.kind)).toEqual(["notice"]);
      expect(
        final.entries.filter(
          (entry) => entry.body.kind === "notice" && entry.body.code === "effect_reconciled",
        ),
      ).toHaveLength(1);
    }
    if (recovery === "recovery-finalized") {
      expect(checkpoint.batch?.runs).toEqual(final.runs);
      expect(checkpoint.batch?.entries.map((entry) => entry.body.kind)).toEqual([
        "tool_results",
        "notice",
      ]);
    }
    expect(store.diagnostics().integrity).toBe("ok");
    await runtime.close();
    await boot(store);
    expect(await store.loadSession(sessionId)).toEqual(final);
    expect(executionCount(workspace)).toBe(count);
  },
);

it.each(["verified synthetic result", `a${String.fromCodePoint(0x1f600).repeat(3000)}`])(
  "atomically reconciles evidence without rewriting history, including Unicode truncation %#",
  async (evidence) => {
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
          evidence,
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
      evidence: evidence.slice(0, 4096).toWellFormed(),
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
      text: expect.stringContaining(
        `call_reconcile is now succeeded: ${evidence.slice(0, 4096).toWellFormed()}`,
      ),
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
  },
);

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
