import { type ChildProcess, fork } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DesktopCommand, DesktopState } from "./shared.ts";
import { isWorkerMessage } from "./wire.ts";

/** One child and one inherited IPC pipe, with no TCP port or reusable external endpoint. */
export class DesktopProcess {
  private readonly child: ChildProcess;
  private state: DesktopState | undefined;
  private failure: string | undefined;
  private sequence = 0;
  private readonly waiting = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly ready: Promise<void>;
  private closing: Promise<void> | undefined;

  constructor(directory: string, node: string, onState: (state: DesktopState) => void) {
    this.child = fork(join(directory, "worker.mjs"), [], {
      execPath: node,
      cwd: directory,
      execArgv: [],
      env: { HOME: homedir(), PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
    });
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail("本地服务启动超时。请关闭应用并检查安装。", onState);
        reject(Error(this.failure));
      }, 30_000);
      const fail = (message: string) => {
        clearTimeout(timer);
        this.fail(message, onState);
        reject(Error(message));
      };
      this.child.on("message", (value: unknown) => {
        if (this.failure) return;
        if (!isWorkerMessage(value)) {
          fail("本地服务返回了无效数据，已停止通讯。");
          this.child.disconnect();
          return;
        }
        if (value.type === "fatal") {
          fail(value.message);
          if (this.child.connected) this.child.disconnect();
          return;
        }
        if (value.type === "state") {
          clearTimeout(timer);
          this.state = value.state;
          onState(value.state);
          resolve();
          return;
        }
        const pending = this.waiting.get(value.id);
        if (!pending) return;
        this.waiting.delete(value.id);
        clearTimeout(pending.timer);
        if (value.error) pending.reject(Error(value.error));
        else pending.resolve();
      });
      this.child.once("error", () => fail("无法启动安装包中的 Node 运行时。请重新安装 moyyi。"));
      this.child.once("exit", () => {
        if (!this.closing) fail("本地会话服务意外停止。请重新打开应用；不会自动重跑任务。");
      });
    });
    // Startup can fail before the renderer mounts; keep a rejected promise without an unhandled rejection.
    void this.ready.catch(() => {});
  }

  private fail(message: string, onState: (state: DesktopState) => void): void {
    this.failure = message;
    for (const pending of this.waiting.values()) {
      clearTimeout(pending.timer);
      pending.reject(Error(message));
    }
    this.waiting.clear();
    if (this.state) {
      this.state = {
        ...this.state,
        status: "closed",
        connection: { ready: false, message },
        error: message,
        run: null,
        pendingApproval: null,
        permissions: { writes: false, checks: false },
        reportTarget: null,
        artifactPreview: null,
        effectInspection: null,
      };
      onState(this.state);
    }
  }

  async getState(): Promise<DesktopState> {
    await this.ready;
    if (this.failure || !this.state) throw Error(this.failure ?? "本地服务尚未就绪。");
    return this.state;
  }

  async send(command: DesktopCommand): Promise<DesktopState> {
    await this.getState();
    if (this.waiting.size >= 8) throw Error("操作正在处理中，请稍候。");
    const id = ++this.sequence;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(Error("操作尚未确认。请查看当前状态，不要重复批准。"));
      }, 60_000);
      this.waiting.set(id, { resolve, reject, timer });
      this.child.send({ type: "command", id, command }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(Error("本地服务通讯中断。"));
      });
    });
    return this.getState();
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      try {
        if (this.child.connected && !this.failure) await this.send({ type: "close" });
      } catch {
        // A missing ACK is not permission to leave a writer alive. Disconnect requests its
        // cleanup too, and completion still waits for the owned process to actually exit.
      } finally {
        if (this.child.connected) this.child.disconnect();
      }
      if (this.child.exitCode !== null || this.child.signalCode !== null) return;
      await new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    })();
    return this.closing;
  }
}
