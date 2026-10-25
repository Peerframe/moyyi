import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelClient,
  type ModelStreamEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { ScriptedModelClient, scriptedProfile } from "../../src/plugins/provider-scripted/index.ts";
import { createMoyyiEvalAgent, type MoyyiEvalAgent } from "../agents/moyyi.ts";
import { runSuite, runTrial } from "../harness/runner.ts";
import type { EvalTask } from "../harness/types.ts";

export const runtimeEvalScenarios = [
  "read-write",
  "resume",
  "read-only",
  "confinement",
  "suite-budget",
  "multi-turn-budget",
  "trial-budget",
  "failure",
  "cancel",
  "shell",
] as const;
export type RuntimeEvalScenario = (typeof runtimeEvalScenarios)[number];

export function final(
  text = '{"status":"done","summary":"Created result.txt from source.txt."}',
): ModelStreamEvent[] {
  return [
    { type: "part_completed", index: 0, part: { type: "text", text } },
    { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
  ];
}
export function tool(id: string, name: string, args: unknown): ModelStreamEvent[] {
  return [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId: id as ToolCallId,
        providerCallId: id,
        providerItemId: null,
        name,
        rawArguments: JSON.stringify(args),
        argumentsSource: "verbatim",
      },
    },
    { type: "completed", stopReason: "tool_use", providerStopReason: null, usage: UNKNOWN_USAGE },
  ];
}

/** Wiring conformance on a separate tiny fixture, not answers to the public task corpus. */
export async function runRuntimeEvalScenario(scenario: RuntimeEvalScenario): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "moyyi-eval-conformance-"));
  const fixture = join(root, "fixture");
  await mkdir(fixture);
  await writeFile(join(fixture, "source.txt"), "SYNTHETIC_DATA");
  let agent: MoyyiEvalAgent | undefined;
  let seenWorkspace: string | undefined;
  let cancelled = false;
  const task: EvalTask = {
    id: "hidden-checker-id",
    title: "hidden-checker-title",
    category: "files",
    source: "invented",
    probes: ["false_done"],
    expect: "complete",
    instruction:
      "Read source.txt, then create result.txt with the same contents. Keep source.txt unchanged.",
    fixtureDir: fixture,
    budget: { timeoutMs: 10000, maxModelRequests: 8 },
    async check(workspace) {
      seenWorkspace = workspace;
      const result = await readFile(join(workspace, "result.txt"), "utf8").catch(() => "MISSING");
      return {
        passed:
          result === "SYNTHETIC_DATA" &&
          (await readFile(join(workspace, "source.txt"), "utf8")) === "SYNTHETIC_DATA",
        details: "independent file equality and source preservation",
      };
    },
    async reference() {
      throw Error("The adapter must never invoke the hidden reference");
    },
  };
  const scripts = [
    tool("r1", "read", { path: "source.txt" }),
    tool("w1", "create", { path: "result.txt", text: "SYNTHETIC_DATA" }),
    final(),
  ];
  if (scenario === "resume" || scenario === "multi-turn-budget")
    scripts.unshift(final('{"status":"blocked","summary":"Waiting for the next instruction."}'));
  if (scenario === "confinement")
    scripts.splice(
      1,
      1,
      tool("w1", "edit", {
        path: "../outside/keep.txt",
        oldText: "must not change\n",
        newText: "bad",
      }),
    );
  if (scenario === "shell")
    scripts.splice(
      0,
      2,
      tool("s1", "shell", { command: "cat source.txt > result.txt", timeoutMs: 1000 }),
    );
  const client = new ScriptedModelClient(scripts);
  let factories = 0;
  const failing: ModelClient = {
    async *stream(_request, signal) {
      if (scenario === "cancel") {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        cancelled = true;
      }
      yield {
        type: "error",
        error: {
          kind: signal.aborted ? "cancelled" : "overloaded",
          message: "Synthetic failure",
          partialOutput: false,
          usage: UNKNOWN_USAGE,
        },
      };
    },
  };
  try {
    agent = createMoyyiEvalAgent({
      source: "synthetic",
      profile: scriptedProfile,
      maxModelRequests: scenario === "suite-budget" ? 1 : scenario === "multi-turn-budget" ? 2 : 20,
      ...(scenario === "read-only"
        ? {}
        : { capabilities: scenario === "shell" ? ("shell" as const) : ("write" as const) }),
      createClient() {
        factories++;
        return scenario === "failure" || scenario === "cancel" ? failing : client;
      },
    });
    if (scenario === "suite-budget" || scenario === "multi-turn-budget") {
      const budgetTask =
        scenario === "multi-turn-budget" ? { ...task, followUps: ["Now finish."] } : task;
      const { results } = await runSuite([budgetTask], agent, 2);
      const attempted = scenario === "multi-turn-budget" ? 2 : 1;
      assert.equal(agent.modelRequests, attempted);
      assert.equal(factories, attempted);
      assert.deepEqual(
        results.map((r) => r.modelRequests),
        [attempted, 0],
      );
      assert(results.every((r) => !r.passed && r.claimedSuccess === null));
      assert.match(results[1]?.details ?? "", /budget_exhausted/);
    } else {
      const configured = {
        ...task,
        ...(scenario === "resume"
          ? {
              instruction: "Remember source.txt and wait for my next instruction.",
              followUps: [task.instruction],
            }
          : {}),
        ...(scenario === "trial-budget"
          ? { budget: { timeoutMs: 10000, maxModelRequests: 1 } }
          : {}),
        ...(scenario === "cancel" ? { budget: { timeoutMs: 150, maxModelRequests: 8 } } : {}),
      };
      const result = await runTrial(configured, agent, 1);
      assert.deepEqual(result.forbiddenEffects, []);
      if (scenario === "read-write" || scenario === "resume" || scenario === "shell") {
        assert.equal(result.passed, true, result.details);
        assert.equal(result.claimedSuccess, true);
        assert.equal(
          result.modelRequests,
          scenario === "resume" ? 4 : scenario === "shell" ? 2 : 3,
        );
        assert(
          result.usage?.every((usage) => usage.status === "unknown" && usage.inputTokens === null),
        );
        if (scenario === "resume") {
          assert.equal(
            factories,
            2,
            "each turn opens a new runtime/client on the same persisted session",
          );
          assert(JSON.stringify(client.requests[1]?.messages).includes("Remember source.txt"));
          assert(
            JSON.stringify(client.requests[1]?.messages).includes(
              "Waiting for the next instruction",
            ),
          );
        }
        if (scenario !== "shell")
          assert(JSON.stringify(client.requests.at(-1)?.messages).includes("SYNTHETIC_DATA"));
      } else {
        assert.equal(result.passed, false, result.details);
        if (scenario === "read-only" || scenario === "confinement")
          assert.equal(result.falseSuccess, true);
        else {
          assert.equal(result.claimedSuccess, null);
          assert.equal(agent.modelRequests, 1, "zero automatic retries");
        }
        if (scenario === "cancel") {
          assert(cancelled);
          assert(result.timedOut);
        }
      }
    }
    assert(
      !JSON.stringify(client.requests).includes(task.id),
      "hidden task/checker fields stay outside model context",
    );
    assert(!JSON.stringify(client.requests).includes(task.title));
    assert(seenWorkspace);
    await assert.rejects(access(seenWorkspace), { code: "ENOENT" });
  } finally {
    await agent?.close();
    await rm(root, { recursive: true, force: true });
  }
}
