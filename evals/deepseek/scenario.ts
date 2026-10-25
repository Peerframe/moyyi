import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ModelRecording,
  RunOutcome,
  RuntimeEvent,
  SessionId,
  ToolResultPart,
  TranscriptEntry,
} from "../../src/contracts/index.ts";
import {
  deepSeekFixture,
  deepSeekFixtureSse,
  deepSeekTextFixture,
} from "../../src/plugins/provider-deepseek/fixtures.ts";
import {
  DEEPSEEK_API_PROFILE,
  type DeepSeekTransport,
  deepSeekProfile,
} from "../../src/plugins/provider-deepseek/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { FileRecordingSink, loadModelRecordings } from "../../src/runtime/model-recording.ts";

export const fixtureText = "# Synthetic project\nThe greeting is: Hello moyyi 世界 🙂.\n";
export const finalAnswer = "README.md says: Hello moyyi 世界 🙂.";
export const instruction = "List the project, then read README.md and report its greeting.";
export function successfulFixtures(
  readPath = "README.md",
): readonly (readonly Record<string, unknown>[])[] {
  return [
    deepSeekFixture(
      [
        { type: "reasoning", text: "List the selected workspace first." },
        { type: "function_call", callId: "fixture_list_1", name: "list", arguments: "{}" },
      ],
      { responseId: "fixture_response_list" },
    ),
    deepSeekFixture(
      [
        { type: "reasoning", text: "Read the requested workspace file." },
        {
          type: "function_call",
          callId: "fixture_read_1",
          name: "read",
          arguments: JSON.stringify({ path: readPath }),
        },
      ],
      { responseId: "fixture_response_read" },
    ),
    deepSeekTextFixture(finalAnswer, { responseId: "fixture_response_final" }),
  ];
}

/** Synthetic bytes exercise the real SSE parser; there is no HTTP implementation here. */
export function fixtureTransport(responses: readonly (readonly Record<string, unknown>[])[]) {
  const requests: Record<string, unknown>[] = [];
  let closures = 0;
  const transport: DeepSeekTransport = async (body, signal) => {
    assert.equal(signal.aborted, false, "Transport called after cancellation");
    const index = requests.length;
    requests.push(JSON.parse(body) as Record<string, unknown>);
    const events = responses[index];
    if (!events) throw Error("Unexpected extra synthetic model request");
    const encoded = new TextEncoder().encode(deepSeekFixtureSse(events));
    let closed = false;
    return {
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      retryAfter: null,
      body: {
        async *[Symbol.asyncIterator]() {
          for (let offset = 0; offset < encoded.length; offset += 13) {
            if (signal.aborted) throw Error("Synthetic stream cancelled");
            yield encoded.slice(offset, offset + 13);
          }
        },
      },
      async close() {
        if (!closed) {
          closures++;
          closed = true;
        }
      },
    };
  };
  return {
    transport,
    requests,
    get closures() {
      return closures;
    },
  };
}

export interface SessionObservation {
  readonly outcome: RunOutcome;
  readonly entries: readonly TranscriptEntry[];
  readonly results: readonly ToolResultPart[];
  readonly effectStates: readonly string[];
  readonly assistantContent: readonly unknown[];
  readonly events: readonly RuntimeEvent[];
}
export async function runSession(
  runtime: Runtime,
  workspace: string,
  input = instruction,
  observe?: (event: RuntimeEvent) => void,
): Promise<SessionObservation> {
  const events: RuntimeEvent[] = [];
  const entries = new Map<string, TranscriptEntry>();
  const effects = new Map<string, string>();
  let loading = false;
  let sessionId: SessionId | undefined;
  const unsubscribe = runtime.subscribe((event) => {
    events.push(event);
    observe?.(event);
    if (event.type === "session.ready") sessionId = event.sessionId;
    if (loading && event.type === "entry.appended") entries.set(event.entry.id, event.entry);
    if (event.type === "effect.updated") effects.set(event.effect.id, event.effect.state);
  });
  try {
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    assert.ok(sessionId, "Session must be created");
    await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: input }] });
    await runtime.idle();
    loading = true;
    await runtime.send({ type: "session.load", sessionId });
    const finished = events.filter((event) => event.type === "run.finished");
    assert.equal(finished.length, 1, "A run must finish exactly once");
    assert.ok(!events.some((event) => event.type === "command.rejected"));
    const outcome = finished[0]?.outcome;
    assert.ok(outcome);
    const saved = [...entries.values()];
    assert.ok(saved.length, "The protocol must reload persisted entries");
    const results = saved.flatMap((entry) =>
      entry.body.kind === "tool_results" ? entry.body.results : [],
    );
    const calls = saved.flatMap((entry) =>
      entry.body.kind === "assistant_message"
        ? entry.body.content.filter((part) => part.type === "tool_call")
        : [],
    );
    assert.equal(results.length, calls.length, "Every call must have one result");
    for (const call of calls)
      assert.equal(results.filter((result) => result.callId === call.callId).length, 1);
    return {
      outcome,
      entries: saved,
      results,
      effectStates: [...effects.values()],
      events,
      assistantContent: saved.flatMap((entry) =>
        entry.body.kind === "assistant_message" ? [entry.body.content] : [],
      ),
    };
  } finally {
    unsubscribe();
  }
}

