import { describe, expect, it, vi } from "vitest";
import type {
  FileRead,
  PluginHost,
  RunId,
  ToolContext,
  ToolDefinition,
  ToolOutcome,
  WorkspaceFiles,
} from "../../contracts/index.ts";
import { fsPlugin } from "./index.ts";

async function registered(config?: unknown): Promise<Map<string, ToolDefinition>> {
  const tools = new Map<string, ToolDefinition>();
  const host: PluginHost = {
    pluginName: "fs",
    config,
    registerTool: (tool) => {
      tools.set(tool.name, tool);
    },
    registerModelProvider: vi.fn(),
    registerContextSource: vi.fn(),
    registerPolicyRule: vi.fn(),
    onEvent: vi.fn(),
    onDispose: vi.fn(),
  };
  await fsPlugin.setup(host);
  return tools;
}
function capability() {
  return {
    read: vi.fn<WorkspaceFiles["read"]>(async (path) => ({
      path,
      text: "hello",
      bytesRead: 5,
      truncated: false,
    })),
    list: vi.fn<WorkspaceFiles["list"]>(async (path) => ({
      path,
      entries: [{ path: "a.txt", type: "file" }],
      truncated: false,
      skippedEntries: 0,
    })),
    search: vi.fn<WorkspaceFiles["search"]>(async (path) => ({
      path,
      matches: [{ path: "a.txt", line: 1, text: "hello" }],
      truncated: false,
      skippedFiles: 0,
    })),
  };
}
function context(
  files?: WorkspaceFiles,
  signal = new AbortController().signal,
  maxOutputBytes = 8192,
): ToolContext {
  return {
    runId: "run_fs" as RunId,
    workspaceRoot: "/synthetic/workspace",
    signal,
    limits: { maxOutputBytes },
    ...(files ? { files } : {}),
  };
}
function body(outcome: ToolOutcome): Record<string, unknown> {
  const text = outcome.content[0];
  if (text?.type !== "text") throw new Error("Expected a JSON text result");
  const metadata = JSON.parse(text.text) as Record<string, unknown>;
  if (metadata.format !== "file-read-v1") return metadata;
  const { format: _format, presentation, ...body } = metadata;
  expect(body).not.toHaveProperty("text");
  expect(outcome.content).toHaveLength(2);
  const source = outcome.content[1];
  if (source?.type !== "text") throw new Error("Expected numbered source text");
  const range = presentation as { startLine: number; sourceBytes: number };
  const raw = (source.text.match(/[^\n]*\n|[^\n]+$/g) ?? [])
    .map((sourceLine, index) => {
      const prefix = `${range.startLine + index}: `;
      expect(sourceLine.startsWith(prefix)).toBe(true);
      return sourceLine.slice(prefix.length);
    })
    .join("");
  expect(new TextEncoder().encode(raw).byteLength).toBe(range.sourceBytes);
  return { ...body, text: raw };
}
async function selected(name: string): Promise<ToolDefinition> {
  const tool = (await registered()).get(name);
  if (!tool) throw new Error("Missing test tool");
  return tool;
}

