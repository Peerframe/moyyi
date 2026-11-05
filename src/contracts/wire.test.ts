import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  FrameDecoder,
  parseClientCommand,
  parseClientFrame,
  parseServerFrame,
  WIRE_LIMITS,
  WireError,
} from "./wire.ts";

const valid: unknown[] = [
  { type: "plugin.reload", name: "fs" },
  { type: "session.create", workspaceRoot: "/work/project" },
  { type: "session.load", sessionId: "session_1" },
  { type: "session.list" },
  { type: "session.list", offset: 20, limit: 20 },
  { type: "session.results", sessionId: "session_1", offset: 0, limit: 20 },
  { type: "session.compact", sessionId: "session_1" },
  { type: "session.mode", sessionId: "session_1", mode: "plan" },
  { type: "run.start", sessionId: "session_1", input: [{ type: "text", text: "Hello" }] },
  { type: "run.steer", runId: "run_1", input: [{ type: "text", text: "Also check tests" }] },
  { type: "run.cancel", runId: "run_1" },
  { type: "approval.respond", effectId: "effect_1", digest: "sha256:ab", decision: "deny" },
];

describe("client command validation", () => {
  it.each(valid)("accepts and rebuilds %j", (command) => {
    const parsed = parseClientCommand(JSON.parse(JSON.stringify(command)));
    expect(parsed).toEqual(command);
    expect(parsed).not.toBe(command);
  });

  it.each([
    [null, "Unknown command type"],
    [{ type: "session.delete", sessionId: "s" }, "Unknown command type"],
    [{ type: "run.cancel", runId: "r", grant: "write" }, "unexpected field"],
    [JSON.parse('{"type":"run.cancel","runId":"r","__proto__":{"x":1}}'), "unexpected field"],
    [{ type: "session.create", workspaceRoot: "relative/dir" }, "absolute path"],
    [{ type: "session.create", workspaceRoot: `/${"a".repeat(5000)}` }, "too long"],
    [{ type: "session.load", sessionId: "" }, "must not be empty"],
    [{ type: "session.load", sessionId: "bad id" }, "printable ASCII"],
    [{ type: "session.load", sessionId: 7 }, "must be a string"],
    [{ type: "session.list", offset: -1 }, "integer"],
    [{ type: "session.list", limit: 1.5 }, "integer"],
    [{ type: "session.list", limit: 100_000 }, "integer"],
    [{ type: "run.start", sessionId: "s", input: [] }, "1 to 64 parts"],
    [
      { type: "run.start", sessionId: "s", input: [{ type: "image", data: "x" }] },
      "unexpected field",
    ],
    [
      { type: "run.start", sessionId: "s", input: [{ type: "tool_result", text: "x" }] },
      "text parts only",
    ],
    [
      {
        type: "run.start",
        sessionId: "s",
        input: [{ type: "text", text: "x".repeat(WIRE_LIMITS.textPartBytes + 1) }],
      },
      "too long",
    ],
    [{ type: "run.start", sessionId: "s", input: [{ type: "text", text: "\ud800" }] }, "Unicode"],
    [
      { type: "approval.respond", effectId: "e", digest: "d", decision: "allow" },
      "approve or deny",
    ],
  ])("rejects %j", (command, message) => {
    expect(() => parseClientCommand(command)).toThrow(WireError);
    expect(() => parseClientCommand(command)).toThrow(message);
  });

  it("validates whole frames, including the nested command", () => {
    expect(parseClientFrame({ type: "hello", version: 1, token: "t" })).toEqual({
      type: "hello",
      version: 1,
      token: "t",
    });
    expect(parseClientFrame({ type: "idle", id: 3 })).toEqual({ type: "idle", id: 3 });
    expect(() =>
      parseClientFrame({ type: "command", id: 1, command: { type: "run.cancel" } }),
    ).toThrow(WireError);
    expect(() => parseClientFrame({ type: "command", id: -1, command: valid[9] })).toThrow(
      "Frame id",
    );
    expect(() => parseClientFrame(Object.create({ type: "idle", id: 1 }))).toThrow(WireError);
  });
});

describe("server frame shape", () => {
  it("accepts known events and a welcome, and rejects unknown ones", () => {
    expect(
      parseServerFrame({
        type: "event",
        event: { type: "run.started", runId: "r", sessionId: "s" },
      }),
    ).toMatchObject({ type: "event", event: { type: "run.started" } });
    expect(() => parseServerFrame({ type: "event", event: { type: "session.deleted" } })).toThrow(
      "Unknown event type",
    );
    expect(
      parseServerFrame({
        type: "welcome",
        version: 1,
        workspaceRoot: "/w",
        plugins: [{ name: "fs", state: "failed", error: "boom" }],
        notices: ["grants | none"],
        diagnostics: [],
      }),
    ).toMatchObject({ type: "welcome", plugins: [{ name: "fs", state: "failed" }] });
    expect(() =>
      parseServerFrame({
        type: "welcome",
        version: 1,
        workspaceRoot: "/w",
        plugins: [{ name: "fs", state: "maybe" }],
        notices: [],
        diagnostics: [],
      }),
    ).toThrow("Plugin state");
    expect(parseServerFrame({ type: "error", message: "stop" })).toEqual({
      type: "error",
      message: "stop",
    });
  });
});

describe("newline framing", () => {
  it("joins frames split across chunks and splits several frames in one chunk", () => {
    const decoder = new FrameDecoder(1024);
    const bytes = new TextEncoder().encode('{"a":1}\n{"b":"é"}\n{"c"');
    expect(decoder.push(bytes.subarray(0, 3))).toEqual([]);
    expect(decoder.push(bytes.subarray(3, 16))).toEqual([{ a: 1 }]);
    expect(decoder.push(bytes.subarray(16))).toEqual([{ b: "é" }]);
    expect(decoder.push(new TextEncoder().encode(":2}\n"))).toEqual([{ c: 2 }]);
  });

  it("fails before buffering past the bound, and on bad UTF-8 or JSON", () => {
    expect(() => new FrameDecoder(4).push(new TextEncoder().encode("12345"))).toThrow("too large");
    const split = new FrameDecoder(8);
    split.push(new TextEncoder().encode("1234"));
    expect(() => split.push(new TextEncoder().encode("56789"))).toThrow("too large");
    expect(() => new FrameDecoder(8).push(Uint8Array.of(0xff, 10))).toThrow("UTF-8");
    expect(() => new FrameDecoder(8).push(new TextEncoder().encode("{x}\n"))).toThrow("JSON");
  });

  it("encodes one bounded line", () => {
    expect(encodeFrame({ type: "ack", id: 1 }, 100)).toBe('{"type":"ack","id":1}\n');
    expect(() => encodeFrame({ type: "error", message: "x".repeat(100) }, 50)).toThrow("too large");
  });
});
