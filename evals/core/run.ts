import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ActionDigest,
  type EffectClass,
  type EffectId,
  type EffectRecord,
  type EntryId,
  type ModelStreamEvent,
  type Plugin,
  type RunId,
  type RunLimits,
  type RunOutcome,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  type ToolResultPart,
  type TranscriptEntry,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";

interface Evidence {
  readonly modelRequests: number;
  readonly preparations: number;
  readonly executions: number;
  readonly outcome: RunOutcome | null;
  readonly effectStates: readonly string[];
  readonly resultStatuses: readonly string[];
}
interface Observation {
  readonly evidence: Evidence;
  readonly entries: readonly TranscriptEntry[];
  readonly results: readonly ToolResultPart[];
  readonly events: readonly RuntimeEvent[];
  readonly requests: ReturnType<typeof scriptedProvider>["client"]["requests"];
  readonly retryDelays: readonly number[];
}
interface Scenario {
  readonly id: string;
  readonly responses: readonly (readonly ModelStreamEvent[])[];
  readonly effect?: EffectClass;
  readonly cancelBeforeExecution?: boolean;
  readonly cancelOnAssistantDelta?: boolean;
  readonly cancelAfterAssistantCommit?: boolean;
  readonly cancelAfterToolResultCommit?: boolean;
  readonly limits?: Partial<RunLimits>;
  check(observation: Observation): void;
}

const terminal = (
  stopReason: Extract<ModelStreamEvent, { type: "completed" }>["stopReason"],
): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const finalAnswer: readonly ModelStreamEvent[] = [
  {
    type: "part_completed",
    index: 0,
    part: { type: "text", text: "The synthetic scenario has finished." },
  },
  terminal("end_turn"),
];
const call = (
  rawArguments = '{"a":2,"b":3}',
  callId = "call_eval_1",
): readonly ModelStreamEvent[] => [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: callId as ToolCallId,
      providerCallId: callId,
      providerItemId: null,
      name: "eval_add",
      rawArguments,
      argumentsSource: "verbatim",
    },
  },
  terminal("tool_use"),
];
const transient = (partialOutput: boolean): ModelStreamEvent => ({
  type: "error",
  error: {
    kind: "rate_limited",
    message: "Synthetic transient failure",
    partialOutput,
    usage: UNKNOWN_USAGE,
    retryAfterMs: 0,
  },
});
const noExecution = ({ evidence }: Observation) => {
  assert.equal(evidence.preparations, 0);
  assert.equal(evidence.executions, 0);
  assert.deepEqual(evidence.effectStates, []);
};
const noRetry = (observation: Observation) => {
  noExecution(observation);
  assert.equal(observation.evidence.modelRequests, 1);
  assert.equal(observation.evidence.outcome?.kind, "failed");
  assert.ok(
    observation.entries.some(
      (entry) => entry.body.kind === "assistant_message" && entry.body.stopReason === "interrupted",
    ),
  );
};

const budgetExhausted = { kind: "budget_exhausted", budget: "model_requests" } as const;
function checkBudgetPrompts(observation: Observation, maximum: number): void {
  const notices = observation.entries.flatMap((entry) =>
    entry.body.kind === "notice" && entry.body.code === "model_request_budget"
      ? [entry.body.text]
      : [],
  );
  assert.equal(notices.length, observation.requests.length);
  for (const [index, request] of observation.requests.entries()) {
    const remaining = maximum - index;
    const prefix = `Model request budget: attempt ${index + 1} of ${maximum}; ${remaining} request(s) remaining including this one.`;
    assert.ok(notices[index]?.startsWith(prefix), "Persist the actual attempt allowance");
    assert.ok(
      notices[index]?.includes(`${remaining - 1} tool-enabled request(s) remain`),
      "Report actual tool opportunities separately from the reserved answer",
    );
    if (remaining === 2) {
      assert.ok(notices[index]?.includes("last tool-enabled request"));
      assert.ok(notices[index]?.includes("artifact"));
    }
    const latest = request.messages.at(-1);
    assert.equal(latest?.role, "user");
    assert.ok(
      latest?.content.some((part) => part.type === "text" && part.text.includes(prefix)),
      "The current request must carry the current budget next to user content",
    );
    assert.deepEqual(request.system, observation.requests[0]?.system);
    assert.ok(request.tools.some((tool) => tool.name === "eval_add"));
    assert.equal(request.toolChoice, remaining === 1 ? "none" : undefined);
  }
}

