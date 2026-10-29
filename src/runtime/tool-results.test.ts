import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeJson,
  type EntryId,
  type RunId,
  type SessionId,
  type Timestamp,
  type ToolCallId,
  type ToolCallPart,
  type ToolContext,
  type ToolResultPart,
  type TranscriptEntry,
  toolOutputHandle,
} from "../contracts/index.ts";
import { SqliteSessionStore } from "../store/index.ts";
import { RuntimeToolResults, readToolDeadlines } from "./tool-results.ts";

const stores: SqliteSessionStore[] = [];
const directories: string[] = [];
const runId = "output-run" as RunId;
const sessionId = "output-session" as SessionId;
const callId = "output-call" as ToolCallId;
const now = "2026-10-29T00:00:00Z" as Timestamp;
const bytes = (value: unknown) => Buffer.byteLength(canonicalizeJson(value));
function call(id: string, rawArguments = '{"path":"a","range":{"start":1,"end":2}}'): ToolCallPart {
  return {
    type: "tool_call",
    callId: id as ToolCallId,
    providerCallId: id,
    providerItemId: null,
    name: "read",
    rawArguments,
    argumentsSource: "verbatim",
  };
}
function result(id: ToolCallId, text = "Observed evidence"): ToolResultPart {
  return {
    type: "tool_result",
    callId: id,
    status: "succeeded",
    content: [{ type: "text", text }],
  };
}
function open(directory: string) {
  const store = new SqliteSessionStore(directory);
  stores.push(store);
  return store;
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-runtime-output-"));
  directories.push(directory);
  const store = open(directory);
  return { directory, store, processor: new RuntimeToolResults(store) };
}
const context = (id = sessionId): ToolContext => ({
  runId,
  sessionId: id,
  workspaceRoot: "/synthetic",
  signal: new AbortController().signal,
  limits: { maxOutputBytes: 1024 },
});
async function savedOutput(text: string) {
  const f = fixture();
  const processed = await f.processor.process({
    runId,
    sessionId,
    result: result(callId, text),
    maxOutputBytes: 512,
  });
  if (!processed.outputBlob) throw Error("Expected spill");
  const entry: TranscriptEntry = {
    id: "output-entry" as EntryId,
    sessionId,
    runId,
    parentId: null,
    createdAt: now,
    body: {
      kind: "tool_results",
      results: [processed.result],
      outputBlobs: [processed.outputBlob],
    },
  };
  await f.store.commit({
    entries: [entry],
    effects: [],
    durability: "normal",
    sessions: [
      { sessionId, workspaceRoot: f.directory, headEntryId: entry.id },
      { sessionId: "other-session" as SessionId, workspaceRoot: f.directory, headEntryId: null },
    ],
    runs: [{ sessionId, runId, status: "active" }],
  });
  await f.store.commit({
    entries: [],
    effects: [],
    durability: "normal",
    runs: [{ sessionId, runId, status: "completed" }],
  });
  return { ...f, ...processed, entry, handle: toolOutputHandle(processed.outputBlob) };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("runtime tool result presentation", () => {
  it.each([64, 128, 1024])(
    "keeps a bounded observation without spilling when reminder space is %s bytes",
    async (limit) => {
      const { processor, store } = fixture();
      const put = vi.spyOn(store, "putBlob");
      processor.begin(runId, [call("one"), call("two"), call(callId)]);
      const original = result(callId, "Done");
      const processed = await processor.process({
        runId,
        sessionId,
        result: original,
        maxOutputBytes: limit,
      });
      expect(processed.result.status).toBe("succeeded");
      expect(processed.result.content[0]).toEqual(original.content[0]);
      expect(processed.outputBlob).toBeUndefined();
      expect(put).not.toHaveBeenCalled();
      expect(bytes(processed.result.content)).toBeLessThanOrEqual(limit);
      if (limit === 64) expect(processed.result.content).toEqual(original.content);
      if (limit === 128)
        expect(processed.result.content.at(-1)).toEqual({
          type: "text",
          text: "Runtime reminder: repeated call; check existing evidence.",
        });
      if (limit === 1024)
        expect(processed.result.content.at(-1)).toEqual({
          type: "text",
          text: "Runtime reminder: this identical tool call has repeated. Check the evidence already returned and whether another call will add information.",
        });
    },
  );

  it("preserves the observation when there is no room even for the short reminder", async () => {
    const { processor, store } = fixture();
    const original = result(callId, "x".repeat(32));
    expect(bytes(original.content)).toBeLessThanOrEqual(64);
    const put = vi.spyOn(store, "putBlob");
    processor.begin(runId, [call("one"), call("two"), call(callId)]);
    expect(
      await processor.process({ runId, sessionId, result: original, maxOutputBytes: 64 }),
    ).toEqual({ result: original });
    expect(put).not.toHaveBeenCalled();
  });

  it.each([250, 300, 1024])(
    "keeps a real spill retrievable when only %s bytes are available for preview and advice",
    async (limit) => {
      const { processor, store } = fixture();
      const text = `HEAD ${"complete evidence ".repeat(1000)} TAIL`;
      processor.begin(
        runId,
        Array.from({ length: 5 }, (_, index) => call(index === 4 ? callId : `call-${index}`)),
      );
      const processed = await processor.process({
        runId,
        sessionId,
        result: result(callId, text),
        maxOutputBytes: limit,
      });
      if (!processed.outputBlob) throw Error("Expected full observation");
      expect(
        Buffer.from((await store.getBlob(processed.outputBlob.blob)) ?? []).toString("utf8") ===
          text,
      ).toBe(true);
      expect(processed.outputBlob.bytes).toBe(Buffer.byteLength(text));
      expect(bytes(processed.result.content)).toBeLessThanOrEqual(limit);
      expect(processed.result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining(toolOutputHandle(processed.outputBlob)),
      });
      if (limit === 250) expect(processed.result.content).toHaveLength(1);
      if (limit === 300)
        expect(processed.result.content.at(-1)).toEqual({
          type: "text",
          text: "Runtime reminder: repeated call; check existing evidence.",
        });
      if (limit === 1024)
        expect(processed.result.content.at(-1)).toMatchObject({
          type: "text",
          text: expect.stringContaining("repeated 5 times"),
        });
    },
  );

  it("still refuses a genuine oversized output when even its handle cannot fit", async () => {
    const { processor } = fixture();
    processor.begin(runId, [call("one"), call("two"), call(callId)]);
    await expect(
      processor.process({
        runId,
        sessionId,
        result: result(callId, "x".repeat(1000)),
        maxOutputBytes: 64,
      }),
    ).rejects.toThrow("Tool output limit cannot fit an output retrieval handle");
  });

  it("normalizes object keys, reminds at 3/5/8 only, and never blocks the observation", async () => {
    const { processor } = fixture();
    for (let index = 1; index <= 9; index++) {
      const value = call(
        `call-${index}`,
        index % 2
          ? '{"path":"a","range":{"end":2,"start":1}}'
          : ' { "range": {"start":1,"end":2}, "path":"a" } ',
      );
      processor.begin(runId, [value]);
      const processed = await processor.process({
        runId,
        sessionId,
        result: result(value.callId),
        maxOutputBytes: 1024,
      });
      expect(processed.result.status).toBe("succeeded");
      expect(processed.result.content[0]).toEqual({ type: "text", text: "Observed evidence" });
      expect(JSON.stringify(processed.result).includes("Runtime reminder")).toBe(
        [3, 5, 8].includes(index),
      );
      expect(processed.outputBlob).toBeUndefined();
    }
  });

  it("assigns reminders by call order despite reverse completion, and separates runs", async () => {
    const { processor } = fixture();
    const calls = Array.from({ length: 8 }, (_, index) => call(`parallel-${index + 1}`));
    processor.begin(runId, calls);
    processor.begin("other-run" as RunId, [call("other")]);
    for (const [index, value] of [...calls.entries()].reverse()) {
      const processed = await processor.process({
        runId,
        sessionId,
        result: result(value.callId),
        maxOutputBytes: 1024,
      });
      expect(JSON.stringify(processed.result).includes("Runtime reminder")).toBe(
        [2, 4, 7].includes(index),
      );
    }
    const other = await processor.process({
      runId: "other-run" as RunId,
      sessionId,
      result: result("other" as ToolCallId),
      maxOutputBytes: 1024,
    });
    expect(JSON.stringify(other)).not.toContain("Runtime reminder");
  });

  it.each(["arguments", "tool", "user", "finished"] as const)(
    "resets the chain after %s",
    async (reset) => {
      const { processor } = fixture();
      processor.begin(runId, [call("first"), call("second")]);
      if (reset === "arguments") processor.begin(runId, [call("different", '{"path":"b"}')]);
      if (reset === "tool") processor.begin(runId, [{ ...call("different"), name: "search" }]);
      if (reset === "user")
        processor.observe({
          type: "entry.appended",
          entry: {
            id: "steering" as EntryId,
            sessionId,
            runId,
            parentId: null,
            createdAt: now,
            body: {
              kind: "user_message",
              content: [{ type: "text", text: "Try something else" }],
              steering: true,
            },
          },
        });
      if (reset === "finished")
        processor.observe({ type: "run.finished", runId, outcome: { kind: "completed" } });
      const third = call("third");
      processor.begin(runId, [third]);
      expect(
        JSON.stringify(
          await processor.process({
            runId,
            sessionId,
            result: result(third.callId),
            maxOutputBytes: 1024,
          }),
        ),
      ).not.toContain("Runtime reminder");
    },
  );

  it("spills the complete observation, preserves UTF-8 head and tail, and excludes the reminder", async () => {
    const { processor, store } = fixture();
    processor.begin(runId, [call("one"), call("two"), call(callId)]);
    const text = `HEAD-中文\n${'long evidence 😀\\"\n'.repeat(2000)}TAIL-证据`;
    const processed = await processor.process({
      runId,
      sessionId,
      result: result(callId, text),
      maxOutputBytes: 1024,
    });
    if (!processed.outputBlob) throw Error("Expected full output reference");
    expect(
      Buffer.from((await store.getBlob(processed.outputBlob.blob)) ?? []).toString("utf8"),
    ).toBe(text);
    expect(processed.outputBlob.bytes).toBe(Buffer.byteLength(text));
    const rendered = JSON.stringify(processed.result.content);
    expect(rendered).toContain("HEAD-中文");
    expect(rendered).toContain("TAIL-证据");
    expect(rendered).toContain("bytes omitted");
    expect(rendered).toContain(toolOutputHandle(processed.outputBlob));
    expect(processed.result.content.at(-1)).toMatchObject({
      type: "text",
      text: expect.stringContaining("Runtime reminder"),
    });
    expect(bytes(processed.result.content)).toBeLessThanOrEqual(1024);
  });
});

