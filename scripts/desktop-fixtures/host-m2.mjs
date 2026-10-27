import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNKNOWN_USAGE } from "moyyi/contracts";
import { createRuntime } from "moyyi/runtime";

// Installed public runtime and the exact host imported by the packaged production worker.
const { createDesktopHost } = await import(new URL("../host.mjs", import.meta.url));
assert(
  import.meta
    .resolve("moyyi/runtime")
    .startsWith(new URL("../node_modules/moyyi/", import.meta.url).href),
);
assert.equal(process.version, "v26.12.1");
const [workspace, privateDirectory] = process.argv.slice(2);
assert(workspace && privateDirectory);
const paths = [
  "aster.pdf",
  "birch.docx",
  "cedar.xlsx",
  "dahlia.pptx",
  "elm.odt",
  "fir.ods",
  "ginkgo.odp",
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originals = new Map(paths.map((path) => [path, digest(readFileSync(join(workspace, path)))]));
const origin = { provider: "installed-desktop-m2-fixture", model: "scripted" };
const steps = [],
  requests = [],
  cases = [];
let credentialReads = 0,
  nextCall = 0,
  configurationFailure = false;
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
      const callId = `installed_m2_${++nextCall}`;
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
const settings = { preset: "flash", maxRequests: 4, timeoutMs: 120_000 };
async function open() {
  return createDesktopHost({
    runtimeOptions: () => options,
    settings,
    maxOutputTokens: 8192,
    configure: async (next) => {
      if (configurationFailure) throw Error("PRIVATE_CONFIGURATION_FAILURE");
      // The callback can obtain this store only after the previous runtime really closes.
      const probe = await createRuntime(options);
      await probe.close();
      return {
        settings: next,
        runtimeOptions: {
          ...options,
          limits: {
            ...options.limits,
            maxModelRequests: next.maxRequests,
            timeoutMs: next.timeoutMs,
          },
        },
        connection: { ready: false, message: "Synthetic missing-connection state" },
      };
    },
  });
}
function waitFor(target, predicate, label) {
  if (predicate(target.getState())) return Promise.resolve(target.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(Error(`Timed out: ${label}`));
    }, 30_000);
    const off = target.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      off();
      resolve(state);
    });
  });
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Network access is forbidden in the installed M2 probe");
};
let host;
try {
  host = await open();
  await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
  const sessionId = host.getState().activeSessionId;
  await host.dispatch({
    type: "materials",
    sessionId,
    paths: paths.map((path) => join(workspace, path)),
  });
  assert.equal(host.getState().materials.length, 7);
  for (const material of host.getState().materials)
    assert.equal(material.sha256, originals.get(material.path));
  const selection = host.getState().materials;
  await host.dispatch({ type: "materials", sessionId, paths: [] });
  assert.deepEqual(host.getState().materials, selection);
  assert.equal(requests.length, 0);
  cases.push(
    "native-selection payload is revalidated as seven unchanged file identities without extraction or requests",
  );

  steps.push(
    calls(paths.map((path) => ({ name: "read_document", args: { path } }))),
    answer("Seven real parser observations received"),
  );
  await host.dispatch({ type: "start", sessionId, text: "Read the selected documents" });
  await waitFor(host, (state) => state.outcome?.kind === "completed", "document extraction");
  assert.equal(requests.length, 2);
  const results = requests[1].messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === "tool_result");
  assert.equal(results.length, 7);
  assert(
    results.every(
      (result) =>
        result.status === "succeeded" &&
        result.content.some((part) => part.type === "text" && part.text.length > 0),
    ),
  );
  const firstInput = requests[0].messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content);
  assert(
    firstInput.some(
      (part) => part.type === "text" && part.text.includes("contents have not been extracted"),
    ),
  );
  cases.push(
    "all seven installed read_document parsers return actual observations to the next synthetic request",
  );

  const report = "M2 installed bridge fixture report. Semantic task acceptance is separate.\n";
  await host.dispatch({ type: "report.target", sessionId, path: join(workspace, "m2-report.md") });
  steps.push(
    calls([{ name: "create", args: { path: "m2-report.md", text: report } }]),
    answer("Denied"),
  );
  await host.dispatch({ type: "start", sessionId, text: "Prepare a new report" });
  let pending = (await waitFor(host, (state) => !!state.pendingApproval, "report denial"))
    .pendingApproval;
  await assert.rejects(
    host.dispatch({
      type: "approve",
      effectId: pending.effectId,
      digest: "stale",
      decision: "approve",
    }),
  );
  await host.dispatch({
    type: "approve",
    effectId: pending.effectId,
    digest: pending.digest,
    decision: "deny",
  });
  await waitFor(host, (state) => state.outcome?.kind === "completed", "denied run finish");
  assert(!existsSync(join(workspace, "m2-report.md")));
  cases.push("stale and denied report approvals create no file");

  steps.push(
    calls([{ name: "create", args: { path: "m2-report.md", text: report } }]),
    calls([{ name: "read", args: { path: "m2-report.md" } }]),
    answer("Saved report was read back"),
  );
  await host.dispatch({
    type: "start",
    sessionId,
    text: "Create the new report with approval, then read it",
  });
  pending = (await waitFor(host, (state) => !!state.pendingApproval, "report approval"))
    .pendingApproval;
  assert(pending.preview.includes(report.trim()));
  await host.dispatch({
    type: "approve",
    effectId: pending.effectId,
    digest: pending.digest,
    decision: "approve",
  });
  await waitFor(host, (state) => state.artifacts.items.length === 1, "recorded report receipt");
  const artifact = host.getState().artifacts.items[0];
  assert.equal(artifact.afterHash, digest(readFileSync(join(workspace, "m2-report.md"))));
  assert.equal(artifact.path, "m2-report.md");
  await host.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId });
  assert.equal(host.getState().artifactPreview.text, report);
  assert.equal(host.getState().artifactPreview.truncated, false);
  assert(JSON.stringify(requests.at(-1)).includes(report.trim()));
  cases.push(
    "approved create yields a matched session.results receipt, actual hash-checked preview and next-request readback",
  );

  const requestCount = requests.length;
  await host.close();
  host = await open();
  await host.dispatch({ type: "load", sessionId, askEachRead: false });
  assert.equal(host.getState().reportTarget, null);
  assert.equal(host.getState().pendingApproval, null);
  assert.deepEqual(host.getState().materials, []);
  assert.equal(host.getState().artifacts.items[0].effectId, artifact.effectId);
  await host.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId });
  assert.equal(host.getState().artifactPreview.text, report);
  assert.equal(requests.length, requestCount);
  cases.push(
    "SQLite reopen restores recorded artifacts without replay, model access or old report authority",
  );

  writeFileSync(join(workspace, "m2-report.md"), "EXTERNAL_CHANGE");
  await assert.rejects(
    host.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId }),
    /changed/,
  );
  assert.equal(host.getState().artifactPreview, null);
  assert.equal(host.getState().artifacts.items[0].state, "changed");
  unlinkSync(join(workspace, "m2-report.md"));
  await assert.rejects(
    host.dispatch({ type: "artifact.open", sessionId, effectId: artifact.effectId }),
    /missing/,
  );
  assert.equal(host.getState().artifactPreview, null);
  cases.push("changed and deleted files never display the historical receipt as current content");

  configurationFailure = true;
  await assert.rejects(host.dispatch({ type: "configure", settings }), /could not be applied/);
  assert.equal(host.getState().activeSessionId, sessionId);
  assert(!JSON.stringify(host.getState()).includes("PRIVATE_CONFIGURATION_FAILURE"));
  configurationFailure = false;
  await host.dispatch({ type: "configure", settings: { ...settings, maxRequests: 3 } });
  assert.equal(host.getState().settings.maxRequests, 3);
  assert.equal(host.getState().activeSessionId, sessionId);
  assert.equal(host.getState().connection.ready, false);
  await assert.rejects(
    host.dispatch({ type: "start", sessionId, text: "No configured connection" }),
    /unavailable/,
  );
  assert.equal(requests.length, requestCount);
  assert.equal(credentialReads, 0);
  for (const [path, before] of originals)
    assert.equal(digest(readFileSync(join(workspace, path))), before);
  assert.equal(steps.length, 0);
  cases.push(
    "configuration failure preserves history and successful rebuild releases ownership with zero credential reads",
  );
  await host.close();
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      syntheticRequests: requests.length,
      credentialReads,
      liveModel: false,
    }),
  );
} finally {
  await host?.close();
  globalThis.fetch = originalFetch;
}
