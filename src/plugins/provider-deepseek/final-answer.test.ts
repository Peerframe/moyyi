import { describe, expect, it } from "vitest";
import {
  type ContentPart,
  checkModelStream,
  type ModelRequest,
  type ModelStreamEvent,
} from "../../contracts/index.ts";
import { buildDeepSeekRequest, decodeDeepSeekEvents, deepSeekProfile } from "./codec.ts";
import { deepSeekFixture, deepSeekTextFixture, type FixtureOptions } from "./fixtures.ts";

type WireEvent = Record<string, unknown>;
type Stage = "added" | "done" | "terminal";
const stages: readonly Stage[] = ["added", "done", "terminal"];

function messageAt(wire: WireEvent[], stage: Stage): WireEvent {
  const terminal = wire.at(-1);
  if (!terminal) throw new Error("Fixture lacks terminal event");
  const items =
    stage === "terminal"
      ? ((terminal.response as WireEvent).output as WireEvent[])
      : wire
          .filter((event) => event.type === `response.output_item.${stage}`)
          .map((event) => event.item as WireEvent);
  const message = items.find((item) => item.type === "message");
  if (!message) throw new Error(`Fixture lacks ${stage} message`);
  return message;
}

function annotate(wire: WireEvent[]): WireEvent[] {
  for (const stage of stages) messageAt(wire, stage).phase = "final_answer";
  return wire;
}

async function decode(wire: WireEvent[]): Promise<ModelStreamEvent[]> {
  async function* source() {
    yield* wire;
  }
  const events: ModelStreamEvent[] = [];
  for await (const event of decodeDeepSeekEvents(source(), new AbortController().signal))
    events.push(event);
  expect(checkModelStream(events)).toEqual([]);
  expect(
    events.filter((event) => event.type === "completed" || event.type === "error"),
  ).toHaveLength(1);
  return events;
}

function completedParts(events: ModelStreamEvent[]): ContentPart[] {
  return events
    .filter((event) => event.type === "part_completed")
    .sort((a, b) => a.index - b.index)
    .map((event) => event.part);
}

function expectError(events: ModelStreamEvent[], kind = "protocol"): void {
  expect(events.at(-1)).toMatchObject({ type: "error", error: { kind } });
  expect(events.some((event) => event.type === "completed")).toBe(false);
}

function textAndToolFixture(options: FixtureOptions = {}): WireEvent[] {
  return deepSeekFixture(
    [
      { type: "reasoning", text: "Inspect the supplied synthetic file." },
      { type: "message", text: "Synthetic answer before the tool call." },
      { type: "function_call", callId: "synthetic_call", name: "read", arguments: "{}" },
    ],
    options,
  );
}

