import { describe, expect, it } from "vitest";
import { UNKNOWN_USAGE } from "../contracts/model-conformance.ts";
import { effects, entries } from "../contracts/persisted/fixtures/v1.ts";
import type { BlobRef, EffectRecord, TranscriptEntry } from "../contracts/persisted/index.ts";
import { canonicalizeJson } from "../contracts/replay.ts";
import { encodeEffect, encodeEntry, entryBlobRefs, MAX_RECORD_BYTES } from "./records.ts";

const first = entries[0] as TranscriptEntry;
const assistant = entries[1] as TranscriptEntry;
const effect = effects[0] as EffectRecord;
const ref = (n: number) => `sha256:${String(n).padStart(64, "0")}` as BlobRef;
const image = { type: "image", mediaType: "image/png", blob: ref(7) };
const result = {
  type: "tool_result",
  callId: "call_1",
  status: "succeeded",
  content: [image, { type: "text", text: "" }],
};

function withBody(body: unknown): TranscriptEntry {
  return { ...first, body } as TranscriptEntry;
}

function assistantBody(patch: Record<string, unknown>): TranscriptEntry {
  return withBody({ ...assistant.body, ...patch });
}

function withContent(content: unknown): TranscriptEntry {
  return withBody({ kind: "user_message", steering: false, content });
}

