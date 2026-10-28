import { describe, expect, it, vi } from "vitest";
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
      const { settled, ...data } = response;
      void settled.catch(() => {});
      expect(() => canonicalizeJson(data)).not.toThrow();
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
    const { settled, ...data } = response;
    await settled;
    expect(() => canonicalizeJson(data)).not.toThrow();
  });
});

describe("phase interruption and stream settlement", () => {
  it("does not mistake an early return acknowledgment for a settled pending read", async () => {
    const controller = new AbortController();
    let finishNext = (_result: IteratorResult<ModelStreamEvent>) => {};
    const pending = new Promise<IteratorResult<ModelStreamEvent>>((resolve) => {
      finishNext = resolve;
    });
    const model: ModelClient = {
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => {
            controller.abort();
            return pending;
          },
          return: async () => ({ done: true, value: undefined }),
        }),
      }),
    };
    const response = await consumeResponse(model, request, controller.signal, 16_384, () => {});
    let settled = false;
    void response.settled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finishNext({
      done: false,
      value: {
        type: "error",
        error: {
          kind: "network",
          message: "Already received terminal",
          partialOutput: false,
          usage: UNKNOWN_USAGE,
        },
      },
    });
    await response.settled;
    expect(response.deferredTerminal).toMatchObject({ type: "error", error: { kind: "network" } });
    expect(response.parts).toEqual([]);
  });

  it("retains partial text immediately but waits for iterator closure separately", async () => {
    const controller = new AbortController();
    let close = () => {};
    const cleanup = new Promise<void>((resolve) => {
      close = resolve;
    });
    const returning = vi.fn(async () => {
      await cleanup;
      return { done: true as const, value: undefined };
    });
    let next = 0;
    const model: ModelClient = {
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            if (next++ === 0)
              return {
                done: false,
                value: { type: "text_delta", index: 0, text: "Partial" } as ModelStreamEvent,
              };
            controller.abort();
            return {
              done: false,
              value: {
                type: "text_delta",
                index: 0,
                text: "Ignored late content",
              } as ModelStreamEvent,
            };
          },
          return: returning,
        }),
      }),
    };
    const response = await consumeResponse(model, request, controller.signal, 16_384, () => {});
    expect(response.signalInterrupted).toBe(true);
    expect(response.parts).toEqual([{ type: "text", text: "Partial" }]);
    expect(response.error?.kind).toBe("cancelled");
    expect(returning).toHaveBeenCalledTimes(1);
    let settled = false;
    void response.settled.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    close();
    await response.settled;
    expect(settled).toBe(true);
  });

  it.each(["missing", "throws", "rejects", "not_done"] as const)(
    "does not certify closure when iterator return is %s",
    async (mode) => {
      const controller = new AbortController();
      const model: ModelClient = {
        stream: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              controller.abort();
              return { done: true, value: undefined };
            },
            ...(mode === "missing"
              ? {}
              : {
                  return: () => {
                    if (mode === "throws") throw Error("Closure failed");
                    if (mode === "rejects") return Promise.reject(Error("Closure failed"));
                    return Promise.resolve({ done: false as const, value: done });
                  },
                }),
          }),
        }),
      };
      const response = await consumeResponse(model, request, controller.signal, 16_384, () => {});
      expect(response.signalInterrupted).toBe(true);
      await expect(response.settled).rejects.toThrow();
    },
  );

  it("preserves a received provider error when cancellation happens while closing", async () => {
    const controller = new AbortController();
    const model: ModelClient = {
      async *stream() {
        yield {
          type: "error",
          error: {
            kind: "network",
            message: "Actual transport error",
            partialOutput: false,
            usage: UNKNOWN_USAGE,
          },
        };
        controller.abort();
      },
    };
    const response = await consumeResponse(model, request, controller.signal, 16_384, () => {});
    expect(response.error?.message).toBe("Actual transport error");
    expect(response.signalInterrupted).toBe(false);
    await response.settled;
  });
});
