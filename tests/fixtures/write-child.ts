import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import {
  type ActionDigest,
  type EffectId,
  type EffectRecord,
  type EntryId,
  type RunId,
  type SessionId,
  type Timestamp,
  type ToolCallId,
  type TranscriptEntry,
  UNKNOWN_USAGE,
  type WorkspaceChange,
} from "../../src/contracts/index.ts";
import { NodeWorkspaceWrites } from "../../src/runtime/writes.ts";
import { SqliteSessionStore } from "../../src/store/index.ts";

const [checkpoint, operation, dataDirectory, workspaceRoot] = process.argv.slice(2);
if (!dataDirectory || !workspaceRoot || !["create", "edit"].includes(operation ?? ""))
  throw Error("Missing disposable write-crash arguments");
const store = new SqliteSessionStore(dataDirectory);
const sessionId = "session_write_crash" as SessionId;
const runId = "run_write_crash" as RunId;
const effect: EffectRecord = {
  id: "effect_write_crash" as EffectId,
  runId,
  callId: "call_write_crash" as ToolCallId,
  tool: operation as string,
  profile: { class: "workspace_write", reversibility: "snapshot", verification: "postcheck" },
  digest: "sha256:crash-fixture-approved" as ActionDigest,
  state: "intended",
  updatedAt: "2026-10-25T00:00:00.000Z" as Timestamp,
};
const request = await store.putBlob(new TextEncoder().encode("[]"));
const entry: TranscriptEntry = {
  id: "entry_write_crash" as EntryId,
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
        providerCallId: "wire_write_crash",
        providerItemId: null,
        name: operation as string,
        rawArguments:
          operation === "create"
            ? '{"path":"target.txt","text":"after"}'
            : '{"path":"target.txt","oldText":"before","newText":"after"}',
        argumentsSource: "verbatim",
      },
    ],
    stopReason: "tool_use",
    providerStopReason: "tool_calls",
    usage: UNKNOWN_USAGE,
    request: { rendererVersion: "write-crash-v1", system: request, tools: request, messages: [] },
  },
};
await store.commit({
  entries: [entry],
  effects: [effect],
  sessions: [{ sessionId, workspaceRoot, headEntryId: entry.id }],
  runs: [{ runId, sessionId, status: "active" }],
  durability: "normal",
});
await store.commit({
  entries: [],
  effects: [{ ...effect, state: "approved" }],
  durability: "normal",
});
const started: EffectRecord = { ...effect, state: "started" };
await store.commit({
  entries: [],
  effects: [started],
  leases: [{ kind: "acquire", workspaceRoot, runId }],
  durability: "before_side_effect",
});
const mutation: WorkspaceChange = {
  path: "target.txt",
  expectedHash: operation === "create" ? null : createHash("sha256").update("before").digest("hex"),
  text: "after",
  mode: operation === "create" ? 0o600 : 0o640,
};
const factory = new NodeWorkspaceWrites(store, [dataDirectory], {
  checkpoint(point) {
    if (point !== checkpoint) return;
    writeSync(1, "ready\n");
    // The parent sends a real SIGKILL while the store and write capability remain live.
    for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  },
});
await factory
  .create(
    {
      runId,
      workspaceRoot,
      signal: new AbortController().signal,
      limits: { maxOutputBytes: 32768 },
    },
    () => {},
    {
      phase: "execute",
      effect: started,
      action: {
        digest: effect.digest,
        summary: "Disposable process crash probe",
        preconditions: [{ kind: "file_hash", path: mutation.path, sha256: mutation.expectedHash }],
        payload: mutation,
      },
    },
  )
  .apply();
throw Error("Child did not stop at the requested checkpoint");