describe("v1 record encoding", () => {
  it("round-trips every locked fixture without changing bytes or unknown effect state", () => {
    for (const entry of entries) {
      expect(encodeEntry(entry)).toBe(canonicalizeJson(entry));
      expect(JSON.parse(encodeEntry(entry))).toEqual(entry);
    }
    for (const value of effects) expect(JSON.parse(encodeEffect(value))).toEqual(value);
  });

  it("accepts every content part, including incomplete arguments and visible/opaque reasoning", () => {
    const content = [
      { type: "text", text: "" },
      { type: "refusal", text: "No." },
      image,
      { type: "reasoning", kind: "visible", text: "Full text" },
      { type: "reasoning", kind: "summary", text: "Summary" },
      { type: "reasoning", kind: "opaque" },
      {
        type: "tool_call",
        callId: "call_1",
        providerCallId: "provider_1",
        name: "edit",
        rawArguments: '{"incomplete":',
        argumentsSource: "verbatim",
        providerItemId: "item_1",
      },
      result,
    ];
    expect(JSON.parse(encodeEntry(withContent(content))).body.content).toEqual(content);
    expect(() => encodeEntry(assistantBody({ content }))).not.toThrow();
  });

  it("retains arbitrary JSON termination details, empty final output and unknown counters", () => {
    const value = assistantBody({
      providerStopReason: [null, { futureProviderDetail: [1, true] }],
      usage: { ...UNKNOWN_USAGE, status: "final" },
      content: [],
      stopReason: "other",
    });
    expect(JSON.parse(encodeEntry(value))).toEqual(value);
  });

  it("keeps replay payload opaque and permits stale binding and unknown model revisions", () => {
    if (assistant.body.kind !== "assistant_message" || !assistant.body.replay)
      throw Error("fixture");
    const replay = {
      ...assistant.body.replay,
      contentHash: `sha256:${"0".repeat(64)}`,
      origin: { ...assistant.body.replay.origin, modelRevision: null },
      payload: "{not parseable JSON",
    };
    expect(JSON.parse(encodeEntry(assistantBody({ replay }))).body.replay).toEqual(replay);
  });

  it.each([
    null,
    [],
    1,
    { ...first, extra: true },
    { ...first, body: null },
    { ...first, body: { kind: "future_kind" } },
    { ...first, id: "" },
    { ...first, id: "   " },
    { ...first, id: "a".repeat(513) },
    { ...first, sessionId: null },
    { ...first, parentId: 1 },
    { ...first, runId: false },
  ])("rejects invalid entry headers and body kinds %#", (value) => {
    expect(() => encodeEntry(value as TranscriptEntry)).toThrow(TypeError);
  });

  it("accepts the maximum identifier length and null parent/run", () => {
    expect(() =>
      encodeEntry({
        ...first,
        id: "a".repeat(512),
        parentId: null,
        runId: null,
      } as TranscriptEntry),
    ).not.toThrow();
  });

  it.each([
    { kind: "user_message", steering: 1, content: [] },
    { kind: "user_message", steering: false, content: null },
    { kind: "user_message", steering: false, content: [], replay: {} },
    { kind: "notice", code: "", text: "notice" },
    { kind: "notice", code: "ok", text: 1 },
    { kind: "notice", code: "ok", text: "", extra: true },
    { kind: "tool_results", results: [{ ...result, type: "text" }] },
    { kind: "tool_results", results: [{ ...result, status: "started" }] },
    { kind: "tool_results", results: [{ ...result, content: [{ type: "refusal", text: "No" }] }] },
    {
      kind: "compaction",
      replaces: { fromEntryId: "e1", toEntryId: "e2", extra: true },
      summary: [],
      producedBy: { origin: { provider: "x", model: "y" }, promptVersion: "1" },
    },
    {
      kind: "compaction",
      replaces: { fromEntryId: "e1", toEntryId: "e2" },
      summary: [image],
      producedBy: { origin: { provider: "x", model: "y" }, promptVersion: "1" },
    },
  ])("rejects malformed body fields %#", (body) => {
    expect(() => encodeEntry(withBody(body))).toThrow(TypeError);
  });

  it.each([
    null,
    [],
    { type: "future_part" },
    { type: "text", text: 1 },
    { type: "text", text: "", future: true },
    { type: "refusal", text: "", future: true },
    { type: "reasoning", kind: "opaque", text: "not common text" },
    { type: "reasoning", kind: "visible" },
    { type: "reasoning", kind: "hidden", text: "" },
    { ...image, mediaType: "" },
    { ...image, blob: "sha256:abc" },
    { ...image, blob: `sha256:${"A".repeat(64)}` },
    { ...image, blob: "../../private" },
    {
      type: "tool_call",
      callId: "c",
      providerCallId: "p",
      name: "edit",
      rawArguments: "{",
      argumentsSource: "guessed",
      providerItemId: null,
    },
    {
      type: "tool_call",
      callId: "c",
      providerCallId: "p",
      name: "edit",
      rawArguments: {},
      argumentsSource: "verbatim",
      providerItemId: null,
    },
    {
      type: "tool_call",
      callId: "c",
      providerCallId: "p",
      name: "edit",
      rawArguments: "{",
      argumentsSource: "verbatim",
    },
    { ...result, content: [result] },
  ])("rejects malformed or future content parts %#", (part) => {
    expect(() => encodeEntry(withContent([part]))).toThrow(TypeError);
  });

  it.each([
    { origin: { provider: "x", model: "y", revision: "1" } },
    { origin: { provider: "", model: "y" } },
    { stopReason: "unmapped" },
    { usage: { ...UNKNOWN_USAGE, future: 1 } },
    { usage: { ...UNKNOWN_USAGE, inputTokens: 0 } },
    { usage: { ...UNKNOWN_USAGE, status: "final", outputTokens: 1, reasoningTokens: 2 } },
    {
      usage: {
        ...UNKNOWN_USAGE,
        status: "partial",
        inputTokens: 2,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
      },
    },
    { usage: { ...UNKNOWN_USAGE, status: "final", inputTokens: -1 } },
    { request: { rendererVersion: "1", system: ref(1), tools: ref(2), messages: ["invalid"] } },
    { request: { rendererVersion: "1", system: ref(1), tools: ref(2), messages: [], extra: true } },
  ])("rejects malformed assistant metadata %#", (patch) => {
    expect(() => encodeEntry(assistantBody(patch))).toThrow(TypeError);
  });

  it.each([
    { version: 2 },
    { payloadVersion: 0 },
    { payload: {} },
    { contentHash: "sha256:abc" },
    { origin: { provider: "x", model: "y" } },
    { extra: true },
    { payload: "x".repeat(1_048_576) },
  ])("rejects malformed replay envelopes %#", (patch) => {
    if (assistant.body.kind !== "assistant_message") throw Error("fixture");
    const replay = { ...assistant.body.replay, ...patch };
    expect(() => encodeEntry(assistantBody({ replay }))).toThrow(/replay envelope/);
  });

  it.each([
    null,
    [],
    { ...effect, extra: true },
    { ...effect, state: "future" },
    { ...effect, id: "" },
    { ...effect, callId: null },
    { ...effect, digest: "" },
    { ...effect, evidence: 1 },
    { ...effect, profile: { ...effect.profile, class: "network" } },
    { ...effect, profile: { ...effect.profile, reversibility: "automatic" } },
    { ...effect, profile: { ...effect.profile, verification: "unknown" } },
    { ...effect, profile: { ...effect.profile, authority: "allow" } },
  ])("rejects malformed effect records %#", (value) => {
    expect(() => encodeEffect(value as EffectRecord)).toThrow(TypeError);
  });

  it("rejects omitted required fields and explicit undefined optionals", () => {
    const { parentId: _parent, ...missingParent } = first;
    const { updatedAt: _at, ...missingTime } = effect;
    expect(() => encodeEntry(missingParent as TranscriptEntry)).toThrow();
    expect(() => encodeEffect(missingTime as EffectRecord)).toThrow();
    expect(() => encodeEntry(assistantBody({ replay: undefined }))).toThrow();
    expect(() =>
      encodeEffect({ ...effect, evidence: undefined } as unknown as EffectRecord),
    ).toThrow();
  });

  it("rejects lossy JS input without invoking getters", () => {
    let calls = 0;
    const getter = {
      ...first,
      get id() {
        calls++;
        return "entry";
      },
    };
    expect(() => encodeEntry(getter as TranscriptEntry)).toThrow(/accessors/);
    expect(calls).toBe(0);
    for (const text of [undefined, NaN, Infinity, BigInt(1), "\ud800", new Date(), () => 1]) {
      expect(() => encodeEntry(withContent([{ type: "text", text }]))).toThrow();
    }
  });
});

