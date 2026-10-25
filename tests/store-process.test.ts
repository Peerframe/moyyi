import { type ChildProcess, fork } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionId } from "../src/contracts/persisted/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

interface ChildMessage {
  type: string;
  message?: string;
}
interface Worker {
  child: ChildProcess;
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  waitFor(type: string): Promise<ChildMessage>;
}

const directories: string[] = [];
const workers: Worker[] = [];
const stores: SqliteSessionStore[] = [];

function disposable(): { directory: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), "moyyi-store-process-"));
  directories.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  return { directory: join(root, "store"), workspace };
}

function start(mode: string, paths: ReturnType<typeof disposable>, durability = "normal"): Worker {
  const child = fork(
    fileURLToPath(new URL("./fixtures/store-process-child.ts", import.meta.url)),
    [mode, paths.directory, paths.workspace, durability],
    { execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const messages: ChildMessage[] = [];
  const listeners = new Set<() => void>();
  let output = "";
  let stderr = "";
  let ended = false;
  let spawnError: Error | undefined;
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
    let index = output.indexOf("\n");
    while (index >= 0) {
      messages.push(JSON.parse(output.slice(0, index)) as ChildMessage);
      output = output.slice(index + 1);
      index = output.indexOf("\n");
    }
    for (const notify of listeners) notify();
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", (error) => {
    spawnError = error;
    for (const notify of listeners) notify();
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => {
      ended = true;
      for (const notify of listeners) notify();
      resolve({ code, signal });
    });
  });
  const worker: Worker = {
    child,
    closed,
    waitFor(type) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          listeners.delete(check);
          reject(new Error(`Timed out waiting for child ${type}: ${stderr}`));
        }, 10_000);
        function finish(error?: Error, message?: ChildMessage): void {
          clearTimeout(timeout);
          listeners.delete(check);
          if (error) reject(error);
          else resolve(message as ChildMessage);
        }
        function check(): void {
          const message = messages.find((item) => item.type === type);
          const failure = messages.find((item) => item.type === "error");
          if (message) finish(undefined, message);
          else if (failure || spawnError || ended) {
            finish(
              new Error(
                `Child failed before ${type}: ${failure?.message ?? spawnError?.message ?? stderr}`,
              ),
            );
          }
        }
        listeners.add(check);
        check();
      });
    },
  };
  workers.push(worker);
  return worker;
}

async function kill(worker: Worker): Promise<void> {
  if (worker.child.exitCode === null && worker.child.signalCode === null)
    worker.child.kill("SIGKILL");
  await worker.closed;
}

function open(directory: string): SqliteSessionStore {
  const store = new SqliteSessionStore(directory);
  stores.push(store);
  return store;
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map(kill));
  for (const store of stores.splice(0)) store.close();
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("real process interruption (not a physical power-loss test)", () => {
  it.each(["normal", "before_side_effect"])(
    "rolls back all uncommitted records after SIGKILL (%s)",
    async (durability) => {
      const paths = disposable();
      const child = start("transaction", paths, durability);
      await child.waitFor("ready");
      await kill(child);
      expect(await child.closed).toEqual({ code: null, signal: "SIGKILL" });

      const store = open(paths.directory);
      const snapshot = await store.loadSession("session_base" as SessionId);
      expect(snapshot?.headEntryId).toBe("entry_base");
      expect(snapshot?.entries.map((entry) => entry.id)).toEqual(["entry_base"]);
      expect(snapshot?.effects.map((effect) => effect.id)).toEqual(["effect_base"]);
      expect(snapshot?.runs).toEqual([
        { runId: "run_base", sessionId: "session_base", status: "active" },
      ]);
      expect(await store.loadSession("session_new" as SessionId)).toBeNull();
      expect((await store.unsettledEffects()).map((effect) => effect.id)).toEqual(["effect_base"]);
      expect(store.diagnostics()).toMatchObject({
        integrity: "ok",
        journalMode: "wal",
        synchronous: 2,
      });
    },
  );

  it.each(["normal", "before_side_effect"])(
    "retains an acknowledged whole transaction after SIGKILL (%s)",
    async (durability) => {
      const paths = disposable();
      const child = start("committed", paths, durability);
      await child.waitFor("ready");
      await kill(child);

      const store = open(paths.directory);
      const snapshot = await store.loadSession("session_base" as SessionId);
      expect(snapshot?.headEntryId).toBe("entry_next");
      expect(snapshot?.entries.map((entry) => entry.id)).toEqual(["entry_base", "entry_next"]);
      expect(snapshot?.effects.map((effect) => effect.id)).toEqual(["effect_base", "effect_next"]);
      expect(snapshot?.runs).toEqual([
        { runId: "run_base", sessionId: "session_base", status: "interrupted" },
        { runId: "run_next", sessionId: "session_base", status: "active" },
      ]);
      const added = await store.loadSession("session_new" as SessionId);
      expect(added?.entries.map((entry) => entry.id)).toEqual(["entry_new"]);
      expect(added?.effects.map((effect) => effect.id)).toEqual(["effect_new"]);
      expect(added?.runs).toEqual([
        { runId: "run_new", sessionId: "session_new", status: "active" },
      ]);
      expect((await store.unsettledEffects()).map((effect) => effect.id)).toEqual([
        "effect_base",
        "effect_new",
        "effect_next",
      ]);
      expect(store.diagnostics().integrity).toBe("ok");
    },
  );

  it("reopens cleanly after a killed first schema migration", async () => {
    const paths = disposable();
    const child = start("migration", paths);
    await child.waitFor("ready");
    await kill(child);
    const store = open(paths.directory);
    expect(store.diagnostics()).toMatchObject({
      schemaVersion: 2,
      persistedFormat: 1,
      integrity: "ok",
    });
    expect(await store.loadSession("session_base" as SessionId)).toBeNull();
  });
});

describe("OS writer lock across real processes", () => {
  it("refuses competing writers, failed acquisition does not steal the lock, and SIGKILL releases it", async () => {
    const paths = disposable();
    const owner = start("hold", paths);
    await owner.waitFor("ready");

    const first = start("attempt", paths);
    expect((await first.waitFor("rejected")).message).toMatch(/locked|busy/i);
    expect(await first.closed).toEqual({ code: 0, signal: null });
    const second = start("attempt", paths);
    expect((await second.waitFor("rejected")).message).toMatch(/locked|busy/i);
    expect(await second.closed).toEqual({ code: 0, signal: null });
    expect(owner.child.exitCode).toBeNull();
    expect(owner.child.signalCode).toBeNull();

    await kill(owner);
    const successor = start("attempt", paths);
    await successor.waitFor("acquired");
    expect(await successor.closed).toEqual({ code: 0, signal: null });
    expect(open(paths.directory).diagnostics().integrity).toBe("ok");
  });
});
