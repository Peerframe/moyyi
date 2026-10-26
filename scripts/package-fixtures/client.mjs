import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UNKNOWN_USAGE } from "moyyi/contracts";
import {
  ANTHROPIC_API_PROFILE,
  createRuntime,
  DEEPSEEK_API_PROFILE,
  FileRecordingSink,
  loadModelRecordings,
  WebPolicy,
} from "moyyi/runtime";

// Copied outside the repository by the package gate. Every model response is synthetic;
// runtime, installed imports, filesystem effects, approvals and SQLite remain real.
for (const helper of [FileRecordingSink, loadModelRecordings, WebPolicy])
  assert.equal(typeof helper, "function");
assert.equal(typeof DEEPSEEK_API_PROFILE, "string");
assert.equal(typeof ANTHROPIC_API_PROFILE, "string");
const directory = mkdtempSync(join(tmpdir(), "moyyi-installed-client-"));
const workspace = join(directory, "workspace");
const dataDirectory = join(directory, "private-data");
const skillRoot = join(directory, "skills-library");
const skillDirectory = join(skillRoot, "package-review");
mkdirSync(skillDirectory, { recursive: true });
const skillDocument = (body) =>
  `---\nname: package-review\ndescription: Inspect package fixtures\nallowed-tools: shell\n---\n${body}\n`;
writeFileSync(join(skillDirectory, "SKILL.md"), skillDocument("INSTALLED_SKILL_FIRST"));
mkdirSync(workspace);
writeFileSync(join(workspace, "protected.txt"), "UNCHANGED");
writeFileSync(join(workspace, "AGENTS.md"), "INSTALLED_ROOT_GUIDANCE_FIRST");
writeFileSync(join(directory, "outside.txt"), "OUTSIDE_UNCHANGED");
const cases = [];
const events = [];
const requests = [];
const steps = [];
const origin = { provider: "package-fixture", model: "synthetic" };
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
let nextCall = 0;
const tool = (name, args) => {
  const id = `package_call_${++nextCall}`;
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
};
const plugin = {
  name: "package-fixture",
  apiVersion: 1,
  setup(host) {
    host.registerModelProvider({
      id: origin.provider,
      models: [
        {
          origin,
          contextWindowTokens: 200_000,
          maxOutputTokens: 8_000,
          parallelToolCalls: false,
          reasoning: "none",
          promptCache: "none",
          editFormat: "search_replace",
        },
      ],
      createClient() {
        return {
          async *stream(request, signal) {
            requests.push(structuredClone(request));
            const step = steps.shift();
            assert(step, "Unexpected extra model request");
            if (typeof step === "function") yield* step(request, signal);
            else yield* step;
          },
        };
      },
    });
  },
};
let developmentVersion = "version-one";
let loads = 0;
let disposals = 0;
const options = {
  model: origin,
  dataDirectory,
  skills: { root: skillRoot, enabled: ["package-review"] },
  plugins: [{ plugin }],
  workspaceWrites: { roots: [workspace], approval: "ask" },
  developmentPlugins: [
    {
      name: "package-note",
      async load() {
        loads++;
        const text = developmentVersion;
        return {
          plugin: {
            name: "package-note",
            apiVersion: 1,
            setup(host) {
              host.registerContextSource({
                id: "package-note",
                async collect() {
                  return [
                    { id: "package-note", stability: "static", content: [{ type: "text", text }] },
                  ];
                },
              });
              host.onDispose(() => {
                disposals++;
              });
            },
          },
        };
      },
    },
  ],
};
let runtime;
let sessionId;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Installed client acceptance attempted network access");
};