describe("record timestamps", () => {
  it.each([
    "2026-10-25T12:30:40.123Z",
    "2024-02-29T00:00:00+08:00",
    "2026-10-25t12:30:40z",
    "2026-10-25T12:30:40-00:00",
    "2016-12-31T23:59:60Z",
    "2017-01-01T07:59:60+08:00",
  ])("accepts RFC 3339 timestamp %s", (createdAt) => {
    expect(() => encodeEntry({ ...first, createdAt } as TranscriptEntry)).not.toThrow();
  });

  it.each([
    "2026-10-25",
    "2026-10-25T12:00:00",
    "2026-02-29T00:00:00Z",
    "2024-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-10-00T00:00:00Z",
    "2026-10-25T24:00:00Z",
    "2026-10-25T12:60:00Z",
    "2026-10-25T12:00:61Z",
    "2026-10-25T12:00:00+24:00",
    "2026-10-25T12:00:00+08:60",
    "2026-10-25T12:00:60Z",
    "2026-10-25T12:00:00Ztrailing",
  ])("rejects invalid RFC 3339 timestamp %s", (createdAt) => {
    expect(() => encodeEntry({ ...first, createdAt } as TranscriptEntry)).toThrow(
      /RFC 3339|Leap second/,
    );
    expect(() => encodeEffect({ ...effect, updatedAt: createdAt } as EffectRecord)).toThrow();
  });
});

describe("record byte bounds", () => {
  it("accepts exactly 4 MiB and rejects one additional canonical UTF-8 byte", () => {
    const base = withBody({ kind: "notice", code: "test", text: "" });
    const room = MAX_RECORD_BYTES - new TextEncoder().encode(encodeEntry(base)).byteLength;
    const exact = withBody({ kind: "notice", code: "test", text: "x".repeat(room) });
    expect(new TextEncoder().encode(encodeEntry(exact)).byteLength).toBe(MAX_RECORD_BYTES);
    expect(() =>
      encodeEntry(withBody({ kind: "notice", code: "test", text: "x".repeat(room + 1) })),
    ).toThrow(RangeError);
  });

  it("counts escaped and multibyte strings as bytes and bounds effects too", () => {
    expect(() =>
      encodeEntry(withContent([{ type: "text", text: "中".repeat(MAX_RECORD_BYTES / 2) }])),
    ).toThrow(RangeError);
    expect(() =>
      encodeEntry(withContent([{ type: "text", text: "\n".repeat(MAX_RECORD_BYTES / 2) }])),
    ).toThrow(RangeError);
    expect(() => encodeEffect({ ...effect, evidence: "x".repeat(MAX_RECORD_BYTES) })).toThrow(
      RangeError,
    );
  });
});

describe("entryBlobRefs", () => {
  it("finds request, image and nested result blobs in order for both message roles", () => {
    const content = [image, result];
    const user = withContent(content);
    encodeEntry(user);
    expect(entryBlobRefs(user)).toEqual([ref(7), ref(7)]);
    const model = assistantBody({ content });
    encodeEntry(model);
    expect(entryBlobRefs(model)).toEqual([ref(1), ref(2), ref(3), ref(7), ref(7)]);
    const results = withBody({ kind: "tool_results", results: [result] });
    encodeEntry(results);
    expect(entryBlobRefs(results)).toEqual([ref(7)]);
  });

  it("does not interpret payload strings or add references from non-content records", () => {
    expect(entryBlobRefs(entries[3] as TranscriptEntry)).toEqual([]);
    expect(entryBlobRefs(entries[4] as TranscriptEntry)).toEqual([]);
    if (assistant.body.kind !== "assistant_message") throw Error("fixture");
    const value = assistantBody({
      replay: { ...assistant.body.replay, payload: JSON.stringify({ blob: ref(8) }) },
      providerStopReason: { blob: ref(9) },
      content: [{ type: "text", text: ref(10) }],
    });
    encodeEntry(value);
    expect(entryBlobRefs(value)).toEqual([ref(1), ref(2), ref(3)]);
  });
});