describe("fs plugin", () => {
  it("registers three read tools and three snapshot writes with closed schemas", async () => {
    const tools = await registered();
    expect([...tools.keys()]).toEqual(["read", "list", "search", "create", "edit", "undo"]);
    for (const tool of [...tools.values()].slice(0, 3)) {
      expect(tool.effect).toEqual({
        class: "read",
        reversibility: "not_applicable",
        verification: "not_applicable",
      });
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.reconcile).toBeUndefined();
    }
  });
  it.each([{}, null, { outsideWorkspace: true }])(
    "rejects unsupported plugin configuration %j",
    async (config) => {
      await expect(registered(config)).rejects.toThrow("does not accept configuration");
    },
  );
  it("prepares a serializable request without touching files or echoing a search query into its summary", async () => {
    const files = capability(),
      ctx = context(files),
      tool = await selected("search");
    const input = { path: "src", query: "synthetic confidential string" };
    const action = await tool.prepare(input, ctx);
    input.query = "changed later";
    expect(action.payload).toEqual({
      path: "src",
      query: "synthetic confidential string",
      caseSensitive: true,
    });
    expect(action.summary).toBe("search src");
    expect(action.preconditions).toEqual([]);
    expect(files.read).not.toHaveBeenCalled();
    expect(files.list).not.toHaveBeenCalled();
    expect(files.search).not.toHaveBeenCalled();
  });
  it("delegates read to its scoped capability and retains host truncation metadata", async () => {
    const files = capability(),
      ctx = context(files),
      tool = await selected("read");
    files.read.mockResolvedValue({
      path: "file.txt",
      text: "prefix",
      bytesRead: 6,
      truncated: true,
    });
    const outcome = await tool.execute(
      await tool.prepare({ path: "file.txt", maxBytes: 100 }, ctx),
      ctx,
    );
    expect(files.read).toHaveBeenCalledExactlyOnceWith("file.txt", { maxBytes: 100 });
    expect(outcome.status).toBe("succeeded");
    expect(body(outcome)).toEqual({
      path: "file.txt",
      text: "prefix",
      bytesRead: 6,
      truncated: true,
    });
  });
  it("lists the workspace root by default and forwards a smaller requested limit", async () => {
    const files = capability(),
      ctx = context(files),
      tool = await selected("list");
    const result = await tool.execute(await tool.prepare({ maxEntries: 3 }, ctx), ctx);
    expect(files.list).toHaveBeenCalledExactlyOnceWith(".", { maxEntries: 3 });
    expect(body(result).entries).toEqual([{ path: "a.txt", type: "file" }]);
    expect(body(result).truncated).toBe(false);
  });
  it("forwards exact line selection with the reduced byte budget and retains range evidence", async () => {
    const files = capability(),
      ctx = context(files),
      tool = await selected("read");
    const evidence: FileRead = {
      path: "source.ts",
      text: "second\nthird\n",
      bytesRead: 13,
      truncated: true,
      lineRange: { startLine: 2, endLine: 3, complete: true },
    };
    files.read.mockResolvedValue(evidence);
    const args = { path: "source.ts", startLine: 2, maxLines: 2, maxBytes: 65536 };
    const action = await tool.prepare(args, ctx);
    args.startLine = 7;
    const result = await tool.execute(action, ctx);
    expect(files.read).toHaveBeenCalledExactlyOnceWith("source.ts", {
      startLine: 2,
      maxLines: 2,
      maxBytes: 1024,
    });
    expect(body(result)).toEqual(evidence);
  });
  it.each([{ startLine: 2 }, { maxLines: 5 }])(
    "preserves unspecified range defaults for the capability: %j",
    async (options) => {
      const files = capability(),
        ctx = context(files),
        tool = await selected("read");
      await tool.execute(await tool.prepare({ path: "source.ts", ...options }, ctx), ctx);
      expect(files.read).toHaveBeenCalledExactlyOnceWith("source.ts", {
        maxBytes: 1024,
        ...options,
      });
    },
  );
  it.each([
    { startLine: 0 },
    { startLine: 1000001 },
    { startLine: 1.5 },
    { startLine: "1" },
    { maxLines: 0 },
    { maxLines: 1001 },
    { maxLines: null },
    { startLine: 1, maxLines: 2, bypassScan: true },
  ])("rejects invalid range arguments before capability use: %j", async (options) => {
    const files = capability(),
      tool = await selected("read");
    await expect(tool.prepare({ path: "source.ts", ...options }, context(files))).rejects.toThrow();
    expect(files.read).not.toHaveBeenCalled();
  });
  it("drops range endpoints if serialized output clipping shortens the returned text", async () => {
    const files = capability(),
      ctx = context(files, undefined, 256),
      tool = await selected("read");
    files.read.mockResolvedValue({
      path: "source.ts",
      text: "line\n".repeat(100),
      bytesRead: 500,
      truncated: false,
      lineRange: { startLine: 1, endLine: 100, complete: true },
    });
    const result = await tool.execute(
      await tool.prepare({ path: "source.ts", startLine: 1, maxLines: 100 }, ctx),
      ctx,
    );
    expect(result.status).toBe("succeeded");
    expect(body(result).truncated).toBe(true);
    expect(body(result)).not.toHaveProperty("lineRange");
    expect(new TextEncoder().encode(JSON.stringify(result.content)).byteLength).toBeLessThanOrEqual(
      256,
    );
  });
  it("searches a literal query with case controls and no regex or ignore override", async () => {
    const files = capability(),
      ctx = context(files),
      tool = await selected("search");
    await tool.execute(
      await tool.prepare({ query: "a.*b", caseSensitive: false, maxMatches: 4 }, ctx),
      ctx,
    );
    expect(files.search).toHaveBeenCalledExactlyOnceWith(".", "a.*b", {
      maxMatches: 4,
      caseSensitive: false,
      contextLines: 8,
    });
    await expect(tool.prepare({ query: "text", regex: true }, ctx)).rejects.toThrow("Unsupported");
    await expect(tool.prepare({ query: "text", respectIgnore: false }, ctx)).rejects.toThrow(
      "Unsupported",
    );
  });
  it.each([0, 20])(
    "forwards explicit search context %i without additional reads",
    async (contextLines) => {
      const files = capability(),
        ctx = context(files),
        tool = await selected("search");
      await tool.execute(await tool.prepare({ query: "hit", contextLines }, ctx), ctx);
      expect(files.search).toHaveBeenCalledExactlyOnceWith(".", "hit", {
        maxMatches: 16,
        caseSensitive: true,
        contextLines,
      });
      expect(files.read).not.toHaveBeenCalled();
    },
  );
  it("snapshots glob lists, forwards exact-file scope and supports file discovery", async () => {
    const files = capability(),
      ctx = context(files),
      tool = await selected("search");
    const args = {
      path: "src/target.ts",
      query: "needle",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts"],
      mode: "files",
    };
    files.search.mockResolvedValue({
      path: args.path,
      mode: "files",
      files: [args.path],
      matches: [],
      truncated: false,
      skippedFiles: 0,
    });
    const action = await tool.prepare(args, ctx);
    args.include[0] = "unrelated/**";
    args.exclude.push("src/**");
    const result = await tool.execute(action, ctx);
    expect(files.search).toHaveBeenCalledExactlyOnceWith("src/target.ts", "needle", {
      maxMatches: 16,
      caseSensitive: true,
      contextLines: 8,
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts"],
      mode: "files",
    });
    expect(body(result)).toEqual({
      path: "src/target.ts",
      mode: "files",
      files: ["src/target.ts"],
      matches: [],
      truncated: false,
      skippedFiles: 0,
    });
    expect(files.read).not.toHaveBeenCalled();
  });
  it.each([
    { include: [] },
    { include: "*.ts" },
    { include: [1] },
    { include: [""] },
    { include: ["x".repeat(129)] },
    { exclude: Array(9).fill("*.ts") },
    { exclude: null },
    { mode: "all" },
    { mode: null },
  ])("rejects malformed selection options before calling files: %j", async (options) => {
    const files = capability();
    await expect(
      (await selected("search")).prepare({ query: "hit", ...options }, context(files)),
    ).rejects.toThrow();
    expect(files.search).not.toHaveBeenCalled();
  });
  it("clips file discovery on whole paths and retains marked omissions", async () => {
    const files = capability(),
      ctx = context(files, undefined, 256),
      tool = await selected("search");
    const paths = ["src/first.ts", `${"long-directory/".repeat(30)}second.ts`];
    files.search.mockResolvedValue({
      path: ".",
      mode: "files",
      files: paths,
      matches: [],
      truncated: false,
      skippedFiles: 2,
    });
    const result = await tool.execute(
      await tool.prepare({ query: "hit", mode: "files" }, ctx),
      ctx,
    );
    expect(body(result)).toEqual({
      path: ".",
      mode: "files",
      files: paths.slice(0, 1),
      matches: [],
      truncated: true,
      skippedFiles: 2,
    });
    expect(Buffer.byteLength(JSON.stringify(result.content))).toBeLessThanOrEqual(256);
    files.search.mockResolvedValue({
      path: ".",
      mode: "files",
      files: [paths[1] as string],
      matches: [],
      truncated: false,
      skippedFiles: 0,
    });
    const empty = await tool.execute(await tool.prepare({ query: "hit", mode: "files" }, ctx), ctx);
    expect(body(empty).files).toEqual([]);
    expect(body(empty).truncated).toBe(true);
  });
  it.each([-1, 21, 1.5, null, "8"])("rejects invalid tool context %j", async (contextLines) => {
    const files = capability();
    await expect(
      (await selected("search")).prepare({ query: "hit", contextLines }, context(files)),
    ).rejects.toThrow(/contextLines/);
    expect(files.search).not.toHaveBeenCalled();
  });
  it("drops whole search windows on output clipping without false range endpoints", async () => {
    const files = capability(),
      ctx = context(files, undefined, 512),
      tool = await selected("search");
    const first = { path: "file", startLine: 1, endLine: 2, text: "hit\nsecond\n", complete: true };
    files.search.mockResolvedValue({
      path: ".",
      matches: [
        { path: "file", line: 1, text: "hit" },
        { path: "file", line: 20, text: "hit" },
      ],
      context: [
        first,
        {
          path: "file",
          startLine: 20,
          endLine: 20,
          text: `hit${"x".repeat(1000)}`,
          complete: true,
        },
      ],
      truncated: false,
      skippedFiles: 0,
    });
    const result = await tool.execute(await tool.prepare({ query: "hit" }, ctx), ctx);
    expect(body(result).context).toEqual([first]);
    expect(body(result).matches).toHaveLength(2);
    expect(body(result).truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result.content))).toBeLessThanOrEqual(512);
  });
  it.each(["read", "list", "search"])(
    "%s fails explicitly without a file capability",
    async (name) => {
      const tool = await selected(name),
        ctx = context();
      const args = name === "search" ? { query: "needle" } : { path: "." };
      const result = await tool.execute(await tool.prepare(args, ctx), ctx);
      expect(result.status).toBe("failed");
      expect(body(result).error).toContain("capability is unavailable");
    },
  );
  it("keeps capability denials as failures without fallback access", async () => {
    const files = capability(),
      ctx = context(files),
      tool = await selected("read");
    files.read.mockRejectedValue(new Error("Protected path denied"));
    const action = await tool.prepare({ path: ".env" }, ctx);
    expect(action.preconditions).toEqual([]);
    expect(files.read).not.toHaveBeenCalled();
    const result = await tool.execute(action, ctx);
    expect(result.status).toBe("failed");
    expect(body(result).error).toBe("Protected path denied");
    expect(files.read).toHaveBeenCalledTimes(1);
    expect(files.list).not.toHaveBeenCalled();
    expect(files.search).not.toHaveBeenCalled();
  });
  it("does not invoke a capability after cancellation", async () => {
    const files = capability(),
      controller = new AbortController(),
      ctx = context(files, controller.signal),
      tool = await selected("read");
    const action = await tool.prepare({ path: "file" }, ctx);
    controller.abort();
    await expect(tool.prepare({ path: "file" }, ctx)).rejects.toThrow("cancelled");
    const result = await tool.execute(action, ctx);
    expect(result.status).toBe("failed");
    expect(body(result).error).toContain("cancelled");
    expect(files.read).not.toHaveBeenCalled();
  });
  it("discards file content when cancellation arrives while awaiting the capability", async () => {
    const files = capability(),
      controller = new AbortController(),
      ctx = context(files, controller.signal),
      tool = await selected("read");
    let release: ((value: FileRead) => void) | undefined;
    files.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = tool.execute(await tool.prepare({ path: "file" }, ctx), ctx);
    controller.abort();
    release?.({ path: "file", text: "must not escape", bytesRead: 15, truncated: false });
    const result = await pending;
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain("must not escape");
  });
  it.each(["/outside", "../outside", "dir/../file", "", "bad\0path", "dir\\file"])(
    "rejects invalid path %j before capability use",
    async (path) => {
      await expect(
        (await selected("read")).prepare({ path }, context(capability())),
      ).rejects.toThrow("path");
    },
  );
  it.each([
    { query: "" },
    { query: "x".repeat(257) },
    { query: "a\nb" },
    { query: "a\rb" },
    { query: "a\0b" },
    { query: "x", maxMatches: 0 },
    { query: "x", caseSensitive: "yes" },
    { query: "x", grant: true },
    { query: "x", path: null },
  ])("rejects malformed or authority-bearing arguments %j", async (args) => {
    await expect((await selected("search")).prepare(args, context(capability()))).rejects.toThrow();
  });
  it.each(["read", "list", "search"])(
    "%s output retains bounded metadata and source with a truthful truncation marker",
    async (name) => {
      const files = capability(),
        ctx = context(files, undefined, 256),
        tool = await selected(name);
      files.read.mockResolvedValue({
        path: "file",
        text: '😀\n"'.repeat(1000),
        bytesRead: 6000,
        truncated: false,
      });
      files.list.mockResolvedValue({
        path: ".",
        entries: Array.from({ length: 30 }, (_, i) => ({ path: `a-${i}`, type: "file" })),
        truncated: false,
        skippedEntries: 1,
      });
      files.search.mockResolvedValue({
        path: ".",
        matches: [{ path: "file", line: 1, text: '😀\n"'.repeat(1000) }],
        truncated: false,
        skippedFiles: 1,
      });
      const result = await tool.execute(
        await tool.prepare(name === "search" ? { query: "x" } : { path: "file" }, ctx),
        ctx,
      );
      expect(result.status).toBe("succeeded");
      expect(body(result).truncated).toBe(true);
      expect(
        new TextEncoder().encode(JSON.stringify(result.content)).byteLength,
      ).toBeLessThanOrEqual(256);
      expect(JSON.stringify(result)).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
    },
  );
  it("fits the core's minimum output budget even when result paths cannot fit", async () => {
    const files = capability(),
      ctx = context(files, undefined, 64),
      tool = await selected("read");
    files.read.mockResolvedValue({
      path: "long".repeat(100),
      text: "content",
      bytesRead: 7,
      truncated: false,
    });
    const result = await tool.execute(await tool.prepare({ path: "file" }, ctx), ctx);
    expect(body(result)).toEqual({ truncated: true });
    expect(new TextEncoder().encode(JSON.stringify(result.content)).byteLength).toBeLessThanOrEqual(
      64,
    );
    expect(files.read).toHaveBeenCalledExactlyOnceWith("file", { maxBytes: 8 });
  });
  it("sanitizes malformed diagnostic Unicode and never substitutes a success", async () => {
    const files = capability(),
      ctx = context(files),
      tool = await selected("read");
    files.read.mockRejectedValue(new Error("bad\ud800"));
    const result = await tool.execute(await tool.prepare({ path: "file" }, ctx), ctx);
    expect(result.status).toBe("failed");
    expect(body(result).error).toBe("bad�");
  });
});
