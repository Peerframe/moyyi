import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ActionDigest,
  EffectId,
  EffectRecord,
  PreparedProcess,
  RunId,
  Timestamp,
  ToolCallId,
} from "../contracts/index.ts";
import { NodeWorkspaceProcesses } from "./processes.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(maxOutputBytes = 32_768) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-process-test-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const abort = new AbortController();
  let authorized = true;
  const guard = () => {
    if (!authorized) throw Error("revoked");
  };
  const context = {
    runId: "run_process" as RunId,
    workspaceRoot: workspace,
    signal: abort.signal,
    limits: { maxOutputBytes },
  };
  const factory = new NodeWorkspaceProcesses({
    roots: [workspace],
    protectedPaths: [join(workspace, "private-store")],
  });
  const capability = factory.create(context, guard, { phase: "prepare" });
  const scopeFor = (proposal: PreparedProcess) => {
    const effect: EffectRecord = {
      id: "effect_process" as EffectId,
      runId: context.runId,
      callId: "call_process" as ToolCallId,
      tool: "shell",
      profile: { class: "process", reversibility: "none", verification: "none" },
      digest: "test_digest" as ActionDigest,
      state: "started",
      updatedAt: "2026-10-25T00:00:00.000Z" as Timestamp,
    };
    return {
      phase: "execute" as const,
      effect,
      action: {
        digest: effect.digest,
        summary: "approved test command",
        preconditions: [],
        payload: proposal,
      },
    };
  };
  const prepare = (command: string, timeoutMs = 5_000, cwd = ".") =>
    capability.prepare({ command, timeoutMs, cwd });
  const execute = (proposal: PreparedProcess) => factory.create(context, guard, scopeFor(proposal));
  return {
    root,
    workspace,
    abort,
    context,
    factory,
    capability,
    prepare,
    execute,
    scopeFor,
    guard,
    revoke: () => {
      authorized = false;
    },
    read: (name: string) => readFileSync(join(workspace, name), "utf8"),
  };
}
async function until(check: () => boolean) {
  const end = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() >= end) throw Error("Process fixture did not become ready");
    await delay(20);
  }
}

