import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  type ModelClient,
  type ModelProfile,
  type ModelRequest,
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  type TranscriptEntry,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { pathToHead } from "../src/core/index.ts";
import { scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const STEP_SUMMARY = "Summarize the quoted earlier steps";
const text = (value: string): ModelStreamEvent[] => [
  { type: "part_completed", index: 0, part: { type: "text", text: value } },
  { type: "completed", stopReason: "end_turn", providerStopReason: "stop", usage: UNKNOWN_USAGE },
];
const read = (id: string): ModelStreamEvent[] => [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: id as ToolCallId,
      providerCallId: id,
      providerItemId: null,
      name: "read",
      rawArguments: JSON.stringify({ path: "big.txt" }),
      argumentsSource: "verbatim",
    },
  },
  { type: "completed", stopReason: "tool_use", providerStopReason: null, usage: UNKNOWN_USAGE },
];

/** Answers step-summary requests with a summary, and everything else from a fixed script. */
class StepAwareClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  readonly summaries: ModelRequest[] = [];
  readonly #script: ModelStreamEvent[][];
  readonly summary: string;
  constructor(script: ModelStreamEvent[][], summary: string) {
    this.#script = [...script];
    this.summary = summary;
  }
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    const summarizing = request.system.some(
      (part) => part.type === "text" && part.text.startsWith(STEP_SUMMARY),
    );
    if (summarizing) this.summaries.push(request);
    const events = summarizing ? text(this.summary) : this.#script.shift();
    if (!events) throw Error("Script exhausted");
    for (const event of events) yield event;
  }
}

async function run(options: { steps: number; ratio?: number; window?: number; summary?: string }) {
  const root = mkdtempSync(join(tmpdir(), "moyyi-steps-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "big.txt"), `${"evidence line\n".repeat(600)}`);
  const store = new SqliteSessionStore(join(root, "store"));
  cleanups.push(() => store.close());
  const script = [
    ...Array.from({ length: options.steps }, (_, i) => read(`call_${i}`)),
    text("Finished after reading."),
  ];
  const client = new StepAwareClient(
    script,
    options.summary ?? "Read big.txt repeatedly; it holds evidence lines.",
  );
  const profile: ModelProfile = {
    ...scriptedProfile,
    contextWindowTokens: options.window ?? 120_000,
  };
  const runtime = await createRuntime({
    store,
    model: scriptedProfile.origin,
    limits: { maxModelRequests: 40, maxToolOutputBytes: 32_768 },
    ...(options.ratio ? { autoCompact: { thresholdRatio: options.ratio } } : {}),
    plugins: [
      {
        plugin: {
          name: "steps-model",
          apiVersion: 1,
          setup(host) {
            host.registerModelProvider({
              id: "scripted",
              models: [profile],
              createClient: () => client,
            });
          },
        },
      },
    ],
  });
  cleanups.push(() => runtime.close());
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const { sessionId } = events.find((event) => event.type === "session.ready") as {
    sessionId: SessionId;
  };
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [{ type: "text", text: "Read big.txt several times, then answer." }],
  });
  await runtime.idle();
  const outcome = events.findLast((event) => event.type === "run.finished");
  const snapshot = await store.loadSession(sessionId);
  if (!snapshot) throw Error("Missing session");
  return { client, outcome, snapshot };
}

const compactions = (entries: readonly TranscriptEntry[]) =>
  entries.filter((entry) => entry.body.kind === "compaction");

it("summarizes earlier steps of a long turn and keeps the request and latest steps verbatim", async () => {
  const result = await run({ steps: 8, ratio: 0.6 });
  expect(result.outcome).toMatchObject({ outcome: { kind: "completed" } });
  expect(result.client.summaries.length).toBeGreaterThanOrEqual(1);
  const [compaction] = compactions(result.snapshot.entries);
  expect(compaction?.body).toMatchObject({
    kind: "compaction",
    producedBy: { promptVersion: "moyyi-step-compaction-v1" },
  });
  // The summarized range starts right after the user's request, never before it.
  const path = pathToHead(result.snapshot);
  const userIndex = path.findIndex((entry) => entry.body.kind === "user_message");
  if (compaction?.body.kind !== "compaction") throw Error("No compaction");
  expect(path[userIndex + 1]?.id).toBe(compaction.body.replaces.fromEntryId);
  // Requests after the summary are smaller than the one that triggered it, and still carry
  // the user's request and the summary.
  const after = result.client.requests.at(-1) as ModelRequest;
  const serialized = JSON.stringify(after);
  expect(serialized).toContain("Read big.txt several times");
  expect(serialized).toContain("Read big.txt repeatedly");
  const before =
    result.client.requests[
      result.client.requests.indexOf(result.client.summaries[0] as ModelRequest) - 1
    ];
  expect(serialized.length).toBeLessThan(JSON.stringify(before).length * 2);
  // Original steps remain in history.
  expect(
    result.snapshot.entries.filter((entry) => entry.body.kind === "tool_results"),
  ).toHaveLength(8);
}, 30_000);

it("never compacts inside a turn when automatic compaction is off or the turn is short", async () => {
  // Without it, the same task outgrows the window and the turn fails.
  const off = await run({ steps: 8 });
  expect(off.client.summaries).toHaveLength(0);
  expect(compactions(off.snapshot.entries)).toHaveLength(0);
  expect(off.outcome).toMatchObject({ outcome: { kind: "failed" } });
  expect(JSON.stringify(off.outcome)).toContain("Context capacity exceeded");
  const short = await run({ steps: 3, ratio: 0.6 });
  expect(short.client.summaries).toHaveLength(0);
  expect(short.outcome).toMatchObject({ outcome: { kind: "completed" } });
}, 30_000);

it("keeps going with full history when a step summary does not reduce the context", async () => {
  const result = await run({ steps: 6, ratio: 0.6, summary: "x ".repeat(60_000) });
  expect(result.outcome).toMatchObject({ outcome: { kind: "completed" } });
  expect(result.client.summaries.length).toBeGreaterThanOrEqual(1);
  expect(compactions(result.snapshot.entries)).toHaveLength(0);
}, 30_000);
