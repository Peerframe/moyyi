import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ActionDigest,
  type ModelStreamEvent,
  type RuntimeEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { WorkspaceProcessPolicy } from "../src/policy/index.ts";
import { createRuntime, type RuntimeOptions } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const terminal = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
async function harness(
  command: string,
  configure: (root: string) => Partial<RuntimeOptions> = (root) => ({
    workspaceProcesses: { roots: [root] },
  }),
  timeoutMs = 3000,
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-shell-integration-"));
  const root = join(directory, "workspace");
  mkdirSync(root);
  writeFileSync(join(root, ".env"), "SECRET_CANARY");
  writeFileSync(join(directory, "outside"), "OUTSIDE_CANARY");
  const store = new SqliteSessionStore(join(directory, "data"));
  const provider = scriptedProvider([
    [
      {
        type: "part_completed",
        index: 0,
        part: {
          type: "tool_call",
          callId: "call_shell" as ToolCallId,
          providerCallId: "call_shell",
          providerItemId: null,
          name: "shell",
          rawArguments: JSON.stringify({ command, timeoutMs }),
          argumentsSource: "verbatim",
        },
      },
      terminal("tool_use"),
    ],
    [terminal("end_turn")],
  ]);
  const options: RuntimeOptions = {
    store,
    model: scriptedProfile.origin,
    plugins: [{ plugin: provider.plugin }],
    ...configure(root),
  };
  let runtime = await createRuntime(options);
  const events: RuntimeEvent[] = [];
  runtime.subscribe((e) => events.push(e));
  await runtime.send({ type: "session.create", workspaceRoot: root });
  const ready = events.find((e) => e.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("No session");
  const sessionId = ready.sessionId;
  cleanups.push(async () => {
    await runtime.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    root,
    store,
    events,
    sessionId,
    provider,
    get runtime() {
      return runtime;
    },
    approve(
      callback: (
        event: Extract<RuntimeEvent, { type: "approval.requested" }>,
      ) => "approve" | "deny" = () => "approve",
    ) {
      return runtime.subscribe((event) => {
        if (event.type === "approval.requested")
          void runtime.send({
            type: "approval.respond",
            effectId: event.effectId,
            digest: event.digest,
            decision: callback(event),
          });
      });
    },
    async start() {
      await runtime.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: "Run the synthetic shell fixture." }],
      });
    },
    async finish() {
      await runtime.idle();
      const s = await store.loadSession(sessionId);
      if (!s) throw Error("Missing session");
      return {
        ...s,
        results: s.entries.flatMap((e) => (e.body.kind === "tool_results" ? e.body.results : [])),
      };
    },
    async restart() {
      await runtime.close();
      runtime = await createRuntime(options);
      return runtime;
    },
  };
}

