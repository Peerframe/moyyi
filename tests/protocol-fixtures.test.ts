import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Research-fixture integrity only. These checks are not provider adapters or live API validation.
interface Example {
  id: string;
  body: Record<string, unknown>;
}
interface Stream {
  id: string;
  events: { event: string; data: Record<string, unknown> | string }[];
}
interface Fixture {
  provenance: { kind: string; retrievedAt: string; sources: string[] };
  requests: Example[];
  responses: Example[];
  streams: Stream[];
}

const providers = ["anthropic", "openai-responses", "openai-chat"] as const;
const root = join(import.meta.dirname, "fixtures", "protocols");
const fixtures = Object.fromEntries(
  await Promise.all(
    providers.map(async (provider) => [
      provider,
      JSON.parse(await readFile(join(root, provider, "examples.json"), "utf8")) as Fixture,
    ]),
  ),
) as Record<(typeof providers)[number], Fixture>;

function object(value: unknown): Record<string, unknown> {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function objects(value: unknown): Record<string, unknown>[] {
  expect(Array.isArray(value)).toBe(true);
  return (value as unknown[]).map(object);
}

function named<T extends { id: string }>(examples: T[], id: string): T {
  const result = examples.find((example) => example.id === id);
  if (!result) throw new Error(`missing research example ${id}`);
  return result;
}

describe("handwritten protocol fixture integrity", () => {
  for (const provider of providers) {
    it(`${provider}: has explicit provenance and uniquely named request/response/stream cases`, async () => {
      const fixture = fixtures[provider];
      expect(fixture.provenance.kind).toBe("handwritten-from-official-docs");
      expect(fixture.provenance.retrievedAt).toBe("2026-10-25");
      expect(fixture.provenance.sources.length).toBeGreaterThan(1);
      for (const source of fixture.provenance.sources)
        expect(new URL(source).protocol).toBe("https:");
      for (const group of [fixture.requests, fixture.responses, fixture.streams]) {
        expect(group.length).toBeGreaterThan(0);
        expect(new Set(group.map((example) => example.id)).size).toBe(group.length);
      }
      expect(await readFile(join(root, provider, "README.md"), "utf8")).toMatch(/[Ss]ynthetic/);
      for (const example of [...fixture.requests, ...fixture.responses]) {
        expect(typeof example.body.model).toBe("string");
      }
    });
  }

  it("Anthropic: signed reasoning and tool input agree between stream, response and replay", () => {
    const fixture = fixtures.anthropic;
    const stream = named(fixture.streams, "signed-tool-success");
    for (const event of stream.events) expect(object(event.data).type).toBe(event.event);
    const deltas = stream.events
      .filter((event) => event.event === "content_block_delta")
      .map((event) => object(object(event.data).delta));
    const raw = deltas
      .filter((delta) => delta.type === "input_json_delta")
      .map((delta) => delta.partial_json)
      .join("");
    const signature = deltas
      .filter((delta) => delta.type === "signature_delta")
      .map((delta) => delta.signature)
      .join("");
    const response = named(fixture.responses, "signed-thinking-tool-use").body;
    const parts = objects(response.content);
    expect(JSON.parse(raw)).toEqual(parts.find((part) => part.type === "tool_use")?.input);
    expect(signature).toBe(parts.find((part) => part.type === "thinking")?.signature);
    const replay = objects(named(fixture.requests, "signed-tool-result-replay").body.messages);
    expect(replay.find((message) => message.role === "assistant")?.content).toEqual(parts);
    const result = objects(replay.at(-1)?.content).find((part) => part.type === "tool_result");
    expect(result?.tool_use_id).toBe(parts.find((part) => part.type === "tool_use")?.id);
    expect(stream.events.at(-1)?.event).toBe("message_stop");
  });

  it("Anthropic: error and incomplete JSON samples never claim successful termination", () => {
    const fixture = fixtures.anthropic;
    const error = named(fixture.streams, "error-after-part");
    expect(error.events.at(-1)?.event).toBe("error");
    expect(error.events.some((event) => event.event === "message_stop")).toBe(false);
    const interrupted = named(fixture.streams, "interrupted-tool-json");
    expect(
      interrupted.events.some((event) =>
        ["message_stop", "content_block_stop"].includes(event.event),
      ),
    ).toBe(false);
    const raw = interrupted.events
      .filter((event) => event.event === "content_block_delta")
      .map((event) => object(object(event.data).delta).partial_json)
      .join("");
    expect(() => JSON.parse(raw)).toThrow();
  });

  it("Responses: interleaved arguments stay tied to item IDs, independent of completion order", () => {
    const stream = named(fixtures["openai-responses"].streams, "responses-tool-success-stream");
    const accumulated = new Map<unknown, string>();
    const added: unknown[] = [];
    const completed: unknown[] = [];
    for (const { event, data: raw } of stream.events) {
      const data = object(raw);
      expect(data.type).toBe(event);
      if (event === "response.output_item.added") {
        const item = object(data.item);
        if (item.type === "function_call") {
          added.push(item.id);
          expect(item.call_id).not.toBe(item.id);
        }
      }
      if (event === "response.function_call_arguments.delta") {
        accumulated.set(data.item_id, (accumulated.get(data.item_id) ?? "") + String(data.delta));
      }
      if (event === "response.function_call_arguments.done") {
        expect(accumulated.get(data.item_id)).toBe(data.arguments);
        completed.push(data.item_id);
      }
    }
    expect(added).toHaveLength(2);
    expect(completed).toEqual([...added].reverse());
    const output = objects(object(object(stream.events.at(-1)?.data).response).output);
    for (const item of output.filter((part) => part.type === "function_call")) {
      expect(accumulated.get(item.id)).toBe(item.arguments);
    }
  });

  it("Responses: streams have ordered sequence numbers and exactly one final terminal", () => {
    const terminals = ["response.completed", "response.incomplete", "response.failed", "error"];
    for (const stream of fixtures["openai-responses"].streams) {
      const numbers = stream.events.map((event) => object(event.data).sequence_number as number);
      expect(numbers.every((number) => Number.isSafeInteger(number) && number >= 0)).toBe(true);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
      expect(stream.events.filter((event) => terminals.includes(event.event))).toHaveLength(1);
      expect(terminals).toContain(stream.events.at(-1)?.event);
    }
  });

  it("Chat: keeps argument spelling and the usage-only tail after tool finish", () => {
    const fixture = fixtures["openai-chat"];
    const stream = named(fixture.streams, "tool-success-with-usage");
    const chunks = stream.events
      .filter((event) => event.data !== "[DONE]")
      .map((event) => object(event.data));
    const raw = chunks
      .flatMap((chunk) => objects(chunk.choices))
      .flatMap((choice) => {
        const calls = object(choice.delta).tool_calls;
        return calls === undefined
          ? []
          : objects(calls).map((call) => object(call.function).arguments ?? "");
      })
      .join("");
    const responseCall = objects(
      object(objects(named(fixture.responses, "tool-call").body.choices)[0]?.message).tool_calls,
    )[0];
    expect(raw).toBe(object(responseCall?.function).arguments);
    expect(raw).toBe('{ "path": "notes.txt" }');
    expect(chunks.at(-1)?.choices).toEqual([]);
    expect(chunks.at(-1)?.usage).toEqual(named(fixture.responses, "tool-call").body.usage);
    expect(stream.events.at(-1)?.data).toBe("[DONE]");
    expect(object(objects(chunks.at(-2)?.choices)[0]).finish_reason).toBe("tool_calls");
  });

  it("Chat: distinguishes refusal, truncated arguments and EOF from ordinary completion", () => {
    const fixture = fixtures["openai-chat"];
    const refusal = objects(named(fixture.responses, "refusal").body.choices)[0];
    expect(refusal?.finish_reason).toBe("stop");
    expect(object(refusal?.message).refusal).toBeTypeOf("string");
    const truncated = objects(named(fixture.responses, "truncated-arguments").body.choices)[0];
    expect(truncated?.finish_reason).toBe("length");
    const call = objects(object(truncated?.message).tool_calls)[0];
    expect(() => JSON.parse(String(object(call?.function).arguments))).toThrow();
    expect(
      named(fixture.streams, "transport-interruption").events.some(
        (event) => event.data === "[DONE]",
      ),
    ).toBe(false);
  });
});
