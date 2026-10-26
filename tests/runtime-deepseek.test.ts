import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEquivalent,
  finalAnswer,
  fixtureText,
  fixtureTransport,
  runRoundTrip,
  successfulFixtures,
} from "../evals/deepseek/scenario.ts";
import { fileResultValue } from "../evals/support/file-result.ts";
import {
  type FileRead,
  type RunOutcome,
  type SessionId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { deepSeekFixture } from "../src/plugins/provider-deepseek/fixtures.ts";
import { DEEPSEEK_API_PROFILE, deepSeekProfile } from "../src/plugins/provider-deepseek/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { MemoryRecordingSink } from "../src/runtime/model-recording.ts";

afterEach(() => {
  vi.restoreAllMocks();
});
describe("DeepSeek fixture transport through runtime, files, recording and replay", () => {
  it.each(["idle", "close"] as const)(
    "%s waits for a cancelled exchange's recording finalization",
    async (method) => {
      const directory = mkdtempSync(join(tmpdir(), "moyyi-deepseek-cancel-"));
      const workspace = join(directory, "workspace");
      mkdirSync(workspace);
      const memory = new MemoryRecordingSink();
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const synthetic = fixtureTransport([
        deepSeekFixture([{ type: "message", text: "Retain partial text" }]),
      ]);
      const runtime = await createRuntime({
        model: deepSeekProfile.origin,
        dataDirectory: join(directory, "data"),
        deepseek: { transport: synthetic.transport },
        modelRecording: {
          apiProfile: DEEPSEEK_API_PROFILE,
          source: "synthetic",
          sink: {
            async write(recording, writeId) {
              entered.resolve();
              await release.promise;
              await memory.write(recording, writeId);
            },
            invalidate: (writeId) => memory.invalidate(writeId),
          },
        },
      });
      try {
        const finished = Promise.withResolvers<RunOutcome>();
        let sessionId: SessionId | undefined;
        runtime.subscribe((event) => {
          if (event.type === "session.ready") sessionId = event.sessionId;
          if (event.type === "assistant.delta")
            void runtime.send({ type: "run.cancel", runId: event.runId });
          if (event.type === "run.finished") finished.resolve(event.outcome);
        });
        await runtime.send({ type: "session.create", workspaceRoot: workspace });
        if (!sessionId) throw Error("Missing session");
        await runtime.send({
          type: "run.start",
          sessionId,
          input: [{ type: "text", text: "Answer briefly" }],
        });
        await entered.promise;
        let settled = false;
        const drained = runtime[method]().then(() => {
          settled = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
        expect(memory.records).toHaveLength(0);
        release.resolve();
        await drained;
        expect(await finished.promise).toEqual({ kind: "cancelled" });
        expect(memory.records).toHaveLength(1);
        expect(memory.records[0]?.events.at(-1)).toMatchObject({
          type: "error",
          error: { kind: "cancelled", partialOutput: true },
        });
        expect(synthetic.requests).toHaveLength(1);
      } finally {
        release.resolve();
        await runtime.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  it("executes two real file tools, persists their results and reproduces the run without network", async () => {
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(Error("Network forbidden in this test"));
    const result = await runRoundTrip();
    assertEquivalent(result);
    expect(result.first.outcome).toEqual({ kind: "completed" });
    expect(result.first.results.map((part) => part.status)).toEqual(["succeeded", "succeeded"]);
    expect(result.first.effectStates).toEqual(["succeeded", "succeeded"]);
    expect(result.records).toHaveLength(3);
    expect(result.wireRequests).toHaveLength(3);
    expect(network).not.toHaveBeenCalled();
    expect(fileResultValue<FileRead>(result.first.results[1]).text).toBe(fixtureText);
    expect(JSON.stringify(result.first.assistantContent)).toContain(finalAnswer);
    for (const index of [1, 2]) {
      const input = result.wireRequests[index]?.input as {
        type: string;
        call_id?: string;
        content?: unknown;
        output?: readonly { type: "input_text"; text: string }[];
      }[];
      expect(input.some((part) => part.type === "reasoning")).toBe(true);
      expect(input.some((part) => part.type === "function_call_output")).toBe(true);
      for (const part of input.filter((part) => part.type === "function_call_output")) {
        expect(Array.isArray(part.output)).toBe(true);
        expect(part.output?.every((item) => item.type === "input_text")).toBe(true);
      }
    }
    expect(JSON.stringify(result.wireRequests[2])).toContain("Hello moyyi");
    expect(result.records.every((record) => record.meta.source === "synthetic")).toBe(true);
  });

  it("fails a changed replay request without live fallback", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Network forbidden"));
    const result = await runRoundTrip({ replayInput: "A different instruction" });
    expect(result.first.outcome.kind).toBe("completed");
    expect(result.replay.outcome.kind).toBe("failed");
    expect(result.replay.results).toEqual([]);
    expect(result.transportCallsAfterReplay).toBe(3);
    expect(network).not.toHaveBeenCalled();
  });

  it("re-executes tools during replay and rejects changed file content at the next model request", async () => {
    const result = await runRoundTrip({
      beforeReplay(workspace) {
        writeFileSync(join(workspace, "README.md"), "changed fixture contents\n");
      },
    });
    expect(result.first.outcome.kind).toBe("completed");
    expect(result.replay.outcome.kind).toBe("failed");
    expect(result.replay.results).toHaveLength(2);
    expect(JSON.stringify(result.replay.results)).toContain("changed fixture contents");
    expect(result.transportCallsAfterReplay).toBe(3);
  });

  it("excludes a recording sink inside the workspace and cannot read the captured prompt", async () => {
    const result = await runRoundTrip({
      recordingInsideWorkspace: true,
      responses: successfulFixtures("recordings/exchange-00000000.json"),
    });
    assertEquivalent(result);
    expect(result.first.outcome.kind).toBe("completed");
    expect(result.first.results[1]?.status).toBe("failed");
    const list = result.first.results[0]?.content[0];
    if (list?.type !== "text") throw Error("Missing list output");
    expect(
      JSON.parse(list.text).entries.some((entry: { path: string }) => entry.path === "recordings"),
    ).toBe(false);
    expect(JSON.stringify(result.first.results)).not.toContain("requestHash");
    expect(result.first.events.some((event) => event.type === "approval.requested")).toBe(false);
  });

  it.each([
    {
      label: "reported",
      usage: undefined,
      expectedUsage: {
        status: "final",
        inputTokens: 20,
        outputTokens: 8,
        cacheReadTokens: 4,
        cacheWriteTokens: null,
        reasoningTokens: 3,
      },
    },
    { label: "unknown", usage: null, expectedUsage: UNKNOWN_USAGE },
  ])(
    "records and replays a pre-final output cap with $label usage without retry or execution",
    async ({ usage, expectedUsage }) => {
      const response = deepSeekFixture([{ type: "message", text: "Only a partial answer." }], {
        responseId: "fixture_partial",
        status: "incomplete",
        incompleteReason: "max_output_tokens",
        usage,
      });
      const result = await runRoundTrip({ responses: [response] });
      assertEquivalent(result);
      expect(result.first.outcome).toEqual({
        kind: "budget_exhausted",
        budget: "model_output_tokens",
      });
      expect(result.first.results).toEqual([]);
      expect(result.first.effectStates).toEqual([]);
      expect(result.records).toHaveLength(1);
      expect(result.wireRequests).toHaveLength(1);
      expect(result.wireRequests[0]?.tool_choice).not.toBe("none");
      expect(result.records[0]?.events.at(-1)).toMatchObject({
        type: "completed",
        stopReason: "max_tokens",
        usage: expectedUsage,
      });
      for (const session of [result.first, result.replay]) {
        const assistant = session.entries.filter(
          (entry) => entry.body.kind === "assistant_message",
        );
        expect(assistant).toHaveLength(1);
        expect(assistant[0]?.body).toMatchObject({
          content: [{ type: "text", text: "Only a partial answer." }],
          stopReason: "max_tokens",
          providerStopReason: {
            status: "incomplete",
            incompleteReason: "max_output_tokens",
            responseId: "fixture_partial",
          },
          usage: expectedUsage,
        });
        expect(
          session.entries.some(
            (entry) => entry.body.kind === "notice" && entry.body.code === "model_retry",
          ),
        ).toBe(false);
      }
    },
  );

  it.each([
    { label: "empty", items: [], content: [] },
    {
      label: "whitespace",
      items: [{ type: "message" as const, text: " \n\t" }],
      content: [{ type: "text", text: " \n\t" }],
    },
    {
      label: "reasoning-only",
      items: [{ type: "reasoning" as const, text: "Unfinished reasoning" }],
      content: [{ type: "reasoning", text: "Unfinished reasoning" }],
    },
  ])(
    "records and replays a failed $label completed stream instead of reporting task completion",
    async ({ items, content }) => {
      const result = await runRoundTrip({ responses: [deepSeekFixture(items)] });
      assertEquivalent(result);
      expect(result.first.outcome).toEqual({
        kind: "failed",
        reason: "Model response contained no answer text",
      });
      expect(result.first.results).toEqual([]);
      expect(result.first.effectStates).toEqual([]);
      expect(result.records).toHaveLength(1);
      expect(result.wireRequests).toHaveLength(1);
      expect(result.records[0]?.events.at(-1)).toMatchObject({
        type: "completed",
        stopReason: "end_turn",
      });
      for (const session of [result.first, result.replay]) {
        expect(
          session.entries.find((entry) => entry.body.kind === "assistant_message")?.body,
        ).toMatchObject({
          content,
          stopReason: "end_turn",
          providerStopReason: { status: "completed", incompleteReason: null },
          usage: { status: "final", inputTokens: 20, outputTokens: 8 },
        });
      }
    },
  );

  it("records a broken SSE prefix as partial error and faithfully replays its failed outcome", async () => {
    const response = deepSeekFixture([{ type: "message", text: "Retain this partial text." }]);
    const cut = response.findIndex((event) => event.type === "response.output_text.delta");
    const result = await runRoundTrip({ responses: [response.slice(0, cut + 1)] });
    assertEquivalent(result);
    expect(result.first.outcome.kind).toBe("failed");
    expect(result.first.results).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.events.at(-1)).toMatchObject({
      type: "error",
      error: { partialOutput: true, usage: { status: "unknown" } },
    });
  });

  it("rejects mismatched model/profile and contradictory live replay configuration at creation", async () => {
    const { records } = await runRoundTrip();
    const directory = mkdtempSync(join(tmpdir(), "moyyi-deepseek-invalid-"));
    try {
      await expect(
        createRuntime({
          dataDirectory: join(directory, "wrong-model"),
          model: { provider: "deepseek", model: "wrong-model" },
          modelReplay: { records, apiProfile: DEEPSEEK_API_PROFILE },
        }),
      ).rejects.toThrow(/not registered/);
      await expect(
        createRuntime({
          dataDirectory: join(directory, "wrong-profile"),
          model: deepSeekProfile.origin,
          modelReplay: { records, apiProfile: "different-profile" },
        }),
      ).rejects.toThrow(/profile/);
      await expect(
        createRuntime({
          dataDirectory: join(directory, "obsolete-wire-profile"),
          model: deepSeekProfile.origin,
          modelReplay: { records, apiProfile: "deepseek-responses-text-v1-2026-10-25" },
        }),
      ).rejects.toThrow(/profile/);
      const forbidden = vi.fn(async () => {
        throw Error("must not run");
      });
      await expect(
        createRuntime({
          dataDirectory: join(directory, "contradictory"),
          model: deepSeekProfile.origin,
          modelReplay: { records, apiProfile: DEEPSEEK_API_PROFILE },
          deepseek: { transport: forbidden },
        }),
      ).rejects.toThrow(/combined/);
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
