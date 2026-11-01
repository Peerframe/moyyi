import { describe, expect, it, vi } from "vitest";
import type { ContextSource, ContextSourceInput, PluginHost } from "../../contracts/index.ts";
import {
  createPersonalInstructionsPlugin,
  MAX_PERSONAL_INSTRUCTIONS_BYTES,
  type PersonalInstructionsReader,
} from "./index.ts";

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
async function register(read: PersonalInstructionsReader, config?: unknown) {
  let source: ContextSource | undefined;
  const host: PluginHost = {
    pluginName: "personal-instructions",
    config,
    registerContextSource(value) {
      source = value;
    },
    registerTool: vi.fn(),
    registerModelProvider: vi.fn(),
    registerPolicyRule: vi.fn(),
    onEvent: vi.fn(),
    onDispose: vi.fn(),
  };
  await createPersonalInstructionsPlugin(read).setup(host);
  if (!source) throw Error("Missing source");
  expect(host.registerTool).not.toHaveBeenCalled();
  expect(host.registerPolicyRule).not.toHaveBeenCalled();
  return source;
}
describe("personal instruction source", () => {
  it("refreshes text and source hash without changing the prior collected section or disclosing a path", async () => {
    let text = "Use concise examples.",
      sha256 = "a".repeat(64);
    const source = await register(async () => ({ text, sha256 }));
    const first = await source.collect(input);
    const saved = JSON.stringify(first);
    expect(first).toMatchObject([{ id: "personal-instructions", stability: "turn" }]);
    expect(saved).toContain("个人指令");
    expect(saved).toContain(sha256);
    expect(saved).not.toContain("/private/");
    expect(saved).toContain("never grant tool permissions");
    text = "Use a different example.";
    sha256 = "b".repeat(64);
    expect(JSON.stringify(await source.collect(input))).toContain(text);
    expect(JSON.stringify(first)).toBe(saved);
  });
  it.each([null, { text: "", sha256: "a".repeat(64) }])(
    "omits absent or empty instructions",
    async (value) => {
      expect(await (await register(async () => value)).collect(input)).toEqual([]);
    },
  );
  it("enforces the UTF-8 byte boundary", async () => {
    const source = await register(async () => ({
      text: "x".repeat(MAX_PERSONAL_INSTRUCTIONS_BYTES),
      sha256: "a".repeat(64),
    }));
    expect(await source.collect(input)).toHaveLength(1);
    const oversized = await register(async () => ({
      text: "界".repeat(2800),
      sha256: "a".repeat(64),
    }));
    await expect(oversized.collect(input)).rejects.toThrow("8 KiB limit");
  });
  it("contains private errors and rejects unpaired Unicode and invalid hashes", async () => {
    for (const read of [
      async () => {
        throw Error("private path or key");
      },
      async () => ({ text: "bad\ud800", sha256: "a".repeat(64) }),
      async () => ({ text: "Valid text", sha256: "invalid" }),
    ])
      await expect((await register(read)).collect(input)).rejects.toThrow(
        /^Cannot load personal instructions safely;/,
      );
  });
  it("checks cancellation before and after the trusted read", async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => {
      controller.abort();
      return { text: "Must not escape", sha256: "a".repeat(64) };
    });
    const source = await register(read);
    await expect(source.collect({ ...input, signal: controller.signal })).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
    await expect(source.collect({ ...input, signal: controller.signal })).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not accept model-facing configuration", async () => {
    await expect(register(async () => null, {})).rejects.toThrow("trusted runtime host");
  });
});
