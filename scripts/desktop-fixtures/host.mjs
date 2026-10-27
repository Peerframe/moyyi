import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UNKNOWN_USAGE } from "moyyi/contracts";
import { createRuntime } from "moyyi/runtime";

// This external test is copied beside the installed application only in a disposable copy.
// The worker imports this same production host.mjs; the bundle has no test model/backend.
const { createDesktopHost } = await import(new URL("../host.mjs", import.meta.url));
assert.equal(typeof createRuntime, "function");
assert.equal(process.version, "v26.12.1");
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
assert(!existsSync(join(appDirectory, "node_modules/moyyi/src")));
assert(
  import.meta
    .resolve("moyyi/runtime")
    .startsWith(new URL("../node_modules/moyyi/", import.meta.url).href),
);
assert(readFileSync(join(appDirectory, "worker.mjs"), "utf8").includes("./host.mjs"));

const [workspace, privateDirectory, workerHome] = process.argv.slice(2);
assert(workspace && privateDirectory && workerHome);
const original = readFileSync(join(workspace, "note.txt"));
const pdf = readFileSync(join(workspace, "sample.pdf"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const origin = { provider: "installed-desktop-fixture", model: "scripted" };
const steps = [];
const requests = [];
const cases = [];
let keyReads = 0;
let nextCall = 0;
const complete = (stopReason = "end_turn") => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const answer = (text) => [
  { type: "text_delta", index: 0, text },
  { type: "part_completed", index: 0, part: { type: "text", text } },
  complete(),
];
function call(name, args) {
  const id = `installed_desktop_${++nextCall}`;
  return [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId: id,
        providerCallId: id,
        providerItemId: null,
        name,
        rawArguments: JSON.stringify(args),
        argumentsSource: "verbatim",
      },
    },
    complete("tool_use"),
  ];
}
const plugin = {
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
          requests.push(structuredClone(request));
          const step = steps.shift();
          assert(step, "Unexpected extra synthetic request");
          if (typeof step === "function") yield* step(signal);
          else yield* step;
        },
      }),
    });
  },
};
const options = {
  model: origin,
  dataDirectory: privateDirectory,
  plugins: [{ plugin }],
  deepseek: {
    getApiKey() {
      keyReads++;
      throw Error("Credential access is forbidden in this probe");
    },
  },
  limits: {
    maxModelRequests: 3,
    maxRetries: 0,
    timeoutMs: 120_000,
    maxInputBytes: 65_536,
    maxModelResponseBytes: 1_048_576,
    maxToolOutputBytes: 32_768,
    maxParallelReads: 1,
  },
};
const open = () => createDesktopHost({ runtimeOptions: () => options, maxOutputTokens: 8192 });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Installed desktop fixture attempted network access");
};
let host;

function waitFor(target, predicate, label) {
  if (predicate(target.getState())) return Promise.resolve(target.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(Error(`Timed out: ${label}`));
    }, 20_000);
    const off = target.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      off();
      resolve(state);
    });
  });
}
async function start(text) {
  await host.dispatch({ type: "start", sessionId: host.getState().activeSessionId, text });
}
async function finish() {
  const state = await waitFor(
    host,
    (value) => value.outcome !== null && value.run === null,
    "run completion",
  );
  assert.equal(state.outcome.kind, "completed", JSON.stringify(state.outcome));
  return state;
}

try {
  host = await open();
  assert.equal(requests.length, 0);
  assert.equal(keyReads, 0);
  await assert.rejects(open(), /store is locked/i);
  cases.push("public runtime starts without model/key access and refuses another store writer");

  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  const readSession = host.getState().activeSessionId;
  steps.push(call("read", { path: "note.txt" }), answer("Installed read complete"));
  await start("Read note.txt");
  let state = await finish();
  assert(
    state.messages.some(
      (message) =>
        message.role === "tool" &&
        message.state === "succeeded" &&
        message.text.includes("INSTALLED_NOTE_CANARY"),
    ),
  );
  assert(JSON.stringify(requests.at(-1)).includes("INSTALLED_NOTE_CANARY"));
  assert.equal(requests.length, 2);
  cases.push("real read result reaches the next synthetic request through the packaged host");

  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: true });
  steps.push(call("read", { path: "note.txt" }), answer("Read denied"));
  await start("Read with approval");
  const waiting = await waitFor(host, (value) => value.pendingApproval !== null, "read approval");
  const approval = waiting.pendingApproval;
  await assert.rejects(
    host.dispatch({
      type: "approve",
      effectId: approval.effectId,
      digest: "stale",
      decision: "approve",
    }),
    /stale/,
  );
  assert.equal(requests.length, 3);
  assert.equal(host.getState().pendingApproval.digest, approval.digest);
  await host.dispatch({
    type: "approve",
    effectId: approval.effectId,
    digest: approval.digest,
    decision: "deny",
  });
  state = await finish();
  assert(state.messages.some((message) => message.role === "tool" && message.state === "denied"));
  assert(
    !state.messages.some(
      (message) => message.role === "tool" && message.text.includes("INSTALLED_NOTE_CANARY"),
    ),
  );
  cases.push("stale approval is rejected and denial withholds file content");

  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  const cancelledSession = host.getState().activeSessionId;
  steps.push(async function* (signal) {
    yield { type: "text_delta", index: 0, text: "INSTALLED_PARTIAL" };
    if (!signal.aborted)
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    yield {
      type: "error",
      error: {
        kind: "cancelled",
        message: "Fixture cancelled",
        partialOutput: true,
        usage: UNKNOWN_USAGE,
      },
    };
  });
  await start("Wait for cancellation");
  state = await waitFor(
    host,
    (value) => value.streamText === "INSTALLED_PARTIAL",
    "partial stream",
  );
  await host.dispatch({ type: "cancel", runId: state.run.id });
  await waitFor(host, (value) => value.outcome?.kind === "cancelled", "cancelled outcome");
  await host.close();
  host = await open();
  assert(host.getState().sessions.items.some((session) => session.sessionId === cancelledSession));
  await host.dispatch({ type: "load", sessionId: cancelledSession, askEachRead: false });
  assert(host.getState().messages.some((message) => message.text === "INSTALLED_PARTIAL"));
  assert.equal(host.getState().pendingApproval, null);
  await host.dispatch({ type: "load", sessionId: readSession, askEachRead: false });
  assert(host.getState().messages.some((message) => message.text === "Installed read complete"));
  assert.equal(requests.length, 5);
  cases.push("cancel and SQLite reopen preserve partial/history without replay or model access");

  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  steps.push(call("read_document", { path: "sample.pdf" }), answer("PDF observed"));
  await start("Read the installed PDF fixture");
  state = await finish();
  assert(
    state.messages.some(
      (message) =>
        message.role === "tool" &&
        message.state === "succeeded" &&
        message.text.includes("INSTALLED_PDF_CANARY"),
    ),
  );
  assert(JSON.stringify(requests.at(-1)).includes("INSTALLED_PDF_CANARY"));
  assert.equal(digest(readFileSync(join(workspace, "sample.pdf"))), digest(pdf));
  assert.deepEqual(readFileSync(join(workspace, "note.txt")), original);
  cases.push("read_document extracts the unchanged PDF using installed dependencies");
  assert.equal(keyReads, 0);
  assert.equal(requests.length, 7);
  assert.equal(steps.length, 0);
  await host.close();
  host = undefined;
  cases.push("all scripted tasks retain zero credential reads and no network fallback");

  mkdirSync(workerHome, { recursive: true });
  const workerResult = await verifyProductionWorker();
  cases.push(
    "production worker with empty HOME lists/reopens history and refuses missing-connection runs",
  );
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      liveModel: false,
      syntheticRequests: requests.length,
      credentialReads: keyReads,
      productionWorker: workerResult,
    }),
  );
} finally {
  await host?.close();
  globalThis.fetch = originalFetch;
}

