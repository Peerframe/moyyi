import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deepSeekFixture } from "../../src/plugins/provider-deepseek/fixtures.ts";
import { assertEquivalent, finalAnswer, runRoundTrip, successfulFixtures } from "./scenario.ts";

interface Evidence {
  readonly requests: number;
  readonly recordedOutcome: string;
  readonly replayedOutcome: string;
  readonly toolStatuses: readonly string[];
  readonly replayToolStatuses: readonly string[];
}
const scenarios: readonly { id: string; run(): Promise<Evidence> }[] = [
  {
    id: "sse-file-tools-record-replay",
    async run() {
      const result = await runRoundTrip();
      assertEquivalent(result);
      assert.equal(result.first.outcome.kind, "completed");
      assert.deepEqual(
        result.first.results.map((part) => part.status),
        ["succeeded", "succeeded"],
      );
      assert.equal(result.records.length, 3);
      assert.ok(JSON.stringify(result.replay.assistantContent).includes(finalAnswer));
      assert.ok(JSON.stringify(result.wireRequests[2]).includes("Hello moyyi"));
      return evidence(result);
    },
  },
  {
    id: "changed-request-rejected-no-fallback",
    async run() {
      const result = await runRoundTrip({ replayInput: "Changed user request" });
      assert.equal(result.first.outcome.kind, "completed");
      assert.equal(result.replay.outcome.kind, "failed");
      assert.equal(result.replay.results.length, 0);
      assert.equal(result.transportCallsAfterReplay, 3);
      return evidence(result);
    },
  },
  {
    id: "changed-file-result-rejected",
    async run() {
      const result = await runRoundTrip({
        beforeReplay(workspace) {
          writeFileSync(join(workspace, "README.md"), "changed content\n");
        },
      });
      assert.equal(result.replay.outcome.kind, "failed");
      assert.equal(result.replay.results.length, 2);
      assert.ok(JSON.stringify(result.replay.results).includes("changed content"));
      assert.equal(result.transportCallsAfterReplay, 3);
      return evidence(result);
    },
  },
  {
    id: "recording-directory-remains-private",
    async run() {
      const result = await runRoundTrip({
        recordingInsideWorkspace: true,
        responses: successfulFixtures("recordings/exchange-00000000.json"),
      });
      assertEquivalent(result);
      assert.equal(result.first.results[1]?.status, "failed");
      assert.ok(!JSON.stringify(result.first.results).includes("requestHash"));
      return evidence(result);
    },
  },
  {
    id: "unknown-usage-remains-unknown",
    async run() {
      const result = await runRoundTrip({
        responses: [
          deepSeekFixture([{ type: "message", text: "Bounded answer" }], {
            status: "incomplete",
            incompleteReason: "max_output_tokens",
            usage: null,
          }),
        ],
      });
      assertEquivalent(result);
      assert.equal(result.records.length, 1);
      const terminal = result.records[0]?.events.at(-1);
      assert.ok(terminal?.type === "completed");
      assert.equal(terminal.usage.status, "unknown");
      assert.equal(terminal.stopReason, "max_tokens");
      return evidence(result);
    },
  },
  {
    id: "partial-error-roundtrip-no-retry",
    async run() {
      const events = deepSeekFixture([{ type: "message", text: "Partial answer" }]);
      const end = events.findIndex((event) => event.type === "response.output_text.delta");
      const result = await runRoundTrip({ responses: [events.slice(0, end + 1)] });
      assertEquivalent(result);
      assert.equal(result.first.outcome.kind, "failed");
      assert.equal(result.records.length, 1);
      const terminal = result.records[0]?.events.at(-1);
      assert.ok(terminal?.type === "error");
      assert.equal(terminal.error.partialOutput, true);
      return evidence(result);
    },
  },
];
function evidence(result: Awaited<ReturnType<typeof runRoundTrip>>): Evidence {
  return {
    requests: result.records.length,
    recordedOutcome: result.first.outcome.kind,
    replayedOutcome: result.replay.outcome.kind,
    toolStatuses: result.first.results.map((part) => part.status),
    replayToolStatuses: result.replay.results.map((part) => part.status),
  };
}
console.log(
  "Offline DeepSeek adapter conformance: synthetic SSE → real runtime/files/SQLite → normalized recording → replay.",
);
console.log(
  "No credentials or live HTTP; this is not service acceptance or model task-capability evidence.",
);
const results: { id: string; passed: boolean; evidence?: Evidence; error?: string }[] = [];
for (const scenario of scenarios) {
  try {
    const observation = await scenario.run();
    results.push({ id: scenario.id, passed: true, evidence: observation });
    console.log(`PASS ${scenario.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ id: scenario.id, passed: false, error: message });
    console.error(`FAIL ${scenario.id}: ${message}`);
  }
}
const passed = results.filter((result) => result.passed).length;
const destination = fileURLToPath(new URL("../results/deepseek.json", import.meta.url));
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(
  destination,
  `${JSON.stringify(
    {
      kind: "synthetic-deepseek-record-replay-conformance",
      source: "synthetic",
      liveServiceValidated: false,
      modelCapabilityScore: false,
      evidenceScope:
        "Injected byte-chunk transport, public runtime protocol, session.load, real temporary files and normalized file recordings; no direct database inspection.",
      generatedAt: new Date().toISOString(),
      passed,
      total: results.length,
      results,
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`${passed}/${results.length} scenarios passed. Report: ${destination}`);
if (passed !== results.length) process.exitCode = 1;
