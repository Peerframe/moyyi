import { describe, expect, it, vi } from "vitest";
import type {
  ActionDigest,
  BlobRef,
  ClientCommand,
  EffectId,
  EffectRecord,
  EntryId,
  RunId,
  RuntimeEvent,
  SessionId,
  Timestamp,
  ToolCallId,
  ToolResultPart,
  TranscriptEntry,
} from "../contracts/index.ts";
import type { Runtime } from "../runtime/index.ts";
import { createCliSession, terminalText } from "./session.ts";

const sessionId = "session_test" as SessionId;
const runId = "run_test" as RunId;
const digest = `sha256:${"a".repeat(64)}` as ActionDigest;
const newerDigest = `sha256:${"b".repeat(64)}` as ActionDigest;
const effectId = "effect_read" as EffectId;
function fake() {
  const listeners = new Set<(event: RuntimeEvent) => void>();
  const sent: ClientCommand[] = [];
  let hook: ((command: ClientCommand) => void | Promise<void>) | undefined;
  const emit = (event: RuntimeEvent) => {
    for (const listener of listeners) listener(event);
  };
  const close = vi.fn(async () => {});
  const runtime: Runtime = {
    appendConnectionSwitched: async () => {},
    sessions: {
      list: async () => {
        throw Error("Unused session management");
      },
      history: async () => {
        throw Error("Unused session management");
      },
      readMessage: async () => {
        throw Error("Unused session management");
      },
      update: async () => {
        throw Error("Unused session management");
      },
    },
    plugins: [],
    diagnostics: [],
    close,
    idle: async () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(command) {
      sent.push(command);
      if (hook) await hook(command);
      else if (command.type === "session.create") emit({ type: "session.ready", sessionId });
      else if (command.type === "session.load")
        emit({ type: "session.ready", sessionId: command.sessionId });
      else if (command.type === "run.start" || command.type === "session.compact")
        emit({ type: "run.started", runId, sessionId: command.sessionId });
    },
  };
  return {
    runtime,
    emit,
    sent,
    close,
    setHook(value: typeof hook) {
      hook = value;
    },
    listenerCount: () => listeners.size,
  };
}
function setup(
  options: {
    interactive?: boolean;
    initialPrompt?: string;
    sessionId?: SessionId;
    developmentPluginNames?: readonly string[];
  } = {},
) {
  const host = fake();
  let output = "";
  const prompt = vi.fn();
  const cli = createCliSession(host.runtime, {
    workspaceRoot: "/synthetic/workspace",
    interactive: true,
    write: (text) => {
      output += text;
    },
    prompt,
    ...options,
  });
  return { ...host, cli, prompt, output: () => output };
}
function assistant(text: string, id = "entry_answer"): TranscriptEntry {
  return {
    id: id as EntryId,
    sessionId,
    parentId: null,
    runId,
    createdAt: "2026-10-25T00:00:00Z" as Timestamp,
    body: {
      kind: "assistant_message",
      origin: { provider: "synthetic", model: "fixture" },
      content: [{ type: "text", text }],
      stopReason: "end_turn",
      providerStopReason: null,
      usage: {
        status: "unknown",
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
      },
      request: {
        rendererVersion: "fixture",
        system: `sha256:${"0".repeat(64)}` as BlobRef,
        tools: `sha256:${"0".repeat(64)}` as BlobRef,
        messages: [],
      },
    },
  };
}
const approval = (
  id = effectId,
  value = digest,
): Extract<RuntimeEvent, { type: "approval.requested" }> => ({
  type: "approval.requested",
  effectId: id,
  digest: value,
  summary: "Read a scoped file",
  preview: "note.txt",
});
const finish = (host: ReturnType<typeof setup>) =>
  host.emit({ type: "run.finished", runId, outcome: { kind: "completed" } });
const tick = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

