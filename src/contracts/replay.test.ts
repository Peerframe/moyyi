import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_REPLAY_BYTES,
  type ReplayContent,
  type ReplayEnvelope,
  type ReplayOrigin,
} from "./persisted/replay.ts";
import {
  bindReplay,
  canonicalizeJson,
  checkReplayEnvelopeShape,
  invalidateReplay,
  validateReplay,
} from "./replay.ts";

const hash = (input: string) =>
  `sha256:${createHash("sha256").update(input, "utf8").digest("hex")}`;
const origin: ReplayOrigin = {
  provider: "synthetic",
  model: "rolling-alias",
  apiProfile: "responses-v1/account-scope-a",
  modelRevision: "verified-revision-1",
};
const content: ReplayContent = {
  role: "assistant",
  content: [
    { type: "reasoning", kind: "visible", text: "Full original reasoning." },
    { type: "text", text: "Done." },
  ],
};

describe("canonicalizeJson", () => {
  it("implements the RFC primitive number/string example without Unicode normalization", () => {
    expect(
      canonicalizeJson({
        numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27, -0],
        string: '€$\u000f\nA\'B"\\\\"/',
        literals: [null, true, false],
      }),
    ).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
    expect(canonicalizeJson("é")).not.toBe(canonicalizeJson("e\u0301"));
  });

  it("sorts recursively by UTF-16, including integer-like keys, but keeps array order", () => {
    expect(canonicalizeJson({ "2": 2, "10": 10, a: [{ z: 1, a: 2 }, 3, 2] })).toBe(
      '{"10":10,"2":2,"a":[{"a":2,"z":1},3,2]}',
    );
    expect(canonicalizeJson({ "€": 1, "\r": 2, דּ: 3, "1": 4, "😀": 5, "\u0080": 6, ö: 7 })).toBe(
      '{"\\r":2,"1":4,"\u0080":6,"ö":7,"€":1,"😀":5,"דּ":3}',
    );
    expect(canonicalizeJson(JSON.parse('{"__proto__":{"z":1,"a":2}}'))).toBe(
      '{"__proto__":{"a":2,"z":1}}',
    );
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1n,
    Symbol("value"),
    () => 1,
    new Date(0),
    new Map(),
    /pattern/,
    { bad: undefined },
    [undefined],
    new Array(1),
    "\ud800",
    "\udfff",
    "\ud800a",
    { "\ud800": "bad key" },
    Object.assign([], { extra: true }),
    { [Symbol("hidden")]: 1 },
  ])("rejects values that JSON serialization would alter or omit: %s", (value) => {
    expect(() => canonicalizeJson(value)).toThrow(TypeError);
  });

  it("rejects accessors without invoking them, hidden properties and cyclic data", () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    });
    expect(() => canonicalizeJson(accessor)).toThrow("accessors");
    expect(reads).toBe(0);
    expect(() => canonicalizeJson(Object.defineProperty({}, "hidden", { value: 1 }))).toThrow(
      "hidden properties",
    );
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => canonicalizeJson(cycle)).toThrow("cycles");
    const shared = { a: 1 };
    expect(canonicalizeJson([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });
});

