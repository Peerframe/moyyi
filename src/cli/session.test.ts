import { describe, expect, it, vi } from "vitest";
import type {
  ActionDigest,
  BlobRef,
  ClientCommand,
  EffectId,
  EntryId,
  RunId,
  RuntimeEvent,
  SessionId,
  Timestamp,
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
      else if (command.type === "run.start")
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
