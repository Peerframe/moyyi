import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWorkspaceNavigationScenario } from "../evals/instructions/navigation.ts";
import {
  type ContextSource,
  type ContextSourceInput,
  type ModelRequest,
  type ModelStreamEvent,
  type PermissionPolicy,
  type Plugin,
  type RunOutcome,
  type RuntimeEvent,
  type SessionId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../src/policy/index.ts";
import { NodeWorkspaceFiles } from "../src/runtime/files.ts";
import { createRuntime, type RuntimeOptions } from "../src/runtime/index.ts";
import { collectContext } from "../src/runtime/instructions.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const terminal = (stopReason: "tool_use" | "end_turn" = "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const answer = (): ModelStreamEvent[] => [
  { type: "part_completed", index: 0, part: { type: "text", text: "Synthetic completion." } },
  terminal(),
];
const text = (request: ModelRequest) =>
  request.system.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
function navigation(request: ModelRequest): {
  paths: string[];
  truncated: boolean;
  skippedEntries: number;
} {
  const part = request.system.find(
    (part) => part.type === "text" && part.text.includes("Workspace paths (JSON"),
  );
  if (part?.type !== "text") throw Error("Missing navigation in request");
  return JSON.parse(part.text.split("\n").at(-1) ?? "");
}
async function harness(
  options: Partial<RuntimeOptions> = { workspaceNavigation: true },
  step: (request: ModelRequest, ordinal: number) => ModelStreamEvent[] = answer,
) {
  const root = mkdtempSync(join(tmpdir(), "moyyi-navigation-runtime-"));
  const workspace = join(root, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src/main.ts"), "SOURCE_CONTENT_CANARY");
  writeFileSync(join(workspace, ".env"), "PRIVATE_CANARY");
  const requests: ModelRequest[] = [],
    events: RuntimeEvent[] = [];
  const provider: Plugin = {
    name: "navigation-scripted-model",
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: scriptedProfile.origin.provider,
        models: [scriptedProfile],
        createClient: () => ({
          async *stream(request, signal) {
            signal.throwIfAborted();
            requests.push(request);
            yield* step(request, requests.length);
          },
        }),
      });
    },
  };
  const runtime = await createRuntime({
    model: scriptedProfile.origin,
    dataDirectory: join(root, "data"),
    projectInstructions: false,
    limits: { timeoutMs: 15000, maxModelRequests: 4, maxRetries: 0 },
    ...options,
    plugins: [{ plugin: provider }, ...(options.plugins ?? [])],
  });
  runtime.subscribe((event) => events.push(event));
  cleanups.push(async () => {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  });
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const ready = events.find((event) => event.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("Missing session");
  const sessionId: SessionId = ready.sessionId;
  return {
    root,
    workspace,
    runtime,
    requests,
    events,
    async turn(input = "Inspect the synthetic workspace."): Promise<RunOutcome> {
      const before = events.length;
      await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: input }] });
      await runtime.idle();
      const finished = events.slice(before).filter((event) => event.type === "run.finished");
      expect(finished).toHaveLength(1);
      const last = finished[0];
      if (last?.type !== "run.finished") throw Error("Missing run result");
      return last.outcome;
    },
  };
}

