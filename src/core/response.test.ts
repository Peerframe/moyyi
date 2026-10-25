import { describe, expect, it } from "vitest";
import {
  type ContentPart,
  canonicalizeJson,
  type ModelClient,
  type ModelRequest,
  type ModelStreamEvent,
  UNKNOWN_USAGE,
} from "../contracts/index.ts";
import { consumeResponse } from "./response.ts";

const request: ModelRequest = {
  origin: { provider: "synthetic", model: "synthetic" },
  system: [],
  messages: [],
  tools: [],
  maxOutputTokens: 100,
};
const done: Extract<ModelStreamEvent, { type: "completed" }> = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: "stop",
  usage: UNKNOWN_USAGE,
};

async function collect(events: readonly ModelStreamEvent[]) {
  const displayed: string[] = [];
  const model: ModelClient = {
    async *stream() {
      yield* events;
    },
  };
  const response = await consumeResponse(
    model,
    request,
    new AbortController().signal,
    16_384,
    (text) => displayed.push(text),
  );
  return { response, displayed };
}

describe("stream acceptance preserves the last valid content", () => {
  it("rejects duplicate completed parts before overwriting the original", async () => {
    const original: ContentPart = { type: "text", text: "Original completed content" };
    const { response } = await collect([
      { type: "part_completed", index: 0, part: original },
      { type: "part_completed", index: 0, part: { type: "text", text: "Late replacement" } },
      done,
    ]);
    expect(response.parts).toEqual([original]);
    expect(response.error?.kind).toBe("protocol");
    expect(response.error?.partialOutput).toBe(true);
  });

  it("rejects late deltas without displaying them or changing a completed part", async () => {
    const { response, displayed } = await collect([
      { type: "part_completed", index: 0, part: { type: "text", text: "Done" } },
      { type: "text_delta", index: 0, text: "Late unaccepted content" },
      done,
    ]);
    expect(response.parts).toEqual([{ type: "text", text: "Done" }]);
    expect(displayed).toEqual([]);
    expect(response.error?.kind).toBe("protocol");
  });

  it.each([
    { type: "text_delta", index: 1, text: "After terminal" },
    { type: "part_completed", index: 1, part: { type: "text", text: "After terminal" } },
    {
      ...done,
      providerStopReason: "replacement",
      usage: { ...UNKNOWN_USAGE, status: "final", inputTokens: 1 },
    },
    {
      type: "error",
      error: { kind: "network", message: "Late error", partialOutput: false, usage: UNKNOWN_USAGE },
    },
  ] satisfies ModelStreamEvent[])(
    "rejects $type after terminal without absorbing its contents",
    async (late) => {
      const original: ContentPart = { type: "text", text: "Original" };
      const { response, displayed } = await collect([
        { type: "part_completed", index: 0, part: original },
        done,
        late,
      ]);
      expect(response.parts).toEqual([original]);
      expect(response.error?.kind).toBe("protocol");
      expect(response.providerStopReason).toBe("stop");
      expect(response.usage).toEqual(UNKNOWN_USAGE);
      expect(displayed).toEqual([]);
    },
  );

  it("retains text deltas when their kind changes or their completion has another kind", async () => {
    for (const invalid of [
      { type: "refusal_delta", index: 0, text: "Changed" },
      { type: "part_completed", index: 0, part: { type: "refusal", text: "Changed" } },
    ] satisfies ModelStreamEvent[]) {
      const { response, displayed } = await collect([
        { type: "text_delta", index: 0, text: "Original text" },
        invalid,
        done,
      ]);
      expect(response.parts).toEqual([{ type: "text", text: "Original text" }]);
      expect(response.error?.kind).toBe("protocol");
      expect(displayed).toEqual(["Original text"]);
    }
  });

  it("never converts full reasoning into a summary after a kind change", async () => {
    const { response } = await collect([
      { type: "reasoning_delta", index: 0, kind: "visible", text: "Full original reasoning" },
      { type: "reasoning_delta", index: 0, kind: "summary", text: "New summary" },
      done,
    ]);
    expect(response.parts).toEqual([
      { type: "reasoning", kind: "visible", text: "Full original reasoning" },
    ]);
    expect(response.error?.kind).toBe("protocol");
  });

  it("does not accept callable identities appearing only after terminal", async () => {
    const { response } = await collect([
      done,
      {
        type: "part_completed",
        index: 0,
        part: {
          type: "tool_call",
          callId: "late" as never,
          providerCallId: "late",
          providerItemId: null,
          name: "inspect",
          rawArguments: "{}",
          argumentsSource: "verbatim",
        },
      },
    ]);
    expect(response.parts).toEqual([]);
    expect(response.error?.kind).toBe("protocol");
  });
});

describe("provider error diagnostics", () => {
  it.each(["stream", "next"])(
    "keeps an emoji exception from %s serializable at the length boundary",
    async (point) => {
      const message = `a${String.fromCodePoint(0x1f600).repeat(600)}`;
      const model: ModelClient = {
        stream() {
          if (point === "stream") throw Error(message);
          return {
            [Symbol.asyncIterator]() {
              return {
                next: async () => {
                  throw Error(message);
                },
              };
            },
          };
        },
      };
      const response = await consumeResponse(
        model,
        request,
        new AbortController().signal,
        16_384,
        () => {},
      );
      expect(response.error?.kind).toBe("protocol");
      expect(response.error?.message.length).toBe(1024);
      expect(response.error?.message.isWellFormed()).toBe(true);
      expect(() => canonicalizeJson(response)).not.toThrow();
    },
  );

  it("turns an exception with a throwing coercion into a usable protocol error", async () => {
    const model: ModelClient = {
      stream() {
        throw {
          toString() {
            throw Error("Broken coercion");
          },
        };
      },
    };
    const response = await consumeResponse(
      model,
      request,
      new AbortController().signal,
      16_384,
      () => {},
    );
    expect(response.error?.message).toBe("Unreportable provider error");
    expect(() => canonicalizeJson(response)).not.toThrow();
  });
});
