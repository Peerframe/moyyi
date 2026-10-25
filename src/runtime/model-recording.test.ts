import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeJson,
  checkModelStream,
  type ModelClient,
  type ModelRequest,
  type ModelStreamEvent,
  UNKNOWN_USAGE,
} from "../contracts/index.ts";
import type { ModelRecording } from "../contracts/recording.ts";
import { consumeResponse } from "../core/response.ts";
import {
  FileRecordingSink,
  loadModelRecordings,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_EVENTS,
  MAX_RECORDING_FILES,
  MAX_RECORDING_TOTAL_BYTES,
  MemoryRecordingSink,
  parseModelRecording,
  RecordingModelClient,
  ReplayModelClient,
} from "./model-recording.ts";

const request: ModelRequest = {
  origin: { provider: "synthetic", model: "test-model" },
  system: [{ type: "text", text: "A synthetic system instruction" }],
  messages: [{ role: "user", content: [{ type: "text", text: "Inspect the fixture" }] }],
  tools: [
    {
      name: "inspect",
      description: "Read a fixture",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ],
  maxOutputTokens: 100,
};
const complete: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
const events: readonly ModelStreamEvent[] = [
  { type: "text_delta", index: 0, text: "answer" },
  { type: "part_completed", index: 0, part: { type: "text", text: "answer" } },
  complete,
];
const options = {
  apiProfile: "synthetic.responses/v1",
  source: "synthetic" as const,
  now: () => "2026-10-25T10:00:00.000Z",
};
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "moyyi-recording-test-"));
  directories.push(path);
  return path;
}
function fake(sequence: readonly ModelStreamEvent[] = events): ModelClient {
  return {
    stream: vi.fn(async function* () {
      for (const event of sequence) yield event;
    }),
  };
}
async function collect(
  client: ModelClient,
  input: ModelRequest = request,
  signal = new AbortController().signal,
): Promise<ModelStreamEvent[]> {
  const seen: ModelStreamEvent[] = [];
  for await (const event of client.stream(input, signal)) seen.push(event);
  expect(checkModelStream(seen)).toEqual([]);
  return seen;
}
async function recorded(sequence: readonly ModelStreamEvent[] = events): Promise<ModelRecording> {
  const sink = new MemoryRecordingSink();
  await collect(new RecordingModelClient(fake(sequence), sink, options));
  const result = sink.records[0];
  if (!result) throw Error("Recording missing");
  return result;
}
function resign(value: unknown): ModelRecording {
  const { contentHash: _hash, ...base } = value as ModelRecording;
  return {
    ...base,
    contentHash: `sha256:${createHash("sha256").update(canonicalizeJson(base)).digest("hex")}`,
  };
}
function expectError(
  events: readonly ModelStreamEvent[],
  kind: string,
  partialOutput: boolean,
): void {
  expect(events.at(-1)).toMatchObject({ type: "error", error: { kind, partialOutput } });
  expect(
    events.filter((event) => event.type === "completed" || event.type === "error"),
  ).toHaveLength(1);
}

