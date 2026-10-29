// Native M6 acceptance using the real packaged main/preload/renderer/host and an isolated store.
// Replace worker.mjs only in a disposable application copy; never install this as a daily worker.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { basename, isAbsolute, join, relative } from "node:path";
import tls from "node:tls";
import { UNKNOWN_USAGE } from "moyyi/contracts";

assert(process.send && process.connected, "This fixture must be the isolated app's IPC worker");
const config = JSON.parse(readFileSync(new URL("./qa-config.json", import.meta.url), "utf8"));
assert.equal(config.mode, "synthetic-native-desktop-modules");
const root = realpathSync(config.root);
assert(basename(root).startsWith("moyyi-desktop-modules-"), "Use a dedicated acceptance directory");
for (const key of ["workspace", "dataDirectory", "evidence"]) {
  assert(isAbsolute(config[key]));
  const child = relative(root, realpathSync(config[key]));
  assert(
    child && !child.startsWith("..") && !isAbsolute(child),
    "All fixture paths must be isolated",
  );
}
const evidence = config.evidence;
const ledgerPath = join(evidence, "native-requests.json");
const requests = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : [];
assert(Array.isArray(requests) && requests.length <= 4);
const countsPath = join(evidence, "native-counts.json");
const previousCounts = existsSync(countsPath)
  ? JSON.parse(readFileSync(countsPath, "utf8"))
  : { networkAttempts: 0, credentialReads: 0 };
for (const key of ["networkAttempts", "credentialReads"])
  assert(Number.isSafeInteger(previousCounts[key]) && previousCounts[key] >= 0);
const counts = {
  syntheticRequests: requests.length,
  networkAttempts: previousCounts.networkAttempts,
  credentialReads: previousCounts.credentialReads,
  liveModel: false,
};
const recordCounts = () =>
  writeFileSync(join(evidence, "native-counts.json"), JSON.stringify(counts, null, 2), {
    mode: 0o600,
  });
const denyNetwork = () => {
  counts.networkAttempts++;
  recordCounts();
  throw Error("Network is forbidden in native synthetic acceptance");
};
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = denyNetwork;
dns.lookup = dns.resolve = denyNetwork;
syncBuiltinESMExports();
const { createDesktopHost } = await import("./host.mjs");
const origin = { provider: "native-desktop-modules-fixture", model: "scripted" };
const task =
  "QA modules: read selected PDF and DOCX, create modules-report.md with approval, then read it back.";
const report =
  "# Desktop modules acceptance\n\n| Project | Owner | Allocation | Status |\n| --- | --- | --- | --- |\n| Aster | Mei | 1200 CNY | approved |\n| Birch | Noah | 3400 CNY | blocked |\n\nBoth public documents were read through read_document.\n\nMODULES_READBACK_CANARY\n";
writeFileSync(join(evidence, "expected-report.md"), report, { mode: 0o600 });
recordCounts();
const complete = (stopReason = "end_turn") => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
function tools(calls) {
  return [
    ...calls.map(({ name, args }, index) => {
      const callId = `native_modules_${randomUUID()}`;
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
const resultsOf = (request) =>
  request.messages
    .flatMap((message) => message.content)
    .filter((part) => part.type === "tool_result");
let host;
const plugin = {
  name: origin.provider,
  apiVersion: 1,
  setup(registry) {
    registry.registerModelProvider({
      id: origin.provider,
      models: [
        {
          origin,
          contextWindowTokens: 200000,
          maxOutputTokens: 8192,
          parallelToolCalls: true,
          reasoning: "visible",
          promptCache: "none",
          editFormat: "search_replace",
        },
      ],
      createClient: () => ({
        async *stream(request) {
          assert(requests.length < 4, "Only one four-request synthetic task is allowed");
          assert(
            request.messages.some(
              (message) =>
                message.role === "user" &&
                message.content.some((part) => part.type === "text" && part.text === task),
            ),
            "Use the exact public acceptance task",
          );
          assert.equal(request.maxOutputTokens, 8192);
          const step = requests.length;
          requests.push(structuredClone(request));
          counts.syntheticRequests = requests.length;
          writeFileSync(ledgerPath, JSON.stringify(requests, null, 2), { mode: 0o600 });
          recordCounts();
          const results = resultsOf(request);
          if (step === 0) {
            const state = host.getState();
            assert.equal(state.workspaceRoot, config.workspace);
            assert.equal(state.materials.length, 2);
            assert.deepEqual(state.materials.map((item) => item.format).sort(), ["docx", "pdf"]);
            assert.equal(state.reportTarget, "modules-report.md");
            assert.deepEqual(state.permissions, { writes: false, checks: false });
            yield* tools(
              state.materials.map((material) => ({
                name: "read_document",
                args: { path: material.path },
              })),
            );
          } else if (step === 1) {
            assert.equal(results.length, 2);
            assert(results.every((result) => result.status === "succeeded"));
            const text = JSON.stringify(results);
            for (const fragment of ["Project Aster", "Project Birch", "1200", "3400"])
              assert(text.includes(fragment), `Missing real parser observation: ${fragment}`);
            yield* tools([{ name: "create", args: { path: "modules-report.md", text: report } }]);
          } else if (step === 2) {
            assert.equal(results.length, 3);
            assert.equal(
              results.at(-1).status,
              "succeeded",
              "The native approval must allow the prepared report action",
            );
            assert.equal(readFileSync(join(config.workspace, "modules-report.md"), "utf8"), report);
            yield* tools([{ name: "read", args: { path: "modules-report.md" } }]);
          } else {
            assert.equal(results.length, 4);
            assert.equal(results.at(-1).status, "succeeded");
            assert(JSON.stringify(results.at(-1).content).includes("MODULES_READBACK_CANARY"));
            assert.equal(request.toolChoice, "none");
            yield {
              type: "part_completed",
              index: 0,
              part: {
                type: "text",
                text: "离线验收完成：已读取两份公开合成文档，批准创建报告，并读回实际文件。请在报告成果中预览、另存副本，再重启应用查看历史。没有真实模型或凭据调用。",
              },
            };
            yield complete();
          }
        },
      }),
    });
  },
};
host = await createDesktopHost({
  runtimeOptions: () => ({
    model: origin,
    dataDirectory: config.dataDirectory,
    protectedPaths: [config.evidence],
    plugins: [{ plugin }],
    deepseek: {
      getApiKey() {
        counts.credentialReads++;
        recordCounts();
        throw Error("Credentials are forbidden in native synthetic acceptance");
      },
    },
    limits: {
      maxModelRequests: 4,
      maxRetries: 0,
      timeoutMs: 120000,
      maxInputBytes: 65536,
      maxToolOutputBytes: 32768,
      maxParallelReads: 1,
    },
  }),
  settings: { preset: "flash", maxRequests: 4, timeoutMs: 120000 },
  maxOutputTokens: 8192,
});
function publish(message) {
  if (process.connected) process.send(message);
}
function snapshot(state) {
  writeFileSync(join(evidence, "native-state.json"), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  publish({ type: "state", state });
}
host.subscribe(snapshot);
snapshot(host.getState());
process.on("message", async (message) => {
  assert(message?.type === "command" && Number.isSafeInteger(message.id));
  try {
    await host.dispatch(message.command);
    publish({ type: "ack", id: message.id });
  } catch {
    publish({
      type: "ack",
      id: message.id,
      error: host.getState().error ?? "Fixture command failed",
    });
  }
});
for (const event of ["disconnect", "SIGTERM"])
  process.on(event, () => {
    void host.close().finally(() => process.exit(0));
  });
