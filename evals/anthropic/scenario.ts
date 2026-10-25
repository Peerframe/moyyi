import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin, RuntimeEvent, SessionId } from "../../src/contracts/index.ts";
import {
  anthropicFixture,
  anthropicFixtureTransport,
} from "../../src/plugins/provider-anthropic/fixtures.ts";
import {
  ANTHROPIC_API_PROFILE,
  anthropicProfile,
} from "../../src/plugins/provider-anthropic/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { MemoryRecordingSink } from "../../src/runtime/model-recording.ts";

export const anthropicScenarios = [
  "tools-record-replay",
  "compact-restart",
  "partial-tool-never-executes",
  "unknown-usage",
  "rejected-replay-stays-invalid",
] as const;
export type AnthropicScenario = (typeof anthropicScenarios)[number];
const answer = (text: string) =>
  anthropicFixture([
    {
      type: "thinking",
      thinking: "Synthetic summary reasoning.",
      signature: "synthetic_signature",
    },
    { type: "text", text },
  ]);
const instruction = "Read README.md and preserve all local files.";
const summary = "Preserve all local files. README.md contains the project codename LANTERN.";

export async function runAnthropicScenario(scenario: AnthropicScenario): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-anthropic-eval-")),
    workspace = join(directory, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "Project codename: LANTERN\n");
  writeFileSync(join(workspace, "protected.txt"), "UNCHANGED");
  const toolCall = anthropicFixture([
    { type: "thinking", thinking: "Read the file first.", signature: "synthetic_read_signature" },
    { type: "tool_use", id: "toolu_read", name: "read", rawArguments: '{"path":"README.md"}' },
  ]);
  let streams = [toolCall, answer(`LANTERN. ${"Recorded detail. ".repeat(100)}`)];
  let contextText = "Original synthetic host context.";
  const contextPlugin: Plugin = {
    name: "synthetic-context",
    apiVersion: 1,
    setup(host) {
      host.registerContextSource({
        id: "synthetic-context",
        async collect() {
          return [
            {
              id: "synthetic-context",
              stability: "session",
              content: [{ type: "text", text: contextText }],
            },
          ];
        },
      });
    },
  };
  const contextPlugins =
    scenario === "rejected-replay-stays-invalid" ? [{ plugin: contextPlugin }] : [];
  if (scenario === "rejected-replay-stays-invalid")
    streams.push(
      anthropicFixture([{ type: "text", text: "Synthetic refusal." }], { stopReason: "refusal" }),
    );
  if (scenario === "compact-restart")
    streams.push(
      answer("Second turn. ".repeat(100)),
      answer("Third turn. ".repeat(100)),
      answer("Fourth turn. ".repeat(100)),
      answer(summary),
      answer("Continue after compaction."),
    );
  if (scenario === "unknown-usage")
    streams = [
      anthropicFixture([{ type: "text", text: "Usage missing from this synthetic response." }], {
        usage: null,
      }),
    ];
  if (scenario === "partial-tool-never-executes") {
    const stream = anthropicFixture([
      {
        type: "tool_use",
        id: "toolu_create",
        name: "create",
        rawArguments: '{"path":"unexpected.txt","text":"bad"}',
      },
    ]);
    streams = [stream.slice(0, stream.indexOf("event: message_delta"))];
  }
  const fixture = anthropicFixtureTransport(streams);
  const sink = new MemoryRecordingSink();
  const events: RuntimeEvent[] = [];
  let runtime: Runtime | undefined;
  const subscribe = (active: Runtime) => active.subscribe((event) => events.push(event));
  try {
    runtime = await createRuntime({
      dataDirectory: join(directory, "data"),
      model: anthropicProfile.origin,
      plugins: contextPlugins,
      anthropic: { transport: fixture.transport, accountScope: "synthetic-account" },
      modelRecording: { sink, apiProfile: ANTHROPIC_API_PROFILE, source: "synthetic" },
      ...(scenario === "partial-tool-never-executes"
        ? { workspaceWrites: { roots: [workspace], approval: "allow" as const } }
        : {}),
    });
    subscribe(runtime);
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    const ready = events.findLast((event) => event.type === "session.ready");
    assert(ready);
    const sessionId: SessionId = ready.sessionId;
    const turn = async (text: string, expected = "completed") => {
      assert(runtime);
      await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text }] });
      await runtime.idle();
      assert.equal(
        events.findLast((event) => event.type === "run.finished")?.outcome.kind,
        expected,
      );
    };
    await turn(instruction, scenario === "partial-tool-never-executes" ? "failed" : "completed");
    const assistant = events.flatMap((event) =>
      event.type === "entry.appended" && event.entry.body.kind === "assistant_message"
        ? [event.entry.body]
        : [],
    );
    if (scenario === "unknown-usage") {
      assert.equal(assistant[0]?.usage.status, "unknown");
      assert.equal(assistant[0]?.usage.inputTokens, null);
    } else if (scenario === "partial-tool-never-executes") {
      assert(!events.some((event) => event.type === "effect.updated"));
      assert(!existsSync(join(workspace, "unexpected.txt")));
      assert.equal(assistant[0]?.stopReason, "interrupted");
      assert.equal(fixture.requests.length, 1);
    } else {
      assert(JSON.stringify(fixture.requests[1]).includes("LANTERN"));
      assert(JSON.stringify(fixture.requests[1]).includes("synthetic_read_signature"));
      assert.deepEqual(assistant[0]?.usage, {
        status: "final",
        inputTokens: 17,
        outputTokens: 7,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        reasoningTokens: null,
      });
      const results = events.flatMap((event) =>
        event.type === "entry.appended" && event.entry.body.kind === "tool_results"
          ? event.entry.body.results
          : [],
      );
      assert.equal(results[0]?.status, "succeeded");
      if (scenario === "tools-record-replay") {
        await runtime.close();
        runtime = await createRuntime({
          dataDirectory: join(directory, "replay"),
          model: anthropicProfile.origin,
          modelReplay: { records: sink.records, apiProfile: ANTHROPIC_API_PROFILE },
        });
        const replayEvents: RuntimeEvent[] = [];
        runtime.subscribe((event) => replayEvents.push(event));
        await runtime.send({ type: "session.create", workspaceRoot: workspace });
        const replaySession = replayEvents.find((event) => event.type === "session.ready");
        assert(replaySession);
        await runtime.send({
          type: "run.start",
          sessionId: replaySession.sessionId,
          input: [{ type: "text", text: instruction }],
        });
        await runtime.idle();
        assert.equal(
          replayEvents.findLast((event) => event.type === "run.finished")?.outcome.kind,
          "completed",
        );
        assert.equal(fixture.requests.length, 2);
      } else if (scenario === "rejected-replay-stays-invalid") {
        contextText = "Changed synthetic host context.";
        await turn("Continue with the changed context.");
        assert(!JSON.stringify(fixture.requests.at(-1)).includes("synthetic_read_signature"));
        await runtime.close();
        contextText = "Original synthetic host context.";
        const restart = anthropicFixtureTransport([
          answer("Continue after the refusal and restart."),
        ]);
        runtime = await createRuntime({
          dataDirectory: join(directory, "data"),
          model: anthropicProfile.origin,
          plugins: contextPlugins,
          anthropic: { transport: restart.transport, accountScope: "synthetic-account" },
        });
        subscribe(runtime);
        await turn("Resume with the original host context.");
        const wire = JSON.stringify(restart.requests[0]);
        assert(!wire.includes("synthetic_read_signature"));
        assert(!wire.includes("synthetic_signature"));
        assert(wire.includes("LANTERN"));
        assert(wire.includes("Synthetic refusal."));
      } else {
        for (const text of ["Second request", "Third request", "Fourth request"]) await turn(text);
        await runtime.send({ type: "session.compact", sessionId });
        await runtime.idle();
        assert.equal(
          events.findLast((event) => event.type === "run.finished")?.outcome.kind,
          "completed",
        );
        await turn("Continue using the summary.");
        const continued = fixture.requests.at(-1);
        assert(continued);
        assert(JSON.stringify(continued).includes(summary));
        const blocks = (
          continued.messages as { role: string; content: { type: string }[] }[]
        ).flatMap((message) => message.content);
        assert(
          !blocks.some((block) => block.type === "thinking" || block.type === "redacted_thinking"),
        );
        await runtime.close();
        const restart = anthropicFixtureTransport([answer("Resumed from durable context.")]);
        runtime = await createRuntime({
          dataDirectory: join(directory, "data"),
          model: anthropicProfile.origin,
          anthropic: { transport: restart.transport, accountScope: "synthetic-account" },
        });
        subscribe(runtime);
        assert.equal(restart.requests.length, 0);
        await turn("Resume after restarting.");
        assert(JSON.stringify(restart.requests[0]).includes(summary));
        // New reasoning produced after compaction has a valid prefix and may be used again.
        assert(JSON.stringify(restart.requests[0]).includes("synthetic_signature"));
      }
    }
    assert.equal(readFileSync(join(workspace, "protected.txt"), "utf8"), "UNCHANGED");
    assert.equal(
      sink.records.every((record) => record.meta.source === "synthetic"),
      true,
    );
    assert.equal(fixture.closed(), fixture.requests.length);
  } finally {
    await runtime?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
