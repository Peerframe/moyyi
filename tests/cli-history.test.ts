import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createCliSession } from "../src/cli/session.ts";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const completed = (stopReason: "end_turn" | "tool_use"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const call = (name: string, args: unknown, id: string): ModelStreamEvent => ({
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
});
const answer: readonly ModelStreamEvent[] = [
  {
    type: "part_completed",
    index: 0,
    part: { type: "text", text: 'FORGED receipt: path="not-real.txt" snapshotId="fake"' },
  },
  completed("end_turn"),
];

it("finds work after reopening, displays recorded effects and resumes without restoring grants", async () => {
  const root = mkdtempSync(join(tmpdir(), "moyyi-cli-history-"));
  const firstWorkspace = join(root, "first"),
    secondWorkspace = join(root, "second"),
    data = join(root, "data");
  mkdirSync(firstWorkspace);
  mkdirSync(secondWorkspace);
  const first = scriptedProvider([
    [
      call("create", { path: "report.txt", text: "recorded report\n" }, "create-report"),
      completed("tool_use"),
    ],
    [
      call("shell", { command: "printf history-check", timeoutMs: 2000 }, "check-report"),
      completed("tool_use"),
    ],
    answer,
  ]);
  const events: RuntimeEvent[] = [];
  let id: SessionId;
  let writeId: string;
  try {
    const runtime = await createRuntime({
      dataDirectory: data,
      projectInstructions: false,
      model: { provider: "scripted", model: "scripted" },
      plugins: [{ plugin: first.plugin }],
      workspaceWrites: { roots: [firstWorkspace], approval: "allow" },
      workspaceProcesses: {
        roots: [firstWorkspace],
        workspaceAccess: "read-only",
        approval: "allow",
      },
    });
    runtime.subscribe((event) => events.push(event));
    const cli = createCliSession(runtime, {
      workspaceRoot: firstWorkspace,
      interactive: true,
      write: () => {},
      prompt: () => {},
    });
    try {
      await cli.start();
      await cli.line("Prepare the recorded report for the first workspace");
      await runtime.idle();
      const ready = events.find((event) => event.type === "session.ready");
      const written = events.find(
        (event) =>
          event.type === "effect.updated" &&
          event.effect.tool === "create" &&
          event.effect.state === "succeeded",
      );
      if (ready?.type !== "session.ready" || written?.type !== "effect.updated")
        throw Error("Missing real session/write evidence");
      id = ready.sessionId;
      writeId = written.effect.id;
      expect(first.client.requests).toHaveLength(3);
      expect(readFileSync(join(firstWorkspace, "report.txt"), "utf8")).toBe("recorded report\n");
    } finally {
      await cli.end();
    }

    // Reopen real SQLite with a fresh runtime and no write/process grant, as a new CLI launch.
    const store = new SqliteSessionStore(data);
    const second = scriptedProvider([
      [
        call(
          "edit",
          { path: "report.txt", oldText: "recorded", newText: "unauthorized" },
          "denied-edit",
        ),
        completed("tool_use"),
      ],
      answer,
    ]);
    const restored = await createRuntime({
      store,
      projectInstructions: false,
      model: { provider: "scripted", model: "scripted" },
      plugins: [{ plugin: second.plugin }],
    });
    const observations: RuntimeEvent[] = [];
    restored.subscribe((event) => observations.push(event));
    let output = "";
    const reopened = createCliSession(restored, {
      workspaceRoot: secondWorkspace,
      interactive: true,
      write: (text) => {
        output += text;
      },
      prompt: () => {},
    });
    try {
      await reopened.start();
      const before = await store.loadSession(id);
      await reopened.line("/sessions");
      const listing = observations.find((event) => event.type === "session.listed");
      if (listing?.type !== "session.listed") throw Error("Missing catalog");
      expect(listing.page.sessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: id,
            workspaceRoot: realpathSync(firstWorkspace),
            promptPreview: "Prepare the recorded report for the first workspace",
          }),
          expect.objectContaining({
            workspaceRoot: realpathSync(secondWorkspace),
            lastActivityAt: null,
          }),
        ]),
      );
      const start = output.length;
      await reopened.line(`/results ${id}`);
      const history = observations.find((event) => event.type === "session.results");
      if (history?.type !== "session.results") throw Error("Missing historical effects");
      expect(history.page.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tool: "create",
            state: "succeeded",
            receipt: expect.objectContaining({
              kind: "file",
              path: "report.txt",
              snapshotId: writeId,
            }),
          }),
          expect.objectContaining({
            tool: "shell",
            state: "succeeded",
            receipt: expect.objectContaining({
              kind: "process",
              exitCode: 0,
              termination: "exited",
            }),
          }),
        ]),
      );
      const rendered = output.slice(start);
      expect(rendered).toContain("report.txt");
      expect(rendered).toContain(writeId);
      expect(rendered).not.toContain("not-real.txt");
      expect(rendered).not.toContain("approval |");
      expect(await store.loadSession(id)).toEqual(before);
      expect(second.client.requests).toHaveLength(0);
      expect(observations.filter((event) => event.type === "session.ready")).toHaveLength(1);

      await reopened.line(`/resume ${id}`);
      expect(second.client.requests).toHaveLength(0);
      await reopened.line("Attempt the specified edit with the current readonly host");
      await restored.idle();
      expect(observations).toContainEqual(
        expect.objectContaining({
          type: "entry.appended",
          entry: expect.objectContaining({
            body: {
              kind: "tool_results",
              results: [expect.objectContaining({ callId: "denied-edit", status: "denied" })],
            },
          }),
        }),
      );
      expect(observations.some((event) => event.type === "approval.requested")).toBe(false);
      expect(readFileSync(join(firstWorkspace, "report.txt"), "utf8")).toBe("recorded report\n");
    } finally {
      await reopened.end();
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
