import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelStreamEvent,
  type Plugin,
  type RunOutcome,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { treeHashes } from "../harness/checks.ts";
import { sourceLifecycleReport } from "../tasks/source-lifecycle-report/task.ts";

const complete = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
function text(text: string): ModelStreamEvent[] {
  return [{ type: "part_completed", index: 0, part: { type: "text", text } }, complete("end_turn")];
}

/** Scripted choices test the real runtime/files/store; this does not grade a live model. */
export async function runAnswerReviewScenario(invalidReference = false) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-evidence-eval-"));
  const workspace = join(directory, "workspace");
  cpSync(sourceLifecycleReport.fixtureDir, workspace, { recursive: true });
  const before = await treeHashes(workspace);
  let runtime: Runtime | undefined;
  let sessionId: SessionId | undefined;
  let outcome: RunOutcome | undefined;
  let requests = 0;
  const draft = "MISLEADING_DRAFT_CANARY: every configuration changes dynamically.";
  const final = "SCRIPTED_FINAL_NOT_A_QUALITY_SCORE";
  const plugin: Plugin = {
    name: "isolated-evidence-eval",
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: scriptedProfile.origin.provider,
        models: [scriptedProfile],
        createClient: () => ({
          async *stream(request, signal) {
            signal.throwIfAborted();
            requests++;
            assert(requests <= 4, "Shared request ceiling must include both review stages");
            if (requests === 1) {
              for (const [index, path] of [
                "src/dashboard.mjs",
                "src/stable-read.mjs",
                "src/store.mjs",
              ].entries()) {
                yield {
                  type: "part_completed",
                  index,
                  part: {
                    type: "tool_call",
                    callId: `evidence_read_${index}` as ToolCallId,
                    providerCallId: `evidence_read_${index}`,
                    providerItemId: null,
                    name: "read",
                    rawArguments: JSON.stringify({ path }),
                    argumentsSource: "verbatim",
                  },
                };
              }
              yield complete("tool_use");
              return;
            }
            if (requests === 2) {
              yield* text(draft);
              return;
            }
            assert.equal(request.toolChoice, "none");
            assert.equal(request.tools.length, 0);
            assert(
              !JSON.stringify(request).includes(draft),
              "Investigation conclusions must not anchor either isolated stage",
            );
            assert.equal(request.messages.length, 1);
            const part = request.messages[0]?.content[0];
            assert(part?.type === "text");
            const packet = JSON.parse(part.text);
            assert.equal(packet.observations.length, 3);
            for (const observation of packet.observations)
              assert.equal(observation.status, "succeeded");
            assert(JSON.stringify(packet).includes("createDynamicDashboard"));
            assert(JSON.stringify(packet).includes("createDashboard"));
            if (requests === 3) {
              assert(!("evidenceReview" in packet));
              const observation = packet.observations[0];
              const quote = observation.content[0].text.slice(0, 64);
              const id = invalidReference
                ? "unknown-observation"
                : observation.sources[0].textParts[0].id;
              yield* text(
                JSON.stringify({
                  claims: [
                    {
                      statement:
                        "The first source observation is quoted; this scripted claim does not establish semantic coverage.",
                      basis: "direct",
                      references: [{ id, quote }],
                      consequence: null,
                      uncertainty: "No live-model conclusion is tested.",
                    },
                  ],
                  unknowns: [],
                }),
              );
              return;
            }
            assert.equal(packet.evidenceReview.claims.length, 1);
            yield* text(final);
          },
        }),
      });
    },
  };
  try {
    runtime = await createRuntime({
      model: scriptedProfile.origin,
      plugins: [{ plugin }],
      dataDirectory: join(directory, "private-store"),
      answerReview: true,
      limits: { maxModelRequests: 4, maxRetries: 0, timeoutMs: 30_000 },
    });
    runtime.subscribe((event) => {
      if (event.type === "session.ready") sessionId = event.sessionId;
      if (event.type === "run.finished") outcome = event.outcome;
    });
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    assert(sessionId);
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [
        {
          type: "text",
          text: "Read these implementations and compare the two configuration lifetimes. Do not modify files.",
        },
      ],
    });
    await runtime.idle();
    assert.equal(outcome?.kind, invalidReference ? "failed" : "completed");
    assert.equal(requests, invalidReference ? 3 : 4);
    assert.deepEqual(await treeHashes(workspace), before);
    await runtime.send({ type: "session.load", sessionId });
    assert.equal(requests, invalidReference ? 3 : 4, "History loading must not replay review");
    return {
      kind: "scripted-isolated-evidence",
      invalidReference,
      requests,
      sourceUnchanged: true,
      noReplay: true,
      semanticQuality: "not measured",
    };
  } finally {
    await runtime?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
