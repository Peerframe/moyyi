import { useEffect, useRef, useState } from "react";
import { SettingsSections } from "../../../renderer/slots.ts";
import { createActionGate } from "../../../renderer/view-state.ts";
import type { DesktopBridge, DesktopSettings } from "../../../shared.ts";
import { newSettingsDraft, saveSettingsDraft, validateSettingsDraft } from "./settings-state.ts";

// Local form state only: credentials never enter a host snapshot or browser storage.
export function SettingsDialog({
  settings,
  onConfigure,
  onClose,
}: {
  settings: DesktopSettings;
  onConfigure: DesktopBridge["configure"];
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const gate = useRef(createActionGate());
  const mounted = useRef(true);
  const [draft, setDraft] = useState(() => newSettingsDraft(settings));
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

  useEffect(() => {
    setDraft(newSettingsDraft(settings));
  }, [settings]);

  function close() {
    if (!gate.current.begin()) return;
    setDraft((current) => newSettingsDraft(current.settings));
    onClose();
  }

  async function save() {
    if (!gate.current.begin()) return;
    const validation = validateSettingsDraft(draft);
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveSettingsDraft(
        draft,
        () => setDraft((current) => newSettingsDraft(current.settings)),
        onConfigure,
      );
      if (!mounted.current) return;
      setDraft(newSettingsDraft(result.settings));
      setNotice(
        result.connection.ready
          ? "设置已保存在本机。未发起模型请求，尚未验证远端连接。"
          : "设置已保存在本机，但连接尚未就绪。请为所选服务填写 API Key 或处理系统钥匙串授权；未发起模型请求。",
      );
    } catch {
      if (mounted.current)
        setError(
          validation ??
            "设置未能确认应用。请重新打开模型设置核对，或处理系统授权后重试；已有密钥和会话未删除。",
        );
    } finally {
      gate.current.end();
      if (mounted.current) setPending(false);
    }
  }

  return (
    <dialog
      className="settings-dialog"
      ref={dialog}
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="panel-heading">
          <h2 id="settings-title">模型设置</h2>
          <button type="button" className="quiet" disabled={pending} onClick={close}>
            关闭
          </button>
        </header>
        <p className="panel-note">
          设置保存在本机；密钥仅写入 macOS 钥匙串。保存不会产生模型费用。
        </p>
        <fieldset disabled={pending} className="settings-fields">
          <SettingsSections
            draft={draft}
            setDraft={setDraft}
            setNotice={setNotice}
            setError={setError}
          />
        </fieldset>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="panel-note" role="status">
            {notice}
          </p>
        ) : null}
        <footer className="dialog-actions">
          <button type="button" disabled={pending} onClick={close}>
            取消
          </button>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? "正在保存，请处理系统授权…" : "保存到本机"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
