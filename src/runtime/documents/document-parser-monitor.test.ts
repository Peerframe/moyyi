import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseDocument } from "./document-parser.ts";

const launcher = 100_001;
const init = 100_002;
const fixture = vi.hoisted(() => ({
  spawn: undefined as unknown as (...args: unknown[]) => ChildProcessWithoutNullStreams,
  parent: 100_001,
  start: "1234",
}));
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => fixture.spawn(...args) }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (path: unknown, ...args: unknown[]) => {
      if (path === "/proc/100002/status") return "NSpid:\t100002\t1\n";
      if (path === "/proc/100002/stat") {
        const fields = Array<string>(20).fill("0");
        fields[0] = "S";
        fields[1] = String(fixture.parent);
        fields[19] = fixture.start;
        return `100002 (bwrap) ${fields.join(" ")}\n`;
      }
      return Reflect.apply(actual.readFileSync, actual, [path, ...args]);
    },
  };
});
vi.mock("./document-sandbox.ts", () => ({
  documentSandbox: async () => ({
    command: "/usr/bin/bwrap",
    args: ["--new-session", "--", "node", "worker"],
    env: {},
    backend: "bubblewrap",
  }),
}));

let child: ChildProcessWithoutNullStreams;
let info: PassThrough;
let existing: Set<number>;
let signals: [number, string | number | undefined][];
let spawned: Promise<void>;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  fixture.parent = launcher;
  fixture.start = "1234";
  signals = [];
  existing = new Set([launcher, -launcher, init, -init]);
  info = new PassThrough();
  const stdin = new PassThrough(),
    stdout = new PassThrough(),
    stderr = new PassThrough();
  child = Object.assign(new EventEmitter(), {
    pid: launcher,
    stdin,
    stdout,
    stderr,
    stdio: [stdin, stdout, stderr, info],
  }) as unknown as ChildProcessWithoutNullStreams;
  spawned = new Promise((resolve) => {
    fixture.spawn = (_command, args) => {
      expect(args).toEqual(["--info-fd", "3", "--new-session", "--", "node", "worker"]);
      resolve();
      return child;
    };
  });
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (!existing.has(pid)) throw Object.assign(Error("gone"), { code: "ESRCH" });
    if (signal !== 0) signals.push([pid, signal]);
    return true;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function metadata(text = JSON.stringify({ "child-pid": init })) {
  info.end(text);
  await new Promise<void>((resolve) => setImmediate(resolve));
}
function closeLauncher(code: number | null = null) {
  existing.delete(launcher);
  existing.delete(-launcher);
  child.emit("exit", code);
  child.emit("close", code);
}
function reapNamespace() {
  existing.delete(init);
  existing.delete(-init);
}

it("keeps the monitor to reap init and does not finish when only launcher close has arrived", async () => {
  const controller = new AbortController();
  const pending = parseDocument(Buffer.from("test"), "pdf", controller.signal, () => {});
  const rejection = expect(pending).rejects.toMatchObject({ code: "cancelled" });
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await spawned;
  expect(child.stdin.writableEnded).toBe(false);
  await metadata();
  expect(child.stdin.writableEnded).toBe(true);
  controller.abort();
  expect(signals).toEqual([[-init, "SIGTERM"]]);
  await vi.advanceTimersByTimeAsync(200);
  expect(signals).toContainEqual([init, "SIGKILL"]);
  expect(signals.some(([pid]) => pid === -launcher)).toBe(false);
  closeLauncher();
  await vi.advanceTimersByTimeAsync(25);
  expect(settled).toBe(false);
  reapNamespace();
  await vi.advanceTimersByTimeAsync(25);
  await rejection;
});

it("waits for namespace cleanup before returning an otherwise valid parser result", async () => {
  const pending = parseDocument(Buffer.from("test"), "pdf", new AbortController().signal, () => {});
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await spawned;
  await metadata();
  const value = { text: "body", truncated: false, coverage: "body text" };
  child.stdout.emit("data", Buffer.from(JSON.stringify(value)));
  closeLauncher(0);
  await vi.advanceTimersByTimeAsync(25);
  expect(settled).toBe(false);
  expect(signals).toEqual([]);
  reapNamespace();
  await vi.advanceTimersByTimeAsync(25);
  await expect(pending).resolves.toEqual(value);
});

it.each(["cancelled", "revoked"])(
  "does not deliver document bytes after early %s",
  async (reason) => {
    const controller = new AbortController();
    let authorized = true;
    const pending = parseDocument(Buffer.from("test"), "pdf", controller.signal, () => {
      if (!authorized) throw Error("revoked");
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: reason });
    await spawned;
    if (reason === "cancelled") controller.abort();
    else authorized = false;
    expect(signals).toEqual([]);
    await metadata();
    expect(child.stdin.writableEnded).toBe(false);
    expect(signals).toEqual([[-init, "SIGTERM"]]);
    await vi.advanceTimersByTimeAsync(200);
    reapNamespace();
    closeLauncher();
    await rejection;
  },
);

it.each(["", "not json", '{"child-pid":1}', '{"child-pid":100001}', "x".repeat(4097)])(
  "rejects missing, malformed, unsafe or oversized monitor metadata: %j",
  async (text) => {
    const pending = parseDocument(
      Buffer.from("test"),
      "pdf",
      new AbortController().signal,
      () => {},
    );
    const rejection = expect(pending).rejects.toMatchObject({ code: "parser_failed" });
    await spawned;
    await metadata(text);
    expect(child.stdin.writableEnded).toBe(false);
    closeLauncher(0);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  },
);

it("does not signal a reused identity and retains the original bounded cleanup failure", async () => {
  const controller = new AbortController();
  const pending = parseDocument(Buffer.from("test"), "pdf", controller.signal, () => {});
  const rejection = expect(pending).rejects.toMatchObject({ code: "parser_failed" });
  await spawned;
  await metadata();
  fixture.start = "5678";
  controller.abort();
  expect(signals).toEqual([]);
  await vi.advanceTimersByTimeAsync(1500);
  expect(signals).toEqual([[-launcher, "SIGKILL"]]);
  await rejection;
});

it("preserves sandbox-unavailable when the launcher cannot be spawned", async () => {
  const pending = parseDocument(Buffer.from("test"), "pdf", new AbortController().signal, () => {});
  const rejection = expect(pending).rejects.toMatchObject({ code: "sandbox_unavailable" });
  await spawned;
  Object.defineProperty(child, "pid", { value: undefined });
  child.emit("error", Error("spawn failed"));
  child.emit("close", -1);
  await rejection;
  expect(signals).toEqual([]);
});