function writeEffect(overrides: Partial<EffectRecord> = {}): EffectRecord {
  return {
    id: "effect_write" as EffectId,
    callId: "call_write" as ToolCallId,
    runId,
    tool: "edit",
    profile: { class: "workspace_write", reversibility: "snapshot", verification: "postcheck" },
    digest,
    state: "succeeded",
    updatedAt: "2026-10-26T00:00:00Z" as Timestamp,
    ...overrides,
  };
}
function receiptEntry(
  effect: EffectRecord,
  data: unknown,
  status: ToolResultPart["status"] = "succeeded",
): TranscriptEntry {
  return {
    ...assistant("", `entry_${effect.id}`),
    runId: effect.runId,
    body: {
      kind: "tool_results",
      results: [
        {
          type: "tool_result",
          callId: effect.callId,
          status,
          content: [{ type: "text", text: JSON.stringify(data) }],
        },
      ],
    },
  };
}
const fileReceipt = (effect: EffectRecord, path = "note.txt") => ({
  snapshotId: effect.id,
  path,
  beforeHash: "a".repeat(64),
  afterHash: "b".repeat(64),
});

describe("trusted execution receipts", () => {
  it("waits for a matching terminal journal record and displays the snapshot once", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Edit");
    const effect = writeEffect();
    host.emit({ type: "effect.updated", effect: { ...effect, state: "started" } });
    host.emit({ type: "entry.appended", entry: receiptEntry(effect, fileReceipt(effect)) });
    expect(host.output()).not.toContain("receipt |");
    host.emit({ type: "effect.updated", effect });
    host.emit({ type: "effect.updated", effect });
    expect(host.output().match(/receipt \|/g)).toHaveLength(1);
    expect(host.output()).toContain('receipt | edit path="note.txt" snapshotId="effect_write"');
    await host.cli.end();
  });
  it("does not promote model claims, free-form evidence or ordinary tool results to snapshots", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Inspect");
    const effect = writeEffect();
    host.emit({ type: "entry.appended", entry: assistant(JSON.stringify(fileReceipt(effect))) });
    host.emit({ type: "entry.appended", entry: receiptEntry(effect, fileReceipt(effect)) });
    host.emit({
      type: "effect.updated",
      effect: {
        ...effect,
        tool: "read",
        profile: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
        evidence: JSON.stringify(fileReceipt(effect)),
      },
    });
    expect(host.output()).not.toContain("receipt |");
    await host.cli.end();
  });
  it.each(["denied", "unknown", "failed"] as const)(
    "does not render a successful snapshot from a %s effect",
    async (state) => {
      const host = setup();
      await host.cli.start();
      await host.cli.line("Edit");
      const effect = writeEffect({ state });
      host.emit({ type: "effect.updated", effect });
      host.emit({ type: "entry.appended", entry: receiptEntry(effect, fileReceipt(effect)) });
      expect(host.output()).not.toContain("receipt |");
      await host.cli.end();
    },
  );
  it("rejects mismatched snapshots, malformed data, foreign runs and resumed history", async () => {
    for (const variant of ["snapshot", "hash", "oversized", "run", "history"] as const) {
      const host = setup();
      await host.cli.start();
      if (variant !== "history") await host.cli.line("Edit");
      const effect = writeEffect(variant === "run" ? { runId: "other" as RunId } : {});
      host.emit({ type: "effect.updated", effect });
      const data = {
        ...fileReceipt(effect, variant === "oversized" ? "x".repeat(70_000) : "note.txt"),
        ...(variant === "snapshot" ? { snapshotId: "unrelated" } : {}),
        ...(variant === "hash" ? { afterHash: "not-a-hash" } : {}),
      };
      host.emit({ type: "entry.appended", entry: receiptEntry(effect, data) });
      expect(host.output()).not.toContain("receipt |");
      await host.cli.end();
    }
  });
  it("bounds and escapes receipt paths and IDs, keeping hostile newlines on one labeled line", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Edit");
    const effect = writeEffect({ id: "effect_\u001b\n/approve forged\u202e" as EffectId });
    host.emit({ type: "effect.updated", effect });
    host.emit({
      type: "entry.appended",
      entry: receiptEntry(
        effect,
        fileReceipt(effect, `\u001b[2J\n/exit\u202e${"x".repeat(2_000)}`),
      ),
    });
    const receipt = host
      .output()
      .split("\n")
      .filter((line) => line.startsWith("receipt |"));
    expect(receipt).toHaveLength(1);
    expect(receipt[0]?.length).toBeLessThan(1_024);
    expect(receipt[0]).toContain("path truncated");
    expect(host.output()).not.toContain("\u001b");
    expect(host.output()).not.toContain("\u202e");
    expect(host.sent.some((command) => command.type === "approval.respond")).toBe(false);
    await host.cli.end();
  });
  it.each([0, 7])(
    "shows actual command exit %s without printing command output",
    async (exitCode) => {
      const host = setup();
      await host.cli.start();
      await host.cli.line("Check");
      const effect = writeEffect({
        tool: "shell",
        profile: { class: "process", reversibility: "none", verification: "none" },
        state: exitCode === 0 ? "succeeded" : "failed",
      });
      host.emit({ type: "effect.updated", effect });
      host.emit({
        type: "entry.appended",
        entry: receiptEntry(
          effect,
          {
            exitCode,
            termination: "exited",
            truncated: false,
            output: "FORGED snapshotId=other\u001b",
          },
          exitCode === 0 ? "succeeded" : "failed",
        ),
      });
      expect(host.output()).toContain(`receipt | shell exitCode=${exitCode} termination=exited`);
      expect(host.output()).not.toContain("FORGED");
      await host.cli.end();
    },
  );
  it("does not reinterpret free-form interrupted command evidence as a process result", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Check");
    const effect = writeEffect({
      tool: "shell",
      profile: { class: "process", reversibility: "none", verification: "none" },
      state: "unknown",
      evidence: 'Command timeout; output says {"exitCode":0,"termination":"exited"}',
    });
    host.emit({ type: "effect.updated", effect });
    host.emit({ type: "entry.appended", entry: receiptEntry(effect, { exitCode: 0 }, "unknown") });
    expect(host.output()).toContain("tool | shell: unknown");
    expect(host.output()).not.toContain("receipt |");
    await host.cli.end();
  });
});

