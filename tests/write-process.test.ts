import { type ChildProcess, fork } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { EffectId, SessionId } from "../src/contracts/index.ts";
import { scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const roots: string[] = [];
const stores: SqliteSessionStore[] = [];
const runtimes: Runtime[] = [];
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
const checkpoints = [
  "before_snapshot",
  "after_snapshot",
  "after_stage_sync",
  "before_publish",
  "after_publish",
  "after_parent_sync",
] as const;

describe.each(["edit", "create"])("real SIGKILL during %s", (operation) => {
  it.each(operation === "create" ? [...checkpoints, "after_create_link"] : checkpoints)(
    "recovers %s from durable state without executing again",
    async (checkpoint) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-write-process-")));
      roots.push(root);
      const workspace = join(root, "workspace");
      const directory = join(root, "store");
      mkdirSync(workspace);
      const target = join(workspace, "target.txt");
      if (operation === "edit") writeFileSync(target, "before", { mode: 0o640 });
      const child = fork(
        fileURLToPath(new URL("./fixtures/write-child.ts", import.meta.url)),
        [checkpoint, operation, directory, workspace],
        {
          execArgv: [],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      children.push({ child, closed });
      await new Promise<void>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(
          () => reject(Error(`Child did not reach checkpoint: ${stderr}`)),
          10000,
        );
        child.stdout?.on("data", (bytes) => {
          stdout += String(bytes);
          if (stdout.includes("ready\n")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.stderr?.on("data", (bytes) => {
          stderr += String(bytes);
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", () => {
          clearTimeout(timer);
          if (!stdout.includes("ready\n")) reject(Error(stderr));
        });
      });
      child.kill("SIGKILL");
      await closed;
      expect(child.signalCode).toBe("SIGKILL");
      const unverifiable = checkpoint === "after_create_link";
      const published =
        unverifiable || checkpoint === "after_publish" || checkpoint === "after_parent_sync";
      const expectedState = unverifiable ? "unknown" : published ? "succeeded" : "failed";
      const expectedText = published ? "after" : operation === "edit" ? "before" : null;
      const contents = () => (existsSync(target) ? readFileSync(target, "utf8") : null);
      expect(contents()).toBe(expectedText);
      const store = new SqliteSessionStore(directory);
      stores.push(store);
      const id = "session_write_crash" as SessionId;
      const effectId = "effect_write_crash" as EffectId;
      const interrupted = await store.loadSession(id);
      expect(interrupted?.effects[0]?.state).toBe("started");
      expect(interrupted?.leases).toHaveLength(1);
      const snapshot = await store.getSnapshotForEffect(effectId);
      expect(snapshot === null).toBe(checkpoint === "before_snapshot");
      if (snapshot?.beforeBlob)
        expect(
          Buffer.from((await store.getBlob(snapshot.beforeBlob)) as Uint8Array).toString(),
        ).toBe("before");
      const provider = scriptedProvider([]);
      const runtime = await createRuntime({
        store,
        model: { provider: "scripted", model: "scripted" },
        plugins: [{ plugin: provider.plugin }],
        workspaceWrites: { roots: [workspace], approval: "ask" },
      });
      runtimes.push(runtime);
      const recovered = await store.loadSession(id);
      expect(recovered?.runs[0]?.status).toBe("interrupted");
      expect(recovered?.effects[0]?.state).toBe(expectedState);
      expect(recovered?.leases).toHaveLength(unverifiable ? 1 : 0);
      const results = recovered?.entries.flatMap((entry) =>
        entry.body.kind === "tool_results" ? entry.body.results : [],
      );
      expect(results).toHaveLength(1);
      expect(results?.[0]).toMatchObject({
        callId: "call_write_crash",
        status: expectedState,
      });
      expect(
        recovered?.entries.some(
          (entry) => entry.body.kind === "notice" && entry.body.code === "effect_reconciled",
        ),
      ).toBe(!unverifiable);
      expect(await store.getSnapshotForEffect(effectId)).toEqual(snapshot);
      expect(provider.client.requests).toHaveLength(0);
      expect(contents()).toBe(expectedText);
      if (published)
        expect(statSync(target).mode & 0o777).toBe(operation === "edit" ? 0o640 : 0o600);
      expect(store.diagnostics().integrity).toBe("ok");
      // Interrupted staging files can remain; recovery must not publish or mutate them.
      const afterRecovery = readdirSync(workspace).map((path) => [
        path,
        readFileSync(join(workspace, path), "utf8"),
      ]);
      await runtime.close();
      const second = await createRuntime({
        store,
        model: { provider: "scripted", model: "scripted" },
        plugins: [{ plugin: provider.plugin }],
        workspaceWrites: { roots: [workspace] },
      });
      runtimes.push(second);
      expect(await store.loadSession(id)).toEqual(recovered);
      expect(
        readdirSync(workspace).map((path) => [path, readFileSync(join(workspace, path), "utf8")]),
      ).toEqual(afterRecovery);
      expect(provider.client.requests).toHaveLength(0);
    },
  );
});
