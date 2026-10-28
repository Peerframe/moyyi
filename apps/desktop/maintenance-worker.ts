import { lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type MaintenanceMessage,
  parseMaintenanceRequest,
  runDataMaintenance,
} from "./host/maintenance.ts";
import { type PreparedRollback, prepareRollback } from "./host/maintenance-rollback.ts";

if (!process.send || !process.connected || process.version !== "v26.12.1")
  throw Error("Maintenance requires the parent-owned Node26 IPC helper");
const parent = process.ppid;
let accepted = false;
let id = 0;
let prepared: PreparedRollback | undefined;
let armed = false;
let finishing = false;
const idle = setTimeout(() => finishError("维护操作等待超时，未开始新的动作。"), 60_000);

function send(message: MaintenanceMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.connected) {
      reject(Error("Parent disconnected"));
      return;
    }
    process.send?.(message, (error) => (error ? reject(error) : resolve()));
  });
}
function cleanupStage(): void {
  const entry = process.argv[1];
  if (!entry) return;
  try {
    const stage = realpathSync(dirname(entry));
    if (
      dirname(stage) !== join(realpathSync(homedir()), ".moyyi/maintenance") ||
      !/^rollback-[a-zA-Z0-9]+$/.test(basename(stage)) ||
      realpathSync(entry) !== join(stage, "maintenance-worker.mjs") ||
      realpathSync(process.execPath) !== join(stage, "node")
    )
      return;
    const stat = lstatSync(stage);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700 ||
      readdirSync(stage).sort().join() !== "maintenance-worker.mjs,node"
    )
      return;
    for (const name of ["maintenance-worker.mjs", "node"]) {
      const file = lstatSync(join(stage, name));
      if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid?.()) return;
    }
    rmSync(stage, { recursive: true });
  } catch {
    /* Preserve uncertain paths for diagnosis rather than widening cleanup. */
  }
}

function message(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (detail.startsWith("ROLLBACK_SETTINGS:"))
    return detail.slice("ROLLBACK_SETTINGS:".length).trim();
  if (/Unsettled work/.test(detail))
    return "存在结果未知或尚未收尾的操作，不能恢复旧会话覆盖保护记录。请先只读核对。";
  if (/SQLITE|locked|busy/i.test(detail))
    return "会话库正由另一进程使用或无法安全打开，请关闭其他 moyyi 后重试。";
  return "维护未能确认完成。请重新打开查看当前状态；已有备份和救援副本不会被自动删除。";
}
async function finishError(text: string): Promise<void> {
  if (finishing) return;
  finishing = true;
  clearTimeout(idle);
  prepared?.abort();
  try {
    if (process.connected) await send({ type: "error", id, message: text });
  } finally {
    process.disconnect?.();
  }
}

process.on("message", (value: unknown) => {
  if (finishing || !value || typeof value !== "object" || Array.isArray(value)) return;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.type === "arm" &&
    prepared &&
    envelope.id === id &&
    !armed &&
    Object.keys(envelope).sort().join() === "id,type"
  ) {
    armed = true;
    void send({ type: "armed", id }).catch(() => finishError("回退确认未送达，未替换应用。"));
    return;
  }
  if (envelope.type === "abort" && envelope.id === id && !armed) {
    void finishError("维护操作已取消。");
    return;
  }
  if (
    accepted ||
    envelope.type !== "request" ||
    Object.keys(envelope).sort().join() !== "id,request,type" ||
    !Number.isSafeInteger(envelope.id) ||
    (envelope.id as number) < 1
  ) {
    void finishError("维护通讯无效，未接受新的操作。");
    return;
  }
  accepted = true;
  id = envelope.id as number;
  clearTimeout(idle);
  void (async () => {
    try {
      const request = parseMaintenanceRequest(envelope.request);
      if (request.mode === "rollback") {
        prepared = await prepareRollback(homedir(), request.expectedCurrentRevision);
        if (finishing || !process.connected) {
          prepared.abort();
          cleanupStage();
          return;
        }
        await send({ type: "prepared", id, result: prepared.result });
      } else {
        const result = await runDataMaintenance(homedir(), request);
        await send({ type: "result", id, result });
        finishing = true;
        process.disconnect?.();
      }
    } catch (error) {
      await finishError(message(error));
    }
  })();
});
process.on("disconnect", () => {
  clearTimeout(idle);
  if (finishing) return;
  finishing = true;
  if (!armed || !prepared) {
    prepared?.abort();
    cleanupStage();
    return;
  }
  const rollback = prepared;
  void (async () => {
    // IPC closure alone is not proof that the application exited. Never replace a live app.
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(parent, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") break;
        await rollback.commit();
        return;
      }
      await delay(100);
    }
    rollback.abort();
  })()
    .catch(() => {
      // Prepared/result receipts survive for the next desktop launch to diagnose uncertainty.
    })
    .finally(cleanupStage);
});
process.on("SIGTERM", () => {
  void finishError("维护操作已停止，请核对已有备份和当前状态。");
});
await send({ type: "ready" });
