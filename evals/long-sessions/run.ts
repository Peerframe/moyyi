import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  type TranscriptEntry,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";

const terminal = (
  stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn",
): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const answer = (text: string): ModelStreamEvent[] => [
  { type: "part_completed", index: 0, part: { type: "text", text } },
  terminal(),
];
const call = (name: string, args: unknown): ModelStreamEvent[] => [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: "eval_call" as ToolCallId,
      providerCallId: "eval_call",
      providerItemId: null,
      name,
      rawArguments: JSON.stringify(args),
      argumentsSource: "verbatim",
    },
  },
  terminal("tool_use"),
];
const constraint = "Keep protected.txt unchanged; the chosen project codename is LANTERN.";

/** Synthetic model outputs are inputs to these checks, never evidence of model competence. */
export async function runLongSessionsEval(): Promise<void> {
  const results: { id: string; passed: true }[] = [];
  for (const mode of [
    "compact-resume-recompact",
    "reject-tool-call",
    "reject-truncated-summary",
    "reject-refusal",
  ] as const) {
    const directory = mkdtempSync(join(tmpdir(), "moyyi-long-eval-"));
    const workspace = join(directory, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "protected.txt"), "CANARY");
    const dataDirectory = join(directory, "data");
    let runtime: Runtime | undefined;
    try {
      const initialTurns = mode === "compact-resume-recompact" ? 24 : 4;
      const responses = Array.from({ length: initialTurns }, (_, i) =>
        answer(`Response ${i}. ${"Synthetic historical detail. ".repeat(40)}`),
      );
      responses.push(
        mode === "reject-tool-call"
          ? call("create", { path: "protected.txt", text: "bad" })
          : mode === "reject-truncated-summary"
            ? [
                { type: "part_completed", index: 0, part: { type: "text", text: constraint } },
                terminal("max_tokens"),
              ]
            : mode === "reject-refusal"
              ? [
                  {
                    type: "part_completed",
                    index: 0,
                    part: { type: "refusal", text: "Cannot summarize" },
                  },
                  terminal(),
                ]
              : answer(constraint),
      );
      if (mode !== "compact-resume-recompact")
        responses.push(answer("Continue with original history."));
      const provider = scriptedProvider(responses);
      const events: RuntimeEvent[] = [];
      runtime = await createRuntime({
        dataDirectory,
        model: scriptedProfile.origin,
        plugins: [{ plugin: provider.plugin }],
        workspaceWrites: { roots: [workspace], approval: "allow" },
      });
      let sessionId: SessionId | undefined;
      runtime.subscribe((event) => {
        events.push(event);
        if (event.type === "session.ready") sessionId = event.sessionId;
      });
      await runtime.send({ type: "session.create", workspaceRoot: workspace });
      assert(sessionId);
      const loadEntries = async () => {
        assert(runtime && sessionId);
        const entries: TranscriptEntry[] = [];
        const unsubscribe = runtime.subscribe((event) => {
          if (event.type === "entry.appended") entries.push(event.entry);
        });
        try {
          await runtime.send({ type: "session.load", sessionId });
        } finally {
          unsubscribe();
        }
        return entries;
      };
      const turn = async (text: string) => {
        assert(runtime && sessionId);
        await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text }] });
        await runtime.idle();
        const finish = events.findLast((event) => event.type === "run.finished");
        assert.equal(finish?.outcome.kind, "completed");
      };
      for (let i = 0; i < initialTurns; i++)
        await turn(
          `${i === 0 ? constraint : `Task ${i}`}. ${"Synthetic user detail. ".repeat(40)}`,
        );
      const before = await loadEntries();
      await runtime.send({ type: "session.compact", sessionId });
      await runtime.idle();
      const after = await loadEntries();
      const summaryRequest = provider.client.requests.at(-1);
      assert.equal(provider.client.requests.length, initialTurns + 1);
      assert.deepEqual(summaryRequest?.tools, []);
      assert(summaryRequest?.messages.every((message) => message.replay === undefined));
      assert.equal(readFileSync(join(workspace, "protected.txt"), "utf8"), "CANARY");
      assert(!events.some((event) => event.type === "effect.updated"));
      for (const original of before)
        assert.deepEqual(
          after.find((entry) => entry.id === original.id),
          original,
        );
      const audit = after.filter(
        (entry) =>
          entry.body.kind === "assistant_message" &&
          entry.body.request.rendererVersion === "moyyi-compaction-v1",
      );
      assert.equal(audit.length, 1);
      if (mode !== "compact-resume-recompact") {
        assert.equal(
          events.findLast((event) => event.type === "run.finished")?.outcome.kind,
          "failed",
        );
        assert(!after.some((entry) => entry.body.kind === "compaction"));
        await turn("Continue after the rejected summary.");
        const next = provider.client.requests.at(-1);
        assert.equal(next?.messages.length, initialTurns * 2 + 1);
        assert(JSON.stringify(next).includes("Response 0."));
        assert(!JSON.stringify(next).includes("Compaction never executes tools"));
      } else {
        assert.equal(
          events.findLast((event) => event.type === "run.finished")?.outcome.kind,
          "completed",
        );
        assert.equal(after.filter((entry) => entry.body.kind === "compaction").length, 1);
        const oldRequest = provider.client.requests[initialTurns - 1];
        await runtime.close();
        const resumed = scriptedProvider([
          call("read", { path: "protected.txt" }),
          answer("Read the unchanged file."),
          answer("Next response."),
          answer("Another response."),
          answer(constraint),
          answer("Continuing after second compaction."),
        ]);
        runtime = await createRuntime({
          dataDirectory,
          model: scriptedProfile.origin,
          plugins: [{ plugin: resumed.plugin }],
        });
        runtime.subscribe((event) => events.push(event));
        assert.equal(resumed.client.requests.length, 0);
        await turn("Inspect protected.txt without changing it.");
        const first = resumed.client.requests[0];
        assert(first);
        assert(JSON.stringify(first).includes(constraint));
        assert(JSON.stringify(first).length < JSON.stringify(oldRequest).length / 2);
        const readResult = (await loadEntries()).flatMap((entry) =>
          entry.body.kind === "tool_results" ? entry.body.results : [],
        );
        assert.equal(readResult?.[0]?.status, "succeeded");
        assert(JSON.stringify(readResult).includes("CANARY"));
        await turn("Continue with the selected codename.");
        await turn("Keep the same restrictions.");
        await runtime.send({ type: "session.compact", sessionId });
        await runtime.idle();
        assert.equal(
          events.findLast((event) => event.type === "run.finished")?.outcome.kind,
          "completed",
        );
        await turn("Continue.");
        assert(JSON.stringify(resumed.client.requests.at(-1)).includes(constraint));
        const final = await loadEntries();
        assert.equal(final.filter((entry) => entry.body.kind === "compaction").length, 2);
        assert.equal(readFileSync(join(workspace, "protected.txt"), "utf8"), "CANARY");
      }
      results.push({ id: mode, passed: true });
    } finally {
      await runtime?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  mkdirSync("evals/results", { recursive: true });
  writeFileSync(
    "evals/results/long-sessions.json",
    `${JSON.stringify({ source: "synthetic", results }, null, 2)}\n`,
  );
  console.log(
    `Long-session offline conformance: ${results.length}/${results.length} passed; no live model or cache-hit claim.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runLongSessionsEval();
