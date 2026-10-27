import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelRequest,
  type ModelStreamEvent,
  type Plugin,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "moyyi/contracts";
import type { RuntimeOptions } from "moyyi/runtime";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopState } from "../shared.ts";
import { createDesktopHost, type DesktopHost, type DesktopHostOptions } from "./service.ts";
import { parseDesktopCommand } from "./validation.ts";

type Step =
  | readonly ModelStreamEvent[]
  | ((signal: AbortSignal) => AsyncIterable<ModelStreamEvent>);
const complete = (stopReason: "end_turn" | "tool_use" = "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const answer = (text: string): ModelStreamEvent[] => [
  { type: "text_delta", index: 0, text },
  { type: "part_completed", index: 0, part: { type: "text", text } },
  complete(),
];
let nextCall = 0;
function call(name: string, args: unknown): ModelStreamEvent[] {
  const id = `desktop_call_${++nextCall}`;
  return [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId: id as ToolCallId,
        providerCallId: id,
        providerItemId: null,
        name,
        rawArguments: JSON.stringify(args),
        argumentsSource: "verbatim",
      },
    },
    complete("tool_use"),
  ];
}

const resources: { directory: string; hosts: DesktopHost[] }[] = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    for (const host of resource.hosts) await host.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

async function fixture(
  steps: Step[],
  options: Partial<RuntimeOptions> = {},
  connection = { ready: true },
  display: Omit<DesktopHostOptions, "runtimeOptions" | "connection"> = {},
) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-desktop-host-")));
  const workspace = join(directory, "workspace"),
    other = join(directory, "other");
  mkdirSync(workspace);
  mkdirSync(other);
  writeFileSync(join(workspace, "note.txt"), "ORIGINAL");
  writeFileSync(join(other, "note.txt"), "OTHER_WORKSPACE");
  const dataDirectory = join(directory, "private");
  const requests: ModelRequest[] = [];
  const origin = { provider: "desktop-fixture", model: "scripted" };
  const plugin: Plugin = {
    name: "desktop-fixture",
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: origin.provider,
        models: [
          {
            origin,
            contextWindowTokens: 200_000,
            maxOutputTokens: 8192,
            parallelToolCalls: false,
            reasoning: "visible",
            promptCache: "none",
            editFormat: "search_replace",
          },
        ],
        createClient: () => ({
          async *stream(request, signal) {
            requests.push(structuredClone(request));
            const step = steps.shift();
            if (!step) throw Error("Unexpected fixture request");
            if (typeof step === "function") yield* step(signal);
            else yield* step;
          },
        }),
      });
    },
  };
  const runtimeOptions: RuntimeOptions = {
    model: origin,
    dataDirectory,
    limits: {
      maxModelRequests: 3,
      maxRetries: 0,
      timeoutMs: 120_000,
      maxInputBytes: 65_536,
      maxParallelReads: 1,
    },
    ...options,
    plugins: [{ plugin }, ...(options.plugins ?? [])],
  };
  const resource = { directory, hosts: [] as DesktopHost[] };
  resources.push(resource);
  const reopen = async () => {
    const host = await createDesktopHost({
      runtimeOptions: () => runtimeOptions,
      maxOutputTokens: 8192,
      connection,
      ...display,
    });
    resource.hosts.push(host);
    return host;
  };
  const host = await reopen();
  return { host, reopen, workspace, other, requests, runtimeOptions };
}

function waitFor(
  host: DesktopHost,
  predicate: (state: DesktopState) => boolean,
): Promise<DesktopState> {
  if (predicate(host.getState())) return Promise.resolve(host.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(Error("Desktop state did not settle"));
    }, 3000);
    const off = host.subscribe((state) => {
      if (predicate(state)) {
        clearTimeout(timer);
        off();
        resolve(state);
      }
    });
  });
}

function required<T>(value: T | null | undefined): T {
  if (value == null) throw Error("Expected fixture state");
  return value;
}

