import { describe, expect, it } from "vitest";
import { boundedMessage, isTrustedSender, pickerOptions } from "./security.ts";

describe("desktop transport boundary", () => {
  it("accepts only a boolean picker option, never a supplied path or host module", () => {
    expect(pickerOptions({ askEachRead: true })).toEqual({ askEachRead: true });
    for (const input of [
      null,
      [],
      {},
      { askEachRead: 1 },
      { askEachRead: false, path: "/" },
      { askEachRead: false, host: "evil.mjs" },
    ])
      expect(() => pickerOptions(input)).toThrow();
  });
  it("requires the owning window, top frame and exact local document", () => {
    const sender = {},
      frame = {};
    const trusted = { sender, frame, url: "file:///app/index.html" };
    expect(isTrustedSender(trusted, trusted)).toBe(true);
    for (const other of [
      { ...trusted, sender: {} },
      { ...trusted, frame: {} },
      { ...trusted, url: "https://example.com" },
      { ...trusted, url: "file:///app/index.html#x" },
    ])
      expect(isTrustedSender(other, trusted)).toBe(false);
  });
  it("bounds wire messages and rejects cyclic or undefined values", () => {
    expect(boundedMessage({ text: "hello" }, 100)).toBe(true);
    expect(boundedMessage("x".repeat(101), 100)).toBe(false);
    expect(boundedMessage(undefined)).toBe(false);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(boundedMessage(cycle)).toBe(false);
  });
});
