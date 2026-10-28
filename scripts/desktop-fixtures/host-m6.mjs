import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { isAbsolute, join, relative } from "node:path";
import tls from "node:tls";
import { UNKNOWN_USAGE } from "moyyi/contracts";

// This file is copied beside the installed host, outside the repository. The provider is
// synthetic; parser subprocesses, permissions, files, SQLite and model context are real.
assert.equal(process.version, "v26.12.1");
assert(
  import.meta
    .resolve("moyyi/runtime")
    .startsWith(new URL("../node_modules/moyyi/", import.meta.url).href),
);
assert(!existsSync(new URL("../node_modules/moyyi/src", import.meta.url)));
const [externalDirectory, workspace, dataDirectory] = process.argv.slice(2);
assert(externalDirectory && workspace && dataDirectory);
assert(relative(workspace, externalDirectory).startsWith(".."));
const names = [
  "aster.pdf",
  "birch.docx",
  "cedar.xlsx",
  "dahlia.pptx",
  "elm.odt",
  "fir.ods",
  "ginkgo.odp",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originals = new Map(
  names.map((name) => [name, digest(readFileSync(join(externalDirectory, name)))]),
);
let networkAttempts = 0,
  credentialReads = 0,
  nextCall = 0;
const denyNetwork = () => {
  networkAttempts++;
  throw Error("Network access is forbidden in the installed M6 probe");
};
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = denyNetwork;
dns.lookup = dns.resolve = denyNetwork;
syncBuiltinESMExports();
const { createDesktopHost } = await import(new URL("../host.mjs", import.meta.url));
const requests = [],
  steps = [],
  cases = [];
const origin = { provider: "installed-desktop-m6-fixture", model: "scripted" };
const complete = (stopReason = "end_turn") => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
function calls(tools) {
  return [
    ...tools.map(({ name, args }, index) => {
      const callId = `installed_m6_${++nextCall}`;
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
          assert.equal(request.maxOutputTokens, 8192);
          const step = steps.shift();
          assert(step, "Unexpected extra synthetic request");
          yield* step(request);
        },
      }),
    });
  },
};
const options = {
  model: origin,
  dataDirectory,
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
const settings = { preset: "flash", maxRequests: 4, timeoutMs: 120_000 };
const open = () =>
  createDesktopHost({ runtimeOptions: () => options, settings, maxOutputTokens: 8192 });
function waitFor(target, predicate, label) {
  if (predicate(target.getState())) return Promise.resolve(target.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(Error(`Timed out: ${label}`));
    }, 120_000);
    const off = target.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      off();
      resolve(state);
    });
  });
}
const toolResults = (request) =>
  request.messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === "tool_result");
const report =
  "# Installed M6 report\n\n| Check | Result |\n| --- | --- |\n| Seven imported documents | Observations received |\n\nM6_READBACK_CANARY\n";
