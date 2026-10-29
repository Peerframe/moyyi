import { useEffect, useRef, useState } from "react";
import { createActionGate } from "../../../renderer/view-state.ts";
import type { DesktopPermissions } from "../../../shared.ts";

export function PermissionsDialog({
  workspace,
  permissions,
  onConfigure,
  onClose,
}: {
  workspace: string;
  permissions: DesktopPermissions;
  onConfigure(permissions: DesktopPermissions): Promise<DesktopPermissions>;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const gate = useRef(createActionGate());
  const mounted = useRef(true);
  const [draft, setDraft] = useState(permissions);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
    };
  }, []);

  function close() {
    if (gate.current.begin()) onClose();
  }

  async function save() {
    if (!gate.current.begin()) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const actual = await onConfigure(draft);
      if (!mounted.current) return;
      setDraft(actual);
      setNotice(
        actual.writes === draft.writes && actual.checks === draft.checks
          ? "当前权限已确认。尚未发起模型请求或执行文件操作。"
          : "权限未按本次选择改变；系统确认可能已取消。下方显示当前权限。",
      );
    } catch {
      if (mounted.current) setError("未能确认权限变更。请关闭此窗口核对当前状态，再决定是否重试。");
    } finally {
      gate.current.end();
      if (mounted.current) setPending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="permissions-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="panel-heading">
          <h2 id="permissions-title">本次会话权限</h2>
          <button type="button" disabled={pending} onClick={close}>
            关闭
          </button>
        </header>
        <p className="preview-path">工作目录：{workspace}</p>
        <p className="panel-note">
          两项权限独立，默认关闭。启用后，每次实际操作仍需审阅预览并批准。
        </p>
        <fieldset className="permission-options" disabled={pending}>
          <label>
            <input
              type="checkbox"
              checked={draft.writes}
              onChange={(event) => {
                setDraft((current) => ({ ...current, writes: event.target.checked }));
                setNotice(null);
              }}
            />
            <span>
              <strong>允许提议文件修改</strong>
              <small>可在所选目录内新建、编辑和通过快照撤销；不会自动批准。</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.checks}
              onChange={(event) => {
                setDraft((current) => ({ ...current, checks: event.target.checked }));
                setNotice(null);
              }}
            />
            <span>
              <strong>允许提议 Node 命令检查</strong>
              <small>沙箱内工作目录只读、无网络。不能安装依赖或通过命令修改文件。</small>
            </span>
          </label>
        </fieldset>
        <p className="panel-note">
          应用权限会清除单个报告位置授权。选择报告位置会关闭这两项权限。恢复会话、切换模型配置后均回到只读。
        </p>
        <p className="panel-note">
          运行中需先停止并等待收尾，才能调整权限。停止不会撤销已经完成的修改。
        </p>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="panel-note">
            {notice}
          </p>
        ) : null}
        <footer className="dialog-actions">
          <button type="button" disabled={pending} onClick={close}>
            取消
          </button>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? "正在确认…" : "确认权限"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