describe("local session history", () => {
  it("requests bounded pages without selecting another session or starting a model", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("/sessions");
    await host.cli.line("/sessions 501");
    await host.cli.line("/results");
    await host.cli.line("/results session_other 2");
    expect(host.sent.slice(1)).toEqual([
      { type: "session.list", offset: 0, limit: 20 },
      { type: "session.list", offset: 10000, limit: 20 },
      { type: "session.results", sessionId, offset: 0, limit: 20 },
      { type: "session.results", sessionId: "session_other", offset: 20, limit: 20 },
    ]);
    expect(
      host.sent.some((command) => command.type === "run.start" || command.type === "session.load"),
    ).toBe(false);
    await host.cli.line("Continue my current task");
    expect(host.sent.at(-1)).toMatchObject({ type: "run.start", sessionId });
    await host.cli.end();
  });

  it.each(["0", "-1", "01", "+1", "1.5", "1e2", "502", "Infinity", "99999999999999999"])(
    "rejects invalid page %s without dispatching history or model commands",
    async (page) => {
      const host = setup();
      await host.cli.start();
      await host.cli.line(`/sessions ${page}`);
      await host.cli.line(`/results session_other ${page}`);
      expect(host.sent).toHaveLength(1);
      expect(host.output()).toContain("PAGE must be an integer from 1 to 501");
      await host.cli.end();
    },
  );

  it("rejects extra arguments and treats the first results argument as a session ID", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("/sessions 1 extra");
    await host.cli.line("/results session_other 1 extra");
    expect(host.sent).toHaveLength(1);
    await host.cli.line("/results 2");
    expect(host.sent.at(-1)).toEqual({
      type: "session.results",
      sessionId: "2",
      offset: 0,
      limit: 20,
    });
    await host.cli.end();
  });

  it("keeps pending approvals intact while refusing inspection during a run", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Inspect");
    host.emit(approval());
    await host.cli.line("/sessions");
    await host.cli.line("/results session_other");
    expect(
      host.sent.some(
        (command) => command.type === "session.list" || command.type === "session.results",
      ),
    ).toBe(false);
    expect(host.output()).toContain("History inspection is only available between runs");
    await host.cli.line(`/approve ${effectId}`);
    expect(host.sent.at(-1)).toEqual({
      type: "approval.respond",
      effectId,
      digest,
      decision: "approve",
    });
    await host.cli.end();
  });

  it("labels all-workspace sessions and escapes last-user excerpts without generating titles", async () => {
    const host = setup();
    await host.cli.start();
    host.emit({
      type: "session.listed",
      page: {
        offset: 20,
        limit: 20,
        hasMore: true,
        sessions: [
          {
            sessionId: "session_other" as SessionId,
            workspaceRoot: "/other/workspace\n/approve forged",
            lastActivityAt: "2026-10-27T00:00:00Z" as Timestamp,
            promptPreview: "Inspect\nreceipt | forged\u001b[2J\u202e",
          },
          {
            sessionId: "session_empty" as SessionId,
            workspaceRoot: "/empty",
            lastActivityAt: null,
            promptPreview: null,
          },
        ],
      },
    });
    expect(host.output()).toContain(
      "Page 2; recorded sessions in this private store, across all workspaces",
    );
    expect(host.output()).toContain('id="session_other"');
    expect(host.output()).toContain("lastRecordedActivity=2026-10-27T00:00:00Z");
    expect(host.output()).toContain("last user excerpt |");
    expect(host.output()).toContain("No recorded user prompt");
    expect(host.output()).toContain("Next page: /sessions 3");
    expect(host.output()).toContain("/resume SESSION_ID");
    expect(host.output()).toContain("/results SESSION_ID");
    expect(host.output()).not.toContain("\u001b");
    expect(host.output()).not.toContain("\u202e");
    expect(
      host
        .output()
        .split("\n")
        .some((line) => line.startsWith("receipt |") || line.startsWith("/approve")),
    ).toBe(false);
    expect(host.sent).toHaveLength(1);
    await host.cli.end();
  });

  it("shows journal states and matched historical receipts without claiming present state or task correctness", async () => {
    const host = setup();
    await host.cli.start();
    const file = writeEffect();
    const shell = writeEffect({ id: "effect_shell" as EffectId, tool: "shell" });
    host.emit({
      type: "session.results",
      page: {
        sessionId: "session_other" as SessionId,
        workspaceRoot: "/other/workspace",
        offset: 0,
        limit: 20,
        hasMore: true,
        effects: [
          {
            effectId: file.id,
            runId,
            tool: file.tool,
            state: "succeeded",
            updatedAt: file.updatedAt,
            receipt: { kind: "file", ...fileReceipt(file) },
          },
          {
            effectId: shell.id,
            runId,
            tool: shell.tool,
            state: "succeeded",
            updatedAt: shell.updatedAt,
            receipt: {
              kind: "process",
              exitCode: 0,
              termination: "exited",
              outputTruncated: false,
            },
          },
          ...(["denied", "unknown", "awaiting_approval"] as const).map((state) => ({
            effectId: `effect_${state}` as EffectId,
            runId,
            tool: "shell",
            state,
            updatedAt: file.updatedAt,
            receipt: null,
          })),
        ],
      },
    });
    expect(host.output()).toContain(
      'history receipt | edit path="note.txt" snapshotId="effect_write"',
    );
    expect(host.output()).toContain(
      "history receipt | shell exitCode=0 termination=exited outputTruncated=false",
    );
    for (const state of ["denied", "unknown", "awaiting_approval"])
      expect(host.output()).toContain(`state=${state}`);
    expect(host.output()).toContain("not current file contents or new authorization");
    expect(host.output()).toContain("Exit code 0 does not prove a correct check");
    expect(host.output()).toContain("Next page: /results session_other 2");
    expect(host.output()).not.toContain("Use /approve");
    await host.cli.line("/approve effect_awaiting_approval");
    expect(host.sent).toHaveLength(1);
    await host.cli.line("Continue");
    expect(host.sent.at(-1)).toMatchObject({ type: "run.start", sessionId });
    await host.cli.end();
  });

  it("shows empty pages and never suggests page 502", async () => {
    const host = setup();
    await host.cli.start();
    host.emit({
      type: "session.listed",
      page: { offset: 10000, limit: 20, sessions: [], hasMore: true },
    });
    host.emit({
      type: "session.results",
      page: {
        sessionId,
        workspaceRoot: "/synthetic/workspace",
        offset: 10000,
        limit: 20,
        effects: [],
        hasMore: true,
      },
    });
    expect(host.output()).toContain("No sessions on this page");
    expect(host.output()).toContain("No recorded effects on this page");
    expect(host.output()).toContain("beyond the CLI page limit (501)");
    expect(host.output()).not.toContain("502");
    await host.cli.end();
  });

  it("prompts for explicit history inspection after resume, without replaying old approvals", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("/resume session_old");
    expect(host.output()).toContain("History loaded. Use /results for recorded effects");
    expect(host.sent).toEqual([
      { type: "session.create", workspaceRoot: "/synthetic/workspace" },
      { type: "session.load", sessionId: "session_old" },
    ]);
    await host.cli.line("/results");
    expect(host.sent.at(-1)).toEqual({
      type: "session.results",
      sessionId: "session_old",
      offset: 0,
      limit: 20,
    });
    expect(host.output()).not.toContain("approval |");
    await host.cli.end();
  });
});

