import { useEffect, useRef, useState } from "react";
import type { DesktopBridge, DesktopMaintenanceResult } from "../shared.ts";

export function MaintenanceDialog({
  bridge,
  onClose,
}: {
  bridge: DesktopBridge;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesktopMaintenanceResult | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function run(operation: () => Promise<DesktopMaintenanceResult | null>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await operation());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "维护未能确认完成。请核对当前状态。");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="maintenance-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!running.current) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="maintenance-title">备份与回退</h2>
        <button type="button" disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
      <p className="panel-note">
        仅在任务结束后操作。维护不会调用模型；会话服务将安全关闭再打开，写入权限会重置。
      </p>
      <div className="guide-workflows">
        <section>
          <h3>备份会话与设置</h3>
          <p>保留历史、撤销快照和模型设置。项目文件与钥匙串密钥需另外备份。</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => bridge.createBackup())}
          >
            创建备份
          </button>
        </section>
        <section>
          <h3>恢复会话记录</h3>
          <p>
            先保存当前记录的救援备份，再恢复所选记录。当前设置与项目文件不变，旧操作不会自动重跑。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => bridge.restoreBackup())}
          >
            选择备份并恢复
          </button>
        </section>
        <section>
          <h3>回退软件版本</h3>
          <p>
            回到本机保留且通过验收的上一版应用，保留当前数据。没有可验证或兼容的旧包时，会停止回退。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => bridge.rollbackApplication())}
          >
            检查可回退版本
          </button>
        </section>
      </div>
      {busy ? <p role="status">正在处理维护操作，请勿重复启动 moyyi…</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="maintenance-receipt" role="status">
          <strong>
            {result.kind === "backup"
              ? "备份已完成"
              : result.kind === "restore"
                ? "会话恢复已完成"
                : "已确认回退，正在安全退出"}
          </strong>
          <p>{result.path}</p>
          {result.sessionCount !== null ? <p>会话数：{result.sessionCount}</p> : null}
          {result.rescuePath ? <p>救援副本：{result.rescuePath}</p> : null}
          <p>当前设置与工作区文件保留；不导出钥匙串密钥。</p>
        </div>
      ) : null}
    </dialog>
  );
}
