import { describe, expect, it } from "vitest";
import {
  type ActionDigest,
  canonicalizeJson,
  type EffectId,
  type EffectRecord,
  executionReceipt,
  type RunId,
  type TextPart,
  type Timestamp,
  type ToolCallId,
  type WorkspaceWriteReceipt,
} from "../../contracts/index.ts";
import { presentWrite } from "./write-presentation.ts";

const encoder = new TextEncoder();
const receipt: WorkspaceWriteReceipt = {
  snapshotId: "effect_1",
  path: "report.txt",
  beforeHash: "a".repeat(64),
  afterHash: "b".repeat(64),
};
const size = (value: unknown) => encoder.encode(canonicalizeJson(value)).byteLength;
const data = (content: readonly TextPart[]) => {
  expect(content).toHaveLength(1);
  return JSON.parse(content[0]?.text ?? "null");
};
const observed = (text: string): WorkspaceWriteReceipt => ({
  ...receipt,
  postcheck: { text, bytes: encoder.encode(text).byteLength },
});

describe("verified write presentation", () => {
  it("retains the receipt and all fitting actual bytes, including CRLF and escaping", () => {
    const text = 'Actual "quoted" report\\path\r\n中文 🧪\n'.repeat(150);
    const content = presentWrite(observed(text), 32768);
    expect(data(content)).toEqual({
      ...receipt,
      postcheck: {
        format: "file-postcheck-v1",
        available: true,
        text,
        sourceBytes: encoder.encode(text).byteLength,
        returnedBytes: encoder.encode(text).byteLength,
        truncated: false,
      },
    });
    expect(size(content)).toBeLessThanOrEqual(32768);
  });

  it.each([1024, 8192, 32768, 262144])(
    "bounds the full serialized result under budget %s without splitting Unicode",
    (budget) => {
      const text = '🧪\n"\\中文'.repeat(20_000);
      const content = presentWrite(observed(text), budget);
      const result = data(content);
      expect(result).toMatchObject(receipt);
      expect(result.postcheck).toMatchObject({ available: true, truncated: true });
      expect(result.postcheck.text.length).toBeGreaterThan(0);
      expect(text.startsWith(result.postcheck.text)).toBe(true);
      expect(result.postcheck.text.isWellFormed()).toBe(true);
      expect(result.postcheck.sourceBytes).toBe(encoder.encode(text).byteLength);
      expect(result.postcheck.returnedBytes).toBe(encoder.encode(result.postcheck.text).byteLength);
      expect(result.postcheck.returnedBytes).toBeLessThanOrEqual(16384);
      expect(size(content)).toBeLessThanOrEqual(Math.min(budget, 32768));
    },
  );

  it("distinguishes a verified absent file from an existing empty file", () => {
    expect(data(presentWrite(observed(""), 32768)).postcheck).toMatchObject({
      available: true,
      text: "",
      sourceBytes: 0,
      returnedBytes: 0,
      truncated: false,
    });
    const absent = { ...receipt, afterHash: null, postcheck: { text: null, bytes: 0 } };
    expect(data(presentWrite(absent, 32768))).toMatchObject({
      afterHash: null,
      postcheck: {
        available: true,
        text: null,
        sourceBytes: 0,
        returnedBytes: 0,
        truncated: false,
      },
    });
  });

  it("does not invent body text when the provider withheld it, and preserves tiny-budget success", () => {
    expect(data(presentWrite(receipt, 32768))).toEqual({
      ...receipt,
      postcheck: { format: "file-postcheck-v1", available: false },
    });
    const original = [{ type: "text", text: canonicalizeJson(receipt) }];
    expect(presentWrite(observed("SECRET"), size(original))).toEqual(original);
    expect(presentWrite(observed("SECRET"), 1)).toEqual(original);
  });

  it("stays compatible with execution receipts at the largest presentation budget", () => {
    const effect: EffectRecord = {
      id: receipt.snapshotId as EffectId,
      runId: "run_1" as RunId,
      callId: "call_1" as ToolCallId,
      tool: "edit",
      profile: { class: "workspace_write", reversibility: "snapshot", verification: "postcheck" },
      digest: "digest" as ActionDigest,
      state: "succeeded",
      updatedAt: "2026-10-27T00:00:00Z" as Timestamp,
    };
    const content = presentWrite(observed('"\\\n'.repeat(50_000)), 262144);
    expect(
      executionReceipt(effect, {
        type: "tool_result",
        callId: effect.callId,
        status: "succeeded",
        content,
      }),
    ).toEqual({
      kind: "file",
      ...receipt,
    });
  });
});