async function verifyProductionWorker() {
  async function launch() {
    const child = fork(join(appDirectory, "worker.mjs"), [], {
      execPath: process.execPath,
      execArgv: ["--no-experimental-strip-types"],
      cwd: appDirectory,
      env: { HOME: workerHome, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "json",
    });
    let state;
    let failure;
    let sequence = 0;
    let stderr = "";
    const pending = new Map();
    const observers = new Set();
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.on("message", (message) => {
      if (message.type === "state") {
        state = message.state;
        for (const observer of observers) observer();
      } else if (message.type === "fatal") {
        failure = Error(message.message);
        for (const observer of observers) observer();
      } else if (message.type === "ack") {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        message.error ? request.reject(Error(message.error)) : request.resolve(state);
      }
    });
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => {
        failure ??= Error(`Worker exited: ${code}/${signal} ${stderr}`);
        for (const request of pending.values()) request.reject(failure);
        pending.clear();
        for (const observer of observers) observer();
        resolve({ code, signal });
      }),
    );
    async function bounded(promise, label) {
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error(`Worker timeout: ${label}`)), 20_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    async function request(command) {
      assert(child.connected);
      const id = ++sequence;
      return bounded(
        new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          child.send({ type: "command", id, command }, (error) => {
            if (error) {
              pending.delete(id);
              reject(error);
            }
          });
        }),
        command.type,
      );
    }
    async function close() {
      let acknowledgementError;
      try {
        if (child.connected && !failure) await request({ type: "close" });
      } catch (error) {
        acknowledgementError = error;
      }
      if (child.connected) child.disconnect();
      try {
        assert.equal((await bounded(exited, "exit")).code, 0);
      } catch (error) {
        child.kill("SIGKILL");
        await exited;
        throw error;
      }
      if (acknowledgementError) throw acknowledgementError;
    }
    try {
      await bounded(
        new Promise((resolve, reject) => {
          const check = () => {
            if (failure) {
              observers.delete(check);
              reject(failure);
            } else if (state) {
              observers.delete(check);
              resolve();
            }
          };
          observers.add(check);
          check();
        }),
        "initial state",
      );
    } catch (error) {
      if (child.connected) child.disconnect();
      child.kill("SIGKILL");
      await exited;
      throw error;
    }
    return { state: () => state, request, close };
  }
  let worker = await launch();
  let sessionId;
  try {
    assert.equal(worker.state().connection.ready, false);
    assert.equal(worker.state().run, null);
    const created = await worker.request({
      type: "create",
      workspaceRoot: workspace,
      askEachRead: false,
    });
    sessionId = created.activeSessionId;
    assert(sessionId);
    await worker.request({ type: "list", offset: 0 });
    assert(worker.state().sessions.items.some((item) => item.sessionId === sessionId));
  } finally {
    await worker.close();
  }
  worker = await launch();
  try {
    assert.equal(worker.state().connection.ready, false);
    assert(worker.state().sessions.items.some((item) => item.sessionId === sessionId));
    await worker.request({ type: "load", sessionId, askEachRead: false });
    await assert.rejects(
      worker.request({ type: "start", sessionId, text: "Must not contact the model" }),
      /unavailable/,
    );
    assert.equal(worker.state().run, null);
    assert.equal(worker.state().messages.length, 0);
  } finally {
    await worker.close();
  }
  return {
    emptyHome: true,
    missingConnectionRejected: true,
    historyRestored: true,
    cleanExit: true,
  };
}