function checkNoFinalAnswer(observation: Observation): void {
  noExecution(observation);
  assert.equal(observation.evidence.modelRequests, 1);
  assert.deepEqual(observation.evidence.outcome, budgetExhausted);
  assert.deepEqual(observation.retryDelays, []);
  checkBudgetPrompts(observation, 1);
}

const scenarios: readonly Scenario[] = [
  {
    id: "tool-result-model-loop",
    responses: [call(), finalAnswer],
    check(observation) {
      const { evidence, results, requests } = observation;
      assert.deepEqual(evidence, {
        modelRequests: 2,
        preparations: 1,
        executions: 1,
        outcome: { kind: "completed" },
        effectStates: ["succeeded"],
        resultStatuses: ["succeeded"],
      });
      assert.deepEqual(results[0]?.content, [{ type: "text", text: "5" }]);
      assert.ok(
        requests[1]?.messages.some((message) =>
          message.content.some(
            (part) =>
              part.type === "tool_result" &&
              part.callId === "call_eval_1" &&
              part.status === "succeeded",
          ),
        ),
      );
    },
  },
  {
    id: "default-write-denial",
    effect: "workspace_write",
    responses: [call(), finalAnswer],
    check(observation) {
      noExecution(observation);
      assert.deepEqual(observation.evidence.resultStatuses, ["denied"]);
      assert.equal(observation.evidence.outcome?.kind, "completed");
    },
  },
  {
    id: "invalid-arguments-denial",
    responses: [call('{"a":"invalid","b":3}'), finalAnswer],
    check(observation) {
      noExecution(observation);
      assert.deepEqual(observation.evidence.resultStatuses, ["failed"]);
      assert.equal(observation.evidence.outcome?.kind, "completed");
    },
  },
  {
    id: "cancel-before-start-barrier",
    responses: [call()],
    cancelBeforeExecution: true,
    check({ evidence, events }) {
      assert.equal(evidence.executions, 0);
      assert.equal(evidence.preparations, 1);
      assert.deepEqual(evidence.effectStates, ["cancelled"]);
      assert.deepEqual(evidence.resultStatuses, ["cancelled"]);
      assert.equal(evidence.outcome?.kind, "cancelled");
      assert.ok(
        !events.some(
          (event) => event.type === "effect.updated" && event.effect.state === "started",
        ),
      );
    },
  },
  {
    id: "empty-transient-error-retries",
    responses: [[transient(false)], finalAnswer],
    check(observation) {
      noExecution(observation);
      assert.equal(observation.evidence.modelRequests, 2);
      assert.equal(observation.evidence.outcome?.kind, "completed");
      assert.equal(
        observation.entries.filter(
          (entry) => entry.body.kind === "notice" && entry.body.code === "model_retry",
        ).length,
        1,
      );
    },
  },
  {
    id: "partial-delta-error-never-retries",
    responses: [
      [{ type: "text_delta", index: 0, text: "Retain this partial answer." }, transient(true)],
    ],
    check(observation) {
      noRetry(observation);
      assert.ok(
        observation.entries.some(
          (entry) =>
            entry.body.kind === "assistant_message" &&
            entry.body.content.some(
              (part) => part.type === "text" && part.text === "Retain this partial answer.",
            ),
        ),
      );
    },
  },
  { id: "declared-partial-error-never-retries", responses: [[transient(true)]], check: noRetry },
  {
    id: "request-budget-stops-loop",
    responses: [call(), finalAnswer],
    limits: { maxModelRequests: 1 },
    check(observation) {
      checkNoFinalAnswer(observation);
      assert.deepEqual(observation.evidence.resultStatuses, ["denied"]);
      assert.ok(!observation.events.some((event) => event.type === "approval.requested"));
    },
  },
  {
    id: "budget-reserves-third-request-for-answer",
    responses: [call(), call('{"a":4,"b":5}', "call_eval_2"), finalAnswer],
    limits: { maxModelRequests: 3, maxRetries: 0 },
    check(observation) {
      const { evidence, requests } = observation;
      assert.equal(evidence.modelRequests, 3);
      assert.equal(evidence.preparations, 2);
      assert.equal(evidence.executions, 2);
      assert.deepEqual(evidence.outcome, { kind: "completed" });
      assert.deepEqual(evidence.resultStatuses, ["succeeded", "succeeded"]);
      assert.deepEqual(
        requests[2]?.messages.flatMap((message) =>
          message.content.filter((part) => part.type === "tool_result").map((part) => part.callId),
        ),
        ["call_eval_1", "call_eval_2"],
      );
      checkBudgetPrompts(observation, 3);
    },
  },
  {
    id: "one-request-budget-can-answer-directly",
    responses: [finalAnswer],
    limits: { maxModelRequests: 1 },
    check(observation) {
      noExecution(observation);
      assert.equal(observation.evidence.modelRequests, 1);
      assert.deepEqual(observation.evidence.outcome, { kind: "completed" });
      checkBudgetPrompts(observation, 1);
    },
  },
  {
    id: "one-request-budget-refusal-is-an-answer",
    responses: [
      [
        { type: "part_completed", index: 0, part: { type: "refusal", text: "Cannot verify it." } },
        terminal("refusal"),
      ],
    ],
    limits: { maxModelRequests: 1 },
    check(observation) {
      noExecution(observation);
      assert.equal(observation.evidence.modelRequests, 1);
      assert.deepEqual(observation.evidence.outcome, { kind: "completed" });
      checkBudgetPrompts(observation, 1);
    },
  },
  {
    id: "last-request-write-call-cannot-start",
    responses: [call(), finalAnswer],
    effect: "workspace_write",
    limits: { maxModelRequests: 1 },
    check(observation) {
      checkNoFinalAnswer(observation);
      assert.deepEqual(observation.evidence.resultStatuses, ["denied"]);
      assert.ok(!observation.events.some((event) => event.type === "approval.requested"));
    },
  },
  {
    id: "last-request-empty-answer-is-not-completion",
    responses: [[terminal("end_turn")]],
    limits: { maxModelRequests: 1 },
    check: checkNoFinalAnswer,
  },
  {
    id: "last-request-whitespace-is-not-completion",
    responses: [
      [
        { type: "part_completed", index: 0, part: { type: "text", text: " \n\t" } },
        terminal("end_turn"),
      ],
    ],
    limits: { maxModelRequests: 1 },
    check: checkNoFinalAnswer,
  },
  {
    id: "last-request-truncation-is-not-completion",
    responses: [
      [
        { type: "part_completed", index: 0, part: { type: "text", text: "Partial explanation" } },
        terminal("max_tokens"),
      ],
    ],
    limits: { maxModelRequests: 1 },
    check(observation) {
      noExecution(observation);
      assert.equal(observation.evidence.modelRequests, 1);
      assert.deepEqual(observation.evidence.outcome, {
        kind: "budget_exhausted",
        budget: "model_output_tokens",
      });
      assert.deepEqual(observation.retryDelays, []);
      checkBudgetPrompts(observation, 1);
    },
  },
  {
    id: "last-request-other-stop-is-not-completion",
    responses: [
      [
        { type: "part_completed", index: 0, part: { type: "text", text: "Unproven ending" } },
        terminal("other"),
      ],
    ],
    limits: { maxModelRequests: 1 },
    check: checkNoFinalAnswer,
  },
  ...(["end_turn", "max_tokens", "other", "interrupted"] as const).map(
    (stopReason): Scenario => ({
      id: `early-${stopReason}-without-complete-answer`,
      responses: [
        [
          {
            type: "part_completed",
            index: 0,
            part: { type: "text", text: stopReason === "end_turn" ? " \n" : "Partial answer" },
          },
          terminal(stopReason),
        ],
        finalAnswer,
      ],
      limits: { maxModelRequests: 4, maxRetries: 2 },
      check(observation) {
        noExecution(observation);
        assert.equal(observation.evidence.modelRequests, 1);
        assert.deepEqual(observation.retryDelays, []);
        assert.deepEqual(
          observation.evidence.outcome,
          stopReason === "max_tokens"
            ? { kind: "budget_exhausted", budget: "model_output_tokens" }
            : {
                kind: "failed",
                reason:
                  stopReason === "end_turn"
                    ? "Model response contained no answer text"
                    : `Model response did not complete (stop reason: ${stopReason})`,
              },
        );
        const assistant = observation.entries.find(
          (entry) => entry.body.kind === "assistant_message",
        );
        assert.equal(assistant?.body.kind, "assistant_message");
        if (assistant?.body.kind === "assistant_message") {
          assert.equal(assistant.body.stopReason, stopReason);
          assert.deepEqual(assistant.body.usage, UNKNOWN_USAGE);
          assert.deepEqual(assistant.body.content, [
            { type: "text", text: stopReason === "end_turn" ? " \n" : "Partial answer" },
          ]);
        }
      },
    }),
  ),
  {
    id: "retry-consumes-allowance-before-final-answer",
    responses: [[transient(false)], call(), finalAnswer],
    limits: { maxModelRequests: 3, maxRetries: 1 },
    check(observation) {
      assert.equal(observation.evidence.modelRequests, 3);
      assert.equal(observation.evidence.executions, 1);
      assert.deepEqual(observation.evidence.outcome, { kind: "completed" });
      assert.deepEqual(observation.retryDelays, [0]);
      checkBudgetPrompts(observation, 3);
    },
  },
  {
    id: "last-request-error-has-no-retry-or-backoff",
    responses: [[transient(false)], finalAnswer],
    limits: { maxModelRequests: 1, maxRetries: 2 },
    check(observation) {
      noRetry(observation);
      assert.deepEqual(observation.retryDelays, []);
      assert.ok(
        !observation.entries.some(
          (entry) => entry.body.kind === "notice" && entry.body.code === "model_retry",
        ),
      );
      checkBudgetPrompts(observation, 1);
    },
  },
  {
    id: "cancel-final-answer-does-not-reserve-extra-request",
    responses: [
      [{ type: "text_delta", index: 0, text: "Unfinished answer" }, ...finalAnswer],
      finalAnswer,
    ],
    limits: { maxModelRequests: 1 },
    cancelOnAssistantDelta: true,
    check(observation) {
      noExecution(observation);
      assert.equal(observation.evidence.modelRequests, 1);
      assert.deepEqual(observation.evidence.outcome, { kind: "cancelled" });
      assert.deepEqual(observation.retryDelays, []);
      assert.ok(
        observation.entries.some(
          (entry) =>
            entry.body.kind === "assistant_message" && entry.body.stopReason === "interrupted",
        ),
      );
      checkBudgetPrompts(observation, 1);
    },
  },
  {
    id: "cancel-final-tool-after-assistant-commit",
    responses: [call(), finalAnswer],
    limits: { maxModelRequests: 1 },
    cancelAfterAssistantCommit: true,
    check(observation) {
      noExecution(observation);
      assert.equal(observation.evidence.modelRequests, 1);
      assert.deepEqual(observation.evidence.outcome, { kind: "cancelled" });
      assert.deepEqual(observation.evidence.resultStatuses, ["cancelled"]);
      assert.deepEqual(observation.retryDelays, []);
      checkBudgetPrompts(observation, 1);
    },
  },
  {
    id: "cancel-final-tool-after-denial-commit",
    responses: [call(), finalAnswer],
    limits: { maxModelRequests: 1 },
    cancelAfterToolResultCommit: true,
    check(observation) {
      noExecution(observation);
      assert.equal(observation.evidence.modelRequests, 1);
      assert.deepEqual(observation.evidence.outcome, { kind: "cancelled" });
      assert.deepEqual(observation.evidence.resultStatuses, ["denied"]);
      assert.deepEqual(observation.retryDelays, []);
      checkBudgetPrompts(observation, 1);
    },
  },
];

