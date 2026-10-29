import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ModelRequest, ToolCallPart, ToolResultPart } from "../../src/contracts/index.ts";
import { deepSeekProfile } from "../../src/plugins/provider-deepseek/index.ts";
import { createMoyyiEvalAgent } from "../agents/moyyi.ts";
import { runSuite } from "../harness/runner.ts";
import { tasks } from "../tasks/index.ts";
import { loadReplayFixture, manifest } from "./fixtures.ts";
import { type RequestDifference, SequenceReplayClient } from "./sequence-client.ts";

function toolHistory(request: ModelRequest): {
  calls: ToolCallPart[];
  results: { callId: string; status: ToolResultPart["status"] }[];
} {
  const parts = request.messages.flatMap((message) => message.content);
  return {
    calls: parts.filter((part): part is ToolCallPart => part.type === "tool_call"),
    results: parts.flatMap((part) =>
      part.type === "tool_result" ? [{ callId: part.callId, status: part.status }] : [],
    ),
  };
}

describe("delivery-one real recorded responses through the runtime", () => {
  const reports: {
    taskId: string;
    passed: boolean;
    requestDifferences: readonly RequestDifference[];
  }[] = [];
  afterAll(async () => {
    const directory = join(import.meta.dirname, "../results");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "replay-request-differences.json"),
      `${JSON.stringify(
        {
          measurement: "recorded-response-runtime-conformance",
          baselineCommit: manifest.baselineCommit,
          reports,
        },
        null,
        2,
      )}\n`,
    );
  });
  for (const scenario of manifest.scenarios)
    it(`${scenario.taskId}: original tool sequence and final-file checker`, async () => {
      const records = loadReplayFixture(scenario.taskId);
      const task = tasks.find((item) => item.id === scenario.taskId);
      expect(task).toBeDefined();
      if (!task) throw Error("Original task is unavailable");
      expect(records[0]?.request.messages[0]?.content[0]).toEqual({
        type: "text",
        text: task.instruction,
      });
      const client = new SequenceReplayClient(records);
      const fetch = vi.fn(() => {
        throw Error("Offline replay cannot use HTTP");
      });
      vi.stubGlobal("fetch", fetch);
      const agent = createMoyyiEvalAgent({
        source: "synthetic",
        profile: deepSeekProfile,
        createClient: () => client,
        capabilities: "write",
        maxModelRequests: task.budget.maxModelRequests,
      });
      try {
        const { results, summary } = await runSuite([task], agent, 1);
        reports.push({
          taskId: scenario.taskId,
          passed: results[0]?.passed ?? false,
          requestDifferences: client.requestDifferences,
        });
        expect(results).toHaveLength(1);
        expect(results[0], results[0]?.details).toMatchObject({
          passed: true,
          claimedSuccess: true,
          falseSuccess: false,
          forbiddenEffects: [],
          timedOut: false,
          modelRequests: scenario.requests,
        });
        expect(summary).toMatchObject({ tasks: 1, passAt1: 1, passAllK: 1 });
        client.assertConsumed();
        const actual = client.requests.at(-1);
        const original = records.at(-1)?.request;
        if (!actual || !original) throw Error("Replay did not reach its final request");
        const history = toolHistory(actual);
        const expected = toolHistory(original);
        expect(history.calls.map((call) => call.name)).toEqual(scenario.toolSequence);
        expect(history.calls).toEqual(expected.calls);
        // Read effects execute in parallel; completion order is not the model's call order.
        const byCall = (a: { callId: string }, b: { callId: string }) =>
          a.callId.localeCompare(b.callId);
        expect(history.results.sort(byCall)).toEqual(expected.results.sort(byCall));
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        await agent.close();
        vi.unstubAllGlobals();
      }
    });
});
