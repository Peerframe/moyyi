import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureTransport } from "../evals/deepseek/scenario.ts";
import { MinimalContextBuilder } from "../src/context/index.ts";
import {
  type ContextInput,
  type ContextSection,
  type EntryId,
  type ModelProfile,
  type ModelStreamEvent,
  type RunId,
  type RuntimeEvent,
  type SessionId,
  type SessionStore,
  type Timestamp,
  type TranscriptEntry,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { pathToHead } from "../src/core/index.ts";
import { deepSeekTextFixture } from "../src/plugins/provider-deepseek/fixtures.ts";
import { deepSeekProfile } from "../src/plugins/provider-deepseek/index.ts";
import { ScriptedModelClient, scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const final = (text: string): readonly ModelStreamEvent[] => [
  { type: "part_completed", index: 0, part: { type: "text", text } },
  {
    type: "completed",
    stopReason: "end_turn",
    providerStopReason: "stop",
    usage: { ...UNKNOWN_USAGE, status: "final", outputTokens: 17 },
  },
];
const summary =
  "Keep all customer records. Work on report.txt. Three prior inspections completed; no writes were requested.";

async function harness(
  responses: readonly (readonly ModelStreamEvent[])[],
  options: {
    turns?: number;
    profile?: ModelProfile;
    failCompaction?: boolean;
    size?: number;
    reasoning?: boolean;
    sections?: readonly ContextSection[];
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-compaction-"));
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  const store = new SqliteSessionStore(join(directory, "store"));
  const sessionId = "session_compact" as SessionId,
    runId = "run_seed" as RunId;
  const blob = await store.putBlob(new TextEncoder().encode("[]"));
  const seed: TranscriptEntry[] = [];
  const add = (body: TranscriptEntry["body"]) =>
    seed.push({
      id: `entry_${seed.length}` as EntryId,
      parentId: seed.at(-1)?.id ?? null,
      sessionId,
      runId,
      createdAt: "2026-10-25T00:00:00Z" as Timestamp,
      body,
    });
  for (let turn = 0; turn < (options.turns ?? 5); turn++) {
    add({
      kind: "user_message",
      steering: false,
      content: [
        {
          type: "text",
          text: turn === 0 ? "Keep all customer records; work on report.txt." : `User turn ${turn}`,
        },
      ],
    });
    add({
      kind: "assistant_message",
      origin: scriptedProfile.origin,
      content: [
        ...(options.reasoning
          ? [
              {
                type: "reasoning" as const,
                kind: "visible" as const,
                text: "Consider user constraints.",
              },
            ]
          : []),
        { type: "text", text: `Turn ${turn}: ${"observed data ".repeat(options.size ?? 200)}` },
      ],
      stopReason: "end_turn",
      providerStopReason: "stop",
      usage: UNKNOWN_USAGE,
      request: { rendererVersion: "seed-v1", system: blob, tools: blob, messages: [] },
    });
  }
  await store.commit({
    entries: seed,
    effects: [],
    durability: "normal",
    sessions: [{ sessionId, workspaceRoot: workspace, headEntryId: seed.at(-1)?.id ?? null }],
    runs: [{ runId, sessionId, status: "active" }],
  });
  await store.commit({
    entries: [],
    effects: [],
    durability: "normal",
    runs: [{ runId, sessionId, status: "completed" }],
  });
  const client = new ScriptedModelClient(responses);
  let expire = () => {};
  const delegated: SessionStore = {
    listSessions: () => store.listSessions(),
    loadSession: (id) => store.loadSession(id),
    unsettledEffects: () => store.unsettledEffects(),
    putBlob: (bytes) => store.putBlob(bytes),
    getBlob: (ref) => store.getBlob(ref),
    async commit(batch) {
      if (options.failCompaction && batch.entries.some((entry) => entry.body.kind === "compaction"))
        throw Error("Injected compaction publication failure");
      await store.commit(batch);
    },
  };
  const runtime = await createRuntime({
    store: delegated,
    model: scriptedProfile.origin,
    scheduler: {
      sleep: async () => {},
      deadline: (_ms, callback) => {
        expire = callback;
        return () => {};
      },
    },
    plugins: [
      {
        plugin: {
          name: "compaction-model",
          apiVersion: 1,
          setup(host) {
            host.registerModelProvider({
              id: "scripted",
              models: [options.profile ?? scriptedProfile],
              createClient: () => client,
            });
            if (options.sections)
              host.registerContextSource({
                id: "compaction-sections",
                collect: async () => options.sections ?? [],
              });
          },
        },
      },
    ],
  });
  cleanups.push(async () => {
    await runtime.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  const snapshot = async () => {
    const value = await store.loadSession(sessionId);
    if (!value) throw Error("Missing session");
    return value;
  };
  return {
    runtime,
    store,
    client,
    seed,
    sessionId,
    events,
    snapshot,
    expire: () => expire(),
    async compact() {
      await runtime.send({ type: "session.compact", sessionId });
      await runtime.idle();
      return events.findLast((event) => event.type === "run.finished")?.outcome;
    },
  };
}

it("publishes a smaller summary atomically, keeps two recent turns, and audits the exact request on a sibling", async () => {
  const test = await harness([final(summary), final("Continued.")]);
  expect(await test.compact()).toEqual({ kind: "completed" });
  const snapshot = await test.snapshot();
  expect(
    snapshot.entries.filter((entry) => test.seed.some((original) => original.id === entry.id)),
  ).toEqual(test.seed);
  const compact = snapshot.entries.find((entry) => entry.body.kind === "compaction");
  const audit = snapshot.entries.find(
    (entry) =>
      entry.body.kind === "assistant_message" &&
      entry.body.request.rendererVersion === "moyyi-compaction-v1",
  );
  expect(compact?.parentId).toBe(test.seed.at(-1)?.id);
  expect(audit?.parentId).toBe(compact?.parentId);
  expect(pathToHead(snapshot).some((entry) => entry.id === audit?.id)).toBe(false);
  expect(snapshot.effects).toEqual([]);
  expect(test.client.requests).toHaveLength(1);
  expect(test.client.requests[0]?.tools).toEqual([]);
  if (audit?.body.kind !== "assistant_message") throw Error("No audit");
  expect(audit.body.usage.outputTokens).toBe(17);
  const ref = audit.body.request.messages[0];
  if (!ref) throw Error("Missing message ref");
  const bytes = await test.store.getBlob(ref);
  if (!bytes) throw Error("Missing request blob");
  expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(test.client.requests[0]?.messages[0]);
  await test.runtime.send({
    type: "run.start",
    sessionId: test.sessionId,
    input: [{ type: "text", text: "Continue without repeating earlier constraints." }],
  });
  await test.runtime.idle();
  const messages = test.client.requests[1]?.messages;
  expect(JSON.stringify(messages?.[0])).toContain(summary);
  expect(JSON.stringify(messages)).not.toContain("Turn 0: observed data");
  expect(JSON.stringify(messages)).toContain("Turn 3: observed data");
  expect(JSON.stringify(messages)).toContain("Turn 4: observed data");
});

it("allows complete reasoning as audit-only content", async () => {
  const response: readonly ModelStreamEvent[] = [
    {
      type: "part_completed",
      index: 0,
      part: { type: "reasoning", kind: "visible", text: "Plan a faithful summary." },
    },
    { type: "part_completed", index: 1, part: { type: "text", text: summary } },
    { type: "completed", stopReason: "end_turn", providerStopReason: "stop", usage: UNKNOWN_USAGE },
  ];
  const test = await harness([response]);
  expect(await test.compact()).toEqual({ kind: "completed" });
  const compact = (await test.snapshot()).entries.find((entry) => entry.body.kind === "compaction");
  expect(compact?.body).toMatchObject({ summary: [{ type: "text", text: summary }] });
});

it.each(["omitted-to-omitted", "admitted-to-omitted", "omitted-to-admitted"] as const)(
  "judges summary savings on required content when navigation changes %s",
  async (transition) => {
    const shrinking = transition === "omitted-to-admitted";
    const response = shrinking ? summary : "expanded evidence ".repeat(300);
    const options = shrinking ? {} : { turns: 3, size: 0 };
    const planner = vi.spyOn(MinimalContextBuilder.prototype, "planCompaction");
    let original: ContextInput;
    try {
      const probe = await harness([final(response)], options);
      await probe.compact();
      const captured = planner.mock.calls[0]?.[0];
      if (!captured) throw Error("Missing compaction input");
      original = captured;
    } finally {
      planner.mockRestore();
    }
    const builder = new MinimalContextBuilder();
    const plan = builder.planCompaction(original);
    const template = original.path.at(-1);
    if (!plan || !template) throw Error("Missing compaction plan");
    const candidate: TranscriptEntry = {
      ...template,
      id: "projected_compaction" as EntryId,
      parentId: template.id,
      body: {
        kind: "compaction",
        replaces: plan.replaces,
        summary: [{ type: "text", text: response }],
        producedBy: { origin: original.profile.origin, promptVersion: plan.promptVersion },
      },
    };
    const projected = { ...original, path: [...original.path, candidate] };
    const originalTokens = builder.build(original).report.estimatedTokens;
    const projectedTokens = builder.build(projected).report.estimatedTokens;
    if (originalTokens === undefined || projectedTokens === undefined)
      throw Error("Missing context estimates");
    expect(projectedTokens < originalTokens).toBe(shrinking);
    const navigation: ContextSection = {
      id: "navigation",
      stability: "turn",
      optional: true,
      content: [
        {
          type: "text",
          text: "n".repeat(shrinking ? originalTokens - projectedTokens + 1000 : 10_000),
        },
      ],
    };
    const sections = [...original.sections, navigation];
    const fullBefore = builder.build({ ...original, sections }).report.estimatedTokens;
    const fullAfter = builder.build({ ...projected, sections }).report.estimatedTokens;
    if (fullBefore === undefined || fullAfter === undefined) throw Error("Missing full estimates");
    const profile = {
      ...scriptedProfile,
      contextWindowTokens:
        transition === "admitted-to-omitted"
          ? fullBefore
          : shrinking
            ? fullAfter
            : projectedTokens + 1000,
    };
    const before = builder.build({ ...original, sections, profile });
    const after = builder.build({ ...projected, sections, profile });
    expect(navigation.content.some((part) => before.request.system.includes(part))).toBe(
      transition === "admitted-to-omitted",
    );
    expect(navigation.content.some((part) => after.request.system.includes(part))).toBe(shrinking);
    const test = await harness([final(response)], { ...options, profile, sections: [navigation] });
    expect(await test.compact()).toMatchObject(
      shrinking
        ? { kind: "completed" }
        : { kind: "failed", reason: expect.stringContaining("Summary does not reduce") },
    );
    const snapshot = await test.snapshot();
    expect(snapshot.entries.filter((entry) => entry.body.kind === "compaction")).toHaveLength(
      shrinking ? 1 : 0,
    );
    if (!shrinking) expect(pathToHead(snapshot)).toEqual(test.seed);
    expect(test.client.requests).toHaveLength(1);
  },
);

it("makes no model request when there are not three completed user turns", async () => {
  const test = await harness([final(summary)], { turns: 2 });
  expect((await test.compact())?.kind).toBe("failed");
  expect(test.client.requests).toEqual([]);
  expect((await test.snapshot()).headEntryId).toBe(test.seed.at(-1)?.id);
});

it.each(["refusal", "tool", "interrupted", "larger", "empty"])(
  "keeps the original path for invalid %s summaries",
  async (kind) => {
    const response: readonly ModelStreamEvent[] =
      kind === "refusal"
        ? [
            {
              type: "part_completed",
              index: 0,
              part: { type: "refusal", text: "Cannot summarize" },
            },
            {
              type: "completed",
              stopReason: "end_turn",
              providerStopReason: "stop",
              usage: UNKNOWN_USAGE,
            },
          ]
        : kind === "tool"
          ? [
              {
                type: "part_completed",
                index: 0,
                part: {
                  type: "tool_call",
                  callId: "unexpected" as never,
                  providerCallId: "unexpected",
                  providerItemId: null,
                  name: "read",
                  rawArguments: '{"path":"report.txt"}',
                  argumentsSource: "verbatim",
                },
              },
              {
                type: "completed",
                stopReason: "tool_use",
                providerStopReason: "tool_calls",
                usage: UNKNOWN_USAGE,
              },
            ]
          : kind === "interrupted"
            ? [
                { type: "text_delta", index: 0, text: "Partial summary" },
                {
                  type: "error",
                  error: {
                    kind: "network",
                    message: "Offline interruption",
                    partialOutput: true,
                    usage: UNKNOWN_USAGE,
                  },
                },
              ]
            : final(kind === "larger" ? "expanding content ".repeat(2000) : "");
    const test = await harness([response]);
    expect((await test.compact())?.kind).toBe("failed");
    const snapshot = await test.snapshot();
    expect(snapshot.headEntryId).toBe(test.seed.at(-1)?.id);
    expect(pathToHead(snapshot)).toEqual(test.seed);
    expect(snapshot.effects).toEqual([]);
    expect(snapshot.entries.filter((entry) => entry.body.kind === "compaction")).toEqual([]);
    expect(test.client.requests).toHaveLength(1);
    if (kind === "tool")
      expect(
        snapshot.entries.find((entry) => entry.body.kind === "tool_results")?.body,
      ).toMatchObject({ results: [{ status: "cancelled" }] });
    if (kind === "tool") {
      await test.runtime.close();
      const restarted = await createRuntime({
        store: test.store,
        model: scriptedProfile.origin,
        plugins: [
          {
            plugin: {
              name: "recovery-model",
              apiVersion: 1,
              setup(host) {
                host.registerModelProvider({
                  id: "scripted",
                  models: [scriptedProfile],
                  createClient: () => test.client,
                });
              },
            },
          },
        ],
      });
      cleanups.push(() => restarted.close());
      expect(await test.snapshot()).toEqual(snapshot);
      expect(test.client.requests).toHaveLength(1);
    }
  },
);

it.each(["cancel", "timeout"])(
  "preserves the active head on %s and rejects steering/overlapping runs",
  async (action) => {
    const test = await harness([]);
    const started = Promise.withResolvers<void>();
    test.client.stream = async function* (_request, signal) {
      yield { type: "text_delta", index: 0, text: "Partial" };
      started.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    await test.runtime.send({ type: "session.compact", sessionId: test.sessionId });
    await started.promise;
    const run = test.events.find((event) => event.type === "run.started");
    if (!run) throw Error("No run");
    await test.runtime.send({
      type: "run.steer",
      runId: run.runId,
      input: [{ type: "text", text: "Cannot inject during summary" }],
    });
    await test.runtime.send({
      type: "run.start",
      sessionId: test.sessionId,
      input: [{ type: "text", text: "Cannot overlap" }],
    });
    expect(test.events.filter((event) => event.type === "command.rejected")).toHaveLength(2);
    if (action === "cancel") await test.runtime.send({ type: "run.cancel", runId: run.runId });
    else test.expire();
    await test.runtime.idle();
    expect(test.events.findLast((event) => event.type === "run.finished")?.outcome).toEqual(
      action === "cancel" ? { kind: "cancelled" } : { kind: "budget_exhausted", budget: "time" },
    );
    expect(pathToHead(await test.snapshot())).toEqual(test.seed);
  },
);

it("refuses an oversized summary source before calling the model", async () => {
  const test = await harness([final(summary)], {
    profile: { ...scriptedProfile, contextWindowTokens: 5000, maxOutputTokens: 500 },
  });
  expect(await test.compact()).toMatchObject({
    kind: "failed",
    reason: expect.stringContaining("compact earlier"),
  });
  expect(test.client.requests).toEqual([]);
  expect(pathToHead(await test.snapshot())).toEqual(test.seed);
});

it("rolls back compaction publication without hiding the original path", async () => {
  const test = await harness([final(summary)], { failCompaction: true });
  expect(await test.compact()).toMatchObject({
    kind: "failed",
    reason: expect.stringContaining("publication failure"),
  });
  const snapshot = await test.snapshot();
  expect(snapshot.entries).toEqual(test.seed);
  expect(snapshot.headEntryId).toBe(test.seed.at(-1)?.id);
  expect(test.store.diagnostics().integrity).toBe("ok");
});

it("compacts again using the first summary and retains newly recent turns", async () => {
  const test = await harness([
    final(summary),
    final(`First later answer ${"detail ".repeat(200)}`),
    final(`Second later answer ${"detail ".repeat(200)}`),
    final("Keep all customer records; report.txt work remains ongoing."),
  ]);
  expect(await test.compact()).toEqual({ kind: "completed" });
  for (const text of ["Follow-up one", "Follow-up two"]) {
    await test.runtime.send({
      type: "run.start",
      sessionId: test.sessionId,
      input: [{ type: "text", text }],
    });
    await test.runtime.idle();
  }
  expect(await test.compact()).toEqual({ kind: "completed" });
  expect(JSON.stringify(test.client.requests.at(-1)?.messages)).toContain(summary);
  expect(JSON.stringify(test.client.requests.at(-1)?.messages)).not.toContain(
    "Turn 0: observed data",
  );
  const snapshot = await test.snapshot();
  expect(snapshot.entries.filter((entry) => entry.body.kind === "compaction")).toHaveLength(2);
  const rendered = new MinimalContextBuilder().build({
    path: pathToHead(snapshot),
    profile: scriptedProfile,
    tools: [],
    sections: [],
    unsettledEffects: [],
  });
  expect(JSON.stringify(rendered.request.messages)).toContain("Follow-up one");
  expect(JSON.stringify(rendered.request.messages)).not.toContain("User turn 3");
});

it("compacts and continues through real DeepSeek rendering and synthetic reasoning SSE without network", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Network forbidden"));
  cleanups.push(async () => network.mockRestore());
  const test = await harness([], { reasoning: true });
  await test.runtime.close();
  const fixture = fixtureTransport([
    deepSeekTextFixture(summary),
    deepSeekTextFixture("Continued safely.", { responseId: "after_compaction" }),
  ]);
  const runtime = await createRuntime({
    store: test.store,
    model: deepSeekProfile.origin,
    deepseek: { transport: fixture.transport },
  });
  cleanups.push(() => runtime.close());
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.compact", sessionId: test.sessionId });
  await runtime.idle();
  expect(events.findLast((event) => event.type === "run.finished")?.outcome).toEqual({
    kind: "completed",
  });
  await runtime.send({
    type: "run.start",
    sessionId: test.sessionId,
    input: [{ type: "text", text: "Continue." }],
  });
  await runtime.idle();
  expect(events.findLast((event) => event.type === "run.finished")?.outcome).toEqual({
    kind: "completed",
  });
  expect(fixture.requests).toHaveLength(2);
  expect(JSON.stringify(fixture.requests[1])).toContain(summary);
  expect(JSON.stringify(fixture.requests[1])).not.toContain("Turn 0: observed data");
  const audit = (await test.snapshot()).entries.find(
    (entry) =>
      entry.body.kind === "assistant_message" &&
      entry.body.request.rendererVersion === "moyyi-compaction-v1",
  );
  expect(audit?.body).toMatchObject({
    content: [{ type: "reasoning", kind: "visible" }, { type: "text" }],
    usage: { status: "final", cacheReadTokens: 4 },
  });
  expect(network).not.toHaveBeenCalled();
});