export interface RoundTripOptions {
  readonly responses?: readonly (readonly Record<string, unknown>[])[];
  readonly replayInput?: string;
  readonly recordingInsideWorkspace?: boolean;
  readonly beforeReplay?: (workspace: string, recordingDirectory: string) => void;
  readonly observe?: (phase: "record" | "replay", event: RuntimeEvent) => void;
}
export interface RoundTrip {
  readonly first: SessionObservation;
  readonly replay: SessionObservation;
  readonly records: readonly ModelRecording[];
  readonly wireRequests: readonly Record<string, unknown>[];
  readonly transportCallsAfterReplay: number;
  readonly closedResponses: number;
}
export async function runRoundTrip(options: RoundTripOptions = {}): Promise<RoundTrip> {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-deepseek-offline-"));
  let runtime: Runtime | undefined;
  try {
    const workspace = join(directory, "workspace");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "README.md"), fixtureText);
    writeFileSync(join(workspace, "src/main.ts"), 'export const greeting = "Hello moyyi";\n');
    writeFileSync(join(workspace, ".env"), "SYNTHETIC_PROTECTED_CANARY=never-reveal\n");
    const recordingDirectory = join(
      options.recordingInsideWorkspace ? workspace : directory,
      "recordings",
    );
    const sink = new FileRecordingSink(recordingDirectory);
    const source = fixtureTransport(options.responses ?? successfulFixtures());
    runtime = await createRuntime({
      model: deepSeekProfile.origin,
      dataDirectory: join(directory, "data-original"),
      deepseek: { transport: source.transport },
      modelRecording: { sink, apiProfile: DEEPSEEK_API_PROFILE, source: "synthetic" },
      limits: { timeoutMs: 15000, maxRetries: 0 },
    });
    assert.ok(runtime.plugins.every((plugin) => plugin.state === "loaded"));
    const first = await runSession(runtime, workspace, instruction, (event) =>
      options.observe?.("record", event),
    );
    await runtime.close();
    runtime = undefined;
    options.beforeReplay?.(workspace, recordingDirectory);
    const records = loadModelRecordings(recordingDirectory);
    assert.equal(
      records.length,
      source.requests.length,
      "Every transport exchange must have a recording",
    );
    assert.ok(records.every((record) => record.meta.source === "synthetic"));
    runtime = await createRuntime({
      model: deepSeekProfile.origin,
      dataDirectory: join(directory, "data-replay"),
      modelReplay: { records, apiProfile: DEEPSEEK_API_PROFILE },
      protectedPaths: [sink.directory],
      limits: { timeoutMs: 15000, maxRetries: 0 },
    });
    const replay = await runSession(
      runtime,
      workspace,
      options.replayInput ?? instruction,
      (event) => options.observe?.("replay", event),
    );
    return {
      first,
      replay,
      records,
      wireRequests: source.requests,
      transportCallsAfterReplay: source.requests.length,
      closedResponses: source.closures,
    };
  } finally {
    try {
      await runtime?.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

export function assertEquivalent(result: RoundTrip): void {
  assert.deepEqual(result.replay.outcome, result.first.outcome);
  assert.deepEqual(result.replay.results, result.first.results);
  assert.deepEqual(result.replay.effectStates, result.first.effectStates);
  assert.deepEqual(result.replay.assistantContent, result.first.assistantContent);
  assert.equal(
    result.transportCallsAfterReplay,
    result.records.length,
    "Replay must not call the original transport",
  );
  assert.equal(
    result.closedResponses,
    result.records.length,
    "Every original response must be closed",
  );
}