describe("DeepSeek final_answer phase compatibility", () => {
  it.each(stages)("accepts final_answer present only at %s", async (stage) => {
    const wire = deepSeekTextFixture();
    messageAt(wire, stage).phase = "final_answer";
    const events = await decode(wire);
    expect(events).toEqual(await decode(deepSeekTextFixture()));
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "end_turn" });
  });

  it.each([
    ["final_answer", "final_answer", "final_answer"],
    [null, null, null],
    [undefined, null, "final_answer"],
    [null, "final_answer", undefined],
    ["final_answer", undefined, null],
  ])("discards allowed phase changes from %j to %j to %j", async (added, done, terminal) => {
    const wire = deepSeekTextFixture();
    const values = { added, done, terminal };
    for (const stage of stages)
      if (values[stage] !== undefined) messageAt(wire, stage).phase = values[stage];
    expect(await decode(wire)).toEqual(await decode(deepSeekTextFixture()));
  });

  it("finalizes annotated text exactly once from a terminal snapshot without item completion", async () => {
    const withoutCompletion = (wire: WireEvent[]) =>
      wire.filter(
        (event) =>
          event.type !== "response.output_item.done" && event.type !== "response.content_part.done",
      );
    const events = await decode(withoutCompletion(annotate(deepSeekTextFixture())));
    expect(events).toEqual(await decode(withoutCompletion(deepSeekTextFixture())));
    expect(completedParts(events)).toEqual([
      { type: "reasoning", kind: "visible", text: "Review the supplied facts." },
      { type: "text", text: "Synthetic answer." },
    ]);
  });

  describe.each(stages)("phase validation at %s", (stage) => {
    it.each([
      ["unknown phase", "synthetic_unknown_phase"],
      ["empty string", ""],
      ["number", 1],
      ["boolean", false],
      ["array", ["final_answer"]],
      ["object", { value: "final_answer" }],
    ])("rejects %s", async (_label, value) => {
      const wire = annotate(deepSeekTextFixture());
      messageAt(wire, stage).phase = value;
      expectError(await decode(wire));
    });
  });

  it.each(["added", "done"] as const)(
    "does not treat an annotated %s item followed by EOF as a response terminal",
    async (stage) => {
      const wire = annotate(deepSeekTextFixture());
      const end = wire.findIndex(
        (event) =>
          event.type === `response.output_item.${stage}` &&
          (event.item as WireEvent).type === "message",
      );
      expect(end).toBeGreaterThan(0);
      const events = await decode(wire.slice(0, end + 1));
      expectError(events, "stream_interrupted");
      expect(events.at(-1)).toMatchObject({ error: { partialOutput: true } });
      if (stage === "done")
        expect(completedParts(events)).toContainEqual({ type: "text", text: "Synthetic answer." });
    },
  );

  it.each([
    ["completed", undefined, "tool_use"],
    ["incomplete", "max_output_tokens", "max_tokens"],
    ["incomplete", "content_filter", "refusal"],
  ] as const)(
    "preserves terminal %s/%s as %s after annotated text and a tool call",
    async (status, incompleteReason, stopReason) => {
      const options: FixtureOptions = {
        status,
        ...(incompleteReason ? { incompleteReason } : {}),
      };
      const events = await decode(annotate(textAndToolFixture(options)));
      expect(events).toEqual(await decode(textAndToolFixture(options)));
      expect(events.at(-1)).toMatchObject({ type: "completed", stopReason });
      expect(completedParts(events)).toContainEqual(
        expect.objectContaining({ type: "tool_call", providerCallId: "synthetic_call" }),
      );
    },
  );

  it("preserves a failed response and partial usage after annotated text", async () => {
    const options: FixtureOptions = { status: "failed" };
    const events = await decode(annotate(deepSeekTextFixture("Synthetic partial text.", options)));
    expect(events).toEqual(await decode(deepSeekTextFixture("Synthetic partial text.", options)));
    expectError(events, "overloaded");
    expect(events.at(-1)).toMatchObject({
      error: { partialOutput: true, usage: { status: "partial", inputTokens: 20 } },
    });
  });

  describe.each(["done", "terminal"] as const)("annotated message consistency at %s", (stage) => {
    it.each(["identity", "text", "status", "role"])("still rejects changed %s", async (field) => {
      const wire = annotate(deepSeekTextFixture());
      const message = messageAt(wire, stage);
      if (field === "identity") message.id = "synthetic_changed_item";
      if (field === "text")
        message.content = [{ type: "output_text", text: "Synthetic changed text." }];
      if (field === "status") message.status = "in_progress";
      if (field === "role") message.role = "user";
      expectError(await decode(wire));
    });
  });

  it("retains only ordinary text in common events and the next stateless request", async () => {
    const events = await decode(annotate(deepSeekTextFixture()));
    const content = completedParts(events);
    const request: ModelRequest = {
      origin: deepSeekProfile.origin,
      system: [],
      messages: [
        { role: "assistant", stopReason: "end_turn", content },
        { role: "user", content: [{ type: "text", text: "Continue." }] },
      ],
      tools: [],
      maxOutputTokens: 512,
    };
    const next = buildDeepSeekRequest(request);
    expect(next.input).toEqual([
      {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "Review the supplied facts." }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Synthetic answer." }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Continue." }] },
    ]);
    const normalized = JSON.stringify({ events, request: next });
    expect(normalized).not.toContain("final_answer");
    expect(normalized).not.toContain('"phase"');
  });
});
