import { describe, expect, it } from "vitest";
import {
  type ContentPart,
  checkModelStream,
  type ModelRequest,
  type ModelStreamEvent,
} from "../../contracts/index.ts";
import { buildDeepSeekRequest, decodeDeepSeekEvents, deepSeekProfile } from "./codec.ts";
import { deepSeekFixture, deepSeekTextFixture, deepSeekToolFixture } from "./fixtures.ts";

type WireEvent = Record<string, unknown>;
type Phase = "added" | "done" | "terminal";
const phases: readonly Phase[] = ["added", "done", "terminal"];
const opaque = "synthetic-auxiliary-value";

function eventAt(wire: WireEvent[], type: string): WireEvent {
  const event = wire.find((event) => event.type === type);
  if (!event) throw new Error(`Fixture lacks ${type}`);
  return event;
}

function outputItem(wire: WireEvent[], phase: Phase, type = "reasoning"): WireEvent {
  const candidates =
    phase === "terminal"
      ? ((eventAt(wire, "response.completed").response as WireEvent).output as WireEvent[])
      : wire
          .filter((event) => event.type === `response.output_item.${phase}`)
          .map((event) => event.item as WireEvent);
  const item = candidates.find((item) => item.type === type);
  if (!item) throw new Error(`Fixture lacks ${phase} ${type}`);
  return item;
}

async function decode(wire: WireEvent[]): Promise<ModelStreamEvent[]> {
  async function* source() {
    yield* wire;
  }
  const result: ModelStreamEvent[] = [];
  for await (const event of decodeDeepSeekEvents(source(), new AbortController().signal))
    result.push(event);
  expect(checkModelStream(result)).toEqual([]);
  expect(
    result.filter((event) => event.type === "completed" || event.type === "error"),
  ).toHaveLength(1);
  return result;
}

function expectProtocolError(events: ModelStreamEvent[]): void {
  expect(events.at(-1)).toMatchObject({ type: "error", error: { kind: "protocol" } });
  expect(events.some((event) => event.type === "completed")).toBe(false);
  expect(JSON.stringify(events)).not.toContain(opaque);
}

function emptyReasoningFixture(shape: "empty text" | "whitespace" | "no content"): WireEvent[] {
  const wire = deepSeekFixture([
    { type: "function_call", callId: "synthetic_call", name: "read", arguments: "{}" },
    { type: "reasoning", text: shape === "whitespace" ? " \t\n" : "" },
  ]);
  if (shape !== "no content") return wire;
  const id = outputItem(wire, "added").id;
  outputItem(wire, "done").content = [];
  outputItem(wire, "terminal").content = [];
  return wire.filter((event) => event.item_id !== id);
}

