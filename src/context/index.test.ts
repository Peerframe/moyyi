import { describe, expect, it } from "vitest";
import type { ContextInput, ModelProfile, TranscriptEntry } from "../contracts/index.ts";
import { effects, entries } from "../contracts/persisted/fixtures/v1.ts";
import { ContextCapacityError, MinimalContextBuilder } from "./index.ts";

const profile: ModelProfile = {
  origin: { provider: "scripted", model: "test" },
  contextWindowTokens: 100_000,
  maxOutputTokens: 1000,
  parallelToolCalls: true,
  reasoning: "visible",
  promptCache: "none",
  editFormat: "whole_file",
};
const textPath: readonly TranscriptEntry[] = entries.map((entry) =>
  entry.body.kind === "user_message"
    ? {
        ...entry,
        body: {
          ...entry.body,
          content: entry.body.content.filter((part) => part.type !== "image"),
        },
      }
    : entry,
);
const input = (change: Partial<ContextInput> = {}): ContextInput => ({
  path: textPath,
  profile,
  tools: [],
  sections: [],
  unsettledEffects: effects,
  ...change,
});

describe("MinimalContextBuilder", () => {
  it("preserves every entry, assistant content and opaque replay without applying recorded compaction", () => {
    const result = new MinimalContextBuilder().build(input());
    expect(result.report.includedEntryIds).toEqual(entries.map((entry) => entry.id));
    expect(result.request.messages).toHaveLength(entries.length + 1);
    expect(result.request.messages[0]?.role).toBe("user");
    const assistant = textPath[1]?.body;
    if (assistant?.kind !== "assistant_message") throw new Error("fixture");
    expect(result.request.messages[1]).toEqual({
      role: "assistant",
      content: assistant.content,
      stopReason: assistant.stopReason,
      replay: assistant.replay,
    });
    expect(result.request.messages[1]?.replay).toBe(assistant.replay);
    expect(result.request.messages[2]?.content[0]?.type).toBe("tool_result");
    expect(JSON.stringify(result.request.messages[3])).toContain("User asked to fix range.js.");
    expect(JSON.stringify(result.request.messages[4])).toContain("run_interrupted");
    expect(result.request.messages[6]?.content[0]?.type).toBe("refusal");
    expect(JSON.stringify(result.request.messages.at(-1))).toContain(effects[0]?.id);
    expect(JSON.stringify(result.request.messages.at(-1))).toContain("Verify before retrying");
  });

  it("orders sections by stability while keeping registration order within each group", () => {
    const section = (id: string, stability: "static" | "session" | "turn") => ({
      id,
      stability,
      content: [{ type: "text" as const, text: id }],
    });
    const result = new MinimalContextBuilder().build(
      input({
        sections: [
          section("turn", "turn"),
          section("z", "static"),
          section("session", "session"),
          section("a", "static"),
        ],
      }),
    );
    expect(result.request.system).toEqual(
      ["z", "a", "session", "turn"].map((text) => ({ type: "text", text })),
    );
  });

  it("includes all unsettled effects even with no transcript and keeps their evidence", () => {
    const result = new MinimalContextBuilder().build(input({ path: [] }));
    expect(result.request.messages).toHaveLength(1);
    expect(JSON.stringify(result.request.messages)).toContain("process exited after start");
    expect(result.report.includedEntryIds).toEqual([]);
  });

  it("fails explicitly rather than dropping history when the context is too small", () => {
    expect(() =>
      new MinimalContextBuilder().build(
        input({ profile: { ...profile, contextWindowTokens: 2000 } }),
      ),
    ).toThrow(ContextCapacityError);
    expect(textPath).toHaveLength(entries.length);
  });

  it.each(["system", "tools", "maxOutput"])("charges %s against the capacity", (kind) => {
    const base = input({
      path: [],
      unsettledEffects: [],
      profile: { ...profile, contextWindowTokens: 2000, maxOutputTokens: 1 },
    });
    expect(() => new MinimalContextBuilder().build(base)).not.toThrow();
    const over =
      kind === "system"
        ? {
            ...base,
            sections: [
              {
                id: "large",
                stability: "static" as const,
                content: [{ type: "text" as const, text: "中".repeat(700) }],
              },
            ],
          }
        : kind === "tools"
          ? {
              ...base,
              tools: [
                { name: "read", description: "x".repeat(2000), inputSchema: { type: "object" } },
              ],
            }
          : { ...base, profile: { ...base.profile, maxOutputTokens: 2000 } };
    expect(() => new MinimalContextBuilder().build(over)).toThrow(ContextCapacityError);
  });

  it("rejects images until a provider-specific image budget exists", () => {
    expect(() => new MinimalContextBuilder().build(input({ path: entries }))).toThrow(
      "Image context",
    );
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid token limits %s",
    (limit) => {
      expect(() =>
        new MinimalContextBuilder().build(
          input({ profile: { ...profile, maxOutputTokens: limit } }),
        ),
      ).toThrow("positive safe integers");
    },
  );
});