describe("sandboxed shell through the real runtime", () => {
  it("binds exact command approval and durably records start before command effects", async () => {
    const h = await harness("printf completed > result; printf output");
    h.approve((e) => {
      expect(e.preview).toContain("printf completed");
      expect(existsSync(join(h.root, "result"))).toBe(false);
      return "approve";
    });
    let durableStart = false;
    h.runtime.subscribe((e) => {
      if (e.type === "effect.updated" && e.effect.state === "started") {
        durableStart = true;
        expect(existsSync(join(h.root, "result"))).toBe(false);
      }
    });
    await h.start();
    const s = await h.finish();
    expect(durableStart).toBe(true);
    expect(s.results[0]?.status).toBe("succeeded");
    expect(s.effects[0]?.state).toBe("succeeded");
    expect(readFileSync(join(h.root, "result"), "utf8")).toBe("completed");
    expect(s.leases).toEqual([]);
    const effect = s.effects[0];
    if (!effect) throw Error("Missing effect");
    expect(await h.store.getSnapshotForEffect(effect.id)).toBeNull();
  });
  it.each(["read-only", "file-write-only", "deny", "cancel", "revoke"])(
    "%s cannot launch a command",
    async (mode) => {
      const policy = new WorkspaceProcessPolicy();
      const h = await harness("printf bad > result", (root) =>
        mode === "read-only"
          ? {}
          : mode === "file-write-only"
            ? { workspaceWrites: { roots: [root] } }
            : { workspaceProcesses: { roots: [root] }, policy },
      );
      h.approve(() => {
        if (mode === "revoke") policy.revoke();
        return mode === "deny" ? "deny" : "approve";
      });
      if (mode === "cancel")
        h.runtime.subscribe((e) => {
          if (e.type === "effect.updated" && e.effect.state === "intended") {
            const run = h.events.find((x) => x.type === "run.started");
            if (run?.type === "run.started")
              void h.runtime.send({ type: "run.cancel", runId: run.runId });
          }
        });
      await h.start();
      const s = await h.finish();
      expect(s.results[0]?.status).not.toBe("succeeded");
      expect(existsSync(join(h.root, "result"))).toBe(false);
    },
  );
  it("rejects a stale digest before accepting the displayed action", async () => {
    const h = await harness("printf approved > result");
    const pending: Promise<void>[] = [];
    h.runtime.subscribe((e) => {
      if (e.type === "approval.requested")
        pending.push(
          (async () => {
            await h.runtime.send({
              type: "approval.respond",
              effectId: e.effectId,
              digest: "stale" as ActionDigest,
              decision: "approve",
            });
            expect(existsSync(join(h.root, "result"))).toBe(false);
            await h.runtime.send({
              type: "approval.respond",
              effectId: e.effectId,
              digest: e.digest,
              decision: "deny",
            });
          })(),
        );
    });
    await h.start();
    const s = await h.finish();
    await Promise.all(pending);
    expect(s.results[0]?.status).toBe("denied");
    expect(h.events.some((e) => e.type === "command.rejected")).toBe(true);
  });
  it("records nonzero exit without claiming rollback", async () => {
    const h = await harness("printf partial > result; exit 9");
    h.approve();
    await h.start();
    const s = await h.finish();
    expect(s.results[0]?.status).toBe("failed");
    expect(readFileSync(join(h.root, "result"), "utf8")).toBe("partial");
    expect(s.effects[0]?.evidence).toContain("code 9");
  });
  it("keeps timed-out effects unknown across recovery without replay", async () => {
    const h = await harness("printf once >> result; sleep 10", undefined, 200);
    h.approve();
    await h.start();
    const s = await h.finish();
    expect(s.results[0]?.status).toBe("unknown");
    expect(s.effects[0]?.state).toBe("unknown");
    expect(readFileSync(join(h.root, "result"), "utf8")).toBe("once");
    expect(h.provider.client.requests).toHaveLength(1);
    expect(s.leases).toHaveLength(1);
    await h.restart();
    const recovered = await h.store.loadSession(h.sessionId);
    expect(recovered?.effects[0]?.state).toBe("unknown");
    expect(readFileSync(join(h.root, "result"), "utf8")).toBe("once");
  });
  it("stops live commands on revocation and preserves partial effects as unknown", async () => {
    const policy = new WorkspaceProcessPolicy({ approval: "allow" });
    const h = await harness("printf started > result; sleep 10", (root) => ({
      workspaceProcesses: { roots: [root] },
      policy,
    }));
    await h.start();
    await expect.poll(() => existsSync(join(h.root, "result"))).toBe(true);
    policy.revoke();
    const s = await h.finish();
    expect(s.results[0]?.status).toBe("unknown");
    expect(s.effects[0]?.evidence).toContain("revoked");
  });
  it("uses OS confinement for untrusted command contents", async () => {
    const h = await harness(
      "cat .env > leaked; printf bad > ../outside; cat ../outside > outside-leak; exit 0",
    );
    h.approve();
    await h.start();
    await h.finish();
    expect(readFileSync(join(h.root, ".env"), "utf8")).toBe("SECRET_CANARY");
    expect(readFileSync(join(h.directory, "outside"), "utf8")).toBe("OUTSIDE_CANARY");
    for (const name of ["leaked", "outside-leak"])
      expect(readFileSync(join(h.root, name), "utf8")).toBe("");
  });
});