describe("CLI protocol session", () => {
  it("creates a session and streams output without duplicating the persisted answer", async () => {
    const host = setup();
    await host.cli.start();
    expect(host.sent).toEqual([{ type: "session.create", workspaceRoot: "/synthetic/workspace" }]);
    await host.cli.line("Hello");
    host.emit({ type: "assistant.delta", runId, text: "Hello " });
    host.emit({ type: "assistant.delta", runId, text: "world" });
    host.emit({ type: "entry.appended", entry: assistant("Hello world") });
    host.emit({ type: "entry.appended", entry: assistant("Hello world") });
    finish(host);
    expect(host.output().match(/Hello world/g)).toHaveLength(1);
    expect(host.output()).toContain("assistant | Hello world\n");
    expect(host.output()).toContain("run | completed");
    await host.cli.end();
    expect(await host.cli.done).toBe(0);
  });
  it("renders final-only text and missing streamed suffixes once", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("first");
    host.emit({ type: "entry.appended", entry: assistant("Only final text", "final1") });
    host.emit({ type: "assistant.delta", runId, text: "partial" });
    host.emit({ type: "entry.appended", entry: assistant("partial and final suffix", "final2") });
    expect(host.output()).toContain("assistant | Only final text");
    expect(host.output().match(/partial and final suffix/g)).toHaveLength(1);
    finish(host);
    await host.cli.end();
  });
  it("steers an active run instead of starting a competing one", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("First");
    await host.cli.line("Also check this");
    expect(host.sent.at(-1)).toEqual({
      type: "run.steer",
      runId,
      input: [{ type: "text", text: "Also check this" }],
    });
    expect(host.sent.filter((command) => command.type === "run.start")).toHaveLength(1);
    await host.cli.end();
  });
  it("requires an explicit approval ID and uses each displayed digest", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Inspect");
    const second = "effect_second" as EffectId;
    host.emit(approval());
    host.emit(approval(second, newerDigest));
    await host.cli.line("yes");
    expect(host.sent.at(-1)?.type).toBe("run.steer");
    await host.cli.line("/approve");
    expect(host.sent.filter((command) => command.type === "approval.respond")).toHaveLength(0);
    await host.cli.line(`/approve ${effectId}`);
    await host.cli.line(`/deny ${second}`);
    expect(host.sent.filter((command) => command.type === "approval.respond")).toEqual([
      { type: "approval.respond", effectId, digest, decision: "approve" },
      { type: "approval.respond", effectId: second, digest: newerDigest, decision: "deny" },
    ]);
    await host.cli.line(`/approve ${effectId}`);
    expect(host.sent.filter((command) => command.type === "approval.respond")).toHaveLength(2);
    expect(host.output()).toContain(`digest: ${digest}`);
    await host.cli.end();
  });
  it("does not retry rejected stale approval and only accepts a newly displayed digest", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Inspect");
    host.emit(approval());
    host.setHook((command) => {
      if (command.type === "approval.respond")
        host.emit({
          type: "command.rejected",
          command: command.type,
          reason: "Unknown or stale approval digest",
        });
    });
    await host.cli.line(`/approve ${effectId}`);
    await host.cli.line(`/approve ${effectId}`);
    expect(host.sent.filter((command) => command.type === "approval.respond")).toHaveLength(1);
    host.setHook(undefined);
    host.emit(approval(effectId, newerDigest));
    await host.cli.line(`/approve ${effectId}`);
    expect(host.sent.at(-1)).toEqual({
      type: "approval.respond",
      effectId,
      digest: newerDigest,
      decision: "approve",
    });
    await host.cli.end();
  });
  it("preserves a new approval arriving while the previous reply is rejected", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Inspect");
    host.emit(approval());
    host.setHook((command) => {
      if (command.type === "approval.respond") {
        host.emit(approval(effectId, newerDigest));
        host.emit({ type: "command.rejected", command: command.type, reason: "Stale digest" });
      }
    });
    await host.cli.line(`/approve ${effectId}`);
    host.setHook(undefined);
    await host.cli.line(`/deny ${effectId}`);
    expect(host.sent.at(-1)).toEqual({
      type: "approval.respond",
      effectId,
      digest: newerDigest,
      decision: "deny",
    });
    await host.cli.end();
  });
  it("Ctrl-C cancels a run and a later idle Ctrl-C exits once", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Inspect");
    await host.cli.interrupt();
    expect(host.sent.at(-1)).toEqual({ type: "run.cancel", runId });
    expect(host.close).not.toHaveBeenCalled();
    host.emit({ type: "run.finished", runId, outcome: { kind: "cancelled" } });
    await host.cli.interrupt();
    expect(await host.cli.done).toBe(0);
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(host.listenerCount()).toBe(0);
    await host.cli.end();
    expect(host.close).toHaveBeenCalledTimes(1);
  });
  it("EOF cancels pending approval/run and waits for runtime shutdown", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Inspect");
    host.emit(approval());
    const release = Promise.withResolvers<void>();
    host.close.mockImplementation(() => release.promise);
    const end = host.cli.end();
    await tick();
    expect(host.sent.at(-1)).toEqual({ type: "run.cancel", runId });
    let done = false;
    void host.cli.done.then(() => {
      done = true;
    });
    await tick();
    expect(done).toBe(false);
    release.resolve();
    await end;
    expect(await host.cli.done).toBe(130);
    expect(host.listenerCount()).toBe(0);
  });
  it("one-shot waits for completion and denies approval without prompting", async () => {
    const host = setup({ interactive: false, initialPrompt: "Inspect" });
    await host.cli.start();
    expect(host.close).not.toHaveBeenCalled();
    host.emit(approval());
    await tick();
    expect(host.sent.at(-1)).toEqual({
      type: "approval.respond",
      effectId,
      digest,
      decision: "deny",
    });
    expect(host.prompt).not.toHaveBeenCalled();
    finish(host);
    expect(await host.cli.done).toBe(0);
  });
  it.each(["failed", "budget_exhausted", "cancelled"] as const)(
    "one-shot reports nonzero %s outcome",
    async (kind) => {
      const host = setup({ interactive: false, initialPrompt: "Inspect" });
      await host.cli.start();
      const outcome =
        kind === "failed"
          ? { kind, reason: "failure" }
          : kind === "budget_exhausted"
            ? { kind, budget: "requests" }
            : { kind };
      host.emit({ type: "run.finished", runId, outcome });
      expect(await host.cli.done).toBe(kind === "cancelled" ? 130 : 1);
    },
  );
  it.each([false, true])(
    "explains capped output without exposing reasoning (partial text: %s)",
    async (partial) => {
      const host = setup({ interactive: false, initialPrompt: "Inspect" });
      await host.cli.start();
      const entry = assistant(partial ? "Unfinished explanation" : "");
      if (entry.body.kind !== "assistant_message") throw Error("Wrong fixture");
      host.emit({
        type: "entry.appended",
        entry: {
          ...entry,
          body: {
            ...entry.body,
            stopReason: "max_tokens",
            content: [
              { type: "reasoning", kind: "visible", text: "PRIVATE_REASONING_NOT_FOR_TERMINAL" },
              ...entry.body.content,
            ],
            usage: {
              ...entry.body.usage,
              status: "final",
              outputTokens: 100,
              reasoningTokens: partial ? 75 : 100,
            },
          },
        },
      });
      host.emit({
        type: "run.finished",
        runId,
        outcome: { kind: "budget_exhausted", budget: "model_output_tokens" },
      });
      expect(await host.cli.done).toBe(1);
      expect(host.output()).toContain(
        partial ? "text above is partial" : "without producing an answer",
      );
      expect(host.output()).toContain(
        `100 output tokens, including ${partial ? 75 : 100} reasoning tokens`,
      );
      expect(host.output()).toContain("separate from the number of allowed requests");
      expect(host.output()).not.toContain("PRIVATE_REASONING_NOT_FOR_TERMINAL");
      expect(host.sent.filter((command) => command.type === "run.start")).toHaveLength(1);
    },
  );

  it("does not turn unknown or partial usage into a final token count", async () => {
    const host = setup();
    await host.cli.start();
    const entry = assistant("");
    if (entry.body.kind !== "assistant_message") throw Error("Wrong fixture");
    for (const status of ["unknown", "partial"] as const) {
      host.emit({
        type: "entry.appended",
        entry: {
          ...entry,
          id: `entry_${status}` as EntryId,
          body: { ...entry.body, stopReason: "max_tokens", usage: { ...entry.body.usage, status } },
        },
      });
    }
    expect(host.output()).toContain("without producing an answer");
    expect(host.output()).not.toContain("reported usage");
    expect(host.output()).not.toContain("0 output tokens");
    await host.cli.end();
  });
  it("loads a requested session and displays history without starting a model", async () => {
    const host = setup({ sessionId });
    host.setHook((command) => {
      if (command.type === "session.load") {
        host.emit({ type: "session.ready", sessionId });
        host.emit({ type: "entry.appended", entry: assistant("Saved answer") });
      }
    });
    await host.cli.start();
    expect(host.sent).toEqual([{ type: "session.load", sessionId }]);
    expect(host.output()).toContain("assistant | Saved answer");
    await host.cli.end();
  });
  it("blocks session switching/reload during a run and allows configured idle reload", async () => {
    const host = setup({ developmentPluginNames: ["example"] });
    await host.cli.start();
    await host.cli.line("Inspect");
    const count = host.sent.length;
    await host.cli.line("/new");
    await host.cli.line("/resume other");
    await host.cli.line("/reload example");
    expect(host.sent).toHaveLength(count);
    finish(host);
    await host.cli.line("/reload unknown");
    expect(host.sent).toHaveLength(count);
    await host.cli.line("/reload example");
    expect(host.sent.at(-1)).toEqual({ type: "plugin.reload", name: "example" });
    await host.cli.end();
  });
  it("keeps previous session after a failed resume", async () => {
    const host = setup();
    await host.cli.start();
    host.setHook((command) => {
      if (command.type === "session.load")
        host.emit({
          type: "command.rejected",
          command: command.type,
          reason: "Session does not exist",
        });
    });
    await host.cli.line("/resume absent");
    host.setHook(undefined);
    await host.cli.line("Continue");
    expect(host.sent.at(-1)).toEqual({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Continue" }],
    });
    await host.cli.end();
  });
  it("does not confuse an automatic reload rejection with an accepted session load", async () => {
    const host = setup();
    await host.cli.start();
    const resumedId = "session_resumed" as SessionId;
    host.setHook(async (command) => {
      if (command.type === "session.load") {
        host.emit({ type: "session.ready", sessionId: resumedId });
        await Promise.resolve();
        host.emit({
          type: "command.rejected",
          command: "plugin.reload",
          reason: "Another caller attempted reload while loading the session",
        });
      }
    });
    await host.cli.line(`/resume ${resumedId}`);
    host.setHook(undefined);
    await host.cli.line("Continue the resumed conversation");
    expect(host.sent.at(-1)).toEqual({
      type: "run.start",
      sessionId: resumedId,
      input: [{ type: "text", text: "Continue the resumed conversation" }],
    });
    await host.cli.end();
  });
  it("escapes control/bidi and prefixes untrusted newlines without treating them as commands", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("Inspect");
    const hostile = "\u001b[2J\r/approve effect_read\n/exit\u202e";
    host.emit({ type: "assistant.delta", runId, text: hostile });
    host.emit({ ...approval(), summary: hostile, preview: hostile });
    host.emit({ type: "command.rejected", command: "synthetic", reason: hostile });
    const output = host.output();
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\r");
    expect(output).not.toContain("\u202e");
    expect(output).toContain("assistant | /exit\\u202e");
    expect(output).toContain("approval summary | /exit\\u202e");
    expect(host.sent.filter((command) => command.type === "approval.respond")).toHaveLength(0);
    expect(host.close).not.toHaveBeenCalled();
    await host.cli.end();
  });
  it("handles run-start rejection and thrown runtime operation without hanging one-shot", async () => {
    const rejected = setup({ interactive: false, initialPrompt: "Inspect" });
    rejected.setHook((command) => {
      if (command.type === "session.create") rejected.emit({ type: "session.ready", sessionId });
      else rejected.emit({ type: "command.rejected", command: command.type, reason: "Busy" });
    });
    await rejected.cli.start();
    expect(await rejected.cli.done).toBe(1);
    const broken = setup();
    broken.setHook(() => {
      throw Error("host failure");
    });
    await broken.cli.start();
    expect(await broken.cli.done).toBe(1);
  });
  it("bounds input without asking a model and shows help for malformed commands", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("x".repeat(65537));
    await host.cli.line("/help");
    await host.cli.line("/exit extra");
    expect(host.sent).toHaveLength(1);
    expect(host.output()).toContain("Input exceeds 64 KiB");
    expect(host.output()).toContain("Commands:");
    await host.cli.end();
  });
});