describe("ModelClient recording and deterministic replay", () => {
  it("round-trips the full request, events, unknown usage and honest metadata", async () => {
    const record = await recorded();
    expect(record.meta).toEqual({
      apiProfile: options.apiProfile,
      requestedModel: "test-model",
      reportedModel: null,
      recordedAt: options.now(),
      source: "synthetic",
    });
    expect(record.request).toEqual(request);
    expect(record.events).toEqual(events);
    expect(record.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const replay = new ReplayModelClient([record], { apiProfile: options.apiProfile });
    expect(replay.remaining).toBe(1);
    expect(() => replay.assertConsumed()).toThrow(/unconsumed/);
    expect(await collect(replay)).toEqual(events);
    expect(replay.remaining).toBe(0);
    replay.assertConsumed();
    expectError(await collect(replay), "invalid_request", false);
  });

  it("records a reported server model without inferring it from the requested alias", async () => {
    const terminal: ModelStreamEvent = {
      ...complete,
      type: "completed",
      stopReason: "end_turn",
      providerStopReason: { model: "reported-revision", reason: "stop" },
      usage: UNKNOWN_USAGE,
    };
    expect((await recorded([terminal])).meta.reportedModel).toBe("reported-revision");
  });

  it("preserves incomplete arguments, partial usage and errors without retrying", async () => {
    const partial = {
      ...UNKNOWN_USAGE,
      status: "partial" as const,
      inputTokens: 3,
      outputTokens: 2,
    };
    const interrupted: readonly ModelStreamEvent[] = [
      { type: "tool_call_delta", index: 0, argumentsDelta: '{"path":' },
      {
        type: "error",
        error: {
          kind: "network",
          message: "Synthetic network failure",
          partialOutput: true,
          usage: partial,
        },
      },
    ];
    const source = fake(interrupted);
    const sink = new MemoryRecordingSink();
    expect(await collect(new RecordingModelClient(source, sink, options))).toEqual(interrupted);
    expect(source.stream).toHaveBeenCalledTimes(1);
    expect(
      await collect(new ReplayModelClient(sink.records, { apiProfile: options.apiProfile })),
    ).toEqual(interrupted);
  });

  it("retains declared partial output even without observed deltas", async () => {
    const terminal: ModelStreamEvent = {
      type: "error",
      error: {
        kind: "stream_interrupted",
        message: "Missing wire prefix",
        partialOutput: true,
        usage: UNKNOWN_USAGE,
      },
    };
    const record = await recorded([terminal]);
    expect(
      await collect(new ReplayModelClient([record], { apiProfile: options.apiProfile })),
    ).toEqual([terminal]);
  });

  it.each(["system", "messages", "tools", "maxOutputTokens", "model", "provider"])(
    "rejects a changed %s without consuming an exchange",
    async (field) => {
      const record = await recorded();
      const changed = structuredClone(request) as {
        origin: { model: string; provider: string };
        system: unknown[];
        messages: unknown[];
        tools: unknown[];
        maxOutputTokens: number;
      };
      if (field === "model" || field === "provider") changed.origin[field] += "-changed";
      else if (field === "maxOutputTokens") changed.maxOutputTokens++;
      else if (field === "system") changed.system = [];
      else if (field === "messages") changed.messages = [];
      else changed.tools = [];
      const replay = new ReplayModelClient([record], { apiProfile: options.apiProfile });
      expectError(await collect(replay, changed as ModelRequest), "invalid_request", false);
      expect(replay.remaining).toBe(1);
      expect(await collect(replay)).toEqual(events);
    },
  );

  it("matches canonical object order while preserving message order", async () => {
    const record = await recorded();
    const reordered = {
      maxOutputTokens: request.maxOutputTokens,
      tools: request.tools,
      messages: request.messages,
      system: request.system,
      origin: { model: request.origin.model, provider: request.origin.provider },
    };
    expect(
      await collect(new ReplayModelClient([record], { apiProfile: options.apiProfile }), reordered),
    ).toEqual(events);
  });

  it("preserves and binds historical stop reasons without changing the persisted format", async () => {
    const input: ModelRequest = {
      ...request,
      messages: [
        {
          role: "assistant",
          content: [{ type: "reasoning", kind: "visible", text: "unfinished thought" }],
          stopReason: "interrupted",
        },
        ...request.messages,
      ],
    };
    const sink = new MemoryRecordingSink();
    await collect(new RecordingModelClient(fake(), sink, options), input);
    const replay = new ReplayModelClient(sink.records, { apiProfile: options.apiProfile });
    const changed: ModelRequest = {
      ...input,
      messages: input.messages.map((message, index) =>
        index === 0 ? { ...message, stopReason: "end_turn" } : message,
      ),
    };
    expectError(await collect(replay, changed), "invalid_request", false);
    expect(replay.remaining).toBe(1);
    expect(await collect(replay, input)).toEqual(events);
  });

  it("rejects changed profile, version, missing terminal and tampered contents before replay", async () => {
    const record = await recorded();
    expect(() => new ReplayModelClient([record], { apiProfile: "other" })).toThrow(/profile/);
    expect(
      () =>
        new ReplayModelClient([{ ...record, version: 2 } as unknown as ModelRecording], {
          apiProfile: options.apiProfile,
        }),
    ).toThrow(/version/);
    expect(() =>
      parseModelRecording(resign({ ...record, events: record.events.slice(0, -1) })),
    ).toThrow(/incomplete/);
    expect(() =>
      parseModelRecording({ ...record, meta: { ...record.meta, source: "live" } }),
    ).toThrow(/integrity/);
    expect(() =>
      parseModelRecording(resign({ ...record, request: { ...request, maxOutputTokens: 200 } })),
    ).toThrow(/binding/);
    expect(() => parseModelRecording(resign({ ...record, events: [{ type: "mystery" }] }))).toThrow(
      /Unknown/,
    );
    expect(() =>
      parseModelRecording({ ...record, headers: { authorization: "never accepted" } }),
    ).toThrow(/fields/);
  });

  it("clones the provider request, captured events, exposed records and replay events", async () => {
    const input = structuredClone(request);
    const emitted = { type: "text_delta" as const, index: 0, text: "answer" };
    const source: ModelClient = {
      async *stream(received) {
        (received.messages as unknown[]).length = 0;
        yield emitted;
        emitted.text = "provider changed";
        yield events[1] as ModelStreamEvent;
        yield complete;
      },
    };
    const sink = new MemoryRecordingSink();
    const stream = new RecordingModelClient(source, sink, options)
      .stream(input, new AbortController().signal)
      [Symbol.asyncIterator]();
    const first = await stream.next();
    if (first.value?.type === "text_delta")
      (first.value as { text: string }).text = "consumer changed";
    await stream.next();
    await stream.next();
    await stream.next();
    expect(input).toEqual(request);
    expect(sink.records[0]?.events[0]).toMatchObject({ text: "answer" });
    const external = sink.records as ModelRecording[];
    external.length = 0;
    const replay = new ReplayModelClient(sink.records, { apiProfile: options.apiProfile });
    expect(await collect(replay)).toEqual(events);
  });

  it.each(["throw", "missing", "duplicate", "late", "kind"])(
    "converts malformed provider behavior (%s) to one recorded error",
    async (mode) => {
      const source: ModelClient = {
        async *stream() {
          yield events[0] as ModelStreamEvent;
          if (mode === "throw") throw Error("authorization=synthetic-do-not-export");
          if (mode === "missing") return;
          if (mode === "kind") {
            yield { type: "refusal_delta", index: 0, text: "changed" };
            return;
          }
          yield events[1] as ModelStreamEvent;
          if (mode === "duplicate") {
            yield events[1] as ModelStreamEvent;
            return;
          }
          yield complete;
          yield { type: "text_delta", index: 2, text: "after terminal" };
        },
      };
      const sink = new MemoryRecordingSink();
      const result = await collect(new RecordingModelClient(source, sink, options));
      expectError(result, "protocol", true);
      expect(result[0]).toEqual(events[0]);
      expect(JSON.stringify(result)).not.toContain("synthetic-do-not-export");
      expect(sink.records[0]?.events).toEqual(result);
    },
  );

  it("records cancellation with partial output even if the provider ignores abort", async () => {
    const abort = new AbortController();
    const entered = Promise.withResolvers<void>();
    const source: ModelClient = {
      async *stream() {
        yield events[0] as ModelStreamEvent;
        entered.resolve();
        await new Promise<void>(() => {});
      },
    };
    const sink = new MemoryRecordingSink();
    const result = collect(new RecordingModelClient(source, sink, options), request, abort.signal);
    await entered.promise;
    abort.abort();
    const seen = await result;
    expectError(seen, "cancelled", true);
    expect(sink.records[0]?.events).toEqual(seen);
  });

  it("never calls the provider after pre-cancellation and does not consume a replay", async () => {
    const abort = new AbortController();
    abort.abort();
    const source = fake();
    const sink = new MemoryRecordingSink();
    expectError(
      await collect(new RecordingModelClient(source, sink, options), request, abort.signal),
      "cancelled",
      false,
    );
    expect(source.stream).not.toHaveBeenCalled();
    const replay = new ReplayModelClient([await recorded()], { apiProfile: options.apiProfile });
    expectError(await collect(replay, request, abort.signal), "cancelled", false);
    expect(replay.remaining).toBe(1);
  });

  it("keeps the terminal private until the sink finishes and reports sink failure once", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const seen: ModelStreamEvent[] = [];
    const recording = new RecordingModelClient(
      fake(),
      {
        async invalidate() {},
        async write() {
          entered.resolve();
          await release.promise;
          throw Error("private sink path");
        },
      },
      options,
    );
    const done = (async () => {
      for await (const event of recording.stream(request, new AbortController().signal))
        seen.push(event);
    })();
    await entered.promise;
    expect(seen).toEqual(events.slice(0, -1));
    release.resolve();
    await done;
    expectError(seen, "protocol", true);
    expect(checkModelStream(seen)).toEqual([]);
    expect(JSON.stringify(seen)).not.toContain("private sink path");
  });

  it("keeps an acknowledged recording and emitted terminal identical when cancellation arrives during publication", async () => {
    const abort = new AbortController();
    const sink = new MemoryRecordingSink();
    const result = await collect(
      new RecordingModelClient(
        fake(),
        {
          invalidate: (writeId) => sink.invalidate(writeId),
          async write(record, writeId) {
            await sink.write(record, writeId);
            abort.abort();
          },
        },
        options,
      ),
      request,
      abort.signal,
    );
    expect(result).toEqual(events);
    expect(sink.records[0]?.events).toEqual(result);
  });

  it("bounds oversized requests, event payloads and event counts", async () => {
    const source = fake();
    const sink = new MemoryRecordingSink();
    const tooLarge = {
      ...request,
      system: [{ type: "text" as const, text: "x".repeat(MAX_RECORDING_BYTES) }],
    };
    expectError(
      await collect(new RecordingModelClient(source, sink, options), tooLarge),
      "invalid_request",
      false,
    );
    expect(source.stream).not.toHaveBeenCalled();
    const huge = fake([{ type: "text_delta", index: 0, text: "x".repeat(MAX_RECORDING_BYTES) }]);
    expectError(await collect(new RecordingModelClient(huge, sink, options)), "protocol", false);
    const many = fake(
      Array.from(
        { length: MAX_RECORDING_EVENTS + 1 },
        (): ModelStreamEvent => ({ type: "text_delta", index: 0, text: "" }),
      ),
    );
    const output = await collect(new RecordingModelClient(many, sink, options));
    expectError(output, "protocol", true);
    expect(output.length).toBeLessThanOrEqual(MAX_RECORDING_EVENTS);
  });

  it("rejects concurrent recording without calling the provider or adding a recording", async () => {
    const source = fake();
    const sink = new MemoryRecordingSink();
    const client = new RecordingModelClient(source, sink, options);
    const active = client.stream(request, new AbortController().signal)[Symbol.asyncIterator]();
    expect((await active.next()).value).toEqual(events[0]);
    expectError(await collect(client), "protocol", false);
    expect(source.stream).toHaveBeenCalledTimes(1);
    expect(sink.records).toHaveLength(0);
    await active.next();
    await active.next();
    await active.next();
    expect(sink.records).toHaveLength(1);
    expect(await collect(client)).toEqual(events);
    expect(sink.records).toHaveLength(2);
  });

  it("persists the delivered prefix when core cancels inside onText and closes the iterator", async () => {
    const sink = new MemoryRecordingSink();
    const abort = new AbortController();
    const model = new RecordingModelClient(fake(), sink, options);
    const response = await consumeResponse(model, request, abort.signal, 10000, () =>
      abort.abort(),
    );
    await model.flush();
    expect(response.error?.kind).toBe("cancelled");
    expect(response.parts).toEqual([{ type: "text", text: "answer" }]);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]?.events[0]).toEqual(events[0]);
    expectError(sink.records[0]?.events ?? [], "cancelled", true);
    const replay = new ReplayModelClient(sink.records, { apiProfile: options.apiProfile });
    expectError(await collect(replay), "cancelled", true);
  });

  it("records an interrupted snapshot when core stops at its response byte budget", async () => {
    const sink = new MemoryRecordingSink();
    const model = new RecordingModelClient(fake(), sink, options);
    const budget = Buffer.byteLength(canonicalizeJson(events[0])) + 1;
    const response = await consumeResponse(
      model,
      request,
      new AbortController().signal,
      budget,
      () => {},
    );
    await model.flush();
    expect(response.error?.message).toMatch(/byte limit/);
    expect(response.parts).toEqual([{ type: "text", text: "answer" }]);
    expect(sink.records).toHaveLength(1);
    expectError(sink.records[0]?.events ?? [], "stream_interrupted", true);
    expect(sink.records[0]?.events.slice(0, -1)).toEqual(events.slice(0, 2));
  });

  it("lets cancellation return promptly while flush waits for delayed sink finalization", async () => {
    const storage = new MemoryRecordingSink();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const abort = new AbortController();
    const model = new RecordingModelClient(
      fake(),
      {
        invalidate: (writeId) => storage.invalidate(writeId),
        async write(record, writeId) {
          entered.resolve();
          await release.promise;
          await storage.write(record, writeId);
        },
      },
      options,
    );
    const response = await consumeResponse(model, request, abort.signal, 10000, () =>
      abort.abort(),
    );
    expect(response.error?.kind).toBe("cancelled");
    await entered.promise;
    let flushed = false;
    const pending = model.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    release.resolve();
    await pending;
    expectError(storage.records[0]?.events ?? [], "cancelled", true);
  });

  it("invalidates output published before a custom sink throws and refuses legacy sinks", async () => {
    const storage = new MemoryRecordingSink();
    const model = new RecordingModelClient(
      fake(),
      {
        async write(record, writeId) {
          await storage.write(record, writeId);
          throw Error("post-publication failure");
        },
        invalidate: (writeId) => storage.invalidate(writeId),
      },
      options,
    );
    expectError(await collect(model), "protocol", true);
    expect(storage.records).toEqual([]);
    expectError(
      await collect(new ReplayModelClient(storage.records, { apiProfile: options.apiProfile })),
      "invalid_request",
      false,
    );
    expect(() => new RecordingModelClient(fake(), { async write() {} } as never, options)).toThrow(
      /invalidation/,
    );
  });

  it("rejects concurrent replay without consuming another exchange", async () => {
    const record = await recorded();
    const replay = new ReplayModelClient([record, record], { apiProfile: options.apiProfile });
    const active = replay.stream(request, new AbortController().signal)[Symbol.asyncIterator]();
    await active.next();
    expect(replay.remaining).toBe(1);
    expectError(await collect(replay), "protocol", false);
    expect(replay.remaining).toBe(1);
    await active.next();
    await active.next();
    await active.next();
    expect(await collect(replay)).toEqual(events);
    replay.assertConsumed();
  });
});

