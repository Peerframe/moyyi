import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { UNKNOWN_USAGE } from "moyyi/contracts";
import { discoverNodeToolchain } from "moyyi/runtime";

const { createDesktopHost } = await import(new URL("../host.mjs", import.meta.url));
assert.equal(typeof discoverNodeToolchain, "function");
assert(
  import.meta
    .resolve("moyyi/runtime")
    .startsWith(new URL("../node_modules/moyyi/", import.meta.url).href),
);
assert.equal(process.version, "v26.12.1");
const [workspace, privateDirectory] = process.argv.slice(2);
assert(workspace && privateDirectory);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const path = join(workspace, "note.txt");
const original = "ORIGINAL\n";
writeFileSync(path, original, { mode: 0o640 });
const mode = statSync(path).mode;
const canary = join(dirname(workspace), "m3-outside.txt");
writeFileSync(canary, "OUTSIDE_CANARY");
writeFileSync(join(workspace, ".env"), "PROTECTED_CANARY");
symlinkSync(canary, join(workspace, "linked.txt"));
const origin = { provider: "installed-desktop-m3-fixture", model: "scripted" };
const steps = [],
  requests = [],
  cases = [];
let credentialReads = 0,
  nextCall = 0;
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
function calls(tools) {
  return [
    ...tools.map(({ name, args }, index) => {
      const callId = `installed_m3_${++nextCall}`;
      return {
        type: "part_completed",
        index,
        part: {
          type: "tool_call",
          callId,
          providerCallId: callId,
          providerItemId: null,
          name,
          rawArguments: JSON.stringify(args),
          argumentsSource: "verbatim",
        },
      };
    }),
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
          parallelToolCalls: true,
          reasoning: "visible",
          promptCache: "none",
          editFormat: "search_replace",
        },
      ],
      createClient: () => ({
        async *stream(request) {
          requests.push(structuredClone(request));
          const step = steps.shift();
          assert(step, "Unexpected extra synthetic request");
          yield* step;
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
      credentialReads++;
      throw Error("Credential access is forbidden");
    },
  },
  limits: {
    maxModelRequests: 4,
    maxRetries: 0,
    timeoutMs: 120_000,
    maxInputBytes: 65_536,
    maxModelResponseBytes: 1_048_576,
    maxToolOutputBytes: 32_768,
    maxParallelReads: 1,
  },
};

