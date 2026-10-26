import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ModelStreamEvent,
  RuntimeEvent,
  SessionId,
  ToolCallId,
} from "../../src/contracts/index.ts";
import { UNKNOWN_USAGE } from "../../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { documentTasks } from "./tasks.ts";

const terminal = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
let next = 0;
function response(calls: { name: string; args: unknown }[]): ModelStreamEvent[] {
  return [
    ...calls.map(({ name, args }, index): ModelStreamEvent => {
      const id = `document_eval_${++next}`;
      return {
        type: "part_completed",
        index,
        part: {
          type: "tool_call",
          callId: id as ToolCallId,
          providerCallId: id,
          providerItemId: null,
          name,
          rawArguments: JSON.stringify(args),
          argumentsSource: "verbatim",
        },
      };
    }),
    terminal("tool_use"),
  ];
}
const final: ModelStreamEvent[] = [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "text",
      text: '{"status":"done","summary":"Synthetic document report written and verified."}',
    },
  },
  terminal("end_turn"),
];
let passed = 0;
for (const task of documentTasks) {
  for (const writes of [true, false]) {
    const directory = await mkdtemp(join(tmpdir(), "moyyi-document-eval-"));
    let runtime: Runtime | undefined;
    try {
      const workspace = join(directory, "workspace");
      const expectedWorkspace = join(directory, "reference");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(workspace);
      await mkdir(expectedWorkspace);
      await task.prepare?.(workspace);
      // Reference output belongs only to this scripted wiring check, outside the agent workspace.
      await task.reference(expectedWorkspace);
      const filename = task.id.includes("comparison") ? "comparison.json" : "report.json";
      const expected = await readFile(join(expectedWorkspace, filename), "utf8");
      const files = (await readdir(workspace)).sort();
      const provider = scriptedProvider([
        response(files.map((path) => ({ name: "read_document", args: { path } }))),
        response([{ name: "create", args: { path: filename, text: expected } }]),
        response([{ name: "read", args: { path: filename } }]),
        final,
      ]);
      runtime = await createRuntime({
        dataDirectory: join(directory, "data"),
        model: scriptedProfile.origin,
        plugins: [{ plugin: provider.plugin }],
        limits: { maxModelRequests: 4, maxRetries: 0, timeoutMs: 60_000 },
        ...(writes ? { workspaceWrites: { roots: [workspace] } } : {}),
      });
      const active = runtime;
      const events: RuntimeEvent[] = [];
      let sessionId: SessionId | undefined;
      active.subscribe((event) => {
        events.push(event);
        if (event.type === "session.ready") sessionId = event.sessionId;
        if (event.type === "approval.requested")
          void active.send({
            type: "approval.respond",
            effectId: event.effectId,
            digest: event.digest,
            decision: "approve",
          });
      });
      await active.send({ type: "session.create", workspaceRoot: workspace });
      assert.ok(sessionId);
      await active.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: task.instruction }],
      });
      await active.idle();
      const results = events.flatMap((event) =>
        event.type === "entry.appended" && event.entry.body.kind === "tool_results"
          ? event.entry.body.results
          : [],
      );
      assert.equal(results.length, 9);
      for (const result of results.slice(0, 7)) {
        assert.equal(result.status, "succeeded");
        assert.ok(
          provider.client.requests[1]?.messages.some((message) =>
            message.content.some(
              (part) =>
                part.type === "tool_result" &&
                part.callId === result.callId &&
                JSON.stringify(part) === JSON.stringify(result),
            ),
          ),
          "Exact recorded document evidence reaches next request",
        );
        const metadata = JSON.parse(
          result.content[0]?.type === "text" ? result.content[0].text : "null",
        );
        assert.equal(metadata.lineBasis, "extracted_text");
        assert.equal(metadata.extractionTruncated, false);
        assert.equal(metadata.outputTruncated, false);
        assert.match(metadata.sha256, /^[a-f0-9]{64}$/u);
      }
      assert.equal(provider.client.requests.length, 4);
      assert.equal(provider.client.requests[3]?.toolChoice, "none");
      assert.equal((await task.check(workspace)).passed, writes);
      if (writes) {
        assert.equal(results[7]?.status, "succeeded");
        assert.equal(results[8]?.status, "succeeded");
        assert.equal(await readFile(join(workspace, filename), "utf8"), expected);
        assert.ok(JSON.stringify(provider.client.requests[3]).includes(filename));
      } else assert.equal(results[7]?.status, "denied");
      // Storage reopen and real transcript replay retain evidence; no second model run is made.
      await active.close();
      runtime = undefined;
      runtime = await createRuntime({
        dataDirectory: join(directory, "data"),
        model: scriptedProfile.origin,
        plugins: [{ plugin: provider.plugin }],
      });
      const restored: RuntimeEvent[] = [];
      runtime.subscribe((event) => restored.push(event));
      await runtime.send({ type: "session.load", sessionId });
      assert.equal(
        restored.flatMap((event) =>
          event.type === "entry.appended" && event.entry.body.kind === "tool_results"
            ? event.entry.body.results
            : [],
        ).length,
        9,
      );
      console.log(
        `PASS ${task.id}: ${writes ? "four-request read/write/verify/final-none" : "default write denial"}; seven native parsers, exact next-context evidence, SQLite reopen`,
      );
      passed++;
    } finally {
      await runtime?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
console.log(
  `Document offline conformance: ${passed}/4. Scripted responses prove wiring, not live model understanding. Paid requests: 0.`,
);
