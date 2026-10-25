import { type ChildProcess, fork } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { SessionSnapshot } from "../src/contracts/index.ts";
import { scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../src/runtime/index.ts";
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

it.each(["before", "after"])(
  "SIGKILL %s compaction publication preserves an atomic head and full audit history",
  async (mode) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-compaction-crash-")));
    roots.push(root);
    const directory = join(root, "store"),
      workspace = join(root, "workspace"),
      baselineFile = join(root, "baseline.json");
    mkdirSync(workspace);
    const child = fork(
      fileURLToPath(new URL("./fixtures/compaction-process-child.ts", import.meta.url)),
      [mode, directory, workspace, baselineFile],
      {
        execArgv: [],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    children.push({ child, closed });
    const marker = await new Promise<{ mode: string; requests: number }>((resolve, reject) => {
      let stdout = "",
        stderr = "";
      const timer = setTimeout(
        () => reject(new Error(`Compaction checkpoint unavailable: ${stderr}`)),
        10_000,
      );
      child.stdout?.on("data", (data) => {
        stdout += String(data);
        if (stdout.includes("\nready\n")) {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(stdout.split("\n")[0] as string));
          } catch (error) {
            reject(error);
          }
        }
      });
      child.stderr?.on("data", (data) => {
        stderr = (stderr + String(data)).slice(-8_192);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", () => {
        clearTimeout(timer);
        if (!stdout.includes("\nready\n"))
          reject(new Error(`Child exited before checkpoint: ${stderr}`));
      });
    });
    expect(marker).toEqual({ mode, requests: 5 });
    child.kill("SIGKILL");
    await closed;
    expect(child.signalCode).toBe("SIGKILL");
    const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as SessionSnapshot;
    expect(baseline.entries).toHaveLength(8);
    expect(baseline.runs).toHaveLength(4);
    const store = new SqliteSessionStore(directory);
    stores.push(store);
    const interrupted = await store.loadSession(baseline.sessionId);
    if (!interrupted) throw new Error("Missing compaction session");
    expect(interrupted.entries.slice(0, baseline.entries.length)).toEqual(baseline.entries);
    expect(interrupted.runs.filter((run) => run.status === "completed")).toEqual(baseline.runs);
    const [active] = interrupted.runs.filter((run) => run.status === "active");
    if (!active) throw new Error("Missing interrupted compaction run");
    expect(interrupted.runs.filter((run) => run.status === "active")).toHaveLength(1);
    const published = interrupted.entries.filter((entry) => entry.runId === active.runId);
    if (mode === "before") {
      expect(published).toEqual([]);
      expect(interrupted.headEntryId).toBe(baseline.headEntryId);
    } else {
      expect(published.map((entry) => entry.body.kind)).toEqual([
        "assistant_message",
        "compaction",
      ]);
      const [audit, compacted] = published;
      expect(interrupted.headEntryId).toBe(compacted?.id);
      expect(audit?.parentId).toBe(baseline.headEntryId);
      expect(compacted?.parentId).toBe(baseline.headEntryId);
      if (audit?.body.kind !== "assistant_message" || compacted?.body.kind !== "compaction")
        throw new Error("Summary and its audit did not commit together");
      expect(audit.body.request.rendererVersion).toBe("moyyi-compaction-v1");
      expect(audit.body.content).toEqual(compacted.body.summary);
      const refs = [
        audit.body.request.system,
        audit.body.request.tools,
        ...audit.body.request.messages,
      ];
      for (const ref of refs) expect(await store.getBlob(ref)).not.toBeNull();
      expect(compacted.body.replaces).toEqual({
        fromEntryId: baseline.entries[0]?.id,
        toEntryId: baseline.entries[3]?.id,
      });
    }
    const provider = scriptedProvider([]);
    const boot = async () => {
      const runtime = await createRuntime({
        store,
        model: { provider: "scripted", model: "scripted" },
        plugins: [{ plugin: provider.plugin }],
      });
      runtimes.push(runtime);
      return runtime;
    };
    const runtime = await boot();
    const recovered = await store.loadSession(baseline.sessionId);
    if (!recovered) throw new Error("Session disappeared during recovery");
    expect(recovered.runs.find((run) => run.runId === active.runId)?.status).toBe("interrupted");
    expect(recovered.runs.filter((run) => run.runId !== active.runId)).toEqual(baseline.runs);
    expect(recovered.entries.slice(0, interrupted.entries.length)).toEqual(interrupted.entries);
    const notices = recovered.entries.filter(
      (entry) => entry.body.kind === "notice" && entry.body.code === "run_recovered",
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.parentId).toBe(interrupted.headEntryId);
    expect(recovered.headEntryId).toBe(notices[0]?.id);
    expect(recovered.effects).toEqual([]);
    expect(recovered.leases).toEqual([]);
    expect(provider.client.requests).toEqual([]);
    expect(store.diagnostics().integrity).toBe("ok");
    await runtime.close();
    await boot();
    expect(await store.loadSession(baseline.sessionId)).toEqual(recovered);
    expect(provider.client.requests).toEqual([]);
  },
);
