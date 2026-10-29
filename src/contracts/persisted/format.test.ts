import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as v1 from "./fixtures/v1.ts";
import * as v2 from "./fixtures/v2.ts";
import { type ContentPart, type EntryBody, PERSISTED_FORMAT_VERSION } from "./index.ts";

describe("persisted format", () => {
  it("has a fixture file for every version up to the current one", () => {
    const files = readdirSync(new URL("./fixtures/", import.meta.url)).sort();
    const expected = Array.from({ length: PERSISTED_FORMAT_VERSION }, (_, i) => `v${i + 1}.ts`);
    expect(files).toEqual(expected);
  });

  it("round-trips through JSON without loss", () => {
    // The store writes JSON; anything that does not survive this (Dates, Maps, undefined
    // values in arrays) must not appear in persisted shapes.
    for (const record of [...v1.entries, ...v1.effects, ...v2.entries]) {
      expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    }
  });

  it("keeps full output references outside provider-neutral result content", () => {
    const body = v2.entries[0]?.body;
    if (body?.kind !== "tool_results") throw Error("Missing tool output fixture");
    expect(body.outputBlobs).toHaveLength(1);
    expect(body.outputBlobs?.[0]?.callId).toBe(body.results[0]?.callId);
    expect(Object.keys(body.results[0] ?? {}).sort()).toEqual([
      "callId",
      "content",
      "status",
      "type",
    ]);
  });

  it("covers every transcript entry kind", () => {
    // Adding an entry kind fails to type-check here: it is a format change.
    const allKinds: Record<EntryBody["kind"], true> = {
      user_message: true,
      assistant_message: true,
      tool_results: true,
      compaction: true,
      notice: true,
    };
    const kinds = new Set(v1.entries.map((e) => e.body.kind));
    expect([...kinds].sort()).toEqual(Object.keys(allKinds).sort());
  });

  it("locks refusal, reasoning kinds, argument provenance and usage presence", () => {
    const parts = v1.entries.flatMap((entry) =>
      entry.body.kind === "user_message" || entry.body.kind === "assistant_message"
        ? entry.body.content
        : entry.body.kind === "tool_results"
          ? entry.body.results
          : [],
    );
    const allParts: Record<ContentPart["type"], true> = {
      text: true,
      refusal: true,
      image: true,
      reasoning: true,
      tool_call: true,
      tool_result: true,
    };
    expect([...new Set(parts.map((part) => part.type))].sort()).toEqual(
      Object.keys(allParts).sort(),
    );
    expect(
      parts
        .filter((part) => part.type === "reasoning")
        .map((part) => part.kind)
        .sort(),
    ).toEqual(["opaque", "summary", "visible"]);
    const calls = parts.filter((part) => part.type === "tool_call");
    expect(calls.map((call) => call.argumentsSource).sort()).toEqual([
      "json_serialized",
      "verbatim",
    ]);
    expect(calls[1]?.rawArguments).toBe('{"path":');
    expect(calls[1]?.providerCallId).not.toBe(calls[1]?.providerItemId);
    const messages = v1.entries.flatMap((entry) =>
      entry.body.kind === "assistant_message" ? [entry.body] : [],
    );
    expect(messages.map((message) => message.usage.status)).toEqual([
      "final",
      "partial",
      "unknown",
    ]);
    expect(messages[0]?.usage.cacheReadTokens).toBe(0);
    expect(messages[2]?.usage.inputTokens).toBeNull();
    expect(messages[1]?.providerStopReason).toEqual({
      status: "incomplete",
      reason: "max_output_tokens",
    });
  });
});