// Both supported OS lanes execute real isolation. Missing backend is a failure, never a skip.
describe.skipIf(process.platform !== "darwin" && process.platform !== "linux")(
  "native process capability",
  () => {
    it("runs the approved command once and captures both output streams and nonzero exit", async () => {
      const t = setup();
      const proposal = await t.prepare(
        "printf stdout; printf stderr >&2; printf created > result; exit 7",
      );
      const cap = t.execute(proposal);
      const result = await cap.run();
      expect(result).toMatchObject({ termination: "exited", exitCode: 7, truncated: false });
      expect(result.output).toContain("stdout");
      expect(result.output).toContain("stderr");
      expect(t.read("result")).toBe("created");
      await expect(cap.run()).rejects.toThrow(/single approved/);
    });

    it("binds a normalized real subdirectory to approval", async () => {
      const t = setup();
      mkdirSync(join(t.workspace, "child"));
      const proposal = await t.prepare("printf ok > result", 5_000, "./child/.");
      expect(proposal.cwd).toBe("child");
      expect(await t.execute(proposal).run()).toMatchObject({ termination: "exited", exitCode: 0 });
      expect(t.read("child/result")).toBe("ok");
    });

    it.each(["..", "../workspace", "/", ".git", ".env", "private-store"])(
      "rejects an out-of-scope cwd %s",
      async (cwd) => {
        const t = setup();
        await expect(t.prepare("true", 5_000, cwd)).rejects.toThrow();
      },
    );

    it("rejects symlink cwd and workspace replacement after approval", async () => {
      const t = setup();
      mkdirSync(join(t.workspace, "child"));
      symlinkSync(join(t.workspace, "child"), join(t.workspace, "alias"));
      await expect(t.prepare("true", 5_000, "alias")).rejects.toThrow(/real directories/);
      const proposal = await t.prepare("printf changed > result", 5_000, "child");
      renameSync(join(t.workspace, "child"), join(t.workspace, "previous"));
      mkdirSync(join(t.workspace, "child"));
      await expect(t.execute(proposal).run()).rejects.toThrow(/changed after approval/);
      expect(existsSync(join(t.workspace, "child/result"))).toBe(false);
      const top = await t.prepare("true");
      renameSync(t.workspace, join(t.root, "old-workspace"));
      mkdirSync(t.workspace);
      await expect(t.execute(top).run()).rejects.toThrow(/outside the current explicit grant/);
    });

    it("rejects invalid arguments and bounds command bytes and time", async () => {
      const t = setup();
      for (const command of ["", " ", "bad\0command", "中".repeat(6_000)])
        await expect(t.prepare(command)).rejects.toThrow(/process request/);
      for (const timeout of [0, 120_001, NaN, 1.5])
        await expect(t.prepare("true", timeout)).rejects.toThrow(/process request/);
      await expect(t.prepare("true", 10, "bad\0path")).rejects.toThrow(/process request/);
    });

    it("cannot execute without a matching durable process action", async () => {
      const t = setup();
      const proposal = await t.prepare("printf unexpected > result");
      await expect(t.capability.run()).rejects.toThrow(/single approved/);
      const valid = t.scopeFor(proposal);
      for (const scope of [
        { ...valid, phase: "prepare" as const },
        { ...valid, effect: { ...valid.effect, state: "approved" as const } },
        { ...valid, effect: { ...valid.effect, digest: "different" as ActionDigest } },
        { ...valid, effect: { ...valid.effect, runId: "other" as RunId } },
        { ...valid, action: { ...valid.action, payload: { ...proposal, network: true } } },
      ])
        await expect(t.factory.create(t.context, t.guard, scope).run()).rejects.toThrow();
      expect(existsSync(join(t.workspace, "result"))).toBe(false);
    });

    it("snapshots the approved payload instead of following later mutation", async () => {
      const t = setup();
      const proposal = { ...(await t.prepare("printf approved > result")) };
      const cap = t.execute(proposal);
      proposal.command = "printf replaced > result";
      expect(await cap.run()).toMatchObject({ termination: "exited", exitCode: 0 });
      expect(t.read("result")).toBe("approved");
    });

    it("refuses revoked and cancelled capabilities before starting", async () => {
      const t = setup();
      const cap = t.execute(await t.prepare("printf unexpected > result"));
      t.revoke();
      await expect(cap.run()).rejects.toThrow(/revoked/);
      const other = setup();
      const cancelled = other.execute(await other.prepare("printf unexpected > result"));
      other.abort.abort();
      await expect(cancelled.run()).rejects.toThrow(/cancelled/);
      expect(existsSync(join(t.workspace, "result"))).toBe(false);
      expect(existsSync(join(other.workspace, "result"))).toBe(false);
    });

    it("stops an active group at its deadline", async () => {
      const t = setup();
      const start = performance.now();
      const result = await t.execute(await t.prepare("printf began; /bin/sleep 30", 200)).run();
      expect(["timeout", "unknown"]).toContain(result.termination);
      expect(result.output).toBe("began");
      expect(performance.now() - start).toBeLessThan(3_000);
    });

    it.each(["cancel", "revoke"])(
      "terminates TERM-ignoring background children on %s",
      async (mode) => {
        const t = setup();
        const proposal = await t.prepare(
          "(trap '' TERM; while :; do printf x >> heartbeat; /bin/sleep 0.05; done) & wait",
        );
        const running = t.execute(proposal).run();
        await until(
          () => existsSync(join(t.workspace, "heartbeat")) && t.read("heartbeat").length >= 2,
        );
        if (mode === "cancel") t.abort.abort();
        else t.revoke();
        const result = await running;
        expect([mode === "cancel" ? "cancelled" : "revoked", "unknown"]).toContain(
          result.termination,
        );
        const stopped = t.read("heartbeat");
        await delay(200);
        expect(t.read("heartbeat")).toBe(stopped);
      },
    );

    it("cleans background group members even when the shell exits successfully", async () => {
      const t = setup();
      const proposal = await t.prepare(
        "(trap '' TERM; while :; do printf x >> heartbeat; /bin/sleep 0.05; done) & /bin/sleep 0.1; exit 0",
      );
      const result = await t.execute(proposal).run();
      expect(["exited", "unknown"]).toContain(result.termination);
      const stopped = t.read("heartbeat");
      await delay(200);
      expect(t.read("heartbeat")).toBe(stopped);
    });

    it("bounds combined output while killing an output flood", async () => {
      const t = setup(1_024);
      const result = await t
        .execute(await t.prepare("while :; do printf 0123456789; printf abcdefghij >&2; done"))
        .run();
      expect(result.termination).toBe("output_limit");
      expect(result.truncated).toBe(true);
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(1_024);
      expect(result.output.length).toBeGreaterThan(0);
    });

    it.skipIf(process.platform !== "darwin")(
      "bounds inherited pipes from a deliberately detached process",
      async () => {
        const t = setup();
        const script =
          'use POSIX qw(setsid); my $pid=fork(); die unless defined $pid; if($pid){for(1..200){last if -e "detached.pid";select undef,undef,undef,0.01;}exit 0;} setsid(); open(my $f,">","detached.pid") or die; print $f "$$"; close($f); sleep 3;';
        const command = `/usr/bin/perl -e '${script}'`;
        const started = performance.now();
        try {
          const result = await t.execute(await t.prepare(command)).run();
          expect(result.termination).toBe("unknown");
          expect(performance.now() - started).toBeLessThan(3_000);
          expect(Number(t.read("detached.pid"))).toBeGreaterThan(1);
        } finally {
          // Only this known synthetic child is killed; this is fixture cleanup, not a
          // claim that the native process-group contract covers arbitrary descendants.
          if (existsSync(join(t.workspace, "detached.pid"))) {
            const pid = Number(t.read("detached.pid"));
            if (Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid) {
              try {
                process.kill(pid, "SIGKILL");
              } catch {
                /* Fixture already exited. */
              }
            }
          }
        }
      },
    );

    it("does not split UTF-8 codepoints when truncating output", async () => {
      const t = setup(4);
      const result = await t.execute(await t.prepare("printf '中文中文'")).run();
      expect(result.termination).toBe("output_limit");
      expect(result.output).toBe("中");
      expect(result.output).not.toContain("�");
    });
  },
);