async function runScenario(scenario: Scenario): Promise<Observation> {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-core-eval-"));
  let runtime: Runtime | undefined;
  try {
    const workspace = join(directory, "workspace");
    mkdirSync(workspace);
    const provider = scriptedProvider(scenario.responses);
    let preparations = 0;
    let executions = 0;
    const retryDelays: number[] = [];
    const synthetic: Plugin = {
      name: "eval-arithmetic",
      apiVersion: 1,
      setup(host) {
        host.registerTool({
          name: "eval_add",
          description: "Synthetic bounded arithmetic; no external effects.",
          inputSchema: {
            type: "object",
            properties: {
              a: { type: "integer", minimum: -1000, maximum: 1000 },
              b: { type: "integer", minimum: -1000, maximum: 1000 },
            },
            required: ["a", "b"],
            additionalProperties: false,
          },
          effect: {
            class: scenario.effect ?? "read",
            reversibility: "not_applicable",
            verification: "not_applicable",
          },
          async prepare(args) {
            preparations++;
            return {
              digest: "core-replaces-this" as ActionDigest,
              summary: "Synthetic addition",
              preconditions: [],
              payload: args,
            };
          },
          async execute(action) {
            executions++;
            const { a, b } = action.payload as { a: number; b: number };
            return { status: "succeeded", content: [{ type: "text", text: String(a + b) }] };
          },
        });
      },
    };
    runtime = await createRuntime({
      dataDirectory: join(directory, "data"),
      model: scriptedProfile.origin,
      plugins: [{ plugin: provider.plugin }, { plugin: synthetic }],
      ...(scenario.limits ? { limits: scenario.limits } : {}),
      scheduler: {
        async sleep(milliseconds, signal) {
          assert.ok(!signal.aborted, "Never schedule retry after cancellation");
          retryDelays.push(milliseconds);
        },
        deadline(milliseconds, callback) {
          const timer = setTimeout(callback, milliseconds);
          return () => clearTimeout(timer);
        },
      },
    });
    assert.ok(
      runtime.plugins.every((plugin) => plugin.state === "loaded"),
      "Scenario plugins must load",
    );
    const events: RuntimeEvent[] = [];
    const committedEffects = new Map<EffectId, EffectRecord>();
    const loadedEntries = new Map<EntryId, TranscriptEntry>();
    let loadingSession = false;
    let sessionId: SessionId | undefined;
    let runId: RunId | undefined;
    let outcome: RunOutcome | null = null;
    runtime.subscribe((event) => {
      events.push(event);
      if (event.type === "session.ready") sessionId = event.sessionId;
      if (event.type === "run.started") runId = event.runId;
      if (event.type === "run.finished") outcome = event.outcome;
      if (event.type === "effect.updated") committedEffects.set(event.effect.id, event.effect);
      if (loadingSession && event.type === "entry.appended")
        loadedEntries.set(event.entry.id, event.entry);
      if (
        ((scenario.cancelBeforeExecution &&
          event.type === "effect.updated" &&
          event.effect.state === "intended") ||
          (scenario.cancelOnAssistantDelta && event.type === "assistant.delta") ||
          (scenario.cancelAfterAssistantCommit &&
            !loadingSession &&
            event.type === "entry.appended" &&
            event.entry.body.kind === "assistant_message") ||
          (scenario.cancelAfterToolResultCommit &&
            !loadingSession &&
            event.type === "entry.appended" &&
            event.entry.body.kind === "tool_results")) &&
        runId
      ) {
        void runtime?.send({ type: "run.cancel", runId });
      }
    });
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    assert.ok(sessionId, "Session must be created");
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Run the synthetic arithmetic scenario." }],
    });
    await runtime.idle();
    // Re-read transcript through the public protocol, independently of live append events.
    // Effect states are commit-acknowledgement events, not direct database inspection.
    loadingSession = true;
    await runtime.send({ type: "session.load", sessionId });
    loadingSession = false;
    assert.ok(
      !events.some((event) => event.type === "command.rejected"),
      "Scenario command was rejected",
    );
    assert.equal(
      events.filter((event) => event.type === "run.finished").length,
      1,
      "Run must have one outcome",
    );
    const entries = [...loadedEntries.values()];
    assert.ok(entries.length > 0, "Session load must return recorded entries");
    const results = entries.flatMap((entry) =>
      entry.body.kind === "tool_results" ? entry.body.results : [],
    );
    const calls = entries.flatMap((entry) =>
      entry.body.kind === "assistant_message"
        ? entry.body.content.filter((part) => part.type === "tool_call")
        : [],
    );
    for (const call of calls)
      assert.equal(
        results.filter((result) => result.callId === call.callId).length,
        1,
        "Every recorded call needs exactly one result",
      );
    assert.equal(results.length, calls.length, "No orphan tool result");
    const evidence: Evidence = {
      modelRequests: provider.client.requests.length,
      preparations,
      executions,
      outcome,
      effectStates: [...committedEffects.values()].map((effect) => effect.state),
      resultStatuses: results.map((result) => result.status),
    };
    return { evidence, entries, results, events, requests: provider.client.requests, retryDelays };
  } finally {
    try {
      await runtime?.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

const results: { id: string; passed: boolean; evidence?: Evidence; error?: string }[] = [];
console.log(
  "Deterministic core conformance: real runtime + SQLite, scripted model, synthetic tools.",
);
console.log("This is execution-contract evidence, not a model task-capability score.");
console.log(
  "Evidence: session.load transcript, committed effect events, run.finished outcome, and synthetic execution counts; no direct database inspection.",
);
for (const scenario of scenarios) {
  let observation: Observation | undefined;
  try {
    observation = await runScenario(scenario);
    scenario.check(observation);
    results.push({ id: scenario.id, passed: true, evidence: observation.evidence });
    console.log(`PASS ${scenario.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      id: scenario.id,
      passed: false,
      ...(observation ? { evidence: observation.evidence } : {}),
      error: message,
    });
    console.error(`FAIL ${scenario.id}: ${message}`);
  }
}
const passed = results.filter((result) => result.passed).length;
const report = {
  kind: "deterministic-core-conformance",
  modelCapabilityScore: false,
  evidenceScope: {
    transcript: "session.load entry.appended events, deduplicated by entry ID",
    effects: "effect.updated events emitted after commit",
    outcome: "run.finished protocol event; not a database run-status query",
    execution: "synthetic tool counters and scripted-provider request records",
    directDatabaseInspection: false,
  },
  generatedAt: new Date().toISOString(),
  passed,
  total: results.length,
  results,
};
const destination = fileURLToPath(new URL("../results/core.json", import.meta.url));
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`${passed}/${results.length} scenarios passed. Report: ${destination}`);
if (passed !== results.length) process.exitCode = 1;