describe("desktop host boundary over the public runtime", () => {
  it("creates, streams and reopens real SQLite history without a new model call", async () => {
    const f = await fixture([answer("Read-only answer")]);
    expect(f.requests).toHaveLength(0);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const sessionId = f.host.getState().activeSessionId;
    expect(f.host.getState().sessions.items).toEqual([
      { sessionId, workspaceRoot: f.workspace, lastActivityAt: null, promptPreview: null },
    ]);
    expect(f.requests).toHaveLength(0);
    await f.host.dispatch({ type: "start", sessionId, text: "Inspect this workspace" });
    const done = await waitFor(f.host, (s) => s.outcome?.kind === "completed");
    expect(done.messages.filter((m) => m.text === "Read-only answer")).toHaveLength(1);
    expect(done.streamText).toBe("");
    const summary = required(done.sessions.items.find((item) => item.sessionId === sessionId));
    expect(summary.promptPreview).toBe("Inspect this workspace");
    expect(summary.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await Promise.all([f.host.close(), f.host.close()]);
    const reopened = await f.reopen();
    expect(reopened.getState().sessions.items.some((s) => s.sessionId === sessionId)).toBe(true);
    await reopened.dispatch({ type: "load", sessionId, askEachRead: false });
    expect(reopened.getState().messages.some((m) => m.text === "Read-only answer")).toBe(true);
    expect(reopened.getState().workspaceRoot).toBe(f.workspace);
    expect(f.requests).toHaveLength(1);
    expect(reopened.getState().pendingApproval).toBeNull();
    expect(reopened.getState().sessions.items.find((item) => item.sessionId === sessionId)).toEqual(
      summary,
    );
  });

  it("bounds immediate new-session rows to the first page and never mixes them into later pages", async () => {
    const f = await fixture([answer("Done")]);
    for (let i = 0; i < 21; i++)
      await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    expect(f.host.getState().sessions.items).toHaveLength(20);
    expect(f.host.getState().sessions.items[0]?.sessionId).toBe(f.host.getState().activeSessionId);
    expect(f.host.getState().sessions.hasMore).toBe(true);
    await f.host.dispatch({ type: "list", offset: 20 });
    const later = f.host.getState().sessions;
    expect(later.items).toHaveLength(1);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    expect(f.host.getState().sessions).toEqual(later);
    expect(f.requests).toHaveLength(0);
    const sessionId = f.host.getState().activeSessionId;
    await f.host.dispatch({ type: "start", sessionId, text: `${"x".repeat(159)}😀tail` });
    await waitFor(f.host, (state) => state.outcome?.kind === "completed");
    expect(f.host.getState().sessions).toEqual(later);
    await f.host.dispatch({ type: "list", offset: 0 });
    expect(f.host.getState().sessions.items).toHaveLength(20);
    expect(f.host.getState().sessions.items[0]?.sessionId).toBe(sessionId);
    expect(f.host.getState().sessions.items[0]?.promptPreview).toBe("x".repeat(159));
  });

  it("binds approval to the displayed digest and actual read, without accepting stale clicks", async () => {
    const f = await fixture([call("read", { path: "note.txt" }), answer("Read completed")]);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: true });
    await f.host.dispatch({
      type: "start",
      sessionId: f.host.getState().activeSessionId,
      text: "Read note.txt",
    });
    const waiting = await waitFor(f.host, (s) => s.pendingApproval !== null);
    const pending = required(waiting.pendingApproval);
    await expect(
      f.host.dispatch({
        type: "approve",
        effectId: pending.effectId,
        digest: "stale",
        decision: "approve",
      }),
    ).rejects.toThrow("stale");
    expect(f.requests).toHaveLength(1);
    expect(f.host.getState().pendingApproval?.digest).toBe(pending.digest);
    await f.host.dispatch({
      type: "approve",
      effectId: pending.effectId,
      digest: pending.digest,
      decision: "approve",
    });
    const done = await waitFor(f.host, (s) => s.outcome?.kind === "completed");
    expect(
      done.messages.some(
        (m) => m.role === "tool" && m.state === "succeeded" && m.text.includes("ORIGINAL"),
      ),
    ).toBe(true);
    await expect(
      f.host.dispatch({
        type: "approve",
        effectId: pending.effectId,
        digest: pending.digest,
        decision: "approve",
      }),
    ).rejects.toThrow("Approval");
    expect(f.requests).toHaveLength(2);
  });

  it("denies a read without returning its contents and never inherits factory write authority", async () => {
    const f = await fixture([
      call("read", { path: "note.txt" }),
      answer("Read denied"),
      call("edit", { path: "note.txt", oldText: "ORIGINAL", newText: "CHANGED" }),
      answer("Write denied"),
    ]);
    // The factory is trusted test composition, but its broader grants must not become M1 grants.
    const withWrites = {
      ...f.runtimeOptions,
      workspaceWrites: { roots: [f.workspace], approval: "allow" as const },
    };
    await f.host.close();
    const host = await createDesktopHost({ runtimeOptions: () => withWrites });
    required(resources.at(-1)).hosts.push(host);
    await host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: true });
    await host.dispatch({
      type: "start",
      sessionId: host.getState().activeSessionId,
      text: "Read note.txt",
    });
    const pending = required((await waitFor(host, (s) => !!s.pendingApproval)).pendingApproval);
    await host.dispatch({
      type: "approve",
      effectId: pending.effectId,
      digest: pending.digest,
      decision: "deny",
    });
    const denied = await waitFor(host, (s) => s.outcome?.kind === "completed");
    expect(denied.messages.some((m) => m.role === "tool" && m.state === "denied")).toBe(true);
    expect(denied.messages.some((m) => m.role === "tool" && m.text.includes("ORIGINAL"))).toBe(
      false,
    );
    await host.dispatch({
      type: "start",
      sessionId: host.getState().activeSessionId,
      text: "Try edit",
    });
    await waitFor(host, (s) => s.outcome?.kind === "completed");
    expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("ORIGINAL");
    expect(host.getState().messages.some((m) => m.tool === "edit" && m.state === "denied")).toBe(
      true,
    );
  });

  it("cancels a pending approval and closes/reopens without approving or replaying it", async () => {
    const f = await fixture([call("read", { path: "note.txt" })]);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: true });
    const sessionId = f.host.getState().activeSessionId;
    await f.host.dispatch({ type: "start", sessionId, text: "Read" });
    const waiting = await waitFor(f.host, (s) => !!s.pendingApproval);
    await expect(f.host.dispatch({ type: "load", sessionId, askEachRead: false })).rejects.toThrow(
      "active run",
    );
    await f.host.dispatch({ type: "cancel", runId: required(waiting.run).id });
    await waitFor(f.host, (s) => s.outcome?.kind === "cancelled");
    await f.host.close();
    const next = await f.reopen();
    await next.dispatch({ type: "load", sessionId, askEachRead: false });
    expect(next.getState().pendingApproval).toBeNull();
    expect(next.getState().askEachRead).toBe(false);
    expect(f.requests).toHaveLength(1);
    expect(next.getState().messages.some((m) => m.state === "cancelled")).toBe(true);
  });

  it.each(["Partial output", ""])(
    "close/reopen labels an interrupted response with text %j and releases the writer lock",
    async (partial) => {
      const started = Promise.withResolvers<void>();
      const f = await fixture([
        async function* (signal) {
          yield {
            type: "part_completed",
            index: 0,
            part: { type: "reasoning", kind: "visible", text: "PRIVATE_REASONING" },
          };
          if (partial) yield { type: "text_delta", index: 1, text: partial };
          started.resolve();
          if (!signal.aborted)
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true }),
            );
          yield {
            type: "error",
            error: {
              kind: "cancelled",
              message: "Cancelled",
              partialOutput: true,
              usage: UNKNOWN_USAGE,
            },
          };
        },
      ]);
      await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
      const sessionId = f.host.getState().activeSessionId;
      await f.host.dispatch({ type: "start", sessionId, text: "Wait" });
      await started.promise;
      await expect(f.reopen()).rejects.toThrow("store is locked");
      await f.host.close();
      const next = await f.reopen();
      await next.dispatch({ type: "load", sessionId, askEachRead: false });
      const messages = next.getState().messages;
      expect(messages.some((m) => m.role === "assistant" && m.text === partial)).toBe(!!partial);
      expect(messages.find((m) => m.state === "interrupted")?.text).toBe(
        partial
          ? "This response was interrupted. The text above is partial, not a completed answer."
          : "This response was interrupted before an answer was received.",
      );
      expect(JSON.stringify(messages)).not.toContain("PRIVATE_REASONING");
      expect(f.requests).toHaveLength(1);
    },
  );

  it("rejects foreign IDs and unavailable connections, while listed sessions restore their own workspace", async () => {
    const f = await fixture([], {}, { ready: false });
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const first = f.host.getState().activeSessionId;
    await f.host.dispatch({ type: "create", workspaceRoot: f.other, askEachRead: false });
    await expect(
      f.host.dispatch({ type: "start", sessionId: first, text: "Wrong session" }),
    ).rejects.toThrow("not selected");
    await expect(
      f.host.dispatch({ type: "load", sessionId: "not-listed", askEachRead: false }),
    ).rejects.toThrow("listed");
    await expect(f.host.dispatch({ type: "cancel", runId: "foreign" })).rejects.toThrow(
      "not active",
    );
    await f.host.dispatch({ type: "load", sessionId: first, askEachRead: false });
    expect(f.host.getState().workspaceRoot).toBe(f.workspace);
    await expect(
      f.host.dispatch({ type: "start", sessionId: first, text: "No connection" }),
    ).rejects.toThrow("unavailable");
    expect(f.requests).toHaveLength(0);
  });

  it("projects bounded text without reasoning, replay payloads or mutable internal state", async () => {
    const events: ModelStreamEvent[] = [
      {
        type: "part_completed",
        index: 0,
        part: { type: "reasoning", kind: "visible", text: "PRIVATE_REASONING" },
      },
      { type: "part_completed", index: 1, part: { type: "text", text: "x".repeat(40_000) } },
      complete(),
    ];
    const f = await fixture([events]);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    await f.host.dispatch({
      type: "start",
      sessionId: f.host.getState().activeSessionId,
      text: "Explain",
    });
    const done = await waitFor(f.host, (s) => s.outcome?.kind === "completed");
    expect(JSON.stringify(done)).not.toContain("PRIVATE_REASONING");
    expect(JSON.stringify(done)).not.toContain("rendererVersion");
    expect(done.historyTruncated).toBe(true);
    expect(done.messages.some((m) => m.text.includes("Display truncated"))).toBe(true);
    expect(JSON.stringify(done).length).toBeLessThan(300_000);
    (done.messages as unknown[]).splice(0);
    expect(f.host.getState().messages.length).toBeGreaterThan(0);
  });

  it("shows startup plugin failures after subscribing and retains the warning across commands", async () => {
    const f = await fixture([], {
      plugins: [
        {
          plugin: {
            name: "failed-fixture",
            apiVersion: 1,
            setup() {
              throw Error("PRIVATE_PLUGIN_FAILURE");
            },
          },
        },
      ],
    });
    expect(f.host.getState().error).toContain("runtime plugin is unavailable");
    expect(JSON.stringify(f.host.getState())).not.toContain("PRIVATE_PLUGIN_FAILURE");
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    expect(f.host.getState().error).toContain("runtime plugin is unavailable");
    expect(f.requests).toHaveLength(0);
  });
});