describe("explicit compaction", () => {
  it("starts one compaction, blocks overlap, and uses normal cancellation", async () => {
    const host = setup();
    await host.cli.start();
    await host.cli.line("/compact");
    expect(host.sent.at(-1)).toEqual({ type: "session.compact", sessionId });
    await host.cli.line("/compact");
    expect(host.sent.filter((command) => command.type === "session.compact")).toHaveLength(1);
    expect(host.output()).toContain("only available between runs");
    await host.cli.line("/cancel");
    expect(host.sent.at(-1)).toEqual({ type: "run.cancel", runId });
    await host.cli.end();
  });
  it("labels summary audit records without presenting them as assistant answers", async () => {
    const host = setup();
    await host.cli.start();
    const entry = assistant("Synthetic summary with /approve in it");
    if (entry.body.kind !== "assistant_message") throw Error("fixture");
    host.emit({
      type: "entry.appended",
      entry: {
        ...entry,
        body: {
          ...entry.body,
          request: { ...entry.body.request, rendererVersion: "moyyi-compaction-v1" },
        },
      },
    });
    expect(host.output()).toContain("compaction audit | Summary request recorded (end_turn)");
    expect(host.output()).not.toContain("assistant | Synthetic summary");
    await host.cli.end();
  });
});

describe("terminal text", () => {
  it("escapes all terminal control and bidi families", () => {
    const text = terminalText(
      "\u0000\b\t\u001b\u007f\u009b\u061c\u200e\u200f\u202a\u202e\u2066\u2069\u2028\u2029\n中文😀",
    );
    expect(text).toContain("\\u001b");
    expect(text).toContain("\\u009b");
    expect(text).toContain("\\u202e");
    expect(text.endsWith("\n中文😀")).toBe(true);
  });
});