function lastOutcome() {
  return events.findLast((event) => event.type === "run.finished")?.outcome.kind;
}
function waitFor(type, predicate = () => true) {
  let unsubscribe;
  let timer;
  const promise = new Promise((resolve, reject) => {
    unsubscribe = runtime.subscribe((event) => {
      if (event.type === type && predicate(event)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      }
    });
    timer = setTimeout(() => {
      unsubscribe();
      reject(Error(`Timed out waiting for ${type}`));
    }, 10_000);
  });
  // A rejected test must not leave an unused waiter alive until the process deadline.
  return {
    promise,
    dispose() {
      clearTimeout(timer);
      unsubscribe();
    },
  };
}
async function turn(text, outcome = "completed") {
  await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text }] });
  await runtime.idle();
  assert.equal(lastOutcome(), outcome);
}
function blockedResponse(started) {
  return async function* (_request, signal) {
    yield { type: "text_delta", index: 0, text: "Synthetic pending response" };
    started.resolve();
    if (!signal.aborted)
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    yield {
      type: "error",
      error: {
        kind: "cancelled",
        message: "Synthetic cancelled response",
        partialOutput: true,
        usage: UNKNOWN_USAGE,
      },
    };
  };
}

try {
  runtime = await createRuntime(options);
  assert.equal(loads, 1);
  let sawFrozenBody = false;
  const removeBadObserver = runtime.subscribe((event) => {
    if (event.type === "entry.appended") {
      sawFrozenBody ||=
        Object.isFrozen(event) && Object.isFrozen(event.entry) && Object.isFrozen(event.entry.body);
      event.entry.body.kind = "observer-must-not-change-history";
    }
  });
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  sessionId = events.findLast((event) => event.type === "session.ready")?.sessionId;
  assert(sessionId);
  steps.push(answer("LANTERN is the synthetic project codename."));
  await turn("Remember LANTERN and preserve protected.txt.");
  assert(sawFrozenBody);
  assert(runtime.diagnostics.includes("Event listener threw"));
  assert(
    events.some((event) => event.type === "assistant.delta" && event.text.includes("LANTERN")),
  );
  assert(!JSON.stringify(events).includes("observer-must-not-change-history"));
  removeBadObserver();
  cases.push("session-stream-observer-isolation");

  assert(JSON.stringify(requests.at(-1).system).includes("INSTALLED_ROOT_GUIDANCE_FIRST"));
  writeFileSync(join(workspace, "AGENTS.md"), "INSTALLED_ROOT_GUIDANCE_CHANGED");
  steps.push(answer("Instructions refreshed in the installed runtime."));
  await turn("Continue with the updated project guidance.");
  assert(JSON.stringify(requests.at(-1).system).includes("INSTALLED_ROOT_GUIDANCE_CHANGED"));
  assert(!JSON.stringify(requests.at(-1).system).includes("INSTALLED_ROOT_GUIDANCE_FIRST"));
  rmSync(join(workspace, "AGENTS.md"));
  cases.push("installed-root-instructions-refresh");

  assert(JSON.stringify(requests.at(-1).system).includes("INSTALLED_SKILL_FIRST"));
  writeFileSync(join(skillDirectory, "SKILL.md"), skillDocument("INSTALLED_SKILL_CHANGED"));
  steps.push(answer("Skills refreshed in the installed runtime."));
  await turn("Continue with the changed selected skill.");
  assert(JSON.stringify(requests.at(-1).system).includes("INSTALLED_SKILL_CHANGED"));
  assert(!JSON.stringify(requests.at(-1).system).includes("INSTALLED_SKILL_FIRST"));
  assert(!JSON.stringify(requests.at(-1).system).includes(skillRoot));
  assert(runtime.plugins.some((plugin) => plugin.name === "skills" && plugin.state === "loaded"));
  cases.push("installed-selected-skill-refresh");

  const beforeDiagnostic = requests.length;
  const diagnosticCalls = [
    tool("read", { path: "guessed-file.txt" }),
    tool("list", { path: "." }),
    tool("read", { path: "protected.txt" }),
  ];
  steps.push(
    ...diagnosticCalls,
    answer("Recovered through workspace discovery after the confirmed missing path."),
  );
  await turn("Locate the actual file after a wrong initial path and read its content.");
  assert.equal(requests.length - beforeDiagnostic, 4);
  const [returned, listed, readBack] = diagnosticCalls.map((call, index) => {
    const callId = call[0].part.callId;
    const results = requests[beforeDiagnostic + index + 1].messages
      .flatMap((message) => message.content)
      .filter((part) => part.type === "tool_result" && part.callId === callId);
    assert.equal(results.length, 1);
    return results[0];
  });
  assert.equal(returned.status, "failed");
  assert.deepEqual(JSON.parse(returned.content[0].text), {
    error: "Requested workspace path does not exist; use list or search to locate the file",
    truncated: false,
  });
  assert.equal(listed.status, "succeeded");
  assert(
    JSON.parse(listed.content[0].text).entries.some((entry) => entry.path === "protected.txt"),
  );
  assert.equal(readBack.status, "succeeded");
  assert.equal(readBack.content.length, 2);
  const metadata = JSON.parse(readBack.content[0].text);
  assert.equal(metadata.format, "file-read-v1");
  assert.equal(metadata.path, "protected.txt");
  assert.equal(metadata.truncated, false);
  assert.equal(metadata.presentation.sourceBytes, 9);
  assert.equal(metadata.presentation.outputTruncated, false);
  assert.equal(readBack.content[1].text, "1: UNCHANGED");
  assert.equal(readFileSync(join(workspace, "protected.txt"), "utf8"), "UNCHANGED");
  cases.push("installed-missing-read-diagnostic-and-discovery-recovery");

  const longRecord = `${JSON.stringify({ note: "x".repeat(6000), status: "PENDING_REVIEW" })}\n`;
  writeFileSync(join(workspace, "record.json"), longRecord);
  const recordCall = tool("read", { path: "record.json" });
  const beforeRecord = requests.length;
  steps.push(recordCall, answer("Observed the complete synthetic record."));
  await turn("Read record.json, including the status after the long note.");
  assert.equal(requests.length - beforeRecord, 2);
  const recordResults = requests
    .at(-1)
    .messages.flatMap((message) => message.content)
    .filter((part) => part.type === "tool_result" && part.callId === recordCall[0].part.callId);
  assert.equal(recordResults.length, 1);
  const record = recordResults[0];
  assert.equal(record.status, "succeeded");
  assert.equal(record.content.length, 2);
  assert(Buffer.byteLength(JSON.stringify(record.content)) <= 32768);
  const recordMetadata = JSON.parse(record.content[0].text);
  assert.equal(recordMetadata.format, "file-read-v1");
  assert.equal(recordMetadata.truncated, false);
  assert.equal(recordMetadata.bytesRead, Buffer.byteLength(longRecord));
  assert.equal(recordMetadata.presentation.sourceBytes, Buffer.byteLength(longRecord));
  assert.equal(recordMetadata.presentation.outputTruncated, false);
  assert.equal(recordMetadata.presentation.nextRead, undefined);
  assert.equal(record.content[1].text, `1: ${longRecord}`);
  assert.equal(readFileSync(join(workspace, "record.json"), "utf8"), longRecord);
  cases.push("installed-default-budget-keeps-fitting-single-line");

  steps.push(
    tool("create", { path: "created.txt", text: "APPROVED_CONTENT" }),
    answer("Recorded creation."),
  );
  const approval = waitFor("approval.requested");
  try {
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Create created.txt." }],
    });
    const asked = await approval.promise;
    assert.equal(existsSync(join(workspace, "created.txt")), false);
    assert(asked.preview.includes("APPROVED_CONTENT"));
    await runtime.send({
      type: "approval.respond",
      effectId: asked.effectId,
      digest: "sha256:stale",
      decision: "approve",
    });
    assert(
      events.some(
        (event) =>
          event.type === "command.rejected" &&
          event.command === "approval.respond" &&
          event.reason.includes("stale"),
      ),
    );
    assert.equal(existsSync(join(workspace, "created.txt")), false);
    await runtime.send({
      type: "approval.respond",
      effectId: asked.effectId,
      digest: asked.digest,
      decision: "approve",
    });
    await runtime.idle();
    assert.equal(lastOutcome(), "completed");
    assert(!JSON.stringify(requests.at(-1).system).includes("INSTALLED_ROOT_GUIDANCE_CHANGED"));
    assert.equal(readFileSync(join(workspace, "created.txt"), "utf8"), "APPROVED_CONTENT");
    assert(
      events.some(
        (event) =>
          event.type === "effect.updated" &&
          event.effect.id === asked.effectId &&
          event.effect.state === "succeeded",
      ),
    );
  } finally {
    approval.dispose();
  }
  cases.push("digest-approval-real-write");

  steps.push(
    tool("edit", { path: "protected.txt", oldText: "UNCHANGED", newText: "BAD" }),
    answer("Recorded denial."),
  );
  const denial = waitFor("approval.requested");
  try {
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Propose an edit for review." }],
    });
    const asked = await denial.promise;
    await runtime.send({
      type: "approval.respond",
      effectId: asked.effectId,
      digest: asked.digest,
      decision: "deny",
    });
    await runtime.idle();
    assert.equal(lastOutcome(), "completed");
    assert(
      events.some(
        (event) =>
          event.type === "effect.updated" &&
          event.effect.id === asked.effectId &&
          event.effect.state === "denied",
      ),
    );
  } finally {
    denial.dispose();
  }
  assert.equal(readFileSync(join(workspace, "protected.txt"), "utf8"), "UNCHANGED");
  cases.push("denied-write-preserves-canaries");

  const started = Promise.withResolvers();
  steps.push(blockedResponse(started));
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [{ type: "text", text: "Wait for further input." }],
  });
  await started.promise;
  const runId = events.findLast((event) => event.type === "run.started")?.runId;
  assert(runId);
  const checkpoint = events.length;
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [{ type: "text", text: "Must be rejected while busy." }],
  });
  await runtime.send({ type: "plugin.reload", name: "package-note" });
  assert(
    events
      .slice(checkpoint)
      .some((event) => event.type === "command.rejected" && event.command === "run.start"),
  );
  assert(
    events
      .slice(checkpoint)
      .some((event) => event.type === "command.rejected" && event.command === "plugin.reload"),
  );
  await runtime.send({
    type: "run.steer",
    runId,
    input: [{ type: "text", text: "Keep protected.txt unchanged after restart." }],
  });
  await runtime.send({ type: "run.cancel", runId });
  await runtime.idle();
  assert.equal(lastOutcome(), "cancelled");
  assert(JSON.stringify(events).includes("Keep protected.txt unchanged after restart."));
  cases.push("busy-steer-cancel");

  developmentVersion = "version-two";
  await runtime.send({ type: "plugin.reload", name: "package-note" });
  assert.equal(loads, 2);
  assert.equal(disposals, 1);
  assert(
    events.some(
      (event) =>
        event.type === "plugin.status" && event.name === "package-note" && event.state === "loaded",
    ),
  );
  steps.push(answer("Reloaded context is active."));
  await turn("Read the active host context.");
  assert(JSON.stringify(requests.at(-1).system).includes("version-two"));
  assert(!JSON.stringify(requests.at(-1).system).includes("version-one"));
  cases.push("idle-development-reload");

  for (let i = 0; i < 4; i++) {
    steps.push(answer(`LANTERN: ${"Synthetic source details. ".repeat(100)}`));
    await turn(`Context turn ${i}. ${"Keep protected.txt unchanged. ".repeat(100)}`);
  }
  const summary =
    "Keep protected.txt unchanged. Project codename is LANTERN. created.txt contains APPROVED_CONTENT.";
  steps.push(answer(summary));
  await runtime.send({ type: "session.compact", sessionId });
  await runtime.idle();
  assert.equal(lastOutcome(), "completed");
  assert.deepEqual(requests.at(-1).tools, []);
  assert(
    events.some(
      (event) => event.type === "entry.appended" && event.entry.body.kind === "compaction",
    ),
  );
  steps.push(answer("Continue with the preserved summary."));
  await turn("Continue after compacting.");
  assert(JSON.stringify(requests.at(-1)).includes(summary));
  cases.push("compaction-and-continuation");

  const stopping = Promise.withResolvers();
  steps.push(blockedResponse(stopping));
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [{ type: "text", text: "Wait until the host closes." }],
  });
  await stopping.promise;
  await runtime.close();
  await runtime.close();
  assert.equal(lastOutcome(), "cancelled");
  assert.equal(steps.length, 0);
  const beforeReopen = requests.length;
  runtime = await createRuntime(options);
  const loaded = [];
  const offLoaded = runtime.subscribe((event) => loaded.push(event));
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.load", sessionId });
  await runtime.idle();
  assert.equal(requests.length, beforeReopen);
  assert(loaded.some((event) => event.type === "session.ready" && event.sessionId === sessionId));
  assert(JSON.stringify(loaded).includes(summary));
  assert(JSON.stringify(loaded).includes("Keep protected.txt unchanged after restart."));
  const historyStart = loaded.length;
  await runtime.send({ type: "session.list", limit: 20 });
  const catalog = loaded.slice(historyStart).find((event) => event.type === "session.listed");
  assert(catalog.page.sessions.some((session) => session.sessionId === sessionId));
  await runtime.send({ type: "session.results", sessionId, limit: 50 });
  const results = loaded.slice(historyStart).find((event) => event.type === "session.results");
  assert(
    results.page.effects.some(
      (effect) =>
        effect.tool === "create" &&
        effect.state === "succeeded" &&
        effect.receipt?.kind === "file" &&
        effect.receipt.path === "created.txt" &&
        effect.receipt.snapshotId === effect.effectId,
    ),
  );
  assert(
    results.page.effects.some((effect) => effect.tool === "edit" && effect.state === "denied"),
  );
  assert.equal(requests.length, beforeReopen);
  assert(
    !loaded
      .slice(historyStart)
      .some(
        (event) =>
          event.type === "session.ready" ||
          event.type === "approval.requested" ||
          event.type === "entry.appended",
      ),
  );
  cases.push("history-discovery-and-recorded-results-without-model-or-authority");
  steps.push(answer("Resumed after closing the installed runtime."));
  await turn("Resume after the process boundary.");
  assert(JSON.stringify(requests.at(-1)).includes(summary));
  assert.equal(readFileSync(join(workspace, "created.txt"), "utf8"), "APPROVED_CONTENT");
  assert.equal(readFileSync(join(workspace, "protected.txt"), "utf8"), "UNCHANGED");
  assert.equal(readFileSync(join(directory, "outside.txt"), "utf8"), "OUTSIDE_UNCHANGED");
  offLoaded();
  cases.push("close-reopen-resume-without-replay");

  let removedListenerCalls = 0;
  const unsubscribe = runtime.subscribe(() => {
    removedListenerCalls++;
  });
  unsubscribe();
  await runtime.close();
  const closedEvents = [];
  runtime.subscribe((event) => closedEvents.push(event));
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [{ type: "text", text: "Closed runtime must reject this." }],
  });
  assert.equal(removedListenerCalls, 0);
  assert.deepEqual(closedEvents, [
    { type: "command.rejected", command: "run.start", reason: "Runtime is closed" },
  ]);
  assert.equal(steps.length, 0);
  cases.push("unsubscribe-and-closed-admission");

  console.log(
    JSON.stringify({
      passed: true,
      kind: "installed-client-protocol",
      count: cases.length,
      cases,
      modelRequests: requests.length,
      liveModel: false,
      transport: "in-process",
      storage: "SQLite",
    }),
  );
} finally {
  try {
    await runtime?.close();
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
}