describe("desktop M2 materials and report delivery", () => {
  it("adds selected file identities as separate user input and rejects stale selections without a request", async () => {
    const f = await fixture([answer("Observed selection")]);
    writeFileSync(join(f.workspace, "source.pdf"), "SOURCE_BYTES");
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const sessionId = f.host.getState().activeSessionId;
    await f.host.dispatch({
      type: "materials",
      sessionId,
      paths: [join(f.workspace, "source.pdf")],
    });
    const selected = f.host.getState().materials;
    await f.host.dispatch({ type: "materials", sessionId, paths: [] });
    expect(f.host.getState().materials).toEqual(selected);
    await expect(
      f.host.dispatch({ type: "materials", sessionId, paths: [join(f.other, "outside.pdf")] }),
    ).rejects.toThrow();
    expect(f.host.getState().materials).toEqual(selected);
    expect(f.requests).toHaveLength(0);
    await f.host.dispatch({ type: "start", sessionId, text: "Read the selected material" });
    await waitFor(f.host, (state) => state.outcome?.kind === "completed");
    const parts =
      f.requests[0]?.messages
        .filter((message) => message.role === "user")
        .flatMap((message) => message.content) ?? [];
    expect(
      parts.some((part) => part.type === "text" && part.text === "Read the selected material"),
    ).toBe(true);
    expect(
      parts.some(
        (part) =>
          part.type === "text" &&
          part.text.includes("contents have not been extracted") &&
          part.text.includes(selected[0]?.sha256 ?? "missing"),
      ),
    ).toBe(true);
    expect(JSON.stringify(parts)).not.toContain("SOURCE_BYTES");
    writeFileSync(join(f.workspace, "source.pdf"), "CHANGED");
    await expect(f.host.dispatch({ type: "start", sessionId, text: "Read again" })).rejects.toThrow(
      "changed",
    );
    expect(f.requests).toHaveLength(1);
    await f.host.dispatch({ type: "material.remove", sessionId, path: "source.pdf" });
    expect(f.host.getState().materials).toEqual([]);
  });

  it("requires the displayed report approval, returns real receipts and reopens only unchanged file bytes", async () => {
    const text = '{"answer":"ACTUAL_REPORT"}\n';
    const f = await fixture([
      call("create", { path: "report.json", text }),
      answer("Denied"),
      call("create", { path: "report.json", text }),
      answer("Created"),
    ]);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const sessionId = f.host.getState().activeSessionId;
    await f.host.dispatch({
      type: "report.target",
      sessionId,
      path: join(f.workspace, "report.json"),
    });
    expect(f.host.getState().reportTarget).toBe("report.json");
    await f.host.dispatch({ type: "report.target", sessionId, path: null });
    expect(f.host.getState().reportTarget).toBe("report.json");
    await f.host.dispatch({ type: "start", sessionId, text: "Create the report" });
    let approval = required(
      (await waitFor(f.host, (state) => !!state.pendingApproval)).pendingApproval,
    );
    await expect(f.host.dispatch({ type: "report.clear", sessionId })).rejects.toThrow(
      "active run",
    );
    await expect(
      f.host.dispatch({
        type: "approve",
        effectId: approval.effectId,
        digest: "stale",
        decision: "approve",
      }),
    ).rejects.toThrow("stale");
    await f.host.dispatch({
      type: "approve",
      effectId: approval.effectId,
      digest: approval.digest,
      decision: "deny",
    });
    await waitFor(f.host, (state) => state.outcome?.kind === "completed");
    expect(existsSync(join(f.workspace, "report.json"))).toBe(false);
    await f.host.dispatch({ type: "start", sessionId, text: "Create with approval" });
    approval = required(
      (await waitFor(f.host, (state) => !!state.pendingApproval)).pendingApproval,
    );
    expect(approval.preview).toContain("ACTUAL_REPORT");
    await f.host.dispatch({
      type: "approve",
      effectId: approval.effectId,
      digest: approval.digest,
      decision: "approve",
    });
    const done = await waitFor(f.host, (state) => state.artifacts.items.length === 1);
    const artifact = required(done.artifacts.items[0]);
    expect(readFileSync(join(f.workspace, "report.json"), "utf8")).toBe(text);
    await expect(
      f.host.dispatch({ type: "artifact.open", sessionId, effectId: "forged" }),
    ).rejects.toThrow("recorded report");
    await f.host.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId });
    expect(f.host.getState().artifactPreview).toMatchObject({
      text,
      sha256: artifact.afterHash,
      truncated: false,
    });
    await f.host.close();
    const resumed = await f.reopen();
    await resumed.dispatch({ type: "load", sessionId, askEachRead: false });
    expect(resumed.getState().reportTarget).toBeNull();
    expect(resumed.getState().artifacts.items[0]).toEqual({ ...artifact, state: "unchecked" });
    expect(f.requests).toHaveLength(4);
    writeFileSync(join(f.workspace, "report.json"), "EXTERNAL_CHANGE");
    await expect(
      resumed.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId }),
    ).rejects.toThrow("changed");
    expect(resumed.getState().artifactPreview).toBeNull();
    expect(resumed.getState().artifacts.items[0]?.state).toBe("changed");
    unlinkSync(join(f.workspace, "report.json"));
    await expect(
      resumed.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId }),
    ).rejects.toThrow("missing");
    expect(resumed.getState().artifactPreview).toBeNull();
  });

  it("never turns the report target into edit, undo, shell or another-path authority", async () => {
    const attempts = [
      { name: "create", args: { path: "elsewhere.json", text: "NO" } },
      { name: "edit", args: { path: "note.txt", oldText: "ORIGINAL", newText: "NO" } },
      { name: "undo", args: { snapshotId: "made-up" } },
      { name: "shell", args: { command: "echo NO > note.txt" } },
      { name: "web_fetch", args: { url: "https://example.test/private" } },
    ];
    const f = await fixture(
      attempts.flatMap(({ name, args }) => [call(name, args), answer("Stopped")]),
    );
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const sessionId = f.host.getState().activeSessionId;
    await expect(
      f.host.dispatch({ type: "report.target", sessionId, path: "note.txt" }),
    ).rejects.toThrow("new file");
    await f.host.dispatch({ type: "report.target", sessionId, path: "report.json" });
    for (const attempt of attempts) {
      await f.host.dispatch({ type: "start", sessionId, text: `Try ${attempt.name}` });
      await waitFor(f.host, (state) => state.outcome?.kind === "completed");
      expect(f.host.getState().pendingApproval).toBeNull();
      expect(
        f.host
          .getState()
          .messages.some((message) => message.tool === attempt.name && message.state === "denied"),
      ).toBe(true);
    }
    expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("ORIGINAL");
    expect(existsSync(join(f.workspace, "elsewhere.json"))).toBe(false);
    expect(f.host.getState().artifacts.items).toEqual([]);
    await f.host.dispatch({ type: "load", sessionId, askEachRead: false });
    expect(f.host.getState().reportTarget).toBeNull();
  });

  it("cancels a pending report without creating a file or restoring its approval on reopen", async () => {
    const f = await fixture([call("create", { path: "report.md", text: "NEVER_WRITTEN" })]);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const sessionId = f.host.getState().activeSessionId;
    await f.host.dispatch({ type: "report.target", sessionId, path: "report.md" });
    await f.host.dispatch({ type: "start", sessionId, text: "Prepare report" });
    const waiting = await waitFor(f.host, (state) => !!state.pendingApproval);
    await f.host.dispatch({ type: "cancel", runId: required(waiting.run).id });
    await waitFor(f.host, (state) => state.outcome?.kind === "cancelled");
    await f.host.close();
    const resumed = await f.reopen();
    await resumed.dispatch({ type: "load", sessionId, askEachRead: false });
    expect(resumed.getState().pendingApproval).toBeNull();
    expect(resumed.getState().reportTarget).toBeNull();
    expect(resumed.getState().artifacts.items).toEqual([]);
    expect(existsSync(join(f.workspace, "report.md"))).toBe(false);
    expect(f.requests).toHaveLength(1);
  });

  it("reconfigures only after releasing SQLite ownership and restores history without credentials in state", async () => {
    let configured: RuntimeOptions | undefined;
    let failure = false,
      invalidModel = false,
      calls = 0;
    const f = await fixture(
      [answer("Before settings")],
      {},
      { ready: true },
      {
        configure: async (settings, apiKey) => {
          calls++;
          expect(apiKey === undefined || apiKey === "TEST_ONLY_KEY").toBe(true);
          if (failure) throw Error("PRIVATE_CONFIGURATION_CAUSE");
          const options = required(configured);
          const probe = await createDesktopHost({ runtimeOptions: () => options });
          await probe.close();
          return {
            settings,
            runtimeOptions: {
              ...options,
              ...(invalidModel ? { model: { provider: "missing-fixture", model: "missing" } } : {}),
              limits: {
                ...options.limits,
                maxModelRequests: settings.maxRequests,
                timeoutMs: settings.timeoutMs,
              },
            },
            connection: { ready: false, message: "Fixture connection unavailable" },
          };
        },
      },
    );
    configured = f.runtimeOptions;
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const sessionId = f.host.getState().activeSessionId;
    await f.host.dispatch({ type: "start", sessionId, text: "Initial conversation" });
    await waitFor(f.host, (state) => state.outcome?.kind === "completed");
    await f.host.dispatch({ type: "report.target", sessionId, path: "report.json" });
    const settings = { preset: "flash", maxRequests: 4, timeoutMs: 120_000 };
    await f.host.dispatch({ type: "configure", settings, apiKey: "TEST_ONLY_KEY" });
    expect(calls).toBe(1);
    expect(f.host.getState().settings).toEqual(settings);
    expect(f.host.getState().connection.ready).toBe(false);
    expect(f.host.getState().reportTarget).toBeNull();
    expect(f.host.getState().activeSessionId).toBe(sessionId);
    expect(f.host.getState().messages.some((message) => message.text === "Before settings")).toBe(
      true,
    );
    expect(JSON.stringify(f.host.getState())).not.toContain("TEST_ONLY_KEY");
    expect(f.requests).toHaveLength(1);
    await f.host.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
    failure = true;
    await expect(
      f.host.dispatch({ type: "configure", settings: { ...settings, maxRequests: 5 } }),
    ).rejects.toThrow("could not be applied");
    expect(f.host.getState().settings).toEqual(settings);
    expect(f.host.getState().activeSessionId).toBe(sessionId);
    expect(JSON.stringify(f.host.getState())).not.toContain("PRIVATE_CONFIGURATION_CAUSE");
    expect(f.host.getState().permissions).toEqual({ writes: false, checks: false });
    expect(f.requests).toHaveLength(1);
    failure = false;
    invalidModel = true;
    await expect(
      f.host.dispatch({ type: "configure", settings: { ...settings, maxRequests: 6 } }),
    ).rejects.toThrow("Settings were saved");
    expect(f.host.getState().settings.maxRequests).toBe(6);
    expect(f.host.getState().connection.ready).toBe(false);
    expect(f.requests).toHaveLength(1);
  });
});

