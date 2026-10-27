import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent, SessionId } from "../../src/contracts/index.ts";
import { kimiFixture, kimiFixtureTransport } from "../../src/plugins/provider-kimi/fixtures.ts";
import { kimiApiProfile, kimiProfile } from "../../src/plugins/provider-kimi/index.ts";
import { createRuntime, type Runtime } from "../../src/runtime/index.ts";
import { MemoryRecordingSink } from "../../src/runtime/model-recording.ts";

export const kimiScenarios = [
  "tools-record-replay",
  "last-request-cannot-write",
  "partial-tool-never-executes",
  "compact-restart",
] as const;
export type KimiScenario = (typeof kimiScenarios)[number];
const instruction = "Read README.md and preserve all local files.";
const summary = "Project codename is LANTERN. Preserve all local files.";
const answer = (text: string, reasoning = "Synthetic preserved reasoning.") =>
  kimiFixture({ text, reasoning });

export async function runKimiScenario(scenario: KimiScenario): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-kimi-eval-"));
  const workspace = join(directory, "workspace"),
    dataDirectory = join(directory, "data");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "Project codename: LANTERN\n");
  writeFileSync(join(workspace, "protected.txt"), "UNCHANGED");
  const call = (name: string, args: object, id: string) =>
    kimiFixture({
      reasoning: "Read the file before answering.",
      calls: [{ id, name, arguments: JSON.stringify(args) }],
      finishReason: "tool_calls",
    });
  let streams = [call("read", { path: "README.md" }, "read_1"), answer("LANTERN. ".repeat(100))];
  if (scenario === "last-request-cannot-write")
    streams[1] = call("create", { path: "unexpected.txt", text: "MUST NOT EXIST" }, "create_1");
  if (scenario === "partial-tool-never-executes") {
    const whole = call("create", { path: "unexpected.txt", text: "MUST NOT EXIST" }, "create_1");
    streams = [whole.replace(/data: \[DONE\]\r?\n\r?\n/, "")];
  }
  if (scenario === "compact-restart")
    streams.push(
      answer("Second turn. ".repeat(100), "Old second reasoning."),
      answer("Third turn. ".repeat(100)),
      answer("Fourth turn. ".repeat(100)),
      answer(summary),
      answer("Continue from compacted state.", "New reasoning after compaction."),
    );
  const fixture = kimiFixtureTransport(streams);
  const sink = new MemoryRecordingSink();
  const events: RuntimeEvent[] = [];
  let runtime: Runtime | undefined;
  const configured = {
    dataDirectory,
    model: kimiProfile.origin,
    kimiReasoningEffort: "low" as const,
    limits: { maxRetries: 0, ...(scenario === "compact-restart" ? {} : { maxModelRequests: 2 }) },
  };
  try {
    runtime = await createRuntime({
      ...configured,
      kimi: { transport: fixture.transport },
      modelRecording: { sink, apiProfile: kimiApiProfile("low"), source: "synthetic" },
      ...(["partial-tool-never-executes", "last-request-cannot-write"].includes(scenario)
        ? { workspaceWrites: { roots: [workspace], approval: "allow" as const } }
        : {}),
    });
    runtime.subscribe((event) => events.push(event));
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    const ready = events.findLast((event) => event.type === "session.ready");
    assert(ready);
    const sessionId: SessionId = ready.sessionId;
    const turn = async (text: string) => {
      assert(runtime);
      await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text }] });
      await runtime.idle();
      return events.findLast((event) => event.type === "run.finished")?.outcome.kind;
    };
    const outcome = await turn(instruction);
    if (scenario === "partial-tool-never-executes" || scenario === "last-request-cannot-write") {
      assert.notEqual(outcome, "completed");
      assert(!existsSync(join(workspace, "unexpected.txt")));
      assert.equal(fixture.requests.length, scenario === "partial-tool-never-executes" ? 1 : 2);
      if (scenario === "partial-tool-never-executes")
        assert(!events.some((event) => event.type === "effect.updated"));
      else {
        assert.equal(fixture.requests[1]?.tool_choice, "none");
        assert.deepEqual(fixture.requests[1]?.tools, fixture.requests[0]?.tools);
      }
    } else {
      assert.equal(outcome, "completed");
      const results = events.flatMap((event) =>
        event.type === "entry.appended" && event.entry.body.kind === "tool_results"
          ? event.entry.body.results
          : [],
      );
      assert.equal(results[0]?.status, "succeeded");
      const wire = fixture.requests[1] as {
        messages: {
          role: string;
          content?: string;
          reasoning_content?: string;
          tool_call_id?: string;
        }[];
      };
      assert.equal(
        wire.messages.find((message) => message.role === "tool")?.content,
        `Tool result status: succeeded\n\n${results[0]?.content
          .map((part) => {
            assert(part.type === "text");
            return part.text;
          })
          .join("\n\n")}`,
      );
      assert(
        wire.messages.some(
          (message) => message.reasoning_content === "Read the file before answering.",
        ),
      );
      if (scenario === "tools-record-replay") {
        await runtime.close();
        runtime = await createRuntime({
          ...configured,
          dataDirectory: join(directory, "replay"),
          modelReplay: { records: sink.records, apiProfile: kimiApiProfile("low") },
        });
        const replayEvents: RuntimeEvent[] = [];
        runtime.subscribe((event) => replayEvents.push(event));
        await runtime.send({ type: "session.create", workspaceRoot: workspace });
        const replayReady = replayEvents.findLast((event) => event.type === "session.ready");
        assert(replayReady);
        await runtime.send({
          type: "run.start",
          sessionId: replayReady.sessionId,
          input: [{ type: "text", text: instruction }],
        });
        await runtime.idle();
        assert.equal(
          replayEvents.findLast((event) => event.type === "run.finished")?.outcome.kind,
          "completed",
        );
        assert.equal(fixture.requests.length, 2);
      } else {
        for (const text of ["Second request", "Third request", "Fourth request"])
          assert.equal(await turn(text), "completed");
        await runtime.send({ type: "session.compact", sessionId });
        await runtime.idle();
        assert.equal(
          events.findLast((event) => event.type === "run.finished")?.outcome.kind,
          "completed",
        );
        assert.equal(await turn("Continue using the summary."), "completed");
        const continued = JSON.stringify(fixture.requests.at(-1));
        assert(continued.includes(summary));
        assert(!continued.includes("Old second reasoning."));
        await runtime.close();
        const restart = kimiFixtureTransport([answer("Resumed from durable context.")]);
        runtime = await createRuntime({ ...configured, kimi: { transport: restart.transport } });
        runtime.subscribe((event) => events.push(event));
        assert.equal(restart.requests.length, 0);
        assert.equal(await turn("Resume after restarting."), "completed");
        assert(JSON.stringify(restart.requests[0]).includes(summary));
        assert(JSON.stringify(restart.requests[0]).includes("New reasoning after compaction."));
      }
    }
    assert.equal(readFileSync(join(workspace, "protected.txt"), "utf8"), "UNCHANGED");
    assert(sink.records.every((record) => record.meta.source === "synthetic"));
  } finally {
    await runtime?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
