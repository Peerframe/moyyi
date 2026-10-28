import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ModelRequest,
  type ModelStreamEvent,
  type RunOutcome,
  type RuntimeEvent,
  type Timestamp,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { FileRecordingSink, loadModelRecordings } from "../src/runtime/model-recording.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const question = "Explain the observed behavior and what remains unverified.";
const draft = "Synthetic investigation draft, excluded from independent answer input.";
const answer = "Synthetic final response; this does not establish answer quality.";
function* textTurn(text: string): Generator<ModelStreamEvent> {
  yield { type: "text_delta", index: 0, text };
  yield { type: "part_completed", index: 0, part: { type: "text", text } };
  yield {
    type: "completed",
    stopReason: "end_turn",
    providerStopReason: "stop",
    usage: UNKNOWN_USAGE,
  };
}

async function harness(
  options: {
    blockFirstWrite?: boolean;
    failFirstWrite?: boolean;
    stallFirstStream?: boolean;
    blockFirstCleanup?: boolean;
    firstTerminal?: "network" | "max_tokens" | "refusal";
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-runtime-evidence-recording-"));
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  const store = new SqliteSessionStore(join(directory, "store"));
  const sink = new FileRecordingSink(join(directory, "recordings"));
  const release = Promise.withResolvers<void>();
  const sinkEntered = Promise.withResolvers<void>();
  const streamEntered = Promise.withResolvers<void>();
  const cleanupEntered = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<RunOutcome>();
  const events: RuntimeEvent[] = [];
  const requests: ModelRequest[] = [];
  const order: string[] = [];
  const timers = new Map<() => void, { due: number; milliseconds: number }>();
  let now = Date.parse("2026-10-28T00:00:00Z");
  let writes = 0;
  let providerActive = false;
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const [callback, timer] of timers) {
      if (timer.due > now) continue;
      timers.delete(callback);
      callback();
    }
  };
  const runtime = await createRuntime({
    store,
    documents: false,
    projectInstructions: false,
    evidenceAnswer: true,
    model: scriptedProfile.origin,
    limits: { maxModelRequests: 8, maxRetries: 0, timeoutMs: 300_000 },
    clock: { now: () => new Date(now).toISOString() as Timestamp },
    scheduler: {
      deadline(milliseconds, callback) {
        timers.set(callback, { due: now + milliseconds, milliseconds });
        return () => {
          timers.delete(callback);
        };
      },
      async sleep(milliseconds, signal) {
        signal.throwIfAborted();
        advance(milliseconds);
        signal.throwIfAborted();
      },
    },
    plugins: [
      {
        plugin: {
          name: "recording-phase-model",
          apiVersion: 1,
          setup(host) {
            host.registerModelProvider({
              id: scriptedProfile.origin.provider,
              models: [{ ...scriptedProfile, maxOutputTokens: 8192 }],
              createClient: () => ({
                async *stream(request, signal) {
                  expect(providerActive).toBe(false);
                  providerActive = true;
                  requests.push(request);
                  const index = requests.length;
                  order.push(`request-${index}`);
                  try {
                    if (index === 1) {
                      streamEntered.resolve();
                      if (options.stallFirstStream) {
                        yield { type: "text_delta", index: 0, text: "Partial investigation" };
                        if (!signal.aborted)
                          await new Promise<void>((resolve) =>
                            signal.addEventListener("abort", () => resolve(), { once: true }),
                          );
                        return;
                      }
                      if (options.firstTerminal) {
                        if (options.firstTerminal === "network") {
                          yield {
                            type: "error",
                            error: {
                              kind: "network",
                              message: "Synthetic network failure",
                              partialOutput: false,
                              usage: UNKNOWN_USAGE,
                            },
                          };
                        } else {
                          yield {
                            type: "part_completed",
                            index: 0,
                            part: {
                              type: options.firstTerminal === "refusal" ? "refusal" : "text",
                              text: "Synthetic terminal content",
                            },
                          };
                          yield {
                            type: "completed",
                            stopReason: options.firstTerminal,
                            providerStopReason: "synthetic",
                            usage: UNKNOWN_USAGE,
                          };
                        }
                        return;
                      }
                    }
                    yield* textTurn(index === 1 ? draft : answer);
                  } finally {
                    if (index === 1 && options.blockFirstCleanup) {
                      cleanupEntered.resolve();
                      await release.promise;
                    }
                    providerActive = false;
                    order.push(`closed-${index}`);
                  }
                },
              }),
            });
          },
        },
      },
    ],
    modelRecording: {
      apiProfile: "synthetic.phase-settlement/v1",
      source: "synthetic",
      sink: {
        async write(record, writeId) {
          const index = ++writes;
          if (index === 1) {
            sinkEntered.resolve();
            if (options.blockFirstWrite) await release.promise;
          }
          await sink.write(record, writeId);
          if (index === 1 && options.failFirstWrite) throw Error("private synthetic sink detail");
          order.push(`saved-${index}`);
        },
        invalidate: (writeId) => sink.invalidate(writeId),
      },
    },
  });
  cleanups.push(async () => {
    release.resolve();
    try {
      await runtime.close();
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  runtime.subscribe((event) => {
    events.push(event);
    if (event.type === "run.finished") finished.resolve(event.outcome);
  });
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const ready = events.find((event) => event.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("Session creation failed");
  await runtime.send({
    type: "run.start",
    sessionId: ready.sessionId,
    input: [{ type: "text", text: question }],
  });
  return {
    runtime,
    store,
    sink,
    release,
    sinkEntered,
    streamEntered,
    cleanupEntered,
    finished,
    events,
    requests,
    order,
    timers,
    advance,
    sessionId: ready.sessionId,
  };
}

describe("runtime recorder settlement before an evidence answer", () => {
  it("waits for cancelled investigation recording before starting the next request", async () => {
    const h = await harness({ blockFirstWrite: true, stallFirstStream: true });
    await h.streamEntered.promise;
    h.advance(100_000);
    await h.sinkEntered.promise;
    expect(h.requests).toHaveLength(1);
    expect(h.order).toContain("closed-1");
    expect(() => loadModelRecordings(h.sink.directory)).toThrow("Recording directory is empty");
    h.release.resolve();
    expect(await h.finished.promise).toEqual({ kind: "completed" });
    await h.runtime.idle();
    expect(h.requests).toHaveLength(2);
    expect(h.order.indexOf("request-2")).toBeGreaterThan(h.order.indexOf("saved-1"));
    const records = loadModelRecordings(h.sink.directory);
    expect(records).toHaveLength(2);
    expect(records[0]?.events.at(-1)).toMatchObject({
      type: "error",
      error: { kind: "cancelled" },
    });
    expect(records[1]?.events.at(-1)).toMatchObject({ type: "completed", stopReason: "end_turn" });
    expect(records[1]?.request).toMatchObject({ toolChoice: "none", maxOutputTokens: 8192 });
    expect(JSON.stringify(records[1]?.request.messages)).toContain(question);
    expect(JSON.stringify(records[1]?.request.messages)).not.toContain("Partial investigation");
    const snapshot = await h.store.loadSession(h.sessionId);
    expect(snapshot?.effects).toEqual([]);
  });

  it("stops before a second request when a collected terminal fails publication after phase cancellation", async () => {
    const h = await harness({ blockFirstWrite: true, failFirstWrite: true });
    await h.sinkEntered.promise;
    h.advance(100_000);
    h.release.resolve();
    const outcome = await h.finished.promise;
    expect(outcome.kind).toBe("failed");
    expect(JSON.stringify(outcome)).not.toContain("private synthetic sink detail");
    await h.runtime.idle();
    expect(h.requests).toHaveLength(1);
    expect(h.order).not.toContain("request-2");
    expect(() => loadModelRecordings(h.sink.directory)).toThrow();
  });

  it("fails at the cleanup cap while a sink is stuck and never starts an overlapping request", async () => {
    const h = await harness({ blockFirstWrite: true });
    await h.sinkEntered.promise;
    h.advance(100_000);
    await vi.waitFor(() =>
      expect([...h.timers.values()].some(({ milliseconds }) => milliseconds === 1000)).toBe(true),
    );
    h.advance(1000);
    expect((await h.finished.promise).kind).toBe("failed");
    expect(h.requests).toHaveLength(1);
    h.release.resolve();
    await h.runtime.idle();
    expect(h.requests).toHaveLength(1);
    expect(loadModelRecordings(h.sink.directory)).toHaveLength(1);
  });

  it("also bounds provider cleanup hidden behind the recorder before another request", async () => {
    const h = await harness({ stallFirstStream: true, blockFirstCleanup: true });
    await h.streamEntered.promise;
    h.advance(100_000);
    await h.cleanupEntered.promise;
    await vi.waitFor(() =>
      expect([...h.timers.values()].some(({ milliseconds }) => milliseconds === 1000)).toBe(true),
    );
    h.advance(1000);
    expect((await h.finished.promise).kind).toBe("failed");
    expect(h.requests).toHaveLength(1);
    h.release.resolve();
    await h.runtime.idle();
    expect(h.order).toContain("closed-1");
    expect(h.order).not.toContain("request-2");
    expect(loadModelRecordings(h.sink.directory)).toHaveLength(1);
  });

  it.each(["network", "max_tokens", "refusal"] as const)(
    "does not replace a %s terminal delayed by recording publication",
    async (firstTerminal) => {
      const h = await harness({ blockFirstWrite: true, firstTerminal });
      await h.sinkEntered.promise;
      h.advance(100_000);
      h.release.resolve();
      const outcome = await h.finished.promise;
      expect(h.requests).toHaveLength(1);
      expect(outcome.kind).toBe(
        firstTerminal === "network"
          ? "failed"
          : firstTerminal === "max_tokens"
            ? "budget_exhausted"
            : "completed",
      );
      if (firstTerminal === "max_tokens")
        expect(outcome).toEqual({ kind: "budget_exhausted", budget: "model_output_tokens" });
      await h.runtime.idle();
      const records = loadModelRecordings(h.sink.directory);
      expect(records).toHaveLength(1);
      expect(records[0]?.events.at(-1)).toMatchObject(
        firstTerminal === "network"
          ? { type: "error", error: { kind: "network" } }
          : { type: "completed", stopReason: firstTerminal },
      );
      const snapshot = await h.store.loadSession(h.sessionId);
      expect(
        snapshot?.entries.some(
          (entry) => entry.body.kind === "notice" && entry.body.code === "evidence_answer",
        ),
      ).toBe(false);
    },
  );

  it.each(["network", "max_tokens"] as const)(
    "preserves a validated %s terminal while provider EOF is delayed across phase cancellation",
    async (firstTerminal) => {
      const h = await harness({ blockFirstCleanup: true, firstTerminal });
      await h.cleanupEntered.promise;
      h.advance(100_000);
      h.release.resolve();
      const outcome = await h.finished.promise;
      expect(outcome.kind).toBe(firstTerminal === "network" ? "failed" : "budget_exhausted");
      await h.runtime.idle();
      expect(h.requests).toHaveLength(1);
      expect(loadModelRecordings(h.sink.directory)[0]?.events.at(-1)).toMatchObject(
        firstTerminal === "network"
          ? { type: "error", error: { kind: "network" } }
          : { type: "completed", stopReason: "max_tokens" },
      );
    },
  );

  it("retains normal acknowledged draft and final recordings", async () => {
    const h = await harness();
    expect(await h.finished.promise).toEqual({ kind: "completed" });
    await h.runtime.idle();
    const records = loadModelRecordings(h.sink.directory);
    expect(records).toHaveLength(2);
    expect(h.requests).toHaveLength(2);
    expect(records.every((record) => record.events.at(-1)?.type === "completed")).toBe(true);
    expect(h.order.indexOf("request-2")).toBeGreaterThan(h.order.indexOf("saved-1"));
    expect(JSON.stringify(records[1]?.request.messages)).not.toContain(draft);
  });
});
