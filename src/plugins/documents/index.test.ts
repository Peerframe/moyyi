import { describe, expect, it, vi } from "vitest";
import type {
  DocumentReadResult,
  PluginHost,
  RunId,
  ToolContext,
  ToolDefinition,
  ToolOutcome,
  WorkspaceDocuments,
} from "../../contracts/index.ts";
import { documentsPlugin } from "./index.ts";

const result: DocumentReadResult = {
  path: "reports/example.docx",
  format: "docx",
  sha256: "a".repeat(64),
  bytes: 1024,
  text: "first\r\n中文😀\nlast",
  startLine: 1,
  endLine: 3,
  totalLines: 3,
  truncated: false,
  extractionTruncated: false,
  coverage: "Main document body only; no layout.",
};

async function registered(config?: unknown): Promise<ToolDefinition> {
  const tools: ToolDefinition[] = [];
  const host: PluginHost = {
    pluginName: "documents",
    config,
    registerTool: (tool) => tools.push(tool),
    registerModelProvider: vi.fn(),
    registerContextSource: vi.fn(),
    registerPolicyRule: vi.fn(),
    onEvent: vi.fn(),
    onDispose: vi.fn(),
  };
  await documentsPlugin.setup(host);
  expect(tools).toHaveLength(1);
  return tools[0] as ToolDefinition;
}

function context(documents?: WorkspaceDocuments, budget = 8192): ToolContext {
  return {
    runId: "documents_test" as RunId,
    workspaceRoot: "/synthetic/workspace",
    signal: new AbortController().signal,
    limits: { maxOutputBytes: budget },
    ...(documents ? { documents } : {}),
  };
}

function metadata(outcome: ToolOutcome): Record<string, unknown> {
  const first = outcome.content[0];
  if (first?.type !== "text") throw Error("Expected metadata");
  return JSON.parse(first.text);
}

describe("document tool", () => {
  it("registers a closed read-only tool without executable arguments", async () => {
    const tool = await registered();
    expect(tool.name).toBe("read_document");
    expect(tool.effect).toEqual({
      class: "read",
      reversibility: "not_applicable",
      verification: "not_applicable",
    });
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool.inputSchema.properties as object)).toEqual([
      "path",
      "startLine",
      "maxLines",
    ]);
    expect(tool.reconcile).toBeUndefined();
  });

  it.each([false, {}, null])("rejects plugin configuration %j", async (config) => {
    await expect(registered(config)).rejects.toThrow("trusted runtime host");
  });

  it("prepares copied selection without reading or executing anything", async () => {
    const read = vi.fn(async () => result);
    const ctx = context({ read }),
      tool = await registered();
    const input = { path: "reports/example.docx" };
    const action = await tool.prepare(input, ctx);
    input.path = "other.pdf";
    expect(action.payload).toEqual({ path: "reports/example.docx", startLine: 1, maxLines: 200 });
    expect(action.preconditions).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(action.summary).toBe("read_document reports/example.docx");
  });

  it.each([
    {},
    [],
    null,
    { path: "/outside.pdf" },
    { path: "../outside.pdf" },
    { path: "a/../b.pdf" },
    { path: "a\\b.pdf" },
    { path: "a\0.pdf" },
    { path: "a//b.pdf" },
    { path: "./a.pdf" },
    { path: "\ud800.pdf" },
    { path: "a.pdf", command: "echo unsafe" },
    { path: "a.pdf", maxLines: null },
    { path: "a.pdf", maxLines: 0 },
    { path: "a.pdf", maxLines: 1001 },
    { path: "a.pdf", startLine: 1.5 },
    { path: "a.pdf", startLine: 1_000_001 },
  ])("refuses invalid request %j before accessing the port", async (args) => {
    const read = vi.fn(async () => result),
      tool = await registered();
    await expect(tool.prepare(args, context({ read }))).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("uses only the no-argument bound port and preserves provenance and raw text once", async () => {
    const read = vi.fn(async () => result),
      tool = await registered(),
      ctx = context({ read });
    const action = await tool.prepare({ path: result.path, startLine: 1, maxLines: 3 }, ctx);
    const outcome = await tool.execute(action, ctx);
    expect(read).toHaveBeenCalledExactlyOnceWith();
    expect(outcome.status).toBe("succeeded");
    expect(metadata(outcome)).toMatchObject({
      kind: "document-read-v1",
      path: result.path,
      format: "docx",
      sha256: result.sha256,
      bytes: 1024,
      lineBasis: "extracted_text",
      startLine: 1,
      endLine: 3,
      totalLines: 3,
      extractionTruncated: false,
      outputTruncated: false,
    });
    expect(metadata(outcome)).not.toHaveProperty("text");
    expect(metadata(outcome)).not.toHaveProperty("nextRead");
    expect(outcome.content[1]).toEqual({ type: "text", text: "1: first\r\n2: 中文😀\n3: last" });
  });

  it("reports absent or failed capabilities without a direct-I/O fallback", async () => {
    const tool = await registered(),
      ctx = context();
    const action = await tool.prepare({ path: result.path }, ctx);
    expect((await tool.execute(action, ctx)).status).toBe("failed");
    const read = vi.fn().mockRejectedValue(Error("Document format is unsupported"));
    const outcome = await tool.execute(action, context({ read }));
    expect(outcome.status).toBe("failed");
    expect(metadata(outcome)).toEqual({ error: "Document format is unsupported" });
  });

  it("checks cancellation before read and after the capability resolves", async () => {
    const controller = new AbortController(),
      tool = await registered();
    const read = vi.fn(async () => {
      controller.abort();
      return result;
    });
    const ctx = { ...context({ read }), signal: controller.signal };
    const action = await tool.prepare({ path: result.path }, ctx);
    expect((await tool.execute(action, ctx)).status).toBe("failed");
    expect((await tool.execute(action, ctx)).status).toBe("failed");
    expect(read).toHaveBeenCalledTimes(1);
    await expect(tool.prepare({ path: result.path }, ctx)).rejects.toThrow();
  });
});
