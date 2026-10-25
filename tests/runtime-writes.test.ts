import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
import { WorkspaceWritePolicy } from "../src/policy/index.ts";
import { createRuntime, type RuntimeOptions } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});
const terminal = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
function responses(calls: { name: string; args: unknown }[]): ModelStreamEvent[][] {
  return [
    ...calls.map(({ name, args }, i): ModelStreamEvent[] => [
      {
        type: "part_completed",
        index: 0,
        part: {
          type: "tool_call",
          callId: `call_${i}` as ToolCallId,
          providerCallId: `call_${i}`,
          providerItemId: null,
          name,
          rawArguments: JSON.stringify(args),
          argumentsSource: "verbatim",
        },
      },
      terminal("tool_use"),
    ]),
    [terminal("end_turn")],
  ];
}
async function harness(
  calls: { name: string; args: unknown }[],
  configure: (root: string) => Partial<RuntimeOptions> = (root) => ({
    workspaceWrites: { roots: [root] },
  }),
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-writes-integration-"));
  const root = join(directory, "workspace");
  mkdirSync(root);
  writeFileSync(join(root, "note.txt"), "hello world\n");
  writeFileSync(join(root, ".env"), "PROTECTED_CANARY");
  writeFileSync(join(directory, "outside.txt"), "OUTSIDE_CANARY");
  symlinkSync(join(directory, "outside.txt"), join(root, "escape"));
  const store = new SqliteSessionStore(join(directory, "data"));
  const provider = scriptedProvider(responses(calls));
  const counts: Record<string, number> = {};
  const options: RuntimeOptions = {
    store,
    model: scriptedProfile.origin,
    plugins: [{ plugin: provider.plugin }],
    ids: {
      next: (prefix) => {
        counts[prefix] = (counts[prefix] ?? 0) + 1;
        return `${prefix}_${counts[prefix]}`;
      },
    },
    ...configure(root),
  };
  let runtime = await createRuntime(options);
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: root });
  const ready = events.find((event) => event.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("No session");
  const sessionId = ready.sessionId;
  cleanups.push(async () => {
    await runtime.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    root,
    directory,
    store,
    events,
    sessionId,
    client: provider.client,
    get runtime() {
      return runtime;
    },
    async start() {
      await runtime.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: "Modify the synthetic fixture only." }],
      });
    },
    approve(
      decide: (
        event: Extract<RuntimeEvent, { type: "approval.requested" }>,
      ) => "approve" | "deny" = () => "approve",
    ) {
      return runtime.subscribe((event) => {
        if (event.type === "approval.requested")
          void runtime.send({
            type: "approval.respond",
            effectId: event.effectId,
            digest: event.digest,
            decision: decide(event),
          });
      });
    },
    async finish() {
      await runtime.idle();
      const snapshot = await store.loadSession(sessionId);
      if (!snapshot) throw Error("Missing session");
      return {
        ...snapshot,
        results: snapshot.entries.flatMap((e) =>
          e.body.kind === "tool_results" ? e.body.results : [],
        ),
      };
    },
    async restart() {
      await runtime.close();
      runtime = await createRuntime(options);
      return runtime;
    },
  };
}