describe("DeepSeek auxiliary reasoning compatibility", () => {
  it.each(phases)("accepts visible reasoning with auxiliary data only at %s", async (phase) => {
    const wire = deepSeekTextFixture();
    outputItem(wire, phase).encrypted_content = opaque;
    const events = await decode(wire);
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "end_turn" });
    expect(events).toEqual(await decode(deepSeekTextFixture()));
    expect(JSON.stringify(events)).not.toContain(opaque);
  });

  it("discards changing auxiliary bytes while retaining visible reasoning and tool arguments", async () => {
    const wire = deepSeekToolFixture("read", '{ "path": "synthetic.txt" }');
    for (const phase of phases) outputItem(wire, phase).encrypted_content = `${opaque}-${phase}`;
    const events = await decode(wire);
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "tool_use" });
    expect(events).toEqual(
      await decode(deepSeekToolFixture("read", '{ "path": "synthetic.txt" }')),
    );
    expect(JSON.stringify(events)).not.toContain(opaque);
  });

  it("accepts auxiliary metadata disappearing from a completed terminal snapshot", async () => {
    const wire = deepSeekTextFixture();
    outputItem(wire, "added").encrypted_content = `${opaque}-added`;
    outputItem(wire, "done").encrypted_content = `${opaque}-done`;
    expect(await decode(wire)).toEqual(await decode(deepSeekTextFixture()));
  });

  it.each([null, ""])(
    "treats %j auxiliary data as absent for empty visible reasoning",
    async (value) => {
      const baseline = deepSeekFixture([{ type: "reasoning", text: "" }]);
      const wire = deepSeekFixture([{ type: "reasoning", text: "" }]);
      for (const phase of phases) outputItem(wire, phase).encrypted_content = value;
      const events = await decode(wire);
      expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "end_turn" });
      expect(events).toEqual(await decode(baseline));
    },
  );

  it.each(phases)("accepts exactly 64 KiB of UTF-8 auxiliary data at %s", async (phase) => {
    const wire = deepSeekTextFixture();
    outputItem(wire, phase).encrypted_content = "😀".repeat((64 * 1024) / 4);
    expect(await decode(wire)).toEqual(await decode(deepSeekTextFixture()));
  });

  describe.each(phases)("auxiliary data validation at %s", (phase) => {
    it.each([
      ["ASCII byte overflow", "a".repeat(64 * 1024 + 1)],
      ["UTF-8 byte overflow", `${"😀".repeat((64 * 1024) / 4)}a`],
      ["number", 1],
      ["boolean", false],
      ["array", []],
      ["object", { value: opaque }],
    ])("rejects %s", async (_label, value) => {
      const wire = deepSeekTextFixture();
      outputItem(wire, phase).encrypted_content = value;
      expectProtocolError(await decode(wire));
    });

    it.each(["empty text", "whitespace", "no content"] as const)(
      "rejects opaque-only %s even after a tool call has been emitted",
      async (shape) => {
        const wire = emptyReasoningFixture(shape);
        outputItem(wire, phase).encrypted_content = opaque;
        // A terminal-only value must be checked even when terminal completion finalizes the item.
        const events = await decode(
          phase === "terminal" && shape === "no content"
            ? wire.filter(
                (event) =>
                  event.type !== "response.output_item.done" ||
                  (event.item as WireEvent).type !== "reasoning",
              )
            : wire,
        );
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "part_completed",
            part: expect.objectContaining({ type: "tool_call" }),
          }),
        );
        expectProtocolError(events);
      },
    );
  });

  it("accepts terminal-only visible reasoning with auxiliary data when item completion is omitted", async () => {
    const wire = deepSeekTextFixture();
    outputItem(wire, "terminal").encrypted_content = opaque;
    const withoutItemCompletion = (wire: WireEvent[]) =>
      wire.filter(
        (event) =>
          event.type !== "response.output_item.done" && event.type !== "response.content_part.done",
      );
    const events = await decode(withoutItemCompletion(wire));
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "end_turn" });
    expect(events).toEqual(await decode(withoutItemCompletion(deepSeekTextFixture())));
  });

  it.each([
    "reasoning delta identity",
    "reasoning text done",
    "item identity",
    "item status",
    "terminal reasoning text",
    "terminal item identity",
    "terminal item status",
    "terminal function arguments",
    "terminal function identity",
  ])("still rejects inconsistent %s when auxiliary bytes are ignored", async (variant) => {
    const wire = deepSeekToolFixture();
    for (const phase of phases) outputItem(wire, phase).encrypted_content = `${opaque}-${phase}`;
    if (variant === "reasoning delta identity")
      eventAt(wire, "response.reasoning_text.delta").item_id = "synthetic_changed_item";
    if (variant === "reasoning text done")
      eventAt(wire, "response.reasoning_text.done").text = "Synthetic changed reasoning.";
    if (variant === "item identity") outputItem(wire, "done").id = "synthetic_changed_item";
    if (variant === "item status") outputItem(wire, "done").status = "in_progress";
    if (variant === "terminal reasoning text")
      outputItem(wire, "terminal").content = [
        { type: "reasoning_text", text: "Synthetic changed reasoning." },
      ];
    if (variant === "terminal item identity")
      outputItem(wire, "terminal").id = "synthetic_changed_item";
    if (variant === "terminal item status") outputItem(wire, "terminal").status = "incomplete";
    if (variant === "terminal function arguments")
      outputItem(wire, "terminal", "function_call").arguments = '{"path":"changed.txt"}';
    if (variant === "terminal function identity")
      outputItem(wire, "terminal", "function_call").call_id = "synthetic_changed_call";
    expectProtocolError(await decode(wire));
  });
});

describe("DeepSeek request reasoning remains visible-only", () => {
  it.each(["opaque content", "replay-only reasoning", "auxiliary field on visible content"])(
    "rejects %s in completed assistant history",
    (variant) => {
      const content: ContentPart[] =
        variant === "opaque content"
          ? [{ type: "reasoning", kind: "opaque" }]
          : variant === "replay-only reasoning"
            ? [{ type: "text", text: "Synthetic answer." }]
            : [
                {
                  type: "reasoning",
                  kind: "visible",
                  text: "Synthetic visible reasoning.",
                  encrypted_content: opaque,
                } as ContentPart,
              ];
      const request: ModelRequest = {
        origin: deepSeekProfile.origin,
        system: [],
        messages: [
          {
            role: "assistant",
            stopReason: "end_turn",
            content,
            replay: {
              version: 1,
              payloadVersion: 1,
              origin: {
                ...deepSeekProfile.origin,
                modelRevision: null,
                apiProfile: "synthetic-profile",
              },
              contentHash: "synthetic-hash",
              payload: JSON.stringify({ encrypted_content: opaque }),
            },
          },
        ],
        tools:
          variant === "replay-only reasoning"
            ? [{ name: "read", description: "Read text", inputSchema: { type: "object" } }]
            : [],
        maxOutputTokens: 512,
      };
      expect(() => buildDeepSeekRequest(request)).toThrow();
    },
  );
});