// The long input remains below the existing input-byte limit; final output consists of short
// synthetic parts, exercising the 100-message display boundary without extra model requests.
const input = `Read the selected seven documents, create m6-report.md with approval and read it back.\nLONG_HISTORY_START\n${"Historical input padding. ".repeat(900)}\nLONG_HISTORY_END`;
const finalParts = Array.from(
  { length: 110 },
  (_, index) => `M6_FINAL_PART_${String(index).padStart(3, "0")}`,
);
let host;
try {
  host = await open();
  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  const sessionId = host.getState().activeSessionId;
  assert(sessionId);
  await host.dispatch({
    type: "materials.import",
    sessionId,
    paths: names.map((name) => join(externalDirectory, name)),
  });
  const imported = host.getState().library.items;
  assert.equal(imported.length, 7);
  assert.equal(host.getState().materials.length, 7);
  assert.deepEqual(host.getState().permissions, { writes: false, checks: false });
  assert.equal(host.getState().library.housekeeping, false);
  for (const material of imported) {
    assert.equal(material.state, "active");
    assert.equal(material.sha256, originals.get(material.name));
    assert(!isAbsolute(material.path) && material.path.startsWith("moyyi-materials/"));
    assert.equal(digest(readFileSync(join(workspace, material.path))), material.sha256);
  }
  assert.equal(requests.length, 0);
  cases.push(
    "seven external originals import into bounded hash-matched workspace copies without model calls or write grants",
  );
  const selection = host.getState().materials;
  await host.dispatch({ type: "report.target", sessionId, path: join(workspace, "m6-report.md") });
  steps.push(
    (request) => {
      assert(
        request.messages.some(
          (message) =>
            message.role === "user" &&
            message.content.some((part) => part.type === "text" && part.text === input),
        ),
      );
      return calls(
        selection.map((material) => ({ name: "read_document", args: { path: material.path } })),
      );
    },
    (request) => {
      const results = toolResults(request);
      assert.equal(results.length, 7);
      assert.equal(new Set(results.map((result) => result.callId)).size, 7);
      for (const result of results) {
        assert.equal(result.status, "succeeded");
        assert(result.content.some((part) => part.type === "text" && part.text.length > 0));
      }
      for (const material of selection) assert(JSON.stringify(results).includes(material.path));
      cases.push(
        "all seven installed read_document observations reach the following synthetic model request",
      );
      return calls([{ name: "create", args: { path: "m6-report.md", text: report } }]);
    },
    (request) => {
      assert.equal(toolResults(request).at(-1)?.status, "succeeded");
      // The public filesystem tool is named read, not a fixture-only read_file alias.
      return calls([{ name: "read", args: { path: "m6-report.md" } }]);
    },
    (request) => {
      const result = toolResults(request).at(-1);
      assert.equal(result.status, "succeeded");
      assert(JSON.stringify(result.content).includes("M6_READBACK_CANARY"));
      assert.equal(request.toolChoice, "none");
      return [
        ...finalParts.map((text, index) => ({
          type: "part_completed",
          index,
          part: { type: "text", text },
        })),
        complete(),
      ];
    },
  );
  await host.dispatch({ type: "start", sessionId, text: input });
  const pending = (
    await waitFor(
      host,
      (state) => !!state.pendingApproval || !!state.outcome,
      "approved report preparation",
    )
  ).pendingApproval;
  assert(pending, "The report must require a real prepared-action approval");
  assert(pending.preview.includes("M6_READBACK_CANARY"));
  await host.dispatch({
    type: "approve",
    effectId: pending.effectId,
    digest: pending.digest,
    decision: "approve",
  });
  const finished = await waitFor(
    host,
    (state) => !!state.outcome,
    "four-request document/report run",
  );
  assert.equal(finished.outcome.kind, "completed");
  assert.equal(requests.length, 4);
  assert.equal(steps.length, 0);
  assert.equal(readFileSync(join(workspace, "m6-report.md"), "utf8"), report);
  await host.dispatch({ type: "artifacts", sessionId, offset: 0 });
  const artifact = host.getState().artifacts.items.find((item) => item.path === "m6-report.md");
  assert(artifact);
  assert.equal(artifact.afterHash, digest(Buffer.from(report)));
  await host.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId });
  assert.equal(host.getState().artifactPreview.text, report);
  assert.equal(host.getState().artifactPreview.truncated, false);
  cases.push(
    "one four-request run approves create, returns actual readback to context and opens the hash-checked Markdown report",
  );

  assert.equal(host.getState().historyTruncated, true);
  let cursor, longMessage;
  const messages = new Map();
  for (let pageNumber = 0; pageNumber < 30; pageNumber++) {
    await host.dispatch({ type: "history", sessionId, ...(cursor ? { cursor } : {}) });
    const page = host.getState().history;
    assert.equal(page.sessionId, sessionId);
    assert(Buffer.byteLength(JSON.stringify(page.items)) <= 262_144);
    for (const message of page.items) {
      assert(!messages.has(message.id), "History pagination repeated a message");
      messages.set(message.id, message);
      if (message.role === "user" && message.text.startsWith("Read the selected seven"))
        longMessage = message;
    }
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  assert.equal(cursor, null, "The bounded fixture must reach the oldest history page");
  for (const text of finalParts)
    assert([...messages.values()].some((message) => message.text === text));
  assert(longMessage?.truncated);
  assert.equal(longMessage.textLength, input.length);
  let offset = 0,
    reconstructed = "";
  for (let part = 0; part < 10; part++) {
    await host.dispatch({ type: "history.message", sessionId, messageId: longMessage.id, offset });
    const detail = host.getState().messageDetail;
    assert.equal(detail.totalLength, input.length);
    assert(detail.text.length <= 16_384);
    reconstructed += detail.text;
    if (detail.nextOffset === null) break;
    assert(detail.nextOffset > offset);
    offset = detail.nextOffset;
  }
  assert.equal(reconstructed, input);
  cases.push(
    "all 110 final parts and the complete long original input remain accessible beyond the 100-message display window",
  );

  await host.dispatch({ type: "catalog", query: {} });
  const metadata = host
    .getState()
    .sessions.items.find((item) => item.sessionId === sessionId).metadata;
  await host.dispatch({
    type: "session.update",
    update: {
      sessionId,
      expectedRevision: metadata.revision,
      patch: { title: "M6 imported report", group: "Verification", pinned: true, muted: true },
    },
  });
  await assert.rejects(
    host.dispatch({
      type: "session.update",
      update: {
        sessionId,
        expectedRevision: metadata.revision,
        patch: { title: "Stale overwrite" },
      },
    }),
  );
  await host.dispatch({ type: "catalog", query: { search: "M6 imported", group: "Verification" } });
  assert.equal(host.getState().sessions.items.length, 1);
  const organized = host.getState().sessions.items[0].metadata;
  assert.equal(organized.title, "M6 imported report");
  assert.equal(organized.group, "Verification");
  assert.equal(organized.pinned, true);
  assert.equal(organized.muted, true);
  cases.push(
    "name search, group, pin and mute metadata persist while stale revision edits are refused",
  );

  await host.close();
  host = await open();
  await host.dispatch({ type: "load", sessionId, askEachRead: false });
  assert.deepEqual(host.getState().materials, selection);
  assert.equal(host.getState().library.items.length, 7);
  assert.equal(host.getState().reportTarget, null);
  assert.equal(host.getState().pendingApproval, null);
  assert.deepEqual(host.getState().permissions, { writes: false, checks: false });
  assert.deepEqual(host.getState().webAccess, { allowedOrigins: [], dns: "system" });
  assert.deepEqual(
    host.getState().sessions.items.find((item) => item.sessionId === sessionId).metadata,
    organized,
  );
  await host.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId });
  assert.equal(host.getState().artifactPreview.text, report);
  assert.equal(requests.length, 4);
  cases.push(
    "close and reopen retain selected material identities, organization and receipts without replay or restored grants",
  );

  await host.dispatch({
    type: "session.update",
    update: { sessionId, expectedRevision: organized.revision, patch: { removed: true } },
  });
  await host.dispatch({ type: "catalog", query: { removed: "removed" } });
  const recycled = host.getState().sessions.items.find((item) => item.sessionId === sessionId);
  assert(recycled?.metadata.removedAt);
  await host.dispatch({ type: "load", sessionId, askEachRead: false });
  assert.equal(host.getState().historyOnly, true);
  await assert.rejects(
    host.dispatch({ type: "start", sessionId, text: "Removed sessions must not run" }),
  );
  await host.dispatch({
    type: "session.update",
    update: { sessionId, expectedRevision: recycled.metadata.revision, patch: { removed: false } },
  });
  await host.dispatch({ type: "catalog", query: {} });
  await host.dispatch({ type: "load", sessionId, askEachRead: false });
  assert.deepEqual(host.getState().materials, selection);
  assert.equal(
    host.getState().sessions.items.find((item) => item.sessionId === sessionId).metadata.removedAt,
    null,
  );
  for (const [name, before] of originals)
    assert.equal(digest(readFileSync(join(externalDirectory, name))), before);
  assert.equal(requests.length, 4);
  assert.equal(credentialReads, 0);
  assert.equal(networkAttempts, 0);
  cases.push(
    "recoverable session removal preserves all material references and originals and cannot start model work before restore",
  );
  await host.close();
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      syntheticRequests: requests.length,
      automaticRetries: 0,
      timeoutMs: options.limits.timeoutMs,
      maxOutputTokens: 8192,
      credentialReads,
      networkAttempts,
      liveModel: false,
    }),
  );
} finally {
  await host?.close();
}
