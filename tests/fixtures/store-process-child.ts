import { writeSync } from "node:fs";
import type {
  EffectRecord,
  EntryId,
  RunId,
  SessionId,
  TranscriptEntry,
} from "../../src/contracts/persisted/index.ts";
import type { StoreBatch } from "../../src/contracts/ports.ts";
import { SqliteSessionStore } from "../../src/store/index.ts";

const [mode, directory, workspaceRoot, durability = "normal"] = process.argv.slice(2);
if (!directory || !workspaceRoot) throw new Error("Missing disposable store paths");

function send(type: string, message?: string): void {
  writeSync(1, `${JSON.stringify({ type, message })}\n`);
}

function stopAtCheckpoint(): never {
  // A synchronous write proves the child has entered the critical section. Awaiting IPC
  // here would let the transaction finish; Atomics.wait deliberately holds it open.
  send("ready");
  for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

function entry(
  id: string,
  sessionId: string,
  runId: string,
  parentId: string | null,
): TranscriptEntry {
  return {
    id,
    sessionId,
    runId,
    parentId,
    createdAt: "2026-10-25T00:00:00.000Z",
    body: { kind: "notice", code: "process_test", text: id },
  } as TranscriptEntry;
}

function effect(id: string, runId: string): EffectRecord {
  return {
    id,
    runId,
    callId: `call_${id}`,
    tool: "read",
    digest: "sha256:fixture",
    profile: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
    state: "intended",
    updatedAt: "2026-10-25T00:00:00.000Z",
  } as EffectRecord;
}

async function main(): Promise<void> {
  if (mode === "attempt") {
    let store: SqliteSessionStore;
    try {
      store = new SqliteSessionStore(directory as string);
    } catch (error) {
      send("rejected", String(error));
      return;
    }
    store.close();
    send("acquired");
    return;
  }

  let armed = false;
  const store = new SqliteSessionStore(directory as string, {
    checkpoint(point) {
      if (mode === "migration" && point === "migration:before_commit") stopAtCheckpoint();
      if (mode === "transaction" && armed && point === "commit:before_commit") stopAtCheckpoint();
    },
  });
  if (mode === "hold") stopAtCheckpoint();
  if (mode !== "transaction" && mode !== "committed") throw new Error("Invalid child mode");
  if (durability !== "normal" && durability !== "before_side_effect")
    throw new Error("Invalid durability");

  await store.commit({
    sessions: [
      {
        sessionId: "session_base" as SessionId,
        workspaceRoot: workspaceRoot as string,
        headEntryId: "entry_base" as EntryId,
      },
    ],
    runs: [
      { runId: "run_base" as RunId, sessionId: "session_base" as SessionId, status: "active" },
    ],
    entries: [entry("entry_base", "session_base", "run_base", null)],
    effects: [effect("effect_base", "run_base")],
    durability,
  });
  armed = true;
  const pending: StoreBatch = {
    sessions: [
      {
        sessionId: "session_base" as SessionId,
        workspaceRoot: workspaceRoot as string,
        headEntryId: "entry_next" as EntryId,
      },
      {
        sessionId: "session_new" as SessionId,
        workspaceRoot: workspaceRoot as string,
        headEntryId: "entry_new" as EntryId,
      },
    ],
    runs: [
      { runId: "run_base" as RunId, sessionId: "session_base" as SessionId, status: "interrupted" },
      { runId: "run_next" as RunId, sessionId: "session_base" as SessionId, status: "active" },
      { runId: "run_new" as RunId, sessionId: "session_new" as SessionId, status: "active" },
    ],
    entries: [
      entry("entry_next", "session_base", "run_next", "entry_base"),
      entry("entry_new", "session_new", "run_new", null),
    ],
    effects: [effect("effect_next", "run_next"), effect("effect_new", "run_new")],
    durability,
  };
  await store.commit(pending);
  stopAtCheckpoint();
}

try {
  await main();
} catch (error) {
  send("error", error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
