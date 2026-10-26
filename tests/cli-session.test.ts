import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCliSession } from "../src/cli/session.ts";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../src/policy/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const completed: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
const answer: readonly ModelStreamEvent[] = [
  { type: "text_delta", index: 0, text: "Synthetic " },
  { type: "text_delta", index: 0, text: "answer." },
  { type: "part_completed", index: 0, part: { type: "text", text: "Synthetic answer." } },
  completed,
];
const read: readonly ModelStreamEvent[] = [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: "read_1" as ToolCallId,
      providerCallId: "read_1",
      providerItemId: null,
      name: "read",
      rawArguments: '{"path":"note.txt"}',
      argumentsSource: "verbatim",
    },
  },
  { ...completed, stopReason: "tool_use" },
];
function workspace() {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-cli-session-"));
  const root = join(directory, "workspace");
  mkdirSync(root);
  writeFileSync(join(root, "note.txt"), "Synthetic workspace note.\n");
  return { directory, root, data: join(directory, "data") };
}

describe("CLI session through real runtime and SQLite", () => {
  it("displays actual file and undo snapshot receipts after approved durable writes", async () => {
    const files = workspace();
    const store = new SqliteSessionStore(files.data);
    const calls = [
      { name: "edit", args: { path: "note.txt", oldText: "Synthetic", newText: "Updated" } },
      { name: "undo", args: { snapshotId: "effect_1" } },
    ];
    const scripted = scriptedProvider([
      ...calls.map(({ name, args }, index): ModelStreamEvent[] => [
        {
          type: "part_completed",
          index: 0,
          part: {
            type: "tool_call",
            name,
            callId: `write_${index}` as ToolCallId,
            providerCallId: `write_${index}`,
            providerItemId: null,
            rawArguments: JSON.stringify(args),
            argumentsSource: "verbatim",
          },
        },
        { ...completed, stopReason: "tool_use" },
      ]),
      answer,
    ]);
    const counts: Record<string, number> = {};
    const runtime = await createRuntime({
      store,
      plugins: [{ plugin: scripted.plugin }],
      model: { provider: "scripted", model: "scripted" },
      workspaceWrites: { roots: [files.root], approval: "ask" },
      ids: {
        next(prefix) {
          counts[prefix] = (counts[prefix] ?? 0) + 1;
          return `${prefix}_${counts[prefix]}`;
        },
      },
    });
    const approvals = [
      Promise.withResolvers<Extract<RuntimeEvent, { type: "approval.requested" }>>(),
      Promise.withResolvers<Extract<RuntimeEvent, { type: "approval.requested" }>>(),
    ];
    const finished = Promise.withResolvers<void>();
    let approvalIndex = 0;
    runtime.subscribe((event) => {
      if (event.type === "approval.requested") approvals[approvalIndex++]?.resolve(event);
      if (event.type === "run.finished") finished.resolve();
    });
    let output = "";
    const cli = createCliSession(runtime, {
      workspaceRoot: files.root,
      interactive: true,
      write: (text) => {
        output += text;
      },
      prompt: () => {},
    });
    try {
      await cli.start();
      await cli.line("Edit the file, then undo the change");
      const edit = await approvals[0]?.promise;
      if (!edit) throw Error("Missing edit approval");
      await cli.line(`/approve ${edit.effectId}`);
      const undo = await approvals[1]?.promise;
      if (!undo) throw Error("Missing undo approval");
      expect(readFileSync(join(files.root, "note.txt"), "utf8")).toBe("Updated workspace note.\n");
      expect(output).toContain('receipt | edit path="note.txt" snapshotId="effect_1"');
      await cli.line(`/approve ${undo.effectId}`);
      await finished.promise;
      await runtime.idle();
      expect(readFileSync(join(files.root, "note.txt"), "utf8")).toBe(
        "Synthetic workspace note.\n",
      );
      expect(output).toContain('receipt | undo path="note.txt" snapshotId="effect_2"');
      expect(output.match(/receipt \|/g)).toHaveLength(2);
      expect(await store.getSnapshot("effect_1")).toMatchObject({ path: "note.txt" });
      expect(await store.getSnapshot("effect_2")).toMatchObject({
        path: "note.txt",
        restoreOf: "effect_1",
      });
      expect(scripted.client.requests).toHaveLength(3);
    } finally {
      await cli.end();
      store.close();
      rmSync(files.directory, { recursive: true, force: true });
    }
  });
  it("one-shot denies a real read approval, finishes and never repeats streamed answer", async () => {
    const files = workspace();
    const scripted = scriptedProvider([read, answer]);
    const runtime = await createRuntime({
      plugins: [{ plugin: scripted.plugin }],
      model: { provider: "scripted", model: "scripted" },
      dataDirectory: files.data,
      policy: new ReadOnlyPolicy({ requireApproval: ["read"] }),
    });
    let text = "";
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => events.push(event));
    const cli = createCliSession(runtime, {
      workspaceRoot: files.root,
      interactive: false,
      initialPrompt: "Read note.txt",
      write: (value) => {
        text += value;
      },
      prompt: () => {
        throw Error("Noninteractive prompt");
      },
    });
    try {
      await cli.start();
      expect(await cli.done).toBe(0);
      expect(
        events.some((event) => event.type === "effect.updated" && event.effect.state === "denied"),
      ).toBe(true);
      expect(
        events.some(
          (event) => event.type === "effect.updated" && event.effect.state === "succeeded",
        ),
      ).toBe(false);
      expect(scripted.client.requests).toHaveLength(2);
      expect(text.match(/Synthetic answer\./g)).toHaveLength(1);
      expect(text).toContain("Noninteractive mode denies this approval request");
    } finally {
      await cli.end();
      rmSync(files.directory, { recursive: true, force: true });
    }
  });
  it("accepts explicit approval and steering, then resumes the persisted history without calling a model", async () => {
    const files = workspace();
    const scripted = scriptedProvider([read, answer]);
    const runtime = await createRuntime({
      plugins: [{ plugin: scripted.plugin }],
      model: { provider: "scripted", model: "scripted" },
      dataDirectory: files.data,
      policy: new ReadOnlyPolicy({ requireApproval: ["read"] }),
    });
    const approval = Promise.withResolvers<Extract<RuntimeEvent, { type: "approval.requested" }>>();
    const finished = Promise.withResolvers<void>();
    let sessionId: SessionId | undefined;
    let output = "";
    const events: RuntimeEvent[] = [];
    runtime.subscribe((event) => {
      events.push(event);
      if (event.type === "approval.requested") approval.resolve(event);
      if (event.type === "run.finished") finished.resolve();
      if (event.type === "session.ready") sessionId = event.sessionId;
    });
    const cli = createCliSession(runtime, {
      workspaceRoot: files.root,
      interactive: true,
      write: (text) => {
        output += text;
      },
      prompt: () => {},
    });
    try {
      await cli.start();
      await cli.line("Read note.txt");
      const request = await approval.promise;
      await cli.line("Keep the answer short");
      await cli.line(`/approve ${request.effectId}`);
      await finished.promise;
      await runtime.idle();
      expect(
        events.some(
          (event) => event.type === "effect.updated" && event.effect.state === "succeeded",
        ),
      ).toBe(true);
      expect(scripted.client.requests).toHaveLength(2);
      expect(JSON.stringify(scripted.client.requests[1])).toContain("Keep the answer short");
      expect(JSON.stringify(scripted.client.requests[1])).toContain("Synthetic workspace note");
      expect(output.match(/Synthetic answer\./g)).toHaveLength(1);
      await cli.end();
      if (!sessionId) throw Error("Session ID absent");
      const replay = scriptedProvider([]);
      const resumedRuntime = await createRuntime({
        plugins: [{ plugin: replay.plugin }],
        model: { provider: "scripted", model: "scripted" },
        dataDirectory: files.data,
      });
      let history = "";
      const resumed = createCliSession(resumedRuntime, {
        workspaceRoot: files.root,
        sessionId,
        interactive: true,
        write: (text) => {
          history += text;
        },
        prompt: () => {},
      });
      try {
        await resumed.start();
        expect(history).toContain("assistant | Synthetic answer.");
        expect(history).toContain("user steering | Keep the answer short");
        expect(replay.client.requests).toHaveLength(0);
      } finally {
        await resumed.end();
      }
    } finally {
      await cli.end();
      rmSync(files.directory, { recursive: true, force: true });
    }
  });
  it("EOF cancels a real waiting approval and releases the database writer", async () => {
    const files = workspace();
    const scripted = scriptedProvider([read]);
    const runtime = await createRuntime({
      plugins: [{ plugin: scripted.plugin }],
      model: { provider: "scripted", model: "scripted" },
      dataDirectory: files.data,
      policy: new ReadOnlyPolicy({ requireApproval: ["read"] }),
    });
    const approval = Promise.withResolvers<void>();
    let cancelled = false;
    runtime.subscribe((event) => {
      if (event.type === "approval.requested") approval.resolve();
      if (event.type === "run.finished") cancelled = event.outcome.kind === "cancelled";
    });
    const cli = createCliSession(runtime, {
      workspaceRoot: files.root,
      interactive: true,
      write: () => {},
      prompt: () => {},
    });
    try {
      await cli.start();
      await cli.line("Read note.txt");
      await approval.promise;
      await cli.end();
      expect(await cli.done).toBe(130);
      expect(cancelled).toBe(true);
      const next = scriptedProvider([]);
      const reopened = await createRuntime({
        plugins: [{ plugin: next.plugin }],
        model: { provider: "scripted", model: "scripted" },
        dataDirectory: files.data,
      });
      await reopened.close();
    } finally {
      await cli.end();
      rmSync(files.directory, { recursive: true, force: true });
    }
  });
});