const open = () => createDesktopHost({ runtimeOptions: () => options, maxOutputTokens: 8192 });
function waitFor(predicate) {
  if (predicate(host.getState())) return Promise.resolve(host.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(Error("M3 state did not settle"));
    }, 20_000);
    const off = host.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      off();
      resolve(state);
    });
  });
}
let host, sessionId;
async function finish() {
  await waitFor((s) => s.run === null);
  await host.dispatch({ type: "effects", sessionId, offset: 0 });
  return host.getState();
}
async function start(name, args, tail = true) {
  steps.push(calls([{ name, args }]));
  if (tail) steps.push(answer("Recorded operation; semantic acceptance is separate"));
  await host.dispatch({
    type: "start",
    sessionId,
    text: `Perform the requested ${name} operation`,
  });
}
async function approve(decision = "approve", stale = false) {
  const pending = (await waitFor((s) => !!s.pendingApproval)).pendingApproval;
  if (stale) {
    await assert.rejects(
      host.dispatch({ type: "approve", effectId: pending.effectId, digest: "stale", decision }),
    );
    assert.equal(host.getState().pendingApproval.digest, pending.digest);
  }
  await host.dispatch({
    type: "approve",
    effectId: pending.effectId,
    digest: pending.digest,
    decision,
  });
  return pending.effectId;
}
async function grants(writes, checks) {
  const count = requests.length;
  await host.dispatch({ type: "permissions", sessionId, writes, checks });
  assert.deepEqual(host.getState().permissions, { writes, checks });
  assert.equal(requests.length, count);
}
const originalFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw Error("M3 fixture forbids network access");
};
try {
  host = await open();
  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  sessionId = host.getState().activeSessionId;
  assert.deepEqual(host.getState().permissions, { writes: false, checks: false });
  for (const [name, args] of [
    ["edit", { path: "note.txt", oldText: "ORIGINAL", newText: "NO" }],
    ["shell", { command: "echo unauthorized" }],
  ]) {
    await start(name, args);
    await finish();
    assert(host.getState().effects.items.some((e) => e.tool === name && e.state === "denied"));
  }
  assert.equal(readFileSync(path, "utf8"), original);
  cases.push("default read-only host denies edits and checks without key/model fallback");

  await grants(true, false);
  await start("edit", { path: "note.txt", oldText: "ORIGINAL", newText: "FIRST" });
  await approve("deny", true);
  await finish();
  assert.equal(readFileSync(path, "utf8"), original);
  cases.push("stale and denied edit approvals preserve exact original bytes");

  const snapshots = [];
  for (const [oldText, newText] of [
    ["ORIGINAL", "FIRST"],
    ["FIRST", "SECOND"],
  ]) {
    await start("edit", { path: "note.txt", oldText, newText });
    const effectId = await approve();
    await finish();
    const effect = host.getState().effects.items.find((e) => e.effectId === effectId);
    assert.equal(effect.state, "succeeded");
    assert.equal(effect.receipt.snapshotId, effectId);
    assert.equal(effect.receipt.afterHash, digest(readFileSync(path)));
    snapshots.push(effect.receipt.snapshotId);
  }
  cases.push("two approved edits produce actual durable snapshots and file receipts");

  steps.push(
    calls(
      ["../m3-outside.txt", ".env", "linked.txt"].map((path) => ({
        name: "edit",
        args: { path, oldText: "CANARY", newText: "CHANGED" },
      })),
    ),
    answer("Forbidden paths refused"),
  );
  await host.dispatch({ type: "start", sessionId, text: "Exercise bounded path denials" });
  await finish();
  assert.equal(host.getState().pendingApproval, null);
  assert.equal(readFileSync(canary, "utf8"), "OUTSIDE_CANARY");
  assert.equal(readFileSync(join(workspace, ".env"), "utf8"), "PROTECTED_CANARY");
  assert(
    host
      .getState()
      .messages.filter((m) => m.tool === "edit" && ["failed", "denied"].includes(m.state)).length >=
      3,
  );
  cases.push("outside, symlink and protected edit targets remain unchanged under a write grant");

  await grants(true, true);
  const code =
    'const fs=require("node:fs");console.log(fs.readFileSync("note.txt","utf8"));try{fs.writeFileSync("forbidden-write","bad");process.exitCode=9}catch{console.log("READ_ONLY_CONFIRMED")}';
  await start("shell", { command: `node -e '${code}'` });
  const proposed = (await waitFor((s) => !!s.pendingApproval)).pendingApproval;
  assert(proposed.preview.includes('"workspaceAccess":"read-only"'));
  assert(proposed.preview.includes('"network":"denied"'));
  const checkId = await approve();
  await finish();
  assert.deepEqual(host.getState().effects.items.find((e) => e.effectId === checkId).receipt, {
    kind: "process",
    exitCode: 0,
    termination: "exited",
    outputTruncated: false,
  });
  assert(JSON.stringify(requests.at(-1)).includes("READ_ONLY_CONFIRMED"));
  assert(!existsSync(join(workspace, "forbidden-write")));
  cases.push(
    "separate Node check executes in the real read-only network-denied sandbox with a process receipt",
  );

  await host.dispatch({ type: "effect.inspect", sessionId, effectId: snapshots[1] });
  assert.equal(host.getState().effectInspection.state, "current");
  writeFileSync(path, "EXTERNAL");
  await host.dispatch({ type: "effect.inspect", sessionId, effectId: snapshots[1] });
  assert.equal(host.getState().effectInspection.state, "changed");
  await start("undo", { snapshotId: snapshots[1] });
  await finish();
  assert.equal(readFileSync(path, "utf8"), "EXTERNAL");
  assert(host.getState().effects.items.some((e) => e.tool === "undo" && e.state === "failed"));
  unlinkSync(path);
  await host.dispatch({ type: "effect.inspect", sessionId, effectId: snapshots[1] });
  assert.equal(host.getState().effectInspection.state, "missing");
  writeFileSync(path, "SECOND\n", { mode: mode & 0o777 });
  cases.push(
    "fresh inspection distinguishes changed/missing output and conflicting undo cannot overwrite it",
  );

  for (const snapshotId of snapshots.slice().reverse()) {
    await start("undo", { snapshotId });
    await approve();
    await finish();
  }
  assert.equal(readFileSync(path, "utf8"), original);
  assert.equal(statSync(path).mode, mode);
  cases.push("reverse undo restores both original file bytes and ordinary POSIX mode");

  await start("create", { path: "created.md", text: "TEMPORARY" });
  const created = await approve();
  await finish();
  await start("undo", { snapshotId: created });
  const removed = await approve();
  await finish();
  await host.dispatch({ type: "effect.inspect", sessionId, effectId: removed });
  assert.equal(host.getState().effectInspection.state, "absent");
  assert(!existsSync(join(workspace, "created.md")));
  cases.push("undo of creation records expected absence distinctly from a missing expected file");

  await start("edit", { path: "note.txt", oldText: "ORIGINAL", newText: "RESUMABLE" });
  const resumable = await approve();
  await finish();
  await start("edit", { path: "note.txt", oldText: "RESUMABLE", newText: "CANCELLED" }, false);
  const waiting = await waitFor((s) => !!s.pendingApproval);
  await host.dispatch({ type: "cancel", runId: waiting.run.id });
  await finish();
  let recorded = host.getState().effects,
    requestCount = requests.length;
  await host.close();
  host = await open();
  await host.dispatch({ type: "load", sessionId, askEachRead: false });
  assert.deepEqual(host.getState().effects, recorded);
  assert.deepEqual(host.getState().permissions, { writes: false, checks: false });
  assert.equal(host.getState().pendingApproval, null);
  assert.equal(host.getState().openedHistory, true);
  assert.equal(requests.length, requestCount);
  assert.equal(readFileSync(path, "utf8"), "RESUMABLE\n");
  await grants(true, false);
  await start("undo", { snapshotId: resumable });
  await approve();
  await finish();
  assert.equal(readFileSync(path, "utf8"), original);
  cases.push(
    "cancelled approval reopens without replay and a fresh explicit grant allows ordinary undo of the settled prior edit",
  );

  await grants(false, true);
  await start("shell", { command: "node -e 'setInterval(()=>{},1000)'" }, false);
  const interrupted = await approve();
  await waitFor((s) =>
    s.effects.items.some((e) => e.effectId === interrupted && e.state === "started"),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  await host.dispatch({ type: "cancel", runId: host.getState().run.id });
  await finish();
  assert.equal(host.getState().outcome.kind, "failed");
  assert.equal(
    host.getState().effects.items.find((e) => e.effectId === interrupted).state,
    "unknown",
  );
  recorded = host.getState().effects;
  requestCount = requests.length;
  await host.close();
  host = await open();
  await host.dispatch({ type: "load", sessionId, askEachRead: false });
  assert.deepEqual(host.getState().effects, recorded);
  assert.deepEqual(host.getState().permissions, { writes: false, checks: false });
  assert.equal(requests.length, requestCount);
  await start("read", { path: "note.txt" });
  await finish();
  assert(JSON.stringify(requests.at(-1)).includes("ORIGINAL"));
  await grants(true, false);
  await start("edit", { path: "note.txt", oldText: "ORIGINAL", newText: "BLOCKED" }, false);
  await approve();
  await finish();
  assert.equal(host.getState().outcome.kind, "failed");
  assert.equal(readFileSync(path, "utf8"), original);
  cases.push(
    "interrupted process stays unknown across reopen: reads work, but retained lease blocks further approved writes without replay",
  );

  assert.equal(readFileSync(path, "utf8"), original);
  assert.equal(readFileSync(canary, "utf8"), "OUTSIDE_CANARY");
  assert.equal(readFileSync(join(workspace, ".env"), "utf8"), "PROTECTED_CANARY");
  assert.equal(steps.length, 0);
  assert.equal(requests.length, 33);
  assert.equal(credentialReads, 0);
  assert.equal(networkAttempts, 0);
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      syntheticRequests: requests.length,
      credentialReads,
      networkAttempts,
      liveModel: false,
    }),
  );
} finally {
  await host?.close();
  globalThis.fetch = originalFetch;
}
