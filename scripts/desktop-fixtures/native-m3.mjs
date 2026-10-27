// Native interaction fixture only. Replace worker.mjs in a disposable app copy after packaging;
// never install this worker as the product. qa-config.json supplies isolated workspace/data paths.
// The main/preload/renderer and host.mjs remain byte-identical to the candidate being inspected.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNKNOWN_USAGE } from "moyyi/contracts";
import { createDesktopHost } from "./host.mjs";

assert(process.send && process.connected);
const config = JSON.parse(readFileSync(new URL("./qa-config.json", import.meta.url), "utf8"));
assert.equal(config.mode, "synthetic-native-m3");
const ledgerPath = join(config.evidence, "native-requests.json");
const requests = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : [];
globalThis.fetch = () => {
  throw Error("Network is forbidden in native synthetic acceptance");
};
const origin = { provider: "native-desktop-m3-fixture", model: "scripted" };
const complete = (stopReason) => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const answer = (text) => [
  { type: "part_completed", index: 0, part: { type: "text", text } },
  complete("end_turn"),
];
function tool(name, args) {
  const callId = `qa_${randomUUID()}`;
  return [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId,
        providerCallId: callId,
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
          assert(requests.length < 12, "Synthetic native fixture limit");
          requests.push(request);
          writeFileSync(ledgerPath, JSON.stringify(requests, null, 2), { mode: 0o600 });
          // Tool results also use user-role messages in this model-neutral profile. Locate the
          // actual fixture task, not the last result/budget notice, before counting its results.
          const at = request.messages.findLastIndex(
            (m) =>
              m.role === "user" &&
              m.content.some(
                (p) =>
                  p.type === "text" &&
                  (p.text.includes("QA deny") ||
                    p.text.includes("QA edit and check") ||
                    p.text.includes('"snapshotId"')),
              ),
          );
          assert(at >= 0);
          const input = request.messages[at].content
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("\n");
          const tail = request.messages.slice(at + 1).flatMap((m) => m.content);
          const results = tail.filter((p) => p.type === "tool_result");
          if (input.includes("QA deny")) {
            if (results.length) {
              assert.equal(results.length, 1);
              assert.equal(
                results[0].status,
                "denied",
                "The native deny control must deny execution",
              );
            }
            yield* results.length
              ? answer("离线验收：操作被拒绝，文件未修改。")
              : tool("edit", { path: "note.txt", oldText: "OLD", newText: "NEW" });
          } else if (input.includes("QA edit and check")) {
            if (!results.length)
              yield* tool("edit", { path: "note.txt", oldText: "OLD", newText: "NEW" });
            else if (results.length === 1 && results[0].status === "succeeded")
              yield* tool("shell", {
                command:
                  'node -e \'process.stdout.write(require("node:fs").readFileSync("note.txt","utf8"))\'',
              });
            else if (results.length === 2 && results.every((r) => r.status === "succeeded"))
              yield* tool("edit", { path: "note.txt", oldText: "NEW", newText: "SHOULD_NOT_RUN" });
            else yield* answer("离线验收已停止；请检查实际操作记录。");
          } else if (input.includes("snapshotId")) {
            const snapshotId = input.match(/"snapshotId"\s*:\s*"([^"\n]+)"/)?.[1];
            assert(snapshotId);
            yield* results.length
              ? answer("离线验收：请核对撤销回执和实际文件。")
              : tool("undo", { snapshotId });
          } else yield* answer("离线原生交互验收，仅使用公开合成文件，没有模型或凭据调用。");
        },
      }),
    });
  },
};
const host = await createDesktopHost({
  runtimeOptions: () => ({
    model: origin,
    dataDirectory: config.dataDirectory,
    protectedPaths: [config.evidence],
    plugins: [{ plugin }],
    limits: {
      maxModelRequests: 8,
      maxRetries: 0,
      timeoutMs: 180000,
      maxToolOutputBytes: 32768,
      maxInputBytes: 65536,
    },
  }),
  settings: { preset: "flash", maxRequests: 8, timeoutMs: 180000 },
  maxOutputTokens: 8192,
});
function publish(message) {
  if (process.connected) process.send(message);
}
host.subscribe((state) => {
  writeFileSync(join(config.evidence, "native-state.json"), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  publish({ type: "state", state });
});
publish({ type: "state", state: host.getState() });
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
process.on("disconnect", () => {
  void host.close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void host.close().finally(() => process.exit(0));
});
