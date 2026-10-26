import { describe, expect, it } from "vitest";
import type { ContextInput, ModelProfile, TranscriptEntry } from "../contracts/index.ts";
import { effects, entries } from "../contracts/persisted/fixtures/v1.ts";
import { ContextCapacityError, MinimalContextBuilder } from "./index.ts";

const profile: ModelProfile = {
  origin: { provider: "scripted", model: "test" },
  contextWindowTokens: 100_000,
  maxOutputTokens: 1000,
  parallelToolCalls: true,
  reasoning: "visible",
  promptCache: "none",
  editFormat: "whole_file",
};
const textPath: readonly TranscriptEntry[] = entries.map((entry) =>
  entry.body.kind === "user_message"
    ? {
        ...entry,
        body: {
          ...entry.body,
          content: entry.body.content.filter((part) => part.type !== "image"),
        },
      }
    : entry,
);
const input = (change: Partial<ContextInput> = {}): ContextInput => ({
  path: textPath,
  profile,
  tools: [],
  sections: [],
  unsettledEffects: effects,
  ...change,
});

describe("MinimalContextBuilder", () => {
  it("extends user turns with durable budget notices without rewriting earlier prefixes", () => {
    const user = textPath[0];
    if (!user) throw Error("fixture");
    const notice: TranscriptEntry = {
      ...user,
      id: "budget_1" as TranscriptEntry["id"],
      body: { kind: "notice", code: "model_request_budget", text: "attempt 1 of 2" },
    };
    const later: TranscriptEntry = {
      ...notice,
      id: "budget_2" as TranscriptEntry["id"],
      body: { kind: "notice", code: "model_request_budget", text: "attempt 2 of 2" },
    };
    const builder = new MinimalContextBuilder();
    const first = builder.build(input({ path: [user, notice], unsettledEffects: [] })).request;
    const last = builder.build(
      input({
        path: [user, notice, ...textPath.slice(1, 3), later],
        unsettledEffects: [],
        toolChoice: "none",
      }),
    ).request;
    expect(first.messages).toHaveLength(1);
    expect(last.messages[0]).toEqual(first.messages[0]);
    expect(last.messages).toHaveLength(3);
    expect(last.messages[2]?.content.at(-1)).toEqual({
      type: "text",
      text: "Runtime notice (model_request_budget): attempt 2 of 2",
    });
    expect(last.toolChoice).toBe("none");
    expect(last.system).toEqual(first.system);
    expect(user.body).toEqual(textPath[0]?.body);
  });

  it("preserves interruption barriers while attaching a later budget notice", () => {
    const user = textPath[0];
    if (!user) throw Error("fixture");
    const barrier: TranscriptEntry = {
      ...user,
      id: "barrier" as TranscriptEntry["id"],
      body: { kind: "notice", code: "model_retry", text: "Previous attempt failed" },
    };
    const budget: TranscriptEntry = {
      ...user,
      id: "budget" as TranscriptEntry["id"],
      body: { kind: "notice", code: "model_request_budget", text: "attempt 2 of 2" },
    };
    const request = new MinimalContextBuilder().build(
      input({
        path: [user, barrier, budget],
        unsettledEffects: [],
      }),
    ).request;
    expect(request.messages.map((message) => message.role)).toEqual(["user", "user"]);
    expect(request.messages[1]?.content).toHaveLength(2);
    expect(JSON.stringify(request.messages[1])).toContain("Previous attempt failed");
  });

  it("projects recorded compaction without sending replaced replay or hiding unsettled effects", () => {
    const result = new MinimalContextBuilder().build(input());
    expect(result.report.includedEntryIds).toEqual(entries.slice(3).map((entry) => entry.id));
    expect(result.request.messages).toHaveLength(entries.length - 2);
    expect(JSON.stringify(result.request.messages[0])).toContain("User asked to fix range.js.");
    expect(JSON.stringify(result.request.messages)).not.toContain("signed_state");
    expect(JSON.stringify(result.request.messages.at(-1))).toContain(effects[0]?.id);
    expect(JSON.stringify(result.request.messages.at(-1))).toContain("Verify before retrying");
    expect(textPath).toHaveLength(entries.length);
  });

  it("retains replay on untouched assistant messages", () => {
    const result = new MinimalContextBuilder().build(input({ path: textPath.slice(0, 3) }));
    const assistant = textPath[1]?.body;
    if (assistant?.kind !== "assistant_message") throw new Error("fixture");
    expect(result.request.messages[1]?.replay).toBe(assistant.replay);
  });

  it("keeps tool definitions in deterministic name order", () => {
    const tools = ["z", "a"].map((name) => ({
      name,
      description: name,
      inputSchema: { type: "object" },
    }));
    const builder = new MinimalContextBuilder();
    expect(builder.build(input({ tools })).request).toEqual(
      builder.build(input({ tools: [...tools].reverse() })).request,
    );
  });

  it("orders sections by stability while keeping registration order within each group", () => {
    const section = (id: string, stability: "static" | "session" | "turn") => ({
      id,
      stability,
      content: [{ type: "text" as const, text: id }],
    });
    const result = new MinimalContextBuilder().build(
      input({
        sections: [
          section("turn", "turn"),
          section("z", "static"),
          section("session", "session"),
          section("a", "static"),
        ],
      }),
    );
    expect(result.request.system).toEqual(
      ["z", "a", "session", "turn"].map((text) => ({ type: "text", text })),
    );
  });

  it("includes all unsettled effects even with no transcript and keeps their evidence", () => {
    const result = new MinimalContextBuilder().build(input({ path: [] }));
    expect(result.request.messages).toHaveLength(1);
    expect(JSON.stringify(result.request.messages)).toContain("process exited after start");
    expect(result.report.includedEntryIds).toEqual([]);
  });

  it("fails explicitly rather than dropping history when the context is too small", () => {
    expect(() =>
      new MinimalContextBuilder().build(
        input({ profile: { ...profile, contextWindowTokens: 2000 } }),
      ),
    ).toThrow(ContextCapacityError);
    expect(textPath).toHaveLength(entries.length);
  });

  it("admits optional navigation only when the complete request fits without dropping required evidence", () => {
    const builder = new MinimalContextBuilder();
    const required = input({
      sections: [
        { id: "project", stability: "turn", content: [{ type: "text", text: "Required rules" }] },
      ],
      tools: [{ name: "read", description: "Read", inputSchema: { type: "object" } }],
      toolChoice: "none",
    });
    const baseline = builder.build(required);
    const baselineTokens = baseline.report.estimatedTokens;
    if (baselineTokens === undefined) throw Error("Expected context estimate");
    const navigation = {
      id: "navigation",
      stability: "turn" as const,
      optional: true,
      content: [{ type: "text" as const, text: "src/example.ts\n".repeat(20) }],
    };
    const withNavigation = { ...required, sections: [...required.sections, navigation] };
    const admitted = builder.build(withNavigation);
    expect(admitted.request.system).toContainEqual(navigation.content[0]);
    expect(admitted.report.estimatedTokens).toBeGreaterThan(baselineTokens);
    const constrained = builder.build({
      ...withNavigation,
      profile: { ...profile, contextWindowTokens: baselineTokens },
    });
    expect(constrained.request).toEqual(baseline.request);
    expect(constrained.report.includedEntryIds).toEqual(baseline.report.includedEntryIds);
    expect(constrained.report.summarizedEntryIds).toEqual(baseline.report.summarizedEntryIds);
    expect(constrained.report.notes).toContain(
      "Optional context omitted for capacity: navigation.",
    );
    expect(constrained.request.toolChoice).toBe("none");
    expect(() =>
      builder.build({
        ...withNavigation,
        profile: { ...profile, contextWindowTokens: baselineTokens - 1 },
      }),
    ).toThrow(ContextCapacityError);
    expect(withNavigation.sections).toContain(navigation);
  });

  it("does not make required instructions optional when supplemental sections are present", () => {
    expect(() =>
      new MinimalContextBuilder().build(
        input({
          profile: { ...profile, contextWindowTokens: 10_000 },
          sections: [
            {
              id: "required",
              stability: "static",
              content: [{ type: "text", text: "x".repeat(20_000) }],
            },
            {
              id: "navigation",
              stability: "turn",
              optional: true,
              content: [{ type: "text", text: "a.ts" }],
            },
          ],
        }),
      ),
    ).toThrow(ContextCapacityError);
  });

  it.each(["system", "tools", "maxOutput"])("charges %s against the capacity", (kind) => {
    const base = input({
      path: [],
      unsettledEffects: [],
      profile: { ...profile, contextWindowTokens: 2000, maxOutputTokens: 1 },
    });
    expect(() => new MinimalContextBuilder().build(base)).not.toThrow();
    const over =
      kind === "system"
        ? {
            ...base,
            sections: [
              {
                id: "large",
                stability: "static" as const,
                content: [{ type: "text" as const, text: "中".repeat(700) }],
              },
            ],
          }
        : kind === "tools"
          ? {
              ...base,
              tools: [
                { name: "read", description: "x".repeat(2000), inputSchema: { type: "object" } },
              ],
            }
          : { ...base, profile: { ...base.profile, maxOutputTokens: 2000 } };
    expect(() => new MinimalContextBuilder().build(over)).toThrow(ContextCapacityError);
  });

  it("rejects images until a provider-specific image budget exists", () => {
    expect(() => new MinimalContextBuilder().build(input({ path: entries.slice(0, 3) }))).toThrow(
      "Image context",
    );
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid token limits %s",
    (limit) => {
      expect(() =>
        new MinimalContextBuilder().build(
          input({ profile: { ...profile, maxOutputTokens: limit } }),
        ),
      ).toThrow("positive safe integers");
    },
  );
});

function plannerPath(
  firstTool: "none" | "paired" | "unpaired" | "unknown" = "none",
): readonly TranscriptEntry[] {
  const template = textPath[0];
  const assistant = textPath[1]?.body;
  if (!template || assistant?.kind !== "assistant_message") throw Error("fixture");
  const path: TranscriptEntry[] = [];
  const add = (body: TranscriptEntry["body"]) =>
    path.push({
      ...template,
      id: `plan_${path.length}` as TranscriptEntry["id"],
      parentId: path.at(-1)?.id ?? null,
      body,
    });
  const call = assistant.content.find((part) => part.type === "tool_call");
  if (!call) throw Error("fixture call");
  for (let turn = 0; turn < 5; turn++) {
    add({
      kind: "user_message",
      steering: false,
      content: [{ type: "text", text: `User turn ${turn}` }],
    });
    if (turn === 0 && firstTool !== "none") {
      add({ ...assistant, content: [call], stopReason: "tool_use" });
      if (firstTool !== "unpaired")
        add({
          kind: "tool_results",
          results: [
            {
              type: "tool_result",
              callId: call.callId,
              status: firstTool === "unknown" ? "unknown" : "succeeded",
              content: [{ type: "text", text: "Exact observed output" }],
            },
          ],
        });
    }
    add({
      ...assistant,
      content: [{ type: "text", text: `Answer ${turn}: ${"detail ".repeat(200)}` }],
      stopReason: "end_turn",
    });
  }
  return path;
}

it("plans complete tool pairs while stripping replay only from the quoted summary input", () => {
  const path = plannerPath("paired");
  const plan = new MinimalContextBuilder().planCompaction(input({ path, unsettledEffects: [] }));
  expect(plan).not.toBeNull();
  expect(JSON.stringify(plan?.request)).toContain("tool_call");
  expect(JSON.stringify(plan?.request)).toContain("Exact observed output");
  expect(JSON.stringify(plan?.request)).not.toContain("signed_state");
  expect(JSON.stringify(plan?.request)).not.toContain("User turn 3");
  expect(JSON.stringify(path)).toContain("signed_state");
});

it.each(["admitted", "omitted", "required-overflow"] as const)(
  "uses required context as the compaction baseline when optional navigation is %s",
  (capacity) => {
    const builder = new MinimalContextBuilder();
    const required = input({ path: plannerPath(), unsettledEffects: [] });
    const originalTokens = builder.build(required).report.estimatedTokens;
    if (originalTokens === undefined) throw Error("Expected context estimate");
    const navigation = {
      id: "navigation",
      stability: "turn" as const,
      optional: true,
      content: [{ type: "text" as const, text: "src/example.ts\n".repeat(1000) }],
    };
    const withNavigation = {
      ...required,
      sections: [navigation],
      profile: {
        ...profile,
        contextWindowTokens:
          capacity === "admitted"
            ? profile.contextWindowTokens
            : originalTokens - (capacity === "required-overflow" ? 1000 : 0),
      },
    };
    if (capacity === "required-overflow")
      expect(() => builder.build(withNavigation)).toThrow(ContextCapacityError);
    else {
      const built = builder.build(withNavigation);
      expect(built.request.system).toEqual(capacity === "admitted" ? navigation.content : []);
    }
    const plan = builder.planCompaction(withNavigation);
    expect(plan).not.toBeNull();
    expect(plan?.originalTokens).toBe(originalTokens);
    expect(withNavigation.sections).toEqual([navigation]);
  },
);

it.each(["unpaired", "unknown"] as const)("does not summarize a turn with %s calls", (status) => {
  const path = plannerPath(status);
  expect(
    new MinimalContextBuilder().planCompaction(input({ path, unsettledEffects: [] })),
  ).toBeNull();
});

it("retains an entire unsettled-action turn despite an earlier persisted result", () => {
  const path = plannerPath("paired");
  expect(new MinimalContextBuilder().planCompaction(input({ path }))).toBeNull();
});

it("rejects crossing compaction spans instead of guessing which history disappeared", () => {
  const original = textPath[3];
  if (original?.body.kind !== "compaction") throw Error("fixture");
  const crossing: TranscriptEntry = {
    ...original,
    id: "crossing" as TranscriptEntry["id"],
    parentId: textPath.at(-1)?.id ?? null,
    body: {
      ...original.body,
      replaces: {
        fromEntryId: textPath[1]?.id ?? original.id,
        toEntryId: textPath[4]?.id ?? original.id,
      },
    },
  };
  expect(() => new MinimalContextBuilder().build(input({ path: [...textPath, crossing] }))).toThrow(
    "Crossing compaction",
  );
});
