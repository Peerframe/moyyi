import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelStreamEvent } from "../../src/contracts/index.ts";
import { loadReplayFixture } from "./fixtures.ts";
import { SequenceReplayClient } from "./sequence-client.ts";

const record = loadReplayFixture("deduplicate-roster")[0];
if (!record) throw Error("Required recorded exchange is absent");
const request = record.request;
const collect = async (
  client: SequenceReplayClient,
  input: ModelRequest = request,
  signal = new AbortController().signal,
) => {
  const events: ModelStreamEvent[] = [];
  for await (const event of client.stream(input, signal)) events.push(event);
  return events;
};

describe("eval-only ordered response client", () => {
  it("reports changed requests while returning exact original events, with no fallback after exhaustion", async () => {
    const client = new SequenceReplayClient([record]);
    const changed = {
      ...request,
      system: [{ type: "text" as const, text: "Changed prompt" }],
      tools: [],
    };
    expect(() => client.assertConsumed()).toThrow(/unconsumed/);
    expect(await collect(client, changed)).toEqual(record.events);
    expect(client.requestDifferences).toMatchObject([{ index: 0, fields: ["system", "tools"] }]);
    client.assertConsumed();
    expect(await collect(client)).toMatchObject([
      { type: "error", error: { kind: "invalid_request" } },
    ]);
    expect(client.requests).toHaveLength(1);
  });

  it("accepts matching requests without a difference and isolates returned events and diagnostics", async () => {
    const client = new SequenceReplayClient([record, record]);
    const events = await collect(client);
    events.splice(0);
    const observed = client.requests as ModelRequest[];
    observed.splice(0);
    expect(await collect(client)).toEqual(record.events);
    expect(client.requests).toHaveLength(2);
    expect(client.requestDifferences).toEqual([]);
    client.assertConsumed();
  });

  it("does not consume on pre-cancellation or a concurrent stream", async () => {
    const client = new SequenceReplayClient([record]);
    expect(await collect(client, request, AbortSignal.abort())).toMatchObject([
      { type: "error", error: { kind: "cancelled", partialOutput: false } },
    ]);
    const iterator = client.stream(request, new AbortController().signal)[Symbol.asyncIterator]();
    await iterator.next();
    expect(await collect(client)).toMatchObject([{ type: "error", error: { kind: "protocol" } }]);
    while (!(await iterator.next()).done) {
      /* Drain the original stream. */
    }
    client.assertConsumed();
  });

  it("cancels a started stream without returning the rest of the recorded response", async () => {
    const client = new SequenceReplayClient([record]);
    const abort = new AbortController();
    const iterator = client.stream(request, abort.signal)[Symbol.asyncIterator]();
    await iterator.next();
    abort.abort();
    const next = await iterator.next();
    expect(next.value as ModelStreamEvent).toMatchObject({
      type: "error",
      error: { kind: "cancelled", partialOutput: true },
    });
    expect((await iterator.next()).done).toBe(true);
    expect(() => client.assertConsumed()).toThrow(/unconsumed/);
  });

  it("rejects altered recordings and unknown fixture paths", () => {
    expect(
      () => new SequenceReplayClient([{ ...record, request: { ...request, tools: [] } }]),
    ).toThrow(/binding mismatch/);
    expect(() => loadReplayFixture("../private")).toThrow(/Unknown public/);
    expect(() => new SequenceReplayClient([])).toThrow(/requires recorded/);
  });
});
