import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { UNKNOWN_USAGE } from "moyyi/contracts";
import { createRuntime } from "moyyi/runtime";

// Installed runtime and real file/store; only model events and time are synthetic.
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
assert(!existsSync(join(appDirectory, "node_modules/moyyi/src")));
assert(
  import.meta
    .resolve("moyyi/runtime")
    .startsWith(new URL("../node_modules/moyyi/", import.meta.url).href),
);
const directory = mkdtempSync(join(tmpdir(), "moyyi-installed-phase-"));
const workspace = join(directory, "workspace");
mkdirSync(workspace);
const note =
  "Fixed configuration is copied at startup; dynamic configuration is read on each request.\n";
writeFileSync(join(workspace, "note.txt"), note);
let networkAttempts = 0;
const denyNetwork = () => {
  networkAttempts++;
  throw Error("Network forbidden in phase probe");
};
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = denyNetwork;
syncBuiltinESMExports();
const started = Date.parse("2026-10-28T00:00:00Z");
let now = started;
const timers = new Map();
const advance = (milliseconds) => {
  now += milliseconds;
  for (const [callback, due] of timers) {
    if (due > now) continue;
    timers.delete(callback);
    callback();
  }
};
const origin = { provider: "installed-phase-fixture", model: "synthetic" };
const events = [];
const requests = [];
const records = [];
const order = [];
let active = false;
let runtime;
const complete = (stopReason = "end_turn") => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
try {
  runtime = await createRuntime({
    model: origin,
    dataDirectory: join(directory, "store"),
    documents: false,
    projectInstructions: false,
    evidenceAnswer: true,
    limits: { maxModelRequests: 8, timeoutMs: 300_000, maxRetries: 0 },
    clock: { now: () => new Date(now).toISOString() },
    scheduler: {
      deadline(milliseconds, callback) {
        timers.set(callback, now + milliseconds);
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
    modelRecording: {
      source: "synthetic",
      apiProfile: "installed.phase/v1",
      sink: {
        async write(record) {
          records.push(structuredClone(record));
          order.push(`saved-${records.length}`);
        },
        async invalidate() {
          throw Error("Unexpected record invalidation");
        },
      },
    },
    plugins: [
      {
        plugin: {
          name: origin.provider,
          apiVersion: 1,
          setup(host) {
            host.registerModelProvider({
              id: origin.provider,
              models: [
                {
                  origin,
                  contextWindowTokens: 200_000,
                  maxOutputTokens: 8192,
                  parallelToolCalls: false,
                  reasoning: "visible",
                  promptCache: "none",
                  editFormat: "search_replace",
                },
              ],
              createClient: () => ({
                async *stream(request, signal) {
                  assert.equal(active, false, "Never overlap investigation and final streams");
                  active = true;
                  const index = requests.push(structuredClone(request));
                  order.push(`request-${index}`);
                  assert(index <= 3, "No implicit retry or extra final request");
                  try {
                    if (index === 1) {
                      yield {
                        type: "part_completed",
                        index: 0,
                        part: {
                          type: "tool_call",
                          callId: "read_note",
                          providerCallId: "read_note",
                          providerItemId: null,
                          name: "read",
                          rawArguments: '{"path":"note.txt"}',
                          argumentsSource: "verbatim",
                        },
                      };
                      yield complete("tool_use");
                    } else if (index === 2) {
                      yield { type: "text_delta", index: 0, text: "PARTIAL_DRAFT_NOT_FINAL" };
                      advance(100_000);
                      assert.equal(signal.aborted, true);
                    } else {
                      assert.equal(now - started, 100_000);
                      assert.equal(
                        records.length,
                        2,
                        "Persist the interrupted request before final inference",
                      );
                      assert.equal(signal.aborted, false);
                      assert.equal(request.maxOutputTokens, 8192);
                      assert.equal(request.toolChoice, "none");
                      assert.equal(request.tools.length, 0);
                      assert.equal(request.messages.length, 1);
                      const packet = JSON.parse(request.messages[0].content[0].text);
                      assert.equal(packet.observations.length, 1);
                      assert(JSON.stringify(packet).includes(note.trim()));
                      assert(!JSON.stringify(request).includes("PARTIAL_DRAFT_NOT_FINAL"));
                      advance(50_000);
                      yield {
                        type: "part_completed",
                        index: 0,
                        part: { type: "text", text: "SYNTHETIC_FINAL_NOT_A_QUALITY_SCORE" },
                      };
                      yield complete();
                    }
                  } finally {
                    active = false;
                    order.push(`closed-${index}`);
                  }
                },
              }),
            });
          },
        },
      },
    ],
  });
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const sessionId = events.find((event) => event.type === "session.ready")?.sessionId;
  assert(sessionId);
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [
      {
        type: "text",
        text: "Read note.txt and compare configuration lifetimes. Do not modify files.",
      },
    ],
  });
  await runtime.idle();
  assert.equal(events.find((event) => event.type === "run.finished")?.outcome.kind, "completed");
  assert.equal(requests.length, 3);
  assert.equal(records.length, 3);
  assert(order.indexOf("closed-2") < order.indexOf("request-3"));
  assert(order.indexOf("saved-2") < order.indexOf("request-3"));
  const assistants = events.filter(
    (event) => event.type === "entry.appended" && event.entry.body.kind === "assistant_message",
  );
  assert.equal(assistants.length, 3);
  assert.equal(assistants[1].entry.body.stopReason, "interrupted");
  assert.equal(assistants[2].entry.body.request.rendererVersion, "moyyi-evidence-answer-v1");
  assert.equal(
    events.filter(
      (event) => event.type === "entry.appended" && event.entry.body.code === "model_retry",
    ).length,
    0,
  );
  await runtime.send({ type: "session.load", sessionId });
  assert.equal(requests.length, 3, "History loading is not a replay");
  assert.equal(readFileSync(join(workspace, "note.txt"), "utf8"), note);
  assert.equal(networkAttempts, 0);
  console.log(
    JSON.stringify({
      passed: true,
      syntheticRequests: requests.length,
      investigationMs: 100_000,
      elapsedMs: now - started,
      timeoutMs: 300_000,
      networkAttempts,
      automaticRetries: 0,
      liveModel: false,
      semanticQuality: "not measured",
    }),
  );
} finally {
  await runtime?.close();
  rmSync(directory, { recursive: true, force: true });
}
