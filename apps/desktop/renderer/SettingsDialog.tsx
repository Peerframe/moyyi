import { useEffect, useRef, useState } from "react";
import type { DesktopBridge, DesktopSettings } from "../shared.ts";
import {
  newSettingsDraft,
  presetLabel,
  saveSettingsDraft,
  selectKimiReasoningEffort,
  selectSettingsPreset,
  validateSettingsDraft,
} from "./settings-state.ts";
import { createActionGate } from "./view-state.ts";

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
          <label>
            <span>模型服务</span>
            <select
              value={draft.settings.preset}
              onChange={(event) => {
                const preset = event.target.value as DesktopSettings["preset"];
                setDraft((current) => selectSettingsPreset(current, preset));
                setNotice(null);
                setError(null);
              }}
            >
              <option value="flash">DeepSeek Flash（默认）</option>
              <option value="kimi-cn">Kimi · 中国</option>
              <option value="kimi-global">Kimi · 全球</option>
            </select>
          </label>
          <p className="panel-note">
            {draft.settings.preset === "flash"
              ? "Flash 使用 low 档位。"
              : "Kimi high 尚未通过复杂任务验收，不能视为更可靠的方案。"}
            服务地址固定；选择不同区域时请使用对应的密钥。
          </p>
          {draft.settings.preset !== "flash" ? (
            <label>
              <span>Kimi 推理强度</span>
              <select
                value={draft.settings.kimiReasoningEffort ?? "low"}
                onChange={(event) => {
                  const effort = event.target.value as "low" | "high";
                  setDraft((current) => selectKimiReasoningEffort(current, effort));
                  setNotice(null);
                  setError(null);
                }}
              >
                <option value="low">low（默认）</option>
                <option value="high">high（实验）</option>
              </select>
            </label>
          ) : null}
          <label>
            <span>{presetLabel(draft.settings.preset)} API Key</span>
            <input
              type="password"
              value={draft.apiKey}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={4096}
              placeholder="留空保留该服务已有密钥"
              onChange={(event) => {
                setDraft((current) => ({ ...current, apiKey: event.target.value }));
                setNotice(null);
                setError(null);
              }}
            />
          </label>
          <p className="panel-note">
            更换服务、保存或关闭窗口时会清空输入框。无需在聊天中发送密钥。
          </p>
          <div className="settings-budget">
            <label>
              <span>每轮请求上限</span>
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                required
                value={draft.settings.maxRequests}
                onChange={(event) => {
                  const maxRequests = Number(event.target.value);
                  setDraft((current) => ({
                    ...current,
                    settings: { ...current.settings, maxRequests },
                  }));
                  setNotice(null);
                }}
              />
            </label>
            <label>
              <span>每轮时限（秒）</span>
              <input
                type="number"
                min={30}
                max={300}
                step={1}
                required
                value={draft.settings.timeoutMs / 1000}
                onChange={(event) => {
                  const timeoutMs = Number(event.target.value) * 1000;
                  setDraft((current) => ({
                    ...current,
                    settings: { ...current.settings, timeoutMs },
                  }));
                  setNotice(null);
                }}
              />
            </label>
          </div>
          <p className="panel-note">
            输出上限固定 8192 tokens，自动重试 0 次。保存设置不授予写入权限。
          </p>
          <label>
            <input
              type="checkbox"
              checked={draft.settings.evidenceAnswer ?? false}
              onChange={(event) => {
                const enabled = event.target.checked;
                setDraft((current) => {
                  const { evidenceAnswer: _previous, ...settings } = current.settings;
                  return {
                    ...current,
                    settings: { ...settings, ...(enabled ? { evidenceAnswer: true } : {}) },
                  };
                });
                setNotice(null);
              }}
            />
            <span>独立证据成文（实验）</span>
          </label>
          <p className="panel-note">
            在总上限内用一次请求，直接根据原问题和实际工具证据独立成文。至少 2 次总上限；
            仅用于有完整问题的新会话，不支持追加指令；继续旧会话请先关闭。请求边界已用一半时间时提前成文，仍可能超时或不完整；不增加预算、不保证正确。默认关闭。
          </p>
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