describe("session-scoped stored output retrieval", () => {
  it("preserves literal U+FEFF at the preview head and at any range boundary", async () => {
    const f = await savedOutput(`\uFEFFABC\uFEFF${"evidence".repeat(100)}`);
    const preview = f.result.content[0];
    if (preview?.type !== "text") throw Error("Expected preview");
    expect(preview.text.startsWith("\uFEFFABC")).toBe(true);
    const reader = f.processor.create(context(), () => {});
    expect(JSON.parse(await reader.read(f.handle, 0, 6))).toMatchObject({
      offset: 0,
      nextOffset: 6,
      text: "\uFEFFABC",
    });
    expect(JSON.parse(await reader.read(f.handle, 6, 3))).toMatchObject({
      offset: 6,
      nextOffset: 9,
      text: "\uFEFF",
    });
  });

  it("moves offsets to a valid UTF-8 boundary and reports a useful next offset", async () => {
    const f = await savedOutput(`中😀文${"evidence".repeat(100)}`);
    const reader = f.processor.create(context(), () => {});
    const range = JSON.parse(await reader.read(f.handle, 1, 6));
    expect(range).toMatchObject({ offset: 3, nextOffset: 7, text: "😀" });
    const next = JSON.parse(await reader.read(f.handle, range.nextOffset, 3));
    expect(next).toMatchObject({ offset: 7, nextOffset: 10, text: "文" });
    await expect(reader.read(f.handle, 3, 1)).rejects.toThrow("cannot fit");
  });

  it("reconstructs full Unicode text through bounded byte ranges after reopening", async () => {
    const text = `HEAD\n${"中文😀 evidence\n".repeat(100)}TAIL`;
    const f = await savedOutput(text);
    f.store.close();
    const reopened = open(f.directory);
    const reader = new RuntimeToolResults(reopened).create(context(), () => {});
    let offset = 0;
    let recovered = "";
    do {
      const value = await reader.read(f.handle, offset, 113);
      expect(bytes([{ type: "text", text: value }])).toBeLessThanOrEqual(1024);
      const range = JSON.parse(value);
      expect(range.offset).toBe(offset);
      expect(range.totalBytes).toBe(Buffer.byteLength(text));
      expect(range.nextOffset).toBeGreaterThan(offset);
      expect(range.nextOffset - offset).toBeLessThanOrEqual(113);
      recovered += range.text;
      offset = range.nextOffset;
    } while (offset < Buffer.byteLength(text));
    expect(recovered).toBe(text);
    expect(JSON.parse(await reader.read(f.handle, offset, 1)).text).toBe("");
    expect((await reopened.loadSession(sessionId))?.entries).toEqual([f.entry]);
  });

  it("rejects another session's guessed handle without reading its blob", async () => {
    const f = await savedOutput("private evidence".repeat(100));
    const getBlob = vi.spyOn(f.store, "getBlob");
    const reader = f.processor.create(context("other-session" as SessionId), () => {});
    await expect(reader.read(f.handle, 0, 100)).rejects.toThrow("unavailable in this session");
    expect(getBlob).not.toHaveBeenCalled();
  });

  it.each([
    [-1, 1],
    [0, 0],
    [0, 8193],
    [0.5, 2],
    [100_000, 1],
  ])("rejects invalid range %s/%s", async (offset, length) => {
    const f = await savedOutput("evidence".repeat(100));
    await expect(
      f.processor.create(context(), () => {}).read(f.handle, offset, length),
    ).rejects.toThrow(/range|offset/);
  });

  it("rechecks authorization after loading the session before any blob access", async () => {
    const f = await savedOutput("evidence".repeat(100));
    const load = f.store.loadSession.bind(f.store);
    let permitted = true;
    vi.spyOn(f.store, "loadSession").mockImplementation(async (id) => {
      const snapshot = await load(id);
      permitted = false;
      return snapshot;
    });
    const getBlob = vi.spyOn(f.store, "getBlob");
    const reader = f.processor.create(context(), () => {
      if (!permitted) throw Error("revoked");
    });
    await expect(reader.read(f.handle, 0, 100)).rejects.toThrow("revoked");
    expect(getBlob).not.toHaveBeenCalled();
  });
});

it("uses the configured read deadline but leaves document termination to its own timeout", () => {
  let expire: (() => void) | undefined;
  const dispose = vi.fn();
  const deadline = vi.fn((_ms: number, callback: () => void) => {
    expire = callback;
    return dispose;
  });
  const factory = readToolDeadlines({ deadline, sleep: async () => {} }, 37);
  const parent = new AbortController();
  expect(factory.start("read_document", parent.signal)).toBeUndefined();
  expect(deadline).not.toHaveBeenCalled();
  const read = factory.start("read", parent.signal);
  expect(deadline).toHaveBeenCalledWith(37, expect.any(Function));
  expect(read?.signal.aborted).toBe(false);
  expire?.();
  expect(read?.signal.aborted).toBe(true);
  expect(read?.timeoutMessage).toBe("tool call timed out after 37ms");
  read?.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});