describe("opt-in navigation through the real runtime", () => {
  it("puts relative paths into the first request and refreshes on the next request", async () => {
    const h = await harness();
    expect(await h.turn()).toEqual({ kind: "completed" });
    const firstNavigation = navigation(h.requests[0] as ModelRequest);
    expect(firstNavigation.paths).toContain("src/main.ts");
    expect(text(h.requests[0] as ModelRequest)).not.toContain("SOURCE_CONTENT_CANARY");
    expect(text(h.requests[0] as ModelRequest)).not.toContain("PRIVATE_CANARY");
    // Session facts include the trusted working directory; the optional navigation section
    // still contains only relative names, never source contents or absolute file paths.
    expect(JSON.stringify(firstNavigation)).not.toContain(h.workspace);
    expect(
      firstNavigation.paths.every((path) => !isAbsolute(path) && !path.split("/").includes("..")),
    ).toBe(true);
    rmSync(join(h.workspace, "src/main.ts"));
    writeFileSync(join(h.workspace, "src/new.ts"), "NEW_CONTENT_CANARY");
    expect(await h.turn()).toEqual({ kind: "completed" });
    const refreshed = navigation(h.requests[1] as ModelRequest);
    expect(refreshed.paths).toContain("src/new.ts");
    expect(refreshed.paths).not.toContain("src/main.ts");
    expect(text(h.requests[1] as ModelRequest)).not.toContain("NEW_CONTENT_CANARY");
  });
  it.each([undefined, false])(
    "does not register or scan without explicit true (%j)",
    async (workspaceNavigation) => {
      const scan = vi.spyOn(NodeWorkspaceFiles.prototype, "readWorkspaceNavigation");
      const h = await harness(workspaceNavigation === undefined ? {} : { workspaceNavigation });
      expect(await h.turn()).toEqual({ kind: "completed" });
      expect(h.runtime.plugins.some((plugin) => plugin.name === "workspace-navigation")).toBe(
        false,
      );
      expect(scan).not.toHaveBeenCalled();
      expect(text(h.requests[0] as ModelRequest)).not.toContain("Workspace path navigation");
    },
  );
  it.each([null, "true", 1, {}, []])("rejects nonboolean host selection %j", async (value) => {
    await expect(createRuntime({ workspaceNavigation: value as boolean })).rejects.toThrow(
      "must be a boolean",
    );
  });
  it("captures opt-in before asynchronous plugin setup can mutate the host options", async () => {
    const options: RuntimeOptions = {
      workspaceNavigation: true,
      plugins: [
        {
          plugin: {
            name: "mutate-navigation-options",
            apiVersion: 1,
            async setup() {
              await Promise.resolve();
              Object.assign(options, { workspaceNavigation: false });
            },
          },
        },
      ],
    };
    const runtime = await createRuntime(options);
    try {
      expect(options.workspaceNavigation).toBe(false);
      expect(runtime.plugins.some((plugin) => plugin.name === "workspace-navigation")).toBe(true);
    } finally {
      await runtime.close();
    }
  });
  it.each(["ask", "deny", "missing"] as const)(
    "blocks %s context grants without navigation I/O",
    async (kind) => {
      const scan = vi.spyOn(NodeWorkspaceFiles.prototype, "readWorkspaceNavigation");
      const base = new ReadOnlyPolicy();
      const policy: PermissionPolicy = {
        beforePrepare: base.beforePrepare.bind(base),
        beforeExecute: base.beforeExecute.bind(base),
        ...(kind === "missing"
          ? {}
          : {
              beforeContextRead: () =>
                kind === "deny"
                  ? ({ kind, reason: "no navigation" } as const)
                  : ({ kind } as const),
            }),
      };
      const h = await harness({ workspaceNavigation: true, policy });
      expect(await h.turn()).toEqual({ kind: "completed" });
      expect(scan).not.toHaveBeenCalled();
      expect(text(h.requests[0] as ModelRequest)).toContain("unknown, not empty");
    },
  );
  it.each(["prepare", "execute"] as const)(
    "honors restrictive list rules during %s without I/O",
    async (phase) => {
      const scan = vi.spyOn(NodeWorkspaceFiles.prototype, "readWorkspaceNavigation");
      const h = await harness({
        workspaceNavigation: true,
        plugins: [
          {
            plugin: {
              name: "navigation-deny",
              apiVersion: 1,
              setup(host) {
                host.registerPolicyRule({
                  id: "deny-list",
                  evaluate(request) {
                    return request.tool === "list" && request.phase === phase
                      ? { kind: "deny", reason: "no navigation" }
                      : null;
                  },
                });
              },
            },
          },
        ],
      });
      expect(await h.turn()).toEqual({ kind: "completed" });
      expect(scan).not.toHaveBeenCalled();
      expect(text(h.requests[0] as ModelRequest)).toContain("unknown, not empty");
    },
  );
  it("does not turn list approval into automatic authorization", async () => {
    const scan = vi.spyOn(NodeWorkspaceFiles.prototype, "readWorkspaceNavigation");
    const h = await harness({
      workspaceNavigation: true,
      policy: new ReadOnlyPolicy({ requireApproval: ["list"] }),
    });
    expect(await h.turn()).toEqual({ kind: "completed" });
    expect(scan).not.toHaveBeenCalled();
    expect(h.events.some((event) => event.type === "approval.requested")).toBe(false);
  });
  it.each(["prepare", "execute"] as const)(
    "honors restrictive ignore-read rules during %s without publishing partial paths",
    async (phase) => {
      const h = await harness({
        workspaceNavigation: true,
        plugins: [
          {
            plugin: {
              name: "deny-navigation-ignore",
              apiVersion: 1,
              setup(host) {
                host.registerPolicyRule({
                  id: "deny-ignore",
                  evaluate(request) {
                    return request.tool === "read" && request.phase === phase
                      ? { kind: "deny", reason: "ignore files unavailable" }
                      : null;
                  },
                });
              },
            },
          },
        ],
      });
      expect(await h.turn()).toEqual({ kind: "completed" });
      expect(text(h.requests[0] as ModelRequest)).toContain("unknown, not empty");
      expect(text(h.requests[0] as ModelRequest)).not.toContain("src/main.ts");
    },
  );
  it("also requires the ordinary list preparation grant", async () => {
    const scan = vi.spyOn(NodeWorkspaceFiles.prototype, "readWorkspaceNavigation");
    const h = await harness({
      workspaceNavigation: true,
      policy: {
        beforeContextRead: () => ({ kind: "allow" }),
        beforePrepare: () => ({ kind: "ask" }),
        beforeExecute: () => ({ kind: "allow" }),
      },
    });
    expect(await h.turn()).toEqual({ kind: "completed" });
    expect(scan).not.toHaveBeenCalled();
  });
  it("cancels a pending navigation scan before any model request", async () => {
    const original = NodeWorkspaceFiles.prototype.readWorkspaceNavigation;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.spyOn(NodeWorkspaceFiles.prototype, "readWorkspaceNavigation").mockImplementation(
      async function (this: NodeWorkspaceFiles, context, guard, allowed) {
        entered.resolve();
        await release.promise;
        return original.call(this, context, guard, allowed);
      },
    );
    const h = await harness();
    const completed = h.turn();
    try {
      await entered.promise;
      const started = h.events.find((event) => event.type === "run.started");
      if (started?.type !== "run.started") throw Error("Missing running ID");
      await h.runtime.send({ type: "run.cancel", runId: started.runId });
    } finally {
      release.resolve();
    }
    expect(await completed).toEqual({ kind: "cancelled" });
    expect(h.requests).toHaveLength(0);
  });
  it("supports a four-request read/create/verify/final sequence with the unchanged public checker", async () => {
    const evidence = await runWorkspaceNavigationScenario();
    expect(evidence).toMatchObject({
      modelRequests: 4,
      networkRequests: 0,
      pathsInFirstRequest: true,
      sourceUnchanged: true,
      unrelatedWriteDenied: true,
      finalToolChoice: "none",
      checker: { passed: true },
    });
  });
});

