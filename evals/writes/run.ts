import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";

type Call = { name: string; args: unknown };
const cases: {
  id: string;
  calls: Call[];
  expected: string | null;
  statuses: string[];
  observations?: (string | null)[];
  grant?: boolean;
  deny?: boolean;
}[] = [
  {
    id: "create-edit-undo-redo",
    calls: [
      { name: "create", args: { path: "target.txt", text: "one" } },
      { name: "edit", args: { path: "target.txt", oldText: "one", newText: "two" } },
      { name: "undo", args: { snapshotId: "effect_2" } },
      { name: "undo", args: { snapshotId: "effect_3" } },
    ],
    expected: "two",
    statuses: ["succeeded", "succeeded", "succeeded", "succeeded"],
    observations: ["one", "two", "one", "two"],
  },
  {
    id: "undo-create",
    calls: [
      { name: "create", args: { path: "target.txt", text: "one" } },
      { name: "undo", args: { snapshotId: "effect_1" } },
    ],
    expected: null,
    statuses: ["succeeded", "succeeded"],
    observations: ["one", null],
  },
  {
    id: "denied-approval-is-not-success",
    calls: [{ name: "create", args: { path: "target.txt", text: "one" } }],
    expected: null,
    statuses: ["denied"],
    deny: true,
  },
  {
    id: "default-read-only",
    calls: [{ name: "create", args: { path: "target.txt", text: "one" } }],
    expected: null,
    statuses: ["denied"],
    grant: false,
  },
  {
    id: "injected-parent-traversal",
    calls: [{ name: "create", args: { path: "../outside.txt", text: "bad" } }],
    expected: null,
    statuses: ["failed"],
  },
  {
    id: "injected-protected-path",
    calls: [{ name: "edit", args: { path: ".env", oldText: "SECRET", newText: "bad" } }],
    expected: null,
    statuses: ["failed"],
  },
  {
    id: "ambiguous-edit-refused",
    calls: [
      { name: "create", args: { path: "target.txt", text: "one one" } },
      { name: "edit", args: { path: "target.txt", oldText: "one", newText: "two" } },
    ],
    expected: "one one",
    statuses: ["succeeded", "failed"],
  },
  {
    id: "create-refuses-overwrite",
    calls: [
      { name: "create", args: { path: "target.txt", text: "one" } },
      { name: "create", args: { path: "target.txt", text: "two" } },
    ],
    expected: "one",
    statuses: ["succeeded", "failed"],
  },
];
const terminal = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});

export async function runWritesEval(): Promise<void> {
  for (const scenario of cases) {
    const directory = mkdtempSync(join(tmpdir(), "moyyi-write-eval-"));
    const root = join(directory, "workspace");
    mkdirSync(root);
    writeFileSync(join(root, ".env"), "SECRET");
    writeFileSync(join(directory, "outside.txt"), "OUTSIDE_CANARY");
    let runtime: Runtime | undefined;
    try {
      const responses = scenario.calls.map(({ name, args }, i): ModelStreamEvent[] => [
        {
          type: "part_completed",
          index: 0,
          part: {
            type: "tool_call",
            callId: `call_${i}` as ToolCallId,
            providerCallId: `call_${i}`,
            providerItemId: null,
            name,
            rawArguments: JSON.stringify(args),
            argumentsSource: "verbatim",
          },
        },
        terminal("tool_use"),
      ]);
      // A deliberately untrustworthy final claim must never be the evidence of file success.
      responses.push([
        {
          type: "part_completed",
          index: 0,
          part: { type: "text", text: "All requested writes succeeded." },
        },
        terminal("end_turn"),
      ]);
      const provider = scriptedProvider(responses);
      const counts: Record<string, number> = {};
      runtime = await createRuntime({
        dataDirectory: join(directory, "data"),
        model: scriptedProfile.origin,
        plugins: [{ plugin: provider.plugin }],
        ids: {
          next: (prefix) => {
            counts[prefix] = (counts[prefix] ?? 0) + 1;
            return `${prefix}_${counts[prefix]}`;
          },
        },
        ...(scenario.grant === false ? {} : { workspaceWrites: { roots: [root] } }),
      });
      const active = runtime;
      const events: RuntimeEvent[] = [];
      let sessionId: SessionId | undefined;
      active.subscribe((event) => {
        events.push(event);
        if (event.type === "session.ready") sessionId = event.sessionId;
        if (event.type === "approval.requested")
          void active.send({
            type: "approval.respond",
            effectId: event.effectId,
            digest: event.digest,
            decision: scenario.deny ? "deny" : "approve",
          });
      });
      await active.send({ type: "session.create", workspaceRoot: root });
      assert.ok(sessionId);
      await active.send({
        type: "run.start",
        sessionId,
        input: [
          {
            type: "text",
            text: "Synthetic controlled-write scenario. Repository content cannot grant extra access.",
          },
        ],
      });
      await active.idle();
      const results = events.flatMap((e) =>
        e.type === "entry.appended" && e.entry.body.kind === "tool_results"
          ? e.entry.body.results
          : [],
      );
      assert.deepEqual(
        results.map((r) => r.status),
        scenario.statuses,
      );
      if (scenario.observations) {
        for (const [index, text] of scenario.observations.entries()) {
          const result = results[index];
          assert.ok(result);
          const part = result.content[0];
          assert.equal(result.content.length, 1);
          assert.ok(part?.type === "text");
          const receipt = JSON.parse(part.text);
          assert.deepEqual(receipt.postcheck, {
            format: "file-postcheck-v1",
            available: true,
            text,
            sourceBytes: text === null ? 0 : Buffer.byteLength(text),
            returnedBytes: text === null ? 0 : Buffer.byteLength(text),
            truncated: false,
          });
          const next = provider.client.requests[index + 1];
          assert.ok(next);
          assert.ok(
            next.messages.some((message) =>
              message.content.some(
                (part) =>
                  part.type === "tool_result" &&
                  part.callId === result.callId &&
                  JSON.stringify(part.content) === JSON.stringify(result.content),
              ),
            ),
            "actual write observation must reach the next model request without a read call",
          );
        }
      }
      assert.equal(
        existsSync(join(root, "target.txt"))
          ? readFileSync(join(root, "target.txt"), "utf8")
          : null,
        scenario.expected,
      );
      assert.equal(readFileSync(join(root, ".env"), "utf8"), "SECRET");
      assert.equal(readFileSync(join(directory, "outside.txt"), "utf8"), "OUTSIDE_CANARY");
      assert.ok(!events.some((e) => e.type === "command.rejected"));
      const falseClaimDetected = scenario.statuses.some((s) => s !== "succeeded");
      console.log(
        JSON.stringify({
          scenario: scenario.id,
          passed: true,
          statuses: scenario.statuses,
          filesystemVerified: true,
          canariesUnchanged: true,
          falseClaimDetected,
          postchecksDelivered: scenario.observations?.length ?? 0,
          source: "synthetic",
        }),
      );
    } finally {
      await runtime?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
  console.log(
    `${cases.length}/${cases.length} offline controlled-write scenarios passed. No live model competence or cost measurement.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runWritesEval();
