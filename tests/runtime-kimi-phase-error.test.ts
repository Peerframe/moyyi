import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { RuntimeEvent, Timestamp } from "../src/contracts/index.ts";
import { kimiFixture, kimiFixtureTransport } from "../src/plugins/provider-kimi/fixtures.ts";
import {
  type KimiTransport,
  kimiApiProfile,
  kimiProfile,
} from "../src/plugins/provider-kimi/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { MemoryRecordingSink } from "../src/runtime/model-recording.ts";

it.each(["phase", "user"] as const)(
  "does not start another request when %s cancellation interrupts a known HTTP 429 diagnostic",
  async (cancellation) => {
    const directory = mkdtempSync(join(tmpdir(), "moyyi-kimi-phase-error-"));
    const workspace = join(directory, "workspace");
    mkdirSync(workspace);
    const entered = Promise.withResolvers<void>();
    const pendingBody = Promise.withResolvers<IteratorResult<Uint8Array>>();
    const close = vi.fn(async () => {});
    const cleanup = vi.fn(async () => ({ done: true as const, value: undefined }));
    const fallback = kimiFixtureTransport([
      kimiFixture({ text: "Must never become a final answer." }),
    ]);
    let calls = 0;
    const transport: KimiTransport = async (body, signal) => {
      if (++calls > 1) return fallback.transport(body, signal);
      return {
        status: 429,
        contentType: "application/json",
        retryAfter: null,
        body: {
          [Symbol.asyncIterator]: () => ({
            next: () => {
              entered.resolve();
              return pendingBody.promise;
            },
            return: cleanup,
          }),
        },
        close,
      };
    };
    const sink = new MemoryRecordingSink();
    const events: RuntimeEvent[] = [];
    let now = Date.parse("2026-10-28T00:00:00Z");
    const timers = new Map<() => void, number>();
    const runtime = await createRuntime({
      dataDirectory: join(directory, "data"),
      documents: false,
      projectInstructions: false,
      evidenceAnswer: true,
      model: kimiProfile.origin,
      kimiReasoningEffort: "high",
      kimi: { transport },
      limits: { maxModelRequests: 8, maxRetries: 0, timeoutMs: 300_000 },
      clock: { now: () => new Date(now).toISOString() as Timestamp },
      scheduler: {
        deadline(milliseconds, callback) {
          timers.set(callback, now + milliseconds);
          return () => {
            timers.delete(callback);
          };
        },
        async sleep() {
          throw Error("Unexpected retry");
        },
      },
      modelRecording: { sink, apiProfile: kimiApiProfile("high"), source: "synthetic" },
    });
    try {
      runtime.subscribe((event) => events.push(event));
      await runtime.send({ type: "session.create", workspaceRoot: workspace });
      const ready = events.find((event) => event.type === "session.ready");
      if (ready?.type !== "session.ready") throw Error("Missing session");
      await runtime.send({
        type: "run.start",
        sessionId: ready.sessionId,
        input: [{ type: "text", text: "Explain the available evidence." }],
      });
      await entered.promise;
      if (cancellation === "phase") {
        now += 100_000;
        for (const [callback, due] of timers) {
          if (due > now) continue;
          timers.delete(callback);
          callback();
        }
      } else {
        const started = events.find((event) => event.type === "run.started");
        if (started?.type !== "run.started") throw Error("Missing run");
        await runtime.send({ type: "run.cancel", runId: started.runId });
      }
      // The local interrupted recording can remain cancelled. Settlement must still reject
      // the late known HTTP failure, so it cannot be converted into a fresh-answer request.
      if (cancellation === "user")
        await expect(runtime.idle()).rejects.toThrow(
          "Recording observed a terminal failure during cancellation",
        );
      else await runtime.idle();
      expect(calls).toBe(1);
      expect(events.findLast((event) => event.type === "run.finished")).toMatchObject({
        outcome: { kind: cancellation === "phase" ? "failed" : "cancelled" },
      });
      expect(close).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(sink.records).toHaveLength(1);
      expect(sink.records[0]?.request.maxOutputTokens).toBe(8192);
    } finally {
      pendingBody.resolve({ done: true, value: undefined });
      await runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