describe("replay binding", () => {
  const opaque = 'not JSON: adapter bytes with a signature and "quotes"';
  const bind = () => bindReplay(content, origin, 2, opaque, hash);
  const validate = (envelope: unknown) => validateReplay(envelope, content, origin, 2, hash);

  it("binds the ordered role/content with a real SHA-256 and leaves payload uninterpreted", () => {
    const envelope = bind();
    expect(envelope.payload).toBe(opaque);
    expect(envelope.contentHash).toBe(hash(canonicalizeJson(content)));
    expect(validate(envelope)).toEqual({ valid: true });
    const reorderedKeys: ReplayContent = { content: content.content, role: "assistant" };
    expect(validateReplay(envelope, reorderedKeys, { ...origin }, 2, hash)).toEqual({
      valid: true,
    });
  });

  it("rejects edits, truncation, part reordering and changed roles", () => {
    const changes: ReplayContent[] = [
      { ...content, content: [{ type: "text", text: "Edited." }] },
      { ...content, content: content.content.slice(1) },
      { ...content, content: [...content.content].reverse() },
      { ...content, role: "user" },
    ];
    for (const changed of changes) {
      expect(validateReplay(bind(), changed, origin, 2, hash)).toEqual({
        valid: false,
        reason: "content",
      });
    }
  });

  it.each(["provider", "model", "apiProfile", "modelRevision"] as const)(
    "rejects a different %s, including an alias that stayed the same after a model upgrade",
    (key) => {
      expect(validateReplay(bind(), content, { ...origin, [key]: "different" }, 2, hash)).toEqual({
        valid: false,
        reason: "origin",
      });
    },
  );

  it.each([null, "", "   "])("never replays an unknown model revision: %s", (modelRevision) => {
    const unknown = { ...origin, modelRevision };
    const envelope = bindReplay(content, unknown, 2, opaque, hash);
    expect(envelope.origin.modelRevision).toBe(modelRevision);
    expect(checkReplayEnvelopeShape(envelope)).toEqual({ valid: true });
    expect(validateReplay(envelope, content, unknown, 2, hash)).toEqual({
      valid: false,
      reason: "unknown_model_revision",
    });
    expect(validateReplay(bind(), content, unknown, 2, hash).valid).toBe(false);
    expect(validate(envelope).valid).toBe(false);
  });

  it("rejects unknown versions and malformed envelopes without looking inside payload", () => {
    expect(validate({ ...bind(), version: 2 })).toEqual({ valid: false, reason: "version" });
    for (const payloadVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => bindReplay(content, origin, payloadVersion, opaque, hash)).toThrow(TypeError);
      expect(validate({ ...bind(), payloadVersion }).valid).toBe(false);
    }
    expect(validateReplay(bind(), content, origin, 3, hash)).toEqual({
      valid: false,
      reason: "payload_version",
    });
    for (const changed of [
      { ...bind(), contentHash: "sha256:abc" },
      { ...bind(), contentHash: `sha256:${"A".repeat(64)}` },
      { ...bind(), extra: "unsupported metadata" },
      { ...bind(), payload: {} },
      { ...bind(), origin: { ...origin, apiProfile: "" } },
      null,
    ]) {
      expect(validate(changed)).toEqual({ valid: false, reason: "malformed" });
    }
    expect(() => bindReplay(content, origin, 2, opaque, () => "invalid hash")).toThrow(
      "sha256 digest",
    );
  });

  it("rejects accessor envelopes and malformed content without evaluating accessors", () => {
    let reads = 0;
    const envelope = {
      ...bind(),
      get payload() {
        reads++;
        return opaque;
      },
    };
    expect(checkReplayEnvelopeShape(envelope)).toEqual({ valid: false, reason: "malformed" });
    expect(validate(envelope)).toEqual({ valid: false, reason: "malformed" });
    expect(reads).toBe(0);
    const invalidRole = { role: "system", content: [] } as unknown as ReplayContent;
    expect(() => bindReplay(invalidRole, origin, 2, opaque, hash)).toThrow(
      "Invalid replay content",
    );
    expect(validateReplay(bind(), invalidRole, origin, 2, hash)).toEqual({
      valid: false,
      reason: "content",
    });
  });

  it("enforces the full envelope's UTF-8 byte limit at binding and validation", () => {
    const empty = bindReplay(content, origin, 2, "", hash);
    const overhead = new TextEncoder().encode(canonicalizeJson(empty)).byteLength;
    const exact = bindReplay(content, origin, 2, "a".repeat(MAX_REPLAY_BYTES - overhead), hash);
    expect(new TextEncoder().encode(canonicalizeJson(exact)).byteLength).toBe(MAX_REPLAY_BYTES);
    expect(validate(exact)).toEqual({ valid: true });
    expect(() => bindReplay(content, origin, 2, `${exact.payload}a`, hash)).toThrow(RangeError);
    expect(validate({ ...exact, payload: `${exact.payload}a` })).toEqual({
      valid: false,
      reason: "oversized",
    });
    expect(() => bindReplay(content, origin, 2, "😀".repeat(MAX_REPLAY_BYTES / 4), hash)).toThrow(
      RangeError,
    );
    const escaped: ReplayEnvelope = { ...empty, payload: "\n".repeat(MAX_REPLAY_BYTES / 2) };
    expect(validate(escaped)).toEqual({ valid: false, reason: "oversized" });
  });

  it("invalidates explicitly on an edit, even when original bytes are later restored", () => {
    const message = { ...content, replay: bind(), id: "entry-1" };
    const edited = { ...invalidateReplay(message), content: [{ type: "text", text: "Edited." }] };
    const restored = { ...edited, content: message.content };
    expect(restored).not.toHaveProperty("replay");
    expect(restored.id).toBe("entry-1");
    expect(message.replay).toEqual(bind());
    // The hash is a content consistency check, not proof that no edit occurred.
    expect(validateReplay(message.replay, restored, origin, 2, hash)).toEqual({ valid: true });
    expect(validateReplay(Reflect.get(restored, "replay"), restored, origin, 2, hash).valid).toBe(
      false,
    );
  });
});
