import { describe, expect, it } from "vitest";
import type { ModelStreamEvent } from "./model.ts";
import { checkModelStream, checkUsage, UNKNOWN_USAGE } from "./model-conformance.ts";
import type { ContentPart, ToolCallId, Usage } from "./persisted/index.ts";

const usage: Usage = { ...UNKNOWN_USAGE, status: "final", inputTokens: 1, outputTokens: 1 };
const done: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: "stop",
  usage,
};
const call: ContentPart = {
  type: "tool_call",
  callId: "c1" as ToolCallId,
  providerCallId: "p1",
  name: "read",
  rawArguments: "{}",
  argumentsSource: "verbatim",
  providerItemId: null,
};

function interrupted(
  partialOutput: boolean,
  observedUsage: Usage = UNKNOWN_USAGE,
): ModelStreamEvent {
  return {
    type: "error",
    error: {
      kind: "stream_interrupted",
      message: "connection closed",
      partialOutput,
      usage: observedUsage,
    },
  };
}

describe("checkUsage", () => {
  it("keeps unknown counters distinct from reported zeroes", () => {
    expect(UNKNOWN_USAGE).toEqual({
      status: "unknown",
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
    });
    expect(Object.isFrozen(UNKNOWN_USAGE)).toBe(true);
    expect(checkUsage(UNKNOWN_USAGE)).toEqual([]);
    expect(checkUsage({ ...UNKNOWN_USAGE, inputTokens: 0 })).toEqual([
      "usage.status is unknown but inputTokens is not null",
    ]);
    expect(checkUsage({ ...UNKNOWN_USAGE, status: "final", outputTokens: 0 })).toEqual([]);
  });

  it.each(["partial", "final"])("allows unreported subcounts in %s observations", (status) => {
    expect(checkUsage({ ...usage, status, inputTokens: null, outputTokens: 0 })).toEqual([]);
    expect(
      checkUsage({
        ...usage,
        status,
        inputTokens: 10,
        outputTokens: 8,
        cacheReadTokens: 3,
        cacheWriteTokens: 7,
        reasoningTokens: 8,
      }),
    ).toEqual([]);
  });

  it.each([null, undefined, [], 1, "usage"])("rejects non-record usage %j", (value) => {
    expect(checkUsage(value)).toEqual(["usage must be an object"]);
  });

  it("requires an explicit observation status and every counter", () => {
    expect(checkUsage({ ...usage, status: "estimated" })).toEqual([
      "usage.status must be unknown, partial, or final",
    ]);
    const { reasoningTokens: _omitted, ...missing } = usage;
    expect(checkUsage(missing)).toEqual([
      "usage.reasoningTokens must be a non-negative safe integer or null",
    ]);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1"])(
    "rejects invalid counters %s",
    (inputTokens) => {
      expect(checkUsage({ ...usage, inputTokens })).toEqual([
        "usage.inputTokens must be a non-negative safe integer or null",
      ]);
    },
  );

  it("rejects cache and reasoning subcounts larger than their totals", () => {
    expect(
      checkUsage({ ...usage, inputTokens: 10, cacheReadTokens: 6, cacheWriteTokens: 5 }),
    ).toEqual(["usage cache read/write subcounts exceed inputTokens"]);
    expect(checkUsage({ ...usage, cacheReadTokens: 2, cacheWriteTokens: null })).toEqual([
      "usage cache read/write subcounts exceed inputTokens",
    ]);
    expect(checkUsage({ ...usage, reasoningTokens: 2 })).toEqual([
      "usage.reasoningTokens exceeds outputTokens",
    ]);
    expect(checkUsage({ ...usage, outputTokens: null, reasoningTokens: 2 })).toEqual([]);
  });
});

describe("checkModelStream", () => {
  it("rejects a successful terminal event that silently discards unfinished deltas", () => {
    expect(
      checkModelStream([{ type: "text_delta", index: 0, text: "unfinished" }, done]),
    ).toContain("part 0 has deltas but never completed");
  });
  it("accepts a well-formed stream", () => {
    expect(
      checkModelStream([
        { type: "text_delta", index: 0, text: "hi" },
        { type: "part_completed", index: 0, part: { type: "text", text: "hi" } },
        done,
      ]),
    ).toEqual([]);
  });

  it("requires exactly one terminal event at the end", () => {
    expect(checkModelStream([{ type: "text_delta", index: 0, text: "hi" }])).toHaveLength(1);
    expect(checkModelStream([done, { type: "text_delta", index: 0, text: "late" }])).toHaveLength(
      1,
    );
    expect(checkModelStream([done, done])).toEqual([
      "events after the terminal event at position 0",
    ]);
  });

  it("rejects changes to a completed part", () => {
    expect(
      checkModelStream([
        { type: "part_completed", index: 0, part: { type: "text", text: "a" } },
        { type: "text_delta", index: 0, text: "b" },
        done,
      ]),
    ).toEqual(["position 1: part 0 changed after it completed"]);
  });

  it("rejects tool_use without a completed tool call", () => {
    expect(checkModelStream([{ ...done, stopReason: "tool_use" }])).toEqual([
      "stopReason is tool_use but no tool call completed",
    ]);
    expect(
      checkModelStream([
        { type: "part_completed", index: 0, part: call },
        { ...done, stopReason: "tool_use" },
      ]),
    ).toEqual([]);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid part index %s",
    (index) => {
      expect(checkModelStream([{ type: "text_delta", index, text: "hi" }, done])).toEqual([
        `position 0: invalid part index ${index}`,
      ]);
    },
  );

  it("accepts refusal deltas only when the completed part is a refusal", () => {
    const delta = { type: "refusal_delta", index: 0, text: "Cannot comply" } as const;
    expect(
      checkModelStream([
        delta,
        { type: "part_completed", index: 0, part: { type: "refusal", text: "Cannot comply" } },
        { ...done, stopReason: "refusal" },
      ]),
    ).toEqual([]);
    expect(
      checkModelStream([
        delta,
        { type: "part_completed", index: 0, part: { type: "text", text: "Cannot comply" } },
        done,
      ]),
    ).toEqual(["position 1: part 0 completed as text after refusal deltas"]);
  });

  it.each(["visible", "summary"] as const)(
    "requires %s reasoning deltas to retain their kind in the completed part",
    (kind) => {
      const delta = { type: "reasoning_delta", index: 0, kind, text: "reason" } as const;
      const otherKind = kind === "visible" ? "summary" : "visible";
      expect(
        checkModelStream([
          delta,
          { type: "part_completed", index: 0, part: { type: "reasoning", kind, text: "reason" } },
          done,
        ]),
      ).toEqual([]);
      expect(
        checkModelStream([
          delta,
          {
            type: "part_completed",
            index: 0,
            part: { type: "reasoning", kind: otherKind, text: "reason" },
          },
          done,
        ]),
      ).toEqual([
        `position 1: part 0 completed as reasoning:${otherKind} after reasoning:${kind} deltas`,
      ]);
      expect(
        checkModelStream([
          delta,
          { type: "part_completed", index: 0, part: { type: "reasoning", kind: "opaque" } },
          done,
        ]),
      ).toEqual([
        `position 1: part 0 completed as reasoning:opaque after reasoning:${kind} deltas`,
      ]);
    },
  );

  it("rejects changes between delta kinds, including visible and summary reasoning", () => {
    expect(
      checkModelStream([
        { type: "text_delta", index: 0, text: "hi" },
        { type: "refusal_delta", index: 0, text: "no" },
        { type: "part_completed", index: 0, part: { type: "text", text: "hi" } },
        done,
      ]),
    ).toEqual(["position 1: part 0 changed delta kind from text to refusal"]);
    expect(
      checkModelStream([
        { type: "reasoning_delta", index: 0, kind: "visible", text: "a" },
        { type: "reasoning_delta", index: 0, kind: "summary", text: "b" },
        {
          type: "part_completed",
          index: 0,
          part: { type: "reasoning", kind: "visible", text: "a" },
        },
        done,
      ]),
    ).toEqual([
      "position 1: part 0 changed delta kind from reasoning:visible to reasoning:summary",
    ]);
  });

  it("rejects a reasoning delta with an opaque kind even if the stream is interrupted", () => {
    const malformed = {
      type: "reasoning_delta",
      index: 0,
      kind: "opaque",
      text: "not visible",
    } as unknown as ModelStreamEvent;
    expect(checkModelStream([malformed, interrupted(true)])).toEqual([
      "position 0: reasoning delta kind must be visible or summary",
    ]);
  });

  it("matches tool argument deltas to a completed tool call", () => {
    const delta = { type: "tool_call_delta", index: 0, argumentsDelta: "{}" } as const;
    expect(
      checkModelStream([delta, { type: "part_completed", index: 0, part: call }, done]),
    ).toEqual([]);
    expect(
      checkModelStream([
        delta,
        { type: "part_completed", index: 0, part: { type: "text", text: "{}" } },
        done,
      ]),
    ).toEqual(["position 1: part 0 completed as text after tool_call deltas"]);
  });

  it.each([
    { type: "text_delta", index: 0, text: "partial" },
    { type: "refusal_delta", index: 0, text: "Cannot" },
    { type: "reasoning_delta", index: 0, kind: "visible", text: "thinking" },
    { type: "tool_call_delta", index: 0, argumentsDelta: '{"path":' },
    { type: "part_completed", index: 0, part: { type: "text", text: "done" } },
  ] satisfies ModelStreamEvent[])("requires partialOutput after $type", (output) => {
    expect(checkModelStream([output, interrupted(false)])).toEqual([
      "position 1: error.partialOutput is false after content output",
    ]);
    expect(checkModelStream([output, interrupted(true)])).toEqual([]);
    expect(checkModelStream([interrupted(false)])).toEqual([]);
  });

  it("validates usage on completed and error terminal events", () => {
    const invalid = { ...usage, outputTokens: Number.NaN };
    expect(checkModelStream([{ ...done, usage: invalid }])).toEqual([
      "position 0: usage.outputTokens must be a non-negative safe integer or null",
    ]);
    expect(checkModelStream([interrupted(false, invalid)])).toEqual([
      "position 0: usage.outputTokens must be a non-negative safe integer or null",
    ]);
    expect(checkModelStream([interrupted(false, { ...usage, status: "partial" })])).toEqual([]);
  });
});
