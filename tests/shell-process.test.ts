import { type ChildProcess, fork } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionId } from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function waitUntil(check: () => boolean, message: string) {
  const end = performance.now() + 10_000;
  while (!check()) {
    if (performance.now() > end) throw Error(message);
    await delay(5);
  }
}
function collect(child: ChildProcess) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (bytes) => {
    stdout = (stdout + String(bytes)).slice(-4_096);
  });
  child.stderr?.on("data", (bytes) => {
    stderr = (stderr + String(bytes)).slice(-4_096);
  });
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  return { closed, ready: () => stdout.includes("ready\n"), errors: () => stderr };
}

describe("real SIGKILL around shell execution", () => {
  it.each(["started", "running"])("preserves %s as unknown without replay", async (checkpoint) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-shell-process-")));
    const workspace = join(root, "workspace");
    const directory = join(root, "store");
    mkdirSync(workspace);
    const child = fork(
      fileURLToPath(new URL("./fixtures/shell-process-child.ts", import.meta.url)),
      [checkpoint, directory, workspace],
      { execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    const io = collect(child);
    const runtimes: Runtime[] = [];
    let store: SqliteSessionStore | undefined;
    cleanups.push(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await io.closed;
      for (const runtime of runtimes.reverse()) await runtime.close();
      store?.close();
      // macOS does not promise parent-death cleanup. The disposable command is itself
      // bounded below one second; cleanup only targets its known synthetic group if needed.
      if (
        process.platform === "darwin" &&
        !existsSync(join(workspace, "ended")) &&
        existsSync(join(workspace, "process-group"))
      ) {
        const pid = Number(readFileSync(join(workspace, "process-group"), "utf8"));
        if (Number.isSafeInteger(pid) && pid > 1 && pid !== child.pid && pid !== process.pid) {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            /* Group already exited. */
          }
        }
      }
      rmSync(root, { recursive: true, force: true });
    });
    await waitUntil(
      () => io.ready() || child.exitCode !== null || child.signalCode !== null,
      "Child did not announce its checkpoint",
    );
    expect(io.ready(), io.errors()).toBe(true);
    if (checkpoint === "running")
      await waitUntil(
        () => existsSync(join(workspace, "marker")),
        "Command did not reach its real file effect",
      );
    child.kill("SIGKILL");
    await io.closed;
    expect(child.signalCode).toBe("SIGKILL");
    // Allow the deliberately short command to settle on macOS. This does not assert a
    // universal parent-death guarantee; Linux's PID namespace may terminate it earlier.
    if (checkpoint === "running") await delay(1_100);
    const marker = () =>
      existsSync(join(workspace, "marker"))
        ? readFileSync(join(workspace, "marker"), "utf8")
        : null;
    const expected = checkpoint === "running" ? "once" : null;
    expect(marker()).toBe(expected);
    store = new SqliteSessionStore(directory);
    const id = "session_shell_crash" as SessionId;
    const before = await store.loadSession(id);
    expect(before?.effects[0]?.state).toBe("started");
    expect(before?.leases).toHaveLength(1);
    const provider = scriptedProvider([]);
    const start = async () => {
      const runtime = await createRuntime({
        store,
        model: scriptedProfile.origin,
        plugins: [{ plugin: provider.plugin }],
        workspaceProcesses: { roots: [workspace], approval: "ask" },
      });
      runtimes.push(runtime);
      return runtime;
    };
    const first = await start();
    const recovered = await store.loadSession(id);
    expect(recovered?.effects[0]?.state).toBe("unknown");
    expect(recovered?.runs[0]?.status).toBe("interrupted");
    expect(recovered?.leases).toHaveLength(1);
    expect(
      recovered?.entries.flatMap((entry) =>
        entry.body.kind === "tool_results" ? entry.body.results : [],
      ),
    ).toMatchObject([{ callId: "call_shell_crash", status: "unknown" }]);
    expect(provider.client.requests).toHaveLength(0);
    expect(marker()).toBe(expected);
    expect(store.diagnostics().integrity).toBe("ok");
    await first.close();
    await start();
    expect(await store.loadSession(id)).toEqual(recovered);
    expect(marker()).toBe(expected);
    expect(provider.client.requests).toHaveLength(0);
  });
});