describe("private atomic file recordings", () => {
  it("writes owner-only canonical files and loads complete ordered exchanges", async () => {
    const destination = join(directory(), "recordings");
    const sink = new FileRecordingSink(destination);
    const record = await recorded();
    await sink.write(record);
    await sink.write(record);
    expect(statSync(destination).mode & 0o777).toBe(0o700);
    expect(readdirSync(destination).sort()).toEqual([
      "exchange-00000000.json",
      "exchange-00000001.json",
    ]);
    const path = join(destination, "exchange-00000000.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe(canonicalizeJson(record));
    expect(loadModelRecordings(destination)).toEqual([record, record]);
    expect(() => new FileRecordingSink(destination)).toThrow(/overwrite/);
  });

  it("does not overwrite a file created after sink initialization and removes its temporary file", async () => {
    const sink = new FileRecordingSink(join(directory(), "recordings"));
    const target = join(sink.directory, "exchange-00000000.json");
    writeFileSync(target, "existing", { mode: 0o600 });
    await expect(sink.write(await recorded())).rejects.toThrow();
    expect(readFileSync(target, "utf8")).toBe("existing");
    expect(readdirSync(sink.directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(readdirSync(sink.directory).some((name) => name.startsWith(".pending-"))).toBe(true);
    expect(() => loadModelRecordings(sink.directory)).toThrow(/incomplete/);
  });

  it.each(["after_publish", "before_ack"] as const)(
    "fails closed when real publication faults at %s",
    async (failureAt) => {
      let visited = false;
      const sink = new FileRecordingSink(join(directory(), "records"), {
        checkpoint(phase) {
          if (phase === failureAt) {
            visited = true;
            // A complete, otherwise valid artifact really exists before the fault.
            expect(readdirSync(sink.directory)).toContain("exchange-00000000.json");
            expect(readdirSync(sink.directory).some((name) => name.startsWith(".pending-"))).toBe(
              true,
            );
            throw Error("Synthetic publication acknowledgement failure");
          }
        },
      });
      const model = new RecordingModelClient(fake(), sink, options);
      expectError(await collect(model), "protocol", true);
      expect(visited).toBe(true);
      expect(readdirSync(sink.directory).some((name) => name.startsWith(".pending-"))).toBe(true);
      expect(readdirSync(sink.directory)).not.toContain("exchange-00000000.json");
      expect(() => loadModelRecordings(sink.directory)).toThrow(/incomplete/);
    },
  );

  it("persists real file recordings on core cancellation and revokes only the failed write ID", async () => {
    const sink = new FileRecordingSink(join(directory(), "records"));
    const abort = new AbortController();
    const model = new RecordingModelClient(fake(), sink, options);
    const response = await consumeResponse(model, request, abort.signal, 10000, () =>
      abort.abort(),
    );
    await model.flush();
    expect(response.error?.kind).toBe("cancelled");
    expectError(loadModelRecordings(sink.directory)[0]?.events ?? [], "cancelled", true);
    const memory = new MemoryRecordingSink();
    const record = await recorded();
    const first = "00000000-0000-0000-0000-000000000001";
    const second = "00000000-0000-0000-0000-000000000002";
    await memory.write(record, first);
    await memory.write(record, second);
    await memory.invalidate(second);
    await memory.invalidate(second);
    expect(memory.records).toEqual([record]);
  });

  it("rejects symlink directories/files and public directory/file permissions", async () => {
    const root = directory();
    const target = join(root, "real");
    mkdirSync(target, { mode: 0o700 });
    const alias = join(root, "alias");
    symlinkSync(target, alias);
    expect(() => new FileRecordingSink(alias)).toThrow(/symlink/);
    const sink = new FileRecordingSink(target);
    const outside = join(root, "outside.json");
    writeFileSync(outside, canonicalizeJson(await recorded()), { mode: 0o600 });
    symlinkSync(outside, join(target, "exchange-00000000.json"));
    expect(() => loadModelRecordings(target)).toThrow(/Unsafe/);
    rmSync(join(target, "exchange-00000000.json"));
    await sink.write(await recorded());
    chmodSync(join(target, "exchange-00000000.json"), 0o644);
    expect(() => loadModelRecordings(target)).toThrow(/Unsafe/);
    chmodSync(target, 0o755);
    expect(() => loadModelRecordings(target)).toThrow(/private/);
  });

  it.each(["truncated", "tampered", "duplicate", "gap", "oversize", "unknown"])(
    "rejects %s on-disk records",
    async (mode) => {
      const sink = new FileRecordingSink(join(directory(), "records"));
      const record = await recorded();
      await sink.write(record);
      const path = join(sink.directory, "exchange-00000000.json");
      if (mode === "truncated") writeFileSync(path, "{");
      if (mode === "tampered")
        writeFileSync(
          path,
          canonicalizeJson({ ...record, requestHash: `sha256:${"0".repeat(64)}` }),
        );
      if (mode === "duplicate")
        writeFileSync(
          path,
          canonicalizeJson(record).replace('{"contentHash":', '{"version":1,"contentHash":'),
        );
      if (mode === "gap") {
        writeFileSync(join(sink.directory, "exchange-00000002.json"), canonicalizeJson(record), {
          mode: 0o600,
        });
      }
      if (mode === "oversize") truncateSync(path, MAX_RECORDING_BYTES + 1);
      if (mode === "unknown") writeFileSync(path, canonicalizeJson({ ...record, version: 2 }));
      expect(() => loadModelRecordings(sink.directory)).toThrow();
    },
  );

  it("caps directory enumeration and file size before parsing artifact bytes", () => {
    const root = directory();
    for (let index = 0; index <= MAX_RECORDING_FILES; index++)
      writeFileSync(join(root, `extra-${index}`), "", { mode: 0o600 });
    expect(() => loadModelRecordings(root)).toThrow(/oversized/);
    const other = join(directory(), "aggregate");
    mkdirSync(other, { mode: 0o700 });
    // Per-file checks reject this sparse artifact without allocating its declared byte count.
    const path = join(other, "exchange-00000000.json");
    writeFileSync(path, "", { mode: 0o600 });
    truncateSync(path, MAX_RECORDING_TOTAL_BYTES + 1);
    expect(() => loadModelRecordings(other)).toThrow(/Unsafe/);
  });
});
