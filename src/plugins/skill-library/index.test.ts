import { describe, expect, it, vi } from "vitest";
import type {
  ContextSource,
  ContextSourceInput,
  PluginHost,
  RunId,
  ToolContext,
  ToolDefinition,
} from "../../contracts/index.ts";
import {
  createSkillLibraryPlugin,
  MAX_SKILL_CATALOG_BYTES,
  type SkillLibraryAccess,
  type SkillLibraryEntry,
} from "./index.ts";

const entry = {
  name: "report-style",
  description: "Write reports using the approved style.",
  sha256: "a".repeat(64),
};
const markdown =
  "---\nname: report-style\ndescription: Write reports using the approved style.\nallowed-tools: shell\n---\nRead scripts/helper.py and run it.";
const context = (signal = new AbortController().signal, maxOutputBytes = 32768): ToolContext => ({
  runId: "test" as RunId,
  workspaceRoot: "/private/workspace",
  signal,
  limits: { maxOutputBytes },
});
const input: ContextSourceInput = {
  workspaceRoot: "/private/workspace",
  signal: new AbortController().signal,
  profile: {
    origin: { provider: "synthetic", model: "test" },
    contextWindowTokens: 100_000,
    maxOutputTokens: 1024,
    parallelToolCalls: true,
    reasoning: "none",
    promptCache: "none",
    editFormat: "whole_file",
  },
};
async function register(access: SkillLibraryAccess, config?: unknown) {
  let tool: ToolDefinition | undefined, source: ContextSource | undefined;
  const host: PluginHost = {
    pluginName: "skill-library",
    config,
    registerTool(value) {
      tool = value;
    },
    registerContextSource(value) {
      source = value;
    },
    registerModelProvider: vi.fn(),
    registerPolicyRule: vi.fn(),
    onEvent: vi.fn(),
    onDispose: vi.fn(),
  };
  await createSkillLibraryPlugin(access).setup(host);
  if (!tool || !source) throw Error("Missing registrations");
  expect(host.registerPolicyRule).not.toHaveBeenCalled();
  return { tool, source };
}
function library() {
  let entries: readonly SkillLibraryEntry[] = [entry];
  const read = vi.fn(async () => ({ text: markdown, sha256: entry.sha256 }));
  return {
    access: { list: vi.fn(async () => entries), read },
    read,
    replace(next: readonly SkillLibraryEntry[]) {
      entries = next;
    },
  };
}
describe("enabled skill catalog and read_skill", () => {
  it("registers one bounded read tool and a summary-only history suffix", async () => {
    const lib = library(),
      { tool, source } = await register(lib.access);
    expect(tool.name).toBe("read_skill");
    expect(tool.effect.class).toBe("read");
    expect(tool.inputSchema).toMatchObject({ required: ["name"], additionalProperties: false });
    const sections = await source.collect(input),
      text = JSON.stringify(sections);
    expect(sections).toMatchObject([{ placement: "after_history", stability: "turn" }]);
    expect(text).toContain(entry.name);
    expect(text).toContain(entry.description);
    expect(text).not.toContain("scripts/helper.py");
    expect(text).not.toContain("/private/");
    expect(lib.read).not.toHaveBeenCalled();
  });
  it("returns the pinned full source with explicit inert metadata and resource scope", async () => {
    const lib = library(),
      { tool } = await register(lib.access),
      ctx = context();
    const action = await tool.prepare({ name: entry.name }, ctx);
    expect(lib.read).not.toHaveBeenCalled();
    const result = await tool.execute(action, ctx);
    expect(result.status).toBe("succeeded");
    const text = result.content[0];
    if (text?.type !== "text") throw Error("Missing text");
    expect(text.text).toContain(
      JSON.stringify({ name: entry.name, sha256: entry.sha256, text: markdown }),
    );
    expect(text.text).toContain("allowed-tools never grants permissions");
    expect(text.text).toContain("references and scripts are not read or executed");
    expect(lib.read).toHaveBeenCalledExactlyOnceWith(entry.name, entry.sha256, ctx.signal);
  });
  it.each(["revoke", "version"] as const)(
    "rejects %s between preparation and execution without reading old content",
    async (change) => {
      const lib = library(),
        { tool } = await register(lib.access),
        ctx = context();
      const action = await tool.prepare({ name: entry.name }, ctx);
      lib.replace(change === "revoke" ? [] : [{ ...entry, sha256: "b".repeat(64) }]);
      expect(await tool.execute(action, ctx)).toMatchObject({ status: "failed" });
      expect(lib.read).not.toHaveBeenCalled();
    },
  );
  it.each(["revoke", "version"] as const)(
    "withholds a body if %s occurs during read",
    async (change) => {
      const lib = library();
      lib.read.mockImplementation(async () => {
        lib.replace(change === "revoke" ? [] : [{ ...entry, sha256: "b".repeat(64) }]);
        return { text: markdown, sha256: entry.sha256 };
      });
      const { tool } = await register(lib.access),
        ctx = context();
      const result = await tool.execute(await tool.prepare({ name: entry.name }, ctx), ctx);
      expect(result.status).toBe("failed");
      expect(JSON.stringify(result)).not.toContain("scripts/helper.py");
    },
  );
  it("reports revoked reads and explicitly empty availability without mutating prior sections", async () => {
    const lib = library(),
      { tool, source } = await register(lib.access),
      ctx = context();
    const before = await source.collect(input),
      saved = JSON.stringify(before);
    lib.replace([]);
    expect(JSON.stringify(await source.collect(input))).toContain(
      "No skills are currently enabled",
    );
    expect(await tool.execute(await tool.prepare({ name: entry.name }, ctx), ctx)).toMatchObject({
      status: "failed",
    });
    expect(lib.read).not.toHaveBeenCalled();
    expect(JSON.stringify(before)).toBe(saved);
  });
  it("caps eight normalized descriptions by UTF-8 bytes and sorts names", async () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      ...entry,
      name: `skill-${8 - i}`,
      description: "界".repeat(1024),
    }));
    const { source } = await register({ list: async () => entries, read: async () => null });
    const sections = await source.collect(input),
      text = sections[0]?.content[0]?.text ?? "";
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(MAX_SKILL_CATALOG_BYTES);
    expect(text.indexOf("skill-1")).toBeLessThan(text.indexOf("skill-8"));
    expect(text).toContain("...");
  });
  it.each([
    { entries: [entry, entry] },
    { entries: Array.from({ length: 9 }, (_, i) => ({ ...entry, name: `skill-${i}` })) },
  ])("rejects invalid or ambiguous catalogs", async ({ entries }) => {
    const { source } = await register({ list: async () => entries, read: async () => null });
    await expect(source.collect(input)).rejects.toThrow(
      "Cannot load the enabled skill catalog safely",
    );
  });
  it.each([
    {},
    { name: "../secret" },
    { name: entry.name, path: "/private/file" },
    { name: "Uppercase" },
  ])("rejects noncatalog addressing %j", async (args) => {
    const lib = library(),
      { tool } = await register(lib.access);
    await expect(tool.prepare(args, context())).rejects.toThrow("exactly one enabled skill name");
    expect(lib.read).not.toHaveBeenCalled();
  });
  it("does not claim a truncated source was loaded", async () => {
    const lib = library(),
      { tool } = await register(lib.access),
      ctx = context(undefined, 120);
    const result = await tool.execute(await tool.prepare({ name: entry.name }, ctx), ctx);
    expect(result.status).toBe("failed");
    expect(JSON.stringify(result)).toContain("full instructions were not loaded");
    expect(
      new TextEncoder().encode(result.content[0]?.type === "text" ? result.content[0].text : "")
        .byteLength,
    ).toBeLessThanOrEqual(120);
  });
  it("honors cancellation before and during reads, discarding returned text", async () => {
    const lib = library(),
      controller = new AbortController(),
      ctx = context(controller.signal);
    const { tool } = await register(lib.access);
    const action = await tool.prepare({ name: entry.name }, ctx);
    lib.read.mockImplementation(async () => {
      controller.abort();
      return { text: markdown, sha256: entry.sha256 };
    });
    await expect(tool.execute(action, ctx)).rejects.toThrow();
    await expect(tool.execute(action, ctx)).rejects.toThrow();
    expect(lib.read).toHaveBeenCalledTimes(1);
  });
  it("contains reader exceptions and mismatched source hashes", async () => {
    const lib = library(),
      { tool } = await register(lib.access),
      ctx = context();
    for (const read of [
      async () => {
        throw Error("private path and key");
      },
      async () => ({ text: markdown, sha256: "b".repeat(64) }),
    ]) {
      lib.read.mockImplementation(read);
      const result = await tool.execute(await tool.prepare({ name: entry.name }, ctx), ctx);
      expect(result.status).toBe("failed");
      expect(JSON.stringify(result)).not.toContain("private path");
      expect(JSON.stringify(result)).not.toContain("scripts/helper.py");
    }
  });
});
