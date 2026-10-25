import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deepSeekFixture,
  type FixtureOptions,
} from "../../src/plugins/provider-deepseek/fixtures.ts";
import { assertEquivalent, finalAnswer, runRoundTrip, successfulFixtures } from "./scenario.ts";

interface Evidence {
  readonly requests: number;
  readonly recordedOutcome: string;
  readonly replayedOutcome: string;
  readonly toolStatuses: readonly string[];
  readonly replayToolStatuses: readonly string[];
}
function commentaryRead(withReasoning = false, options: FixtureOptions = {}) {
  const events = deepSeekFixture(
    [
      ...(withReasoning
        ? [{ type: "reasoning" as const, text: "Read the synthetic greeting exactly." }]
        : []),
      { type: "message", text: "I will read the synthetic README.md file." },
      {
        type: "function_call",
        callId: "synthetic_commentary_read",
        name: "read",
        arguments: '{ "path": "README.md" }',
      },
    ],
    { responseId: "synthetic_commentary_response", ...options },
  );
  for (const event of events) {
    const item = event.item as Record<string, unknown> | undefined;
    if (item?.type === "message")
      item.phase = event.type === "response.output_item.added" ? "final_answer" : "commentary";
    const response = event.response as { output?: Record<string, unknown>[] } | undefined;
    for (const item of response?.output ?? [])
      if (item.type === "message") item.phase = "commentary";
  }
  return events;
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
    id: "visible-reasoning-auxiliary-metadata-record-replay",
    async run() {
      const responses = structuredClone(successfulFixtures());
      for (const events of responses)
        for (const event of events) {
          const item = event.item as Record<string, unknown> | undefined;
          if (item?.type === "reasoning")
            item.encrypted_content = `SYNTHETIC_AUXILIARY_${event.type}`;
          const response = event.response as { output?: Record<string, unknown>[] } | undefined;
          for (const final of response?.output ?? [])
            if (final.type === "reasoning") final.encrypted_content = "SYNTHETIC_AUXILIARY_FINAL";
        }
      const result = await runRoundTrip({ responses });
      assertEquivalent(result);
      assert.equal(result.first.outcome.kind, "completed");
      assert.deepEqual(
        result.first.results.map((part) => part.status),
        ["succeeded", "succeeded"],
      );
      assert.ok(JSON.stringify(result.replay.assistantContent).includes(finalAnswer));
      for (const normalized of [result.records, result.wireRequests]) {
        assert.ok(!JSON.stringify(normalized).includes("SYNTHETIC_AUXILIARY"));
        assert.ok(!JSON.stringify(normalized).includes("encrypted_content"));
      }
      return evidence(result);
    },
  },
  {
    id: "final-answer-phase-record-replay-and-tool-continuation",
    async run() {
      const responses = [...successfulFixtures()];
      responses[0] = deepSeekFixture([
        { type: "reasoning", text: "Inspect the selected workspace." },
        { type: "message", text: "Synthetic phase annotation cannot finish a tool turn." },
        { type: "function_call", callId: "fixture_list_1", name: "list", arguments: "{}" },
      ]);
      for (const events of responses)
        for (const event of events) {
          const item = event.item as Record<string, unknown> | undefined;
          if (item?.type === "message") item.phase = "final_answer";
          const response = event.response as { output?: Record<string, unknown>[] } | undefined;
          for (const final of response?.output ?? [])
            if (final.type === "message") final.phase = "final_answer";
        }
      const result = await runRoundTrip({ responses });
      assertEquivalent(result);
      assert.equal(result.first.outcome.kind, "completed");
      assert.equal(result.records.length, 3);
      assert.deepEqual(
        result.first.results.map((part) => part.status),
        ["succeeded", "succeeded"],
      );
      const terminal = result.records[0]?.events.at(-1);
      assert.ok(terminal?.type === "completed" && terminal.stopReason === "tool_use");
      assert.ok(JSON.stringify(result.wireRequests[1]).includes("annotation cannot finish"));
      assert.ok(JSON.stringify(result.replay.assistantContent).includes(finalAnswer));
      for (const normalized of [result.records, result.wireRequests]) {
        assert.ok(!JSON.stringify(normalized).includes('"phase":'));
        assert.ok(!JSON.stringify(normalized).includes('"final_answer"'));
      }
      return evidence(result);
    },
  },
  {
    id: "commentary-read-final-without-reasoning-record-replay",
    async run() {
      const result = await runRoundTrip({
        responses: [
          commentaryRead(),
          deepSeekFixture([{ type: "message", text: finalAnswer }], {
            responseId: "synthetic_plain_final",
          }),
        ],
      });
      assertEquivalent(result);
      assert.equal(result.first.outcome.kind, "completed");
      assert.equal(result.records.length, 2);
      assert.deepEqual(
        result.first.results.map((part) => part.status),
        ["succeeded"],
      );
      assert.equal(result.first.effectStates.length, 1);
      assert.ok(JSON.stringify(result.replay.assistantContent).includes(finalAnswer));
      const continuation = result.wireRequests[1]?.input as Record<string, unknown>[];
      assert.ok(
        continuation.some(
          (item) =>
            item.type === "function_call_output" && JSON.stringify(item).includes("Hello moyyi"),
        ),
      );
      assert.ok(
        continuation.some(
          (item) =>
            item.type === "message" &&
            JSON.stringify(item).includes("I will read the synthetic README.md file."),
        ),
      );
      assert.ok(!continuation.some((item) => item.type === "reasoning"));
      for (const normalized of [result.records, result.wireRequests]) {
        assert.ok(!JSON.stringify(normalized).includes('"phase":'));
        assert.ok(!JSON.stringify(normalized).includes('"replay":'));
      }
      assert.ok(
        result.first.entries.some(
          (entry) =>
            entry.body.kind === "assistant_message" && entry.body.stopReason === "tool_use",
        ),
      );
      assert.ok(
        result.first.entries.some(
          (entry) =>
            entry.body.kind === "assistant_message" && entry.body.stopReason === "end_turn",
        ),
      );
      return evidence(result);
    },
  },
  {
    id: "commentary-read-preserves-visible-reasoning-record-replay",
    async run() {
      const result = await runRoundTrip({
        responses: [
          commentaryRead(true),
          deepSeekFixture([{ type: "message", text: finalAnswer }], {
            responseId: "synthetic_reasoned_final",
          }),
        ],
      });
      assertEquivalent(result);
      assert.equal(result.first.outcome.kind, "completed");
      assert.deepEqual(
        result.first.results.map((part) => part.status),
        ["succeeded"],
      );
      const continuation = result.wireRequests[1]?.input as Record<string, unknown>[];
      assert.deepEqual(
        continuation.filter((item) => item.type === "reasoning"),
        [
          {
            type: "reasoning",
            content: [{ type: "reasoning_text", text: "Read the synthetic greeting exactly." }],
          },
        ],
      );
      assert.ok(JSON.stringify(result.replay.assistantContent).includes(finalAnswer));
      return evidence(result);
    },
  },
  ...(["prefix", "max_tokens", "refusal", "failed", "phase_conflict"] as const).map((variant) => ({
    id: `commentary-${variant}-never-executes-proposed-tool`,
    async run() {
      let events = commentaryRead(
        false,
        variant === "max_tokens" || variant === "refusal"
          ? {
              status: "incomplete",
              incompleteReason: variant === "max_tokens" ? "max_output_tokens" : "content_filter",
            }
          : variant === "failed"
            ? { status: "failed" }
            : {},
      );
      if (variant === "prefix") {
        const end = events.findIndex(
          (event) =>
            event.type === "response.output_item.added" &&
            (event.item as Record<string, unknown>).type === "function_call",
        );
        assert.ok(end > 0);
        events = events.slice(0, end + 1);
      }
      if (variant === "phase_conflict") {
        const last = events.at(-1);
        assert.ok(last);
        const output = (last.response as { output: Record<string, unknown>[] }).output;
        const message = output.find((item) => item.type === "message");
        assert.ok(message);
        message.phase = "final_answer";
      }
      const result = await runRoundTrip({ responses: [events] });
      assertEquivalent(result);
      assert.equal(result.records.length, 1);
      assert.equal(result.first.effectStates.length, 0);
      assert.equal(result.replay.effectStates.length, 0);
      assert.ok(result.first.results.every((part) => part.status !== "succeeded"));
      assert.equal(result.transportCallsAfterReplay, 1);
      const terminal = result.records[0]?.events.at(-1);
      if (variant === "max_tokens" || variant === "refusal") {
        assert.ok(terminal?.type === "completed" && terminal.stopReason === variant);
      } else {
        assert.ok(terminal?.type === "error");
        assert.equal(
          terminal.error.kind,
          variant === "prefix"
            ? "stream_interrupted"
            : variant === "failed"
              ? "overloaded"
              : "protocol",
        );
      }
      return evidence(result);
    },
  })),
  {
    id: "unsupported-message-phase-never-executes-proposed-tool",
    async run() {
      const events = deepSeekFixture([
        {
          type: "function_call",
          callId: "fixture_pending_read",
          name: "read",
          arguments: '{"path":"README.md"}',
        },
        { type: "message", text: "Synthetic unsupported phase." },
      ]);
      const item = events.find(
        (event) =>
          event.type === "response.output_item.added" &&
          (event.item as Record<string, unknown>).type === "message",
      )?.item as Record<string, unknown>;
      item.phase = "synthetic_unknown_phase";
      const result = await runRoundTrip({ responses: [events] });
      assertEquivalent(result);
      assert.equal(result.first.outcome.kind, "failed");
      assert.equal(result.first.effectStates.length, 0);
      assert.ok(result.first.results.every((part) => part.status !== "succeeded"));
      assert.equal(result.transportCallsAfterReplay, 1);
      assert.equal(result.records.length, 1);
      const terminal = result.records[0]?.events.at(-1);
      assert.ok(terminal?.type === "error" && terminal.error.kind === "protocol");
      return evidence(result);
    },
  },
  {
    id: "opaque-only-reasoning-never-executes-proposed-tool",
    async run() {
      const events = deepSeekFixture([
        {
          type: "function_call",
          callId: "synthetic_pending_read",
          name: "read",
          arguments: '{"path":"README.md"}',
        },
        { type: "reasoning", text: "" },
      ]);
      const item = events.find(
        (event) =>
          event.type === "response.output_item.added" &&
          (event.item as Record<string, unknown>).type === "reasoning",
      )?.item as Record<string, unknown>;
      item.encrypted_content = "SYNTHETIC_OPAQUE_ONLY";
      const result = await runRoundTrip({ responses: [events] });
      assertEquivalent(result);
      assert.equal(result.first.outcome.kind, "failed");
      assert.equal(result.first.effectStates.length, 0);
      assert.ok(result.first.results.every((part) => part.status !== "succeeded"));
      assert.equal(result.transportCallsAfterReplay, 1);
      assert.equal(result.records.length, 1);
      const terminal = result.records[0]?.events.at(-1);
      assert.ok(terminal?.type === "error" && terminal.error.kind === "protocol");
      assert.ok(!JSON.stringify(result.records).includes("SYNTHETIC_OPAQUE_ONLY"));
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
