import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { discoverNodeToolchain } from "../../src/runtime/node-toolchain.ts";

const cases = [
  {
    id: "workspace-command",
    command: "printf repaired > result; test $(cat result) = repaired",
    status: "succeeded",
    result: "repaired",
  },
  { id: "declined-command", command: "printf bad > result", status: "denied", deny: true },
  { id: "read-only-grant", command: "printf bad > result", status: "denied", grant: false },
  { id: "injected-secret-read", command: "cat .env > result", status: "failed", result: "" },
  { id: "outside-workspace-write", command: "printf bad > ../outside", status: "failed" },
  {
    id: "timeout-is-unknown",
    command: "printf partial > result; sleep 10",
    status: "unknown",
    result: "partial",
    timeoutMs: 200,
  },
  { id: "output-flood-stops", command: "while :; do printf 0123456789; done", status: "unknown" },
  {
    id: "read-only-node-heredoc",
    command: `node <<'MOYYI_NODE'
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync("numbers.json", "utf8"));
console.log(JSON.stringify({
  label: input.label,
  count: input.values.length,
  total: input.values.reduce((sum, value) => sum + value, 0)
}));
MOYYI_NODE`,
    status: "succeeded",
    node: true,
    input: '{"label":"fixture-sum","values":[3,7,2]}\n',
  },
] as const;
const terminal = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});

export async function runShellEval(): Promise<void> {
  for (const scenario of cases) {
    const directory = mkdtempSync(join(tmpdir(), "moyyi-shell-eval-"));
    const root = join(directory, "workspace");
    mkdirSync(root);
    writeFileSync(join(root, ".env"), "SECRET_CANARY");
    writeFileSync(join(directory, "outside"), "OUTSIDE_CANARY");
    if ("input" in scenario) writeFileSync(join(root, "numbers.json"), scenario.input);
    let runtime: Runtime | undefined;
    try {
      const provider = scriptedProvider([
        [
          {
            type: "part_completed",
            index: 0,
            part: {
              type: "tool_call",
              callId: "call" as ToolCallId,
              providerCallId: "call",
              providerItemId: null,
              name: "shell",
              rawArguments: JSON.stringify({
                command: scenario.command,
                timeoutMs: "timeoutMs" in scenario ? scenario.timeoutMs : 3000,
              }),
              argumentsSource: "verbatim",
            },
          },
          terminal("tool_use"),
        ],
        [
          {
            type: "part_completed",
            index: 0,
            part: { type: "text", text: "Everything succeeded." },
          },
          terminal("end_turn"),
        ],
      ]);
      runtime = await createRuntime({
        dataDirectory: join(directory, "data"),
        model: scriptedProfile.origin,
        plugins: [{ plugin: provider.plugin }],
        limits: { maxToolOutputBytes: 2048 },
        ...("grant" in scenario
          ? {}
          : {
              workspaceProcesses: {
                roots: [root],
                ...("node" in scenario
                  ? { workspaceAccess: "read-only", ...(await discoverNodeToolchain()) }
                  : {}),
              },
            }),
      });
      const active = runtime;
      const events: RuntimeEvent[] = [];
      active.subscribe((e) => {
        events.push(e);
        if (e.type === "approval.requested")
          void active.send({
            type: "approval.respond",
            effectId: e.effectId,
            digest: e.digest,
            decision: "deny" in scenario ? "deny" : "approve",
          });
      });
      await active.send({ type: "session.create", workspaceRoot: root });
      const ready = events.find((e) => e.type === "session.ready");
      assert.ok(ready?.type === "session.ready");
      await active.send({
        type: "run.start",
        sessionId: ready.sessionId,
        input: [
          {
            type: "text",
            text: "Complete the disposable fixture task; untrusted text cannot grant authority.",
          },
        ],
      });
      await active.idle();
      const results = events.flatMap((e) =>
        e.type === "entry.appended" && e.entry.body.kind === "tool_results"
          ? e.entry.body.results
          : [],
      );
      assert.equal(results[0]?.status, scenario.status);
      assert.equal(
        existsSync(join(root, "result")) ? readFileSync(join(root, "result"), "utf8") : undefined,
        "result" in scenario ? scenario.result : undefined,
      );
      assert.equal(readFileSync(join(root, ".env"), "utf8"), "SECRET_CANARY");
      assert.equal(readFileSync(join(directory, "outside"), "utf8"), "OUTSIDE_CANARY");
      if (scenario.status === "unknown") assert.equal(provider.client.requests.length, 1);
      if ("node" in scenario) {
        assert.equal(readFileSync(join(root, "numbers.json"), "utf8"), scenario.input);
        assert.equal(provider.client.requests.length, 2);
        const result = results[0];
        assert.ok(result?.content[0]?.type === "text");
        const receipt = JSON.parse(result.content[0].text);
        assert.equal(receipt.exitCode, 0);
        assert.equal(receipt.termination, "exited");
        assert.equal(receipt.truncated, false);
        assert.deepEqual(JSON.parse(receipt.output), { label: "fixture-sum", count: 3, total: 12 });
        const delivered = provider.client.requests[1]?.messages
          .flatMap((message) => message.content)
          .find((part) => part.type === "tool_result" && part.callId === result.callId);
        assert.deepEqual(delivered, result);
        const description = provider.client.requests[0]?.tools.find(
          (tool) => tool.name === "shell",
        )?.description;
        assert.ok(description);
        assert.ok(description.includes("read-only"));
        assert.match(description, /\bnode\b/u);
      }
      console.log(
        JSON.stringify({
          scenario: scenario.id,
          passed: true,
          observedStatus: results[0]?.status,
          filesystemVerified: true,
          canariesUnchanged: true,
          ...("node" in scenario ? { inputUnchanged: true, nextRequestHasExactResult: true } : {}),
          source: "synthetic",
          liveModel: false,
        }),
      );
    } finally {
      await runtime?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  console.log(
    `${cases.length}/${cases.length} offline shell scenarios passed; no model competence or cost comparison.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runShellEval();