describe("controlled writes through the real runtime", () => {
  it("creates, edits, undoes and redoes with digest approvals and immutable snapshots", async () => {
    const h = await harness([
      { name: "create", args: { path: "new.txt", text: "one\n" } },
      { name: "edit", args: { path: "new.txt", oldText: "one", newText: "two" } },
      { name: "undo", args: { snapshotId: "effect_2" } },
      { name: "undo", args: { snapshotId: "effect_3" } },
    ]);
    h.approve();
    await h.start();
    const s = await h.finish();
    expect(s.results.map((r) => r.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(readFileSync(join(h.root, "new.txt"), "utf8")).toBe("two\n");
    expect(h.events.filter((e) => e.type === "approval.requested")).toHaveLength(4);
    expect(s.effects.every((e) => e.state === "succeeded")).toBe(true);
    expect(s.leases).toEqual([]);
    for (const e of s.effects) expect((await h.store.getSnapshotForEffect(e.id))?.id).toBe(e.id);
    expect((await h.store.getSnapshot("effect_3"))?.restoreOf).toBe("effect_2");
  });
  it("undo of creation removes only the unchanged file", async () => {
    const h = await harness([
      { name: "create", args: { path: "new.txt", text: "new" } },
      { name: "undo", args: { snapshotId: "effect_1" } },
    ]);
    h.approve();
    await h.start();
    const s = await h.finish();
    expect(s.results.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
    expect(existsSync(join(h.root, "new.txt"))).toBe(false);
  });
  it.each(["default", "denied", "cancelled", "revoked"])(
    "%s leaves workspace and snapshots unchanged",
    async (mode) => {
      const policy = new WorkspaceWritePolicy();
      const h = await harness(
        [{ name: "edit", args: { path: "note.txt", oldText: "hello", newText: "bye" } }],
        (root) => (mode === "default" ? {} : { workspaceWrites: { roots: [root] }, policy }),
      );
      if (mode === "denied") h.approve(() => "deny");
      if (mode === "revoked")
        h.approve(() => {
          policy.revoke();
          return "approve";
        });
      if (mode === "cancelled")
        h.runtime.subscribe((e) => {
          if (e.type === "approval.requested") {
            const started = h.events.find((x) => x.type === "run.started");
            if (started?.type === "run.started")
              void h.runtime.send({ type: "run.cancel", runId: started.runId });
          }
        });
      await h.start();
      const s = await h.finish();
      expect(s.results.every((r) => r.status !== "succeeded")).toBe(true);
      expect(readFileSync(join(h.root, "note.txt"), "utf8")).toBe("hello world\n");
      expect(await h.store.getSnapshot("effect_1")).toBeNull();
    },
  );
  it.each(["../outside.txt", ".env", "escape", ".git/config"])(
    "rejects protected or escaping target %s before approval",
    async (path) => {
      const h = await harness([{ name: "create", args: { path, text: "replacement" } }]);
      h.approve();
      await h.start();
      const s = await h.finish();
      expect(s.results[0]?.status).toBe("failed");
      expect(h.events.filter((e) => e.type === "approval.requested")).toHaveLength(0);
      expect(readFileSync(join(h.directory, "outside.txt"), "utf8")).toBe("OUTSIDE_CANARY");
      expect(readFileSync(join(h.root, ".env"), "utf8")).toBe("PROTECTED_CANARY");
    },
  );
  it("does not widen an explicit workspace grant", async () => {
    const h = await harness(
      [{ name: "edit", args: { path: "note.txt", oldText: "hello", newText: "bye" } }],
      () => ({ workspaceWrites: { roots: [tmpdir()] } }),
    );
    h.approve();
    await h.start();
    const s = await h.finish();
    expect(s.results[0]?.status).toBe("failed");
    expect(readFileSync(join(h.root, "note.txt"), "utf8")).toBe("hello world\n");
  });
  it("changed content requires a new digest and a fresh decision", async () => {
    const h = await harness([
      { name: "edit", args: { path: "note.txt", oldText: "hello", newText: "bye" } },
    ]);
    let approvals = 0;
    const digests: string[] = [];
    h.approve((event) => {
      digests.push(event.digest);
      if (++approvals === 1) {
        writeFileSync(join(h.root, "note.txt"), "hello changed\n");
        return "approve";
      }
      return "deny";
    });
    await h.start();
    const s = await h.finish();
    expect(approvals).toBe(2);
    expect(new Set(digests).size).toBe(2);
    expect(s.results[0]?.status).toBe("denied");
    expect(readFileSync(join(h.root, "note.txt"), "utf8")).toBe("hello changed\n");
  });
  it("rejects stale approval digest", async () => {
    const h = await harness([{ name: "create", args: { path: "new.txt", text: "x" } }]);
    const pending: Promise<void>[] = [];
    h.runtime.subscribe((e) => {
      if (e.type === "approval.requested")
        pending.push(
          (async () => {
            await h.runtime.send({
              type: "approval.respond",
              effectId: e.effectId,
              digest: "sha256:stale" as ActionDigest,
              decision: "approve",
            });
            expect(existsSync(join(h.root, "new.txt"))).toBe(false);
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
  it("undo cannot overwrite a later user edit", async () => {
    const h = await harness([
      { name: "create", args: { path: "new.txt", text: "x" } },
      { name: "undo", args: { snapshotId: "effect_1" } },
    ]);
    h.approve();
    h.runtime.subscribe((e) => {
      if (e.type === "effect.updated" && e.effect.state === "succeeded")
        writeFileSync(join(h.root, "new.txt"), "user edit");
    });
    await h.start();
    const s = await h.finish();
    expect(s.results.map((r) => r.status)).toEqual(["succeeded", "failed"]);
    expect(readFileSync(join(h.root, "new.txt"), "utf8")).toBe("user edit");
  });
  it("scoped autonomous mode omits prompts but still snapshots and journals", async () => {
    const h = await harness([{ name: "create", args: { path: "new.txt", text: "x" } }], (root) => ({
      workspaceWrites: { roots: [root], approval: "allow" },
    }));
    await h.start();
    const s = await h.finish();
    expect(s.effects[0]?.state).toBe("succeeded");
    expect(await h.store.getSnapshot("effect_1")).not.toBeNull();
    expect(h.events.filter((e) => e.type === "approval.requested")).toHaveLength(0);
  });
});

it("rejects an invalid grant before loading any plugin resources", async () => {
  let loaded = 0;
  await expect(
    createRuntime({
      workspaceWrites: { roots: [] },
      plugins: [
        {
          plugin: {
            name: "resource-probe",
            apiVersion: 1,
            setup() {
              loaded++;
            },
          },
        },
      ],
    }),
  ).rejects.toThrow("at least one workspace");
  expect(loaded).toBe(0);
});

it("write policy respects denied preparation reads and rejects invalid approval modes", () => {
  const profile = {
    class: "workspace_write",
    reversibility: "snapshot",
    verification: "postcheck",
  } as const;
  expect(
    new WorkspaceWritePolicy({ readAllowed: false }).beforePrepare("edit", profile, {}).kind,
  ).toBe("deny");
  expect(() => new WorkspaceWritePolicy({ approval: "invalid" as "ask" })).toThrow(
    "Invalid workspace approval mode",
  );
});
