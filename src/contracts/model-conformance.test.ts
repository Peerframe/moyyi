import { describe, expect, it } from "vitest";
import type { ModelStreamEvent } from "./model.ts";
import { checkModelStream } from "./model-conformance.ts";
import type { ToolCallId } from "./persisted/index.ts";

const usage = { inputTokens: 1, outputTokens: 1 };
const done: ModelStreamEvent = { type: "completed", stopReason: "end_turn", usage };

describe("checkModelStream", () => {
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
    expect(checkModelStream([{ type: "completed", stopReason: "tool_use", usage }])).toEqual([
      "stopReason is tool_use but no tool call completed",
    ]);
    const call = {
      type: "tool_call",
      callId: "c1" as ToolCallId,
      providerCallId: "p1",
      name: "read",
      rawArguments: "{}",
    } as const;
    expect(
      checkModelStream([
        { type: "part_completed", index: 0, part: call },
        { type: "completed", stopReason: "tool_use", usage },
      ]),
    ).toEqual([]);
  });
});
