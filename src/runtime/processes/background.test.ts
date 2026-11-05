import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ActionDigest,
  BackgroundProcessView,
  EffectId,
  EffectRecord,
  RunId,
  SessionId,
  Timestamp,
  ToolCallId,
} from "../../contracts/index.ts";
import { BackgroundProcesses, MAX_BACKGROUND_RUNNING } from "./background.ts";
import { NodeWorkspaceProcesses } from "./processes.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function setup(sessionId: string | null = "session_bg") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-bg-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  let epoch = 0;
  const registry = new BackgroundProcesses();
  cleanups.push(() => registry.closeAll());
  const context = {
    runId: "run_bg" as RunId,
    ...(sessionId ? { sessionId: sessionId as SessionId } : {}),
    workspaceRoot: workspace,
    signal: new AbortController().signal,
    limits: { maxOutputBytes: 32_768 },
  };
  const factory = new NodeWorkspaceProcesses({
    roots: [workspace],
    workspaceAccess: "read-write",
    background: { registry, epoch: () => epoch },
  });
  const start = async (command: string, timeoutMs = 30_000) => {
    const proposal = await factory
      .create(context, () => {}, { phase: "prepare" })
      .prepare({ command, cwd: ".", timeoutMs, background: true });
    const effect: EffectRecord = {
      id: "effect_bg" as EffectId,
      runId: context.runId,
      callId: "call_bg" as ToolCallId,
      tool: "shell",
      profile: { class: "process", reversibility: "none", verification: "none" },
      digest: "digest" as ActionDigest,
      state: "started",
      updatedAt: "2026-11-05T00:00:00.000Z" as Timestamp,
    };
    return factory
      .create(context, () => {}, {
        phase: "execute",
        effect,
        action: { digest: effect.digest, summary: "s", preconditions: [], payload: proposal },
      })
      .run();
  };
  const access = (session = sessionId) =>
    registry.create(
      { ...context, ...(session ? { sessionId: session as SessionId } : {}) },
      () => {},
    );
  return { workspace, registry, start, access, revoke: () => epoch++ };
}

async function until(
  read: () => Promise<BackgroundProcessView>,
  done: (view: BackgroundProcessView) => boolean,
) {
  let text = "";
  const end = Date.now() + 8_000;
  for (;;) {
    const view = await read();
    text += view.output;
    if (done({ ...view, output: text })) return { ...view, output: text };
    if (Date.now() > end) throw Error(`Background command did not reach the state: ${text}`);
    await delay(50);
  }
}

describe("background commands", () => {
  it("returns a handle at once, streams new output incrementally and stops on request", async () => {
    const t = setup();
    const started = await t.start("printf 'first\\n'; sleep 1; printf 'second\\n'; sleep 30");
    expect(started).toMatchObject({ termination: "background", handle: "bg_1", exitCode: null });
    const access = t.access();
    const first = await until(
      () => access.output("bg_1", 8192),
      (view) => view.output.includes("first"),
    );
    expect(first.state).toBe("running");
    const second = await until(
      () => access.output("bg_1", 8192),
      (view) => view.output.includes("second"),
    );
    expect(second.output).not.toContain("first");
    const stopped = await access.stop("bg_1");
    expect(stopped.state).toBe("stopped");
    expect(t.registry.running).toBe(0);
  }, 20_000);

  it("reports the exit state and code, and can still be read afterwards", async () => {
    const t = setup();
    await t.start("printf done > out.txt; exit 3");
    const view = await until(
      () => t.access().output("bg_1", 8192),
      (current) => current.state !== "running",
    );
    expect(view).toMatchObject({ state: "exited", exitCode: 3 });
    expect(existsSync(join(t.workspace, "out.txt"))).toBe(true);
  }, 20_000);

  it("binds handles to their session and refuses background mode without a session", async () => {
    const t = setup();
    await t.start("sleep 30");
    await expect(t.access("session_other").output("bg_1", 8192)).rejects.toThrow(
      "Unknown background command handle",
    );
    await expect(t.access().output("bg_9", 8192)).rejects.toThrow("Unknown background command");
    const anonymous = setup(null);
    await expect(anonymous.start("sleep 1")).rejects.toThrow("unavailable");
  }, 20_000);

  it("stops on its own deadline and when the grant changes", async () => {
    const t = setup();
    await t.start("sleep 30", 300);
    expect(
      (
        await until(
          () => t.access().output("bg_1", 8192),
          (v) => v.state !== "running",
        )
      ).state,
    ).toBe("timeout");
    await t.start("sleep 30");
    t.revoke();
    expect(
      (
        await until(
          () => t.access().output("bg_2", 8192),
          (v) => v.state !== "running",
        )
      ).state,
    ).toBe("revoked");
  }, 20_000);

  it("limits concurrent commands and stops everything on close, removing scratch directories", async () => {
    const t = setup();
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith("moyyi-process-")).length;
    for (let i = 0; i < MAX_BACKGROUND_RUNNING; i++) await t.start("sleep 30");
    await expect(t.start("sleep 30")).rejects.toThrow(`At most ${MAX_BACKGROUND_RUNNING}`);
    await t.registry.closeAll();
    expect(t.registry.running).toBe(0);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith("moyyi-process-")).length).toBe(
      before,
    );
    await expect(t.start("sleep 1")).rejects.toThrow("closed");
  }, 20_000);

  it("bounds foreground and background time limits separately", async () => {
    const t = setup();
    const capability = new NodeWorkspaceProcesses({ roots: [t.workspace] }).create(
      {
        runId: "r" as RunId,
        sessionId: "s" as SessionId,
        workspaceRoot: t.workspace,
        signal: new AbortController().signal,
        limits: { maxOutputBytes: 1024 },
      },
      () => {},
      { phase: "prepare" },
    );
    await expect(
      capability.prepare({ command: "true", cwd: ".", timeoutMs: 600_000 }),
    ).resolves.toMatchObject({ timeoutMs: 600_000 });
    await expect(
      capability.prepare({ command: "true", cwd: ".", timeoutMs: 600_001 }),
    ).rejects.toThrow();
    await expect(
      capability.prepare({ command: "true", cwd: ".", timeoutMs: 1000, background: true }),
    ).rejects.toThrow("Background commands are unavailable");
  });
});