describe("desktop M3 explicit grants and recorded effects", () => {
  it("keeps independent grants ephemeral and never truncates an approved edit proposal", async () => {
    const steps: Step[] = [];
    const f = await fixture(steps);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const sessionId = f.host.getState().activeSessionId;
    expect(f.host.getState().permissions).toEqual({ writes: false, checks: false });
    await f.host.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
    // A unique match is necessary to reach the complete-preview boundary.
    writeFileSync(join(f.workspace, "large.txt"), `UNIQUE${"a".repeat(80_000)}`);
    steps.push(call("edit", { path: "large.txt", oldText: "UNIQUE", newText: "replacement" }));
    steps.push(answer("Denied"));
    let approvals = 0;
    const off = f.host.subscribe((s) => {
      if (s.pendingApproval) approvals++;
    });
    await f.host.dispatch({ type: "start", sessionId, text: "Edit the file" });
    await waitFor(f.host, (s) => s.outcome?.kind === "completed");
    off();
    expect(approvals).toBe(0);
    expect(readFileSync(join(f.workspace, "large.txt"), "utf8")).toBe(
      `UNIQUE${"a".repeat(80_000)}`,
    );
    await f.host.dispatch({ type: "effects", sessionId, offset: 0 });
    expect(
      f.host.getState().effects.items.some((e) => e.tool === "edit" && e.state === "denied"),
    ).toBe(true);
    steps.push(call("shell", { command: "echo forbidden" }), answer("No checks grant"));
    await f.host.dispatch({ type: "start", sessionId, text: "Try a check" });
    await waitFor(f.host, (s) => s.outcome?.kind === "completed");
    expect(f.host.getState().messages.some((m) => m.tool === "shell" && m.state === "denied")).toBe(
      true,
    );
    await f.host.dispatch({ type: "report.target", sessionId, path: "report.md" });
    expect(f.host.getState().permissions).toEqual({ writes: false, checks: false });
    await f.host.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
    expect(f.host.getState().reportTarget).toBeNull();
    await f.host.dispatch({ type: "load", sessionId, askEachRead: false });
    expect(f.host.getState().openedHistory).toBe(true);
    expect(f.host.getState().permissions).toEqual({ writes: false, checks: false });
    await f.host.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
    await f.host.dispatch({ type: "create", workspaceRoot: f.other, askEachRead: false });
    expect(f.host.getState().permissions).toEqual({ writes: false, checks: false });
    expect(f.host.getState().openedHistory).toBe(false);
  });

  it("records deny/stale, two edits and reverse undo, rejects changed snapshots and restores history without replay", async () => {
    const steps: Step[] = [];
    const f = await fixture(steps);
    await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
    const sessionId = f.host.getState().activeSessionId;
    await f.host.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
    const mode = statSync(join(f.workspace, "note.txt")).mode;
    // Approval command accepts only its binding fields.
    async function edit(oldText: string, newText: string, decision: "approve" | "deny") {
      steps.push(call("edit", { path: "note.txt", oldText, newText }), answer("Recorded"));
      await f.host.dispatch({ type: "start", sessionId, text: "Edit note.txt" });
      const pending = required((await waitFor(f.host, (s) => !!s.pendingApproval)).pendingApproval);
      await expect(
        f.host.dispatch({ type: "approve", effectId: pending.effectId, digest: "stale", decision }),
      ).rejects.toThrow("stale");
      await f.host.dispatch({
        type: "approve",
        effectId: pending.effectId,
        digest: pending.digest,
        decision,
      });
      await waitFor(f.host, (s) => s.outcome?.kind === "completed");
      await f.host.dispatch({ type: "effects", sessionId, offset: 0 });
      return pending.effectId;
    }
    const denied = await edit("ORIGINAL", "FIRST", "deny");
    expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("ORIGINAL");
    const first = await edit("ORIGINAL", "FIRST", "approve");
    const second = await edit("FIRST", "SECOND", "approve");
    expect(f.host.getState().effects.items.find((e) => e.effectId === denied)?.state).toBe(
      "denied",
    );
    await f.host.dispatch({ type: "effect.inspect", sessionId, effectId: second });
    expect(f.host.getState().effectInspection?.state).toBe("current");
    writeFileSync(join(f.workspace, "note.txt"), "EXTERNAL");
    await f.host.dispatch({ type: "effect.inspect", sessionId, effectId: second });
    expect(f.host.getState().effectInspection?.state).toBe("changed");
    steps.push(call("undo", { snapshotId: second }), answer("Conflict"));
    await f.host.dispatch({ type: "start", sessionId, text: "Undo the snapshot" });
    await waitFor(f.host, (s) => s.outcome?.kind === "completed");
    expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("EXTERNAL");
    writeFileSync(join(f.workspace, "note.txt"), "SECOND");
    for (const snapshotId of [second, first]) {
      steps.push(call("undo", { snapshotId }), answer("Undone"));
      await f.host.dispatch({ type: "start", sessionId, text: "Undo the recorded snapshot" });
      const pending = required((await waitFor(f.host, (s) => !!s.pendingApproval)).pendingApproval);
      await f.host.dispatch({
        type: "approve",
        effectId: pending.effectId,
        digest: pending.digest,
        decision: "approve",
      });
      await waitFor(f.host, (s) => s.outcome?.kind === "completed");
    }
    expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("ORIGINAL");
    expect(statSync(join(f.workspace, "note.txt")).mode).toBe(mode);
    await f.host.dispatch({ type: "effects", sessionId, offset: 0 });
    const recorded = f.host.getState().effects;
    const requests = f.requests.length;
    await f.host.close();
    expect(f.host.getState().permissions).toEqual({ writes: false, checks: false });
    const reopened = await f.reopen();
    await reopened.dispatch({ type: "load", sessionId, askEachRead: false });
    expect(reopened.getState().effects).toEqual(recorded);
    expect(reopened.getState().pendingApproval).toBeNull();
    expect(reopened.getState().permissions).toEqual({ writes: false, checks: false });
    expect(f.requests).toHaveLength(requests);
  });
});

