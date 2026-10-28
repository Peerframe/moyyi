import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { createRuntime, kimiApiProfile } from "moyyi/runtime";

// Copied beside the installed app. Only HTTP responses are synthetic; provider, core,
// request records and SQLite are the installed production implementations.
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
assert.equal(process.version, "v26.12.1");
assert(!existsSync(join(appDirectory, "node_modules/moyyi/src")));
assert(
  import.meta
    .resolve("moyyi/runtime")
    .startsWith(new URL("../node_modules/moyyi/", import.meta.url).href),
);
const directory = mkdtempSync(join(tmpdir(), "moyyi-installed-kimi-errors-"));
const workspace = join(directory, "workspace");
mkdirSync(workspace);
const note = "INSTALLED_KIMI_ERROR_SOURCE_UNCHANGED\n";
writeFileSync(join(workspace, "note.txt"), note);
const question = "Read note.txt and explain what it contains. Report any incomplete work.";
const input = [{ type: "text", text: question }];
const secret = "PRIVATE_PROVIDER_DIAGNOSTIC_MUST_NOT_ESCAPE";
const expectations = [
  {
    type: "engine_overloaded_error",
    kind: "overloaded",
    message:
      "Kimi HTTP 429 (engine_overloaded_error): Kimi service is overloaded. Wait for service capacity before starting a new run.",
  },
  {
    type: "rate_limit_reached_error",
    kind: "rate_limited",
    message:
      "Kimi HTTP 429 (rate_limit_reached_error): Kimi account rate limit was reached. Check concurrent usage and RPM, TPM or TPD limits before starting a new run.",
  },
  {
    type: "exceeded_current_quota_error",
    kind: "auth",
    message:
      "Kimi HTTP 429 (exceeded_current_quota_error): Kimi account quota is unavailable. Check account balance and quota before starting a new run.",
  },
  {
    type: "unrecognized_synthetic_error",
    kind: "rate_limited",
    message:
      "Kimi HTTP 429; the specific cause is unknown. Check account limits and service status before starting a new run.",
  },
];
let networkAttempts = 0;
const denyNetwork = () => {
  networkAttempts++;
  throw Error("Network access is forbidden by the installed Kimi error probe");
};
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = denyNetwork;
syncBuiltinESMExports();
const cases = [];
let syntheticRequests = 0;
let runtime;
try {
  for (const expected of expectations) {
    const events = [];
    const recordings = new Map();
    const requests = [];
    let bodyReads = 0;
    let closes = 0;
    const dataDirectory = join(directory, expected.type);
    const options = {
      model: { provider: "kimi", model: "kimi-k3.1-pro" },
      kimiReasoningEffort: "high",
      evidenceAnswer: true,
      dataDirectory,
      limits: { maxModelRequests: 8, timeoutMs: 300_000, maxRetries: 0 },
      kimi: {
        async transport(body, signal) {
          assert.equal(signal.aborted, false);
          requests.push(JSON.parse(body));
          syntheticRequests++;
          assert.equal(requests.length, 1, "An HTTP error must not trigger another request");
          return {
            status: 429,
            contentType: "application/json; charset=utf-8",
            retryAfter: "1",
            body: {
              async *[Symbol.asyncIterator]() {
                bodyReads++;
                yield new TextEncoder().encode(
                  JSON.stringify({
                    error: { type: expected.type, message: secret, code: `${secret}_CODE` },
                  }),
                );
              },
            },
            async close() {
              closes++;
            },
          };
        },
      },
      modelRecording: {
        apiProfile: kimiApiProfile("high"),
        source: "synthetic",
        sink: {
          async write(recording, id) {
            assert(!recordings.has(id));
            recordings.set(id, structuredClone(recording));
          },
          async invalidate(id) {
            recordings.delete(id);
          },
        },
      },
    };
    runtime = await createRuntime(options);
    assert(
      runtime.plugins.some(
        (plugin) => plugin.name === "provider-kimi" && plugin.state === "loaded",
      ),
    );
    assert.equal(requests.length, 0);
    runtime.subscribe((event) => events.push(event));
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    const sessionId = events.find((event) => event.type === "session.ready")?.sessionId;
    assert(sessionId);
    await runtime.send({ type: "run.start", sessionId, input });
    await runtime.idle();
    const outcomes = events.filter((event) => event.type === "run.finished");
    assert.equal(outcomes.length, 1);
    assert.deepEqual(outcomes[0].outcome, { kind: "failed", reason: expected.message });
    assert.equal(requests.length, 1);
    assert.equal(bodyReads, 1);
    assert.equal(closes, 1);
    assert.equal(recordings.size, 1);
    const recording = [...recordings.values()][0];
    assert.deepEqual(recording.events, [
      {
        type: "error",
        error: {
          kind: expected.kind,
          message: expected.message,
          retryAfterMs: 1000,
          partialOutput: false,
          usage: UNKNOWN_USAGE,
        },
      },
    ]);
    assert.equal(recording.request.maxOutputTokens, 8192);
    assert.deepEqual(
      recording.request.messages
        .filter((message) => message.role === "user")
        .flatMap((message) => message.content)
        .filter((part) => part.type === "text" && part.text === question),
      input,
    );
    assert.equal(requests[0].reasoning_effort, "high");
    assert.equal(requests[0].max_completion_tokens, 8192);
    assert.equal(requests[0].model, "kimi-k3.1-pro");
    const entries = events
      .filter((event) => event.type === "entry.appended")
      .map((event) => event.entry);
    const users = entries.filter((entry) => entry.body.kind === "user_message");
    assert.equal(users.length, 1);
    assert.deepEqual(users[0].body.content, input);
    const assistants = entries.filter((entry) => entry.body.kind === "assistant_message");
    assert.equal(assistants.length, 1);
    assert.deepEqual(assistants[0].body.content, []);
    assert.equal(assistants[0].body.stopReason, "interrupted");
    assert.equal(assistants[0].body.request.rendererVersion, "moyyi-core-v2");
    assert.deepEqual(assistants[0].body.usage, UNKNOWN_USAGE);
    assert.equal(entries.filter((entry) => entry.body.kind === "tool_results").length, 0);
    assert.equal(events.filter((event) => event.type === "effect.updated").length, 0);
    assert.equal(events.filter((event) => event.type === "assistant.delta").length, 0);
    const notices = entries.filter((entry) => entry.body.kind === "notice");
    assert.equal(notices.filter((entry) => entry.body.code === "model_request_budget").length, 1);
    assert.equal(notices.filter((entry) => entry.body.code === "model_retry").length, 0);
    assert.equal(notices.filter((entry) => entry.body.code === "evidence_answer").length, 0);
    assert(!JSON.stringify({ events, recording, requests }).includes(secret));
    assert.deepEqual(runtime.diagnostics, []);
    await runtime.close();
    runtime = undefined;

    // Reopen through the public client protocol and verify the original persisted request blobs.
    const reopened = [];
    runtime = await createRuntime(options);
    runtime.subscribe((event) => reopened.push(event));
    await runtime.send({ type: "session.load", sessionId });
    await runtime.idle();
    assert.deepEqual(
      reopened.filter((event) => event.type === "entry.appended").map((event) => event.entry),
      entries,
    );
    const persistedMessages = assistants[0].body.request.messages.map((reference) => {
      const bytes = readFileSync(join(dataDirectory, "blobs", reference.slice(7)));
      assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, reference);
      return JSON.parse(bytes);
    });
    assert.deepEqual(persistedMessages, recording.request.messages);
    assert.equal(requests.length, 1, "Reopening history must not replay the failed request");
    assert.equal(recordings.size, 1);
    assert.equal(readFileSync(join(workspace, "note.txt"), "utf8"), note);
    await runtime.close();
    runtime = undefined;
    cases.push(`${expected.type}: one failed request, safe classification and retained history`);
  }
  assert.equal(networkAttempts, 0);
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      syntheticRequests,
      networkAttempts,
      credentialReads: 0,
      toolExecutions: 0,
      automaticRetries: 0,
      liveModel: false,
    }),
  );
} finally {
  await runtime?.close();
  rmSync(directory, { recursive: true, force: true });
}
