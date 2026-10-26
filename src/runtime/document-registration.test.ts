import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../plugins/provider-scripted/index.ts";
import { createCliRuntime } from "./cli-host.ts";
import { NodeWorkspaceDocuments } from "./documents.ts";
import { createRuntime, type Runtime, type RuntimeOptions } from "./index.ts";

const roots: string[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const done: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "moyyi-document-registration-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  return { workspace, data: join(root, "data") };
}
function provider() {
  return scriptedProvider([
    [
      {
        type: "part_completed",
        index: 0,
        part: {
          type: "tool_call",
          callId: "read_doc_1" as ToolCallId,
          name: "read_document",
          providerCallId: "read_doc_1",
          providerItemId: null,
          rawArguments: '{"path":"report.pdf"}',
          argumentsSource: "verbatim",
        },
      },
      { type: "completed", stopReason: "tool_use", providerStopReason: null, usage: UNKNOWN_USAGE },
    ],
    [{ type: "part_completed", index: 0, part: { type: "text", text: "Done." } }, done],
  ]);
}
async function run(runtime: Runtime, workspace: string, deny = false): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => {
    events.push(event);
    if (deny && event.type === "approval.requested")
      void runtime.send({
        type: "approval.respond",
        effectId: event.effectId,
        digest: event.digest,
        decision: "deny",
      });
  });
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const ready = events.find((event) => event.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("No session");
  await runtime.send({
    type: "run.start",
    sessionId: ready.sessionId,
    input: [{ type: "text", text: "Read report." }],
  });
  await runtime.idle();
  return events;
}

describe("document registration and CLI approval", () => {
  it.each([true, null, {}, "false"])(
    "rejects unsupported trusted host setting %j",
    async (documents) => {
      await expect(createRuntime({ documents } as unknown as RuntimeOptions)).rejects.toThrow(
        "false or omitted",
      );
    },
  );

  it("disables both the advertised tool and its capability with documents:false", async () => {
    const f = fixture(),
      scripted = provider();
    const create = vi.spyOn(NodeWorkspaceDocuments.prototype, "create");
    const runtime = await createRuntime({
      dataDirectory: f.data,
      projectInstructions: false,
      documents: false,
      model: scriptedProfile.origin,
      plugins: [{ plugin: scripted.plugin }],
    });
    runtimes.push(runtime);
    await run(runtime, f.workspace);
    expect(scripted.client.requests[0]?.tools.some((tool) => tool.name === "read_document")).toBe(
      false,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("uses the default read grant without shell authority and binds the started request", async () => {
    const f = fixture(),
      scripted = provider();
    const read = vi.fn(async () => ({
      path: "report.pdf",
      format: "pdf" as const,
      sha256: "a".repeat(64),
      bytes: 100,
      text: "Extracted text",
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      truncated: false,
      extractionTruncated: false,
      coverage: "text only",
    }));
    const create = vi
      .spyOn(NodeWorkspaceDocuments.prototype, "create")
      .mockImplementation((context, guard, scope) => {
        guard();
        expect(context.processes).toBeUndefined();
        expect(scope.effect?.state).toBe("started");
        expect(scope.action?.payload).toEqual({ path: "report.pdf", startLine: 1, maxLines: 200 });
        return { read };
      });
    const runtime = await createRuntime({
      dataDirectory: f.data,
      projectInstructions: false,
      model: scriptedProfile.origin,
      plugins: [{ plugin: scripted.plugin }],
    });
    runtimes.push(runtime);
    const events = await run(runtime, f.workspace);
    expect(create).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledExactlyOnceWith();
    expect(events.some((event) => event.type === "approval.requested")).toBe(false);
    expect(JSON.stringify(scripted.client.requests[1]?.messages)).toContain("Extracted text");
  });

  it("captures disabled selection before asynchronous plugin setup can mutate host options", async () => {
    const f = fixture(),
      scripted = provider();
    const options: RuntimeOptions = {
      dataDirectory: f.data,
      projectInstructions: false,
      documents: false,
      model: scriptedProfile.origin,
      plugins: [
        {
          plugin: {
            name: "mutates-options",
            apiVersion: 1,
            async setup() {
              await Promise.resolve();
              Reflect.deleteProperty(options, "documents");
            },
          },
        },
        { plugin: scripted.plugin },
      ],
    };
    const runtime = await createRuntime(options);
    runtimes.push(runtime);
    await run(runtime, f.workspace);
    expect(options.documents).toBeUndefined();
    expect(scripted.client.requests[0]?.tools.some((tool) => tool.name === "read_document")).toBe(
      false,
    );
  });

  it("keeps --approve-reads authoritative for document reads before any parser starts", async () => {
    const f = fixture(),
      scripted = provider();
    const create = vi.spyOn(NodeWorkspaceDocuments.prototype, "create");
    const runtime = await createCliRuntime({
      demo: false,
      dataDirectory: f.data,
      approveReads: true,
      host: {
        model: scriptedProfile.origin,
        projectInstructions: false,
        plugins: [{ plugin: scripted.plugin }],
      },
    });
    runtimes.push(runtime);
    const events = await run(runtime, f.workspace, true);
    expect(scripted.client.requests[0]?.tools.some((tool) => tool.name === "read_document")).toBe(
      true,
    );
    expect(events.some((event) => event.type === "approval.requested")).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(JSON.stringify(scripted.client.requests[1]?.messages)).toContain('"status":"denied"');
  });
});