describe("navigation context capability lifetime", () => {
  function setup(policy: PermissionPolicy = new ReadOnlyPolicy()) {
    const controller = new AbortController();
    const read = vi.fn<NodeWorkspaceFiles["readWorkspaceNavigation"]>(
      async (_context, guard, allowed) => {
        guard();
        expect(allowed("list", ".")).toBe(true);
        expect(allowed("read", ".gitignore")).toBe(true);
        return { kind: "loaded", paths: ["src/main.ts"], truncated: false, skippedEntries: 0 };
      },
    );
    return {
      read,
      controller,
      collect: (sources: readonly ContextSource[]) =>
        collectContext(
          sources,
          { readWorkspaceNavigation: read } as unknown as NodeWorkspaceFiles,
          policy,
          "/workspace",
          scriptedProfile,
          controller.signal,
          false,
          undefined,
          true,
        ),
    };
  }
  const source = (fn: (input: ContextSourceInput) => Promise<void>): ContextSource => ({
    id: "navigation-probe",
    async collect(input) {
      await fn(input);
      return [];
    },
  });
  const port = (input: ContextSourceInput) => {
    if (!input.workspaceNavigation) throw Error("Missing port");
    return input.workspaceNavigation;
  };
  it("shares an immutable snapshot, refreshes later, and expires retained access", async () => {
    const t = setup();
    let saved: ContextSourceInput | undefined;
    const probe = source(async (input) => {
      saved = input;
      const [a, b] = await Promise.all([port(input).read(), port(input).read()]);
      expect(a).toBe(b);
      expect(Object.isFrozen(a)).toBe(true);
      if (a.kind === "loaded") expect(Object.isFrozen(a.paths)).toBe(true);
    });
    await t.collect([probe, probe]);
    expect(t.read).toHaveBeenCalledTimes(1);
    await expect(port(saved as ContextSourceInput).read()).rejects.toThrow(/expired/);
    await t.collect([probe]);
    expect(t.read).toHaveBeenCalledTimes(2);
  });
  it("checks operation-specific relative paths and detects revoke-and-regrant during I/O", async () => {
    const base = new ReadOnlyPolicy(),
      granted: string[] = [];
    const t = setup({
      revision: base.revision.bind(base),
      beforeContextRead(path, operation) {
        granted.push(`${operation}:${path}`);
        return { kind: "allow" };
      },
      beforePrepare: base.beforePrepare.bind(base),
      beforeExecute: base.beforeExecute.bind(base),
    });
    await t.collect([
      source(async (input) => {
        await port(input).read();
      }),
    ]);
    expect(new Set(granted)).toEqual(new Set(["list:.", "read:.gitignore"]));
    t.read.mockImplementation(async (_context, guard) => {
      guard();
      base.revoke();
      base.grant();
      guard();
      throw Error("unreachable");
    });
    await expect(
      t.collect([
        source(async (input) => {
          await port(input).read();
        }),
      ]),
    ).rejects.toThrow("Cannot load workspace navigation safely");
  });
  it("rechecks every previously granted path even without an epoch", async () => {
    let allowIgnore = true;
    const base = new ReadOnlyPolicy();
    const t = setup({
      beforeContextRead: (path) =>
        path !== ".gitignore" || allowIgnore
          ? { kind: "allow" }
          : { kind: "deny", reason: "revoked" },
      beforePrepare: base.beforePrepare.bind(base),
      beforeExecute: base.beforeExecute.bind(base),
    });
    t.read.mockImplementation(async (_context, guard, allowed) => {
      expect(allowed("read", ".gitignore")).toBe(true);
      allowIgnore = false;
      guard();
      throw Error("unreachable");
    });
    await expect(
      t.collect([
        source(async (input) => {
          await port(input).read();
        }),
      ]),
    ).rejects.toThrow("Cannot load workspace navigation safely");
  });
  it("cancellation and another source failure expire pending ports without leaking I/O details", async () => {
    const t = setup();
    let saved: ContextSourceInput | undefined;
    await expect(
      t.collect([
        source(async (input) => {
          saved = input;
        }),
        source(async () => {
          throw Error("source failed");
        }),
      ]),
    ).rejects.toThrow("source failed");
    await expect(port(saved as ContextSourceInput).read()).rejects.toThrow(/expired/);
    const cancelled = setup();
    cancelled.read.mockImplementation(async () => {
      cancelled.controller.abort();
      throw Error("PRIVATE_IO_DETAIL");
    });
    await expect(
      cancelled.collect([
        source(async (input) => {
          await port(input).read();
        }),
      ]),
    ).rejects.toThrow(/cancelled/);
    const failed = setup();
    failed.read.mockRejectedValue(Error("PRIVATE_IO_DETAIL"));
    await expect(
      failed.collect([
        source(async (input) => {
          await port(input).read();
        }),
      ]),
    ).rejects.toThrow(/^Cannot load workspace navigation safely:/);
  });
});