it("runs a separately approved Node check with a read-only workspace and denied network", async () => {
  const steps: Step[] = [];
  const f = await fixture(steps);
  await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
  const sessionId = f.host.getState().activeSessionId;
  await f.host.dispatch({ type: "permissions", sessionId, writes: false, checks: true });
  expect(f.requests).toHaveLength(0);
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  const code =
    'const fs=require("node:fs");console.log(fs.readFileSync("note.txt","utf8"));try{fs.writeFileSync("should-not-exist","bad");process.exitCode=9}catch{console.log("READ_ONLY_CONFIRMED")}';
  steps.push(call("shell", { command: `node -e ${quote(code)}` }), answer("Check observed"));
  await f.host.dispatch({ type: "start", sessionId, text: "Run the Node check" });
  const pending = required((await waitFor(f.host, (s) => !!s.pendingApproval)).pendingApproval);
  expect(pending.preview).toContain('"workspaceAccess":"read-only"');
  expect(pending.preview).toContain('"network":"denied"');
  await f.host.dispatch({
    type: "approve",
    effectId: pending.effectId,
    digest: pending.digest,
    decision: "approve",
  });
  await waitFor(f.host, (s) => s.outcome?.kind === "completed");
  await f.host.dispatch({ type: "effects", sessionId, offset: 0 });
  expect(
    f.host.getState().effects.items.find((e) => e.effectId === pending.effectId)?.receipt,
  ).toMatchObject({ kind: "process", termination: "exited", exitCode: 0 });
  expect(JSON.stringify(f.requests.at(-1))).toContain("READ_ONLY_CONFIRMED");
  expect(existsSync(join(f.workspace, "should-not-exist"))).toBe(false);
  expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("ORIGINAL");
});

