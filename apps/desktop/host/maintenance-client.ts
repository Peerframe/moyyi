import { type ChildProcess, fork } from "node:child_process";
import { constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMaintenanceResult } from "../wire.ts";
import type { MaintenanceRequest, MaintenanceResult } from "./maintenance.ts";

/** One operation per fixed helper. It may replace the app only after an explicit arm and parent exit. */
export class MaintenanceProcess {
  private readonly child: ChildProcess;
  private readonly ready: Promise<void>;
  private readonly exited: Promise<void>;
  private readonly stage: string | undefined;
  private pending:
    | { resolve: (result: MaintenanceResult | null) => void; reject: (error: Error) => void }
    | undefined;
  private failed: Error | undefined;
  private armed = false;
  private requested = false;
  private prepared = false;
  private mode: MaintenanceRequest["mode"] | undefined;

  constructor(directory: string, node: string, rollback: boolean) {
    let entry = join(directory, "maintenance-worker.mjs");
    let executable = node;
    if (rollback) {
      const parent = join(homedir(), ".moyyi/maintenance");
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      const stat = lstatSync(parent);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid?.() ||
        stat.mode & 0o077
      )
        throw Error("维护目录权限不安全。");
      this.stage = mkdtempSync(join(parent, "rollback-"));
      entry = join(this.stage, "maintenance-worker.mjs");
      executable = join(this.stage, "node");
      try {
        copyFileSync(join(directory, "maintenance-worker.mjs"), entry, constants.COPYFILE_EXCL);
        copyFileSync(node, executable, constants.COPYFILE_EXCL);
      } catch (error) {
        rmSync(this.stage, { recursive: true, force: true });
        throw error;
      }
    }
    this.child = fork(entry, [], {
      execPath: executable,
      cwd: this.stage ?? directory,
      execArgv: [],
      env: { HOME: homedir(), PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
      detached: rollback,
    });
    this.exited = new Promise((resolve) => {
      const finished = () => {
        this.fail(Error("维护进程已结束；请查看已有备份及当前状态。"));
        if (this.stage && !this.armed) rmSync(this.stage, { recursive: true, force: true });
        resolve();
      };
      this.child.once("exit", finished);
      // A failed spawn has no exit event and no writer; close must still release its UI gate.
      this.child.once("error", () => {
        if (!this.child.pid) finished();
      });
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = Error("维护进程启动超时。");
        this.fail(error);
        reject(error);
        if (this.child.connected) this.child.disconnect();
      }, 30_000);
      let ready = false;
      this.child.on("message", (value: unknown) => {
        if (this.failed) return;
        if (!value || typeof value !== "object" || Array.isArray(value))
          return this.fail(Error("维护通讯无效。"));
        const message = value as Record<string, unknown>;
        if (message.type === "ready" && Object.keys(message).length === 1 && !ready) {
          ready = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (!ready || message.id !== 1 || !this.pending)
          return this.fail(Error("维护通讯顺序无效。"));
        if (
          (message.type === "result" || message.type === "prepared") &&
          Object.keys(message).length === 3 &&
          isMaintenanceResult(message.result) &&
          message.result.kind === this.mode &&
          (message.type === "prepared") === (this.mode === "rollback")
        ) {
          this.prepared = message.type === "prepared";
          this.pending.resolve(message.result);
          this.pending = undefined;
          return;
        }
        if (message.type === "armed" && Object.keys(message).length === 2 && this.prepared) {
          this.armed = true;
          this.pending.resolve(null);
          this.pending = undefined;
          return;
        }
        if (
          message.type === "error" &&
          typeof message.message === "string" &&
          message.message.length <= 4096
        ) {
          this.fail(Error(message.message));
          return;
        }
        this.fail(Error("维护服务返回了无效结果。"));
      });
      this.child.once("error", () => {
        clearTimeout(timer);
        const error = Error("无法启动维护进程。");
        this.fail(error);
        reject(error);
      });
      this.child.once("exit", () => {
        clearTimeout(timer);
        if (!ready) reject(this.failed ?? Error("维护进程未就绪。"));
      });
    });
    void this.ready.catch(() => {});
  }

  private fail(error: Error): void {
    this.failed ??= error;
    this.pending?.reject(error);
    this.pending = undefined;
  }
  private async exchange(value: unknown): Promise<MaintenanceResult | null> {
    await this.ready;
    if (this.failed) throw this.failed;
    if (this.pending) throw Error("已有维护操作正在进行。");
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.child.send(value as object, (error) => {
        if (error) this.fail(Error("维护通讯中断。"));
      });
    });
  }
  async run(request: MaintenanceRequest): Promise<MaintenanceResult> {
    if (this.requested) throw Error("维护操作不能重复发送。");
    this.requested = true;
    this.mode = request.mode;
    const result = await this.exchange({ type: "request", id: 1, request });
    if (!result || result.kind !== request.mode) throw Error("维护结果不匹配。");
    if (request.mode !== "rollback") await this.exited;
    return result;
  }
  async arm(): Promise<void> {
    if (!this.prepared || this.armed) throw Error("回退尚未准备好。");
    await this.exchange({ type: "arm", id: 1 });
    // The inherited pipe closes when Electron really exits; disconnecting here would be too early.
    this.child.unref();
    this.child.channel?.unref();
  }
  async close(): Promise<void> {
    if (this.armed) return;
    if (this.child.connected) this.child.disconnect();
    await this.exited;
  }
}
