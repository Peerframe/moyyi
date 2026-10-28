import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelStreamEvent,
  type Plugin,
  type RunOutcome,
  type SessionId,
  type Timestamp,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { treeHashes } from "../harness/checks.ts";
import { sourceDataflowReport } from "../tasks/source-dataflow-report/task.ts";
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
export async function runEvidenceAnswerScenario(dataflow = false, timed = false) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-evidence-eval-"));
  const workspace = join(directory, "workspace");
  cpSync((dataflow ? sourceDataflowReport : sourceLifecycleReport).fixtureDir, workspace, {
    recursive: true,
  });
  const before = await treeHashes(workspace);
  let runtime: Runtime | undefined;
  let sessionId: SessionId | undefined;
  let outcome: RunOutcome | undefined;
  let requests = 0;
  const startedAt = Date.parse("2026-10-28T00:00:00Z");
  let now = startedAt;
  const timers = new Map<() => void, number>();
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const [callback, due] of timers) {
      if (due > now) continue;
      timers.delete(callback);
      callback();
    }
  };
  let investigationClosed = false;
  const draft = "MISLEADING_DRAFT_CANARY: every configuration changes dynamically.";
  const final = "SCRIPTED_FINAL_NOT_A_QUALITY_SCORE";
  const plugin: Plugin = {
    name: "direct-evidence-eval",
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: scriptedProfile.origin.provider,
        models: [timed ? { ...scriptedProfile, maxOutputTokens: 8192 } : scriptedProfile],
        createClient: () => ({
          async *stream(request, signal) {
            signal.throwIfAborted();
            requests++;
            assert(requests <= 3, "Shared request ceiling must include the final answer");
            if (requests === 1) {
              for (const [index, path] of (dataflow
                ? ["src/decode.mjs", "src/requests.mjs", "src/policy.mjs"]
                : ["src/dashboard.mjs", "src/stable-read.mjs", "src/store.mjs"]
              ).entries()) {
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
              if (timed) {
                // A streamed draft cannot move the absolute investigation deadline.
                yield { type: "text_delta", index: 0, text: draft };
                advance(100_000);
                assert.equal(signal.aborted, true);
                investigationClosed = true;
              } else {
                yield* text(draft);
              }
              return;
            }
            if (timed) {
              assert.equal(request.maxOutputTokens, 8192);
              assert(
                investigationClosed,
                "Close the interrupted investigation before final inference",
              );
              assert.equal(now - startedAt, 100_000);
              assert.equal(
                signal.aborted,
                false,
                "The final request uses the original run deadline",
              );
              advance(50_000);
            }
            assert.equal(request.toolChoice, "none");
            assert.equal(request.tools.length, 0);
            assert(
              !JSON.stringify(request).includes(draft),
              "Investigation conclusions must not anchor the direct answer",
            );
            assert.equal(request.messages.length, 1);
            const part = request.messages[0]?.content[0];
            assert(part?.type === "text");
            const packet = JSON.parse(part.text);
            assert.equal(packet.observations.length, 3);
            assert.equal(packet.userInputs.length, 1);
            const serialized = JSON.stringify(packet);
            assert(serialized.includes(dataflow ? "decodeArchive" : "createDashboard"));
            assert(serialized.includes(dataflow ? "decodeDelivery" : "createDynamicDashboard"));
            assert(!("evidenceReview" in packet));
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
      evidenceAnswer: true,
      limits: {
        maxModelRequests: timed ? 8 : 3,
        maxRetries: 0,
        timeoutMs: timed ? 300_000 : 30_000,
      },
      ...(timed
        ? {
            clock: { now: () => new Date(now).toISOString() as Timestamp },
            scheduler: {
              deadline(milliseconds: number, callback: () => void) {
                timers.set(callback, now + milliseconds);
                return () => {
                  timers.delete(callback);
                };
              },
              async sleep(milliseconds: number, signal: AbortSignal) {
                signal.throwIfAborted();
                advance(milliseconds);
                signal.throwIfAborted();
              },
            },
          }
        : {}),
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
    assert.equal(outcome?.kind, "completed");
    assert.equal(requests, 3);
    assert.deepEqual(await treeHashes(workspace), before);
    await runtime.send({ type: "session.load", sessionId });
    assert.equal(requests, 3, "History loading must not replay the answer");
    return {
      kind: "scripted-direct-evidence",
      dataflow,
      ...(timed
        ? { investigationMs: 100_000, elapsedMs: now - startedAt, timeoutMs: 300_000 }
        : {}),
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