it("retains a cancelled started process as unknown across reopen and blocks writes without replay", async () => {
  const steps: Step[] = [];
  const f = await fixture(steps);
  await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
  const sessionId = f.host.getState().activeSessionId;
  await f.host.dispatch({ type: "permissions", sessionId, writes: false, checks: true });
  expect(f.requests).toHaveLength(0);
  steps.push(call("shell", { command: "node -e 'setInterval(()=>{},1000)'" }));
  await f.host.dispatch({ type: "start", sessionId, text: "Run until cancelled" });
  const pending = required((await waitFor(f.host, (s) => !!s.pendingApproval)).pendingApproval);
  await f.host.dispatch({
    type: "approve",
    effectId: pending.effectId,
    digest: pending.digest,
    decision: "approve",
  });
  await waitFor(f.host, (s) =>
    s.effects.items.some((e) => e.effectId === pending.effectId && e.state === "started"),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  await f.host.dispatch({ type: "cancel", runId: required(f.host.getState().run).id });
  await waitFor(f.host, (s) => s.run === null);
  await f.host.dispatch({ type: "effects", sessionId, offset: 0 });
  expect(f.host.getState().effects.items.find((e) => e.effectId === pending.effectId)?.state).toBe(
    "unknown",
  );
  expect(f.host.getState().outcome?.kind).toBe("failed");
  const count = f.requests.length,
    recorded = f.host.getState().effects;
  await f.host.close();
  const reopened = await f.reopen();
  await reopened.dispatch({ type: "load", sessionId, askEachRead: false });
  expect(reopened.getState().effects).toEqual(recorded);
  expect(reopened.getState().permissions).toEqual({ writes: false, checks: false });
  expect(f.requests).toHaveLength(count);
  steps.push(call("read", { path: "note.txt" }), answer("Read after interruption"));
  await reopened.dispatch({
    type: "start",
    sessionId,
    text: "Inspect the file without changing it",
  });
  await waitFor(reopened, (s) => s.outcome?.kind === "completed");
  expect(JSON.stringify(f.requests.at(-1))).toContain("ORIGINAL");
  await reopened.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
  steps.push(call("edit", { path: "note.txt", oldText: "ORIGINAL", newText: "BLOCKED" }));
  await reopened.dispatch({
    type: "start",
    sessionId,
    text: "An unresolved lease must refuse this edit",
  });
  const blocked = required((await waitFor(reopened, (s) => !!s.pendingApproval)).pendingApproval);
  await reopened.dispatch({
    type: "approve",
    effectId: blocked.effectId,
    digest: blocked.digest,
    decision: "approve",
  });
  await waitFor(reopened, (s) => s.run === null);
  expect(reopened.getState().outcome?.kind).toBe("failed");
  expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("ORIGINAL");
  expect(f.requests).toHaveLength(count + 3);
});

it("after pre-effect cancellation reopens read-only and explicitly regrants undo of a settled prior edit", async () => {
  const steps: Step[] = [];
  const f = await fixture(steps);
  await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
  const sessionId = f.host.getState().activeSessionId;
  await f.host.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
  steps.push(
    call("edit", { path: "note.txt", oldText: "ORIGINAL", newText: "SETTLED" }),
    answer("Edited"),
  );
  await f.host.dispatch({ type: "start", sessionId, text: "Make the edit" });
  const edit = required((await waitFor(f.host, (s) => !!s.pendingApproval)).pendingApproval);
  await f.host.dispatch({
    type: "approve",
    effectId: edit.effectId,
    digest: edit.digest,
    decision: "approve",
  });
  await waitFor(f.host, (s) => s.outcome?.kind === "completed");
  steps.push(call("edit", { path: "note.txt", oldText: "SETTLED", newText: "NEVER" }));
  await f.host.dispatch({ type: "start", sessionId, text: "Pending edit" });
  const waiting = await waitFor(f.host, (s) => !!s.pendingApproval);
  await f.host.dispatch({ type: "cancel", runId: required(waiting.run).id });
  await waitFor(f.host, (s) => s.run === null);
  await f.host.close();
  const reopened = await f.reopen();
  await reopened.dispatch({ type: "load", sessionId, askEachRead: false });
  expect(f.requests).toHaveLength(3);
  expect(reopened.getState().permissions).toEqual({ writes: false, checks: false });
  expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("SETTLED");
  await reopened.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
  steps.push(call("undo", { snapshotId: edit.effectId }), answer("Undone"));
  await reopened.dispatch({ type: "start", sessionId, text: "Undo the previously settled edit" });
  const undo = required((await waitFor(reopened, (s) => !!s.pendingApproval)).pendingApproval);
  await reopened.dispatch({
    type: "approve",
    effectId: undo.effectId,
    digest: undo.digest,
    decision: "approve",
  });
  await waitFor(reopened, (s) => s.outcome?.kind === "completed");
  expect(readFileSync(join(f.workspace, "note.txt"), "utf8")).toBe("ORIGINAL");
  expect(f.requests).toHaveLength(5);
});

it("pages all effects independently of report cards without adding requests", async () => {
  const events: ModelStreamEvent[] = Array.from(
    { length: 21 },
    (_, index) =>
      ({ ...required(call("read", { path: "note.txt" })[0]), index }) as ModelStreamEvent,
  );
  events.push(complete("tool_use"));
  const f = await fixture([events, answer("Read")]);
  await f.host.dispatch({ type: "create", workspaceRoot: f.workspace, askEachRead: false });
  const sessionId = f.host.getState().activeSessionId;
  await f.host.dispatch({ type: "start", sessionId, text: "Read the fixture repeatedly" });
  await waitFor(f.host, (s) => s.outcome?.kind === "completed");
  await f.host.dispatch({ type: "effects", sessionId, offset: 0 });
  const first = f.host.getState().effects;
  expect(first.items).toHaveLength(20);
  expect(first.hasMore).toBe(true);
  await f.host.dispatch({ type: "effects", sessionId, offset: 20 });
  const last = f.host.getState().effects;
  expect(last.items).toHaveLength(1);
  expect(last.hasMore).toBe(false);
  expect(new Set([...first.items, ...last.items].map((e) => e.effectId)).size).toBe(21);
  expect(f.host.getState().artifacts.offset).toBe(0);
  await f.host.dispatch({ type: "artifacts", sessionId, offset: 0 });
  expect(f.host.getState().effects).toEqual(last);
  expect(f.requests).toHaveLength(2);
});

describe("desktop command validation", () => {
  it("rejects extra keys, prototype/accessor payloads, invalid IDs and oversized messages", () => {
    const getter = {
      get type() {
        throw Error("Getter must not execute");
      },
    };
    for (const value of [
      null,
      [],
      { type: "close", extra: true },
      { type: "start", sessionId: "x", text: "x".repeat(65_536) },
      { type: "list", offset: Number.NaN },
      { type: "list", offset: -1 },
      { type: "load", sessionId: "x" },
      { type: "cancel", runId: "\n" },
      { type: "create", workspaceRoot: "relative", askEachRead: false },
      { type: "materials", sessionId: "x", paths: Array(9).fill("source.pdf") },
      { type: "materials", sessionId: "x", paths: ["\u0000.pdf"] },
      { type: "report.target", sessionId: "x", path: false },
      { type: "artifact.open", sessionId: "x", effectId: "effect", path: "/private" },
      { type: "configure", settings: { preset: "flash", maxRequests: 0, timeoutMs: 120_000 } },
      Object.create({ type: "close" }),
      getter,
    ])
      expect(() => parseDesktopCommand(value)).toThrow("Invalid desktop command");
    expect(parseDesktopCommand({ type: "close" })).toEqual({ type: "close" });
  });
});
