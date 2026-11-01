import type { SettingsSectionProps } from "../../../renderer/slot-types.ts";
import type { DesktopSettings } from "../../../shared.ts";
import { Connections } from "./Connections.tsx";
import { presetLabel, selectKimiReasoningEffort, selectSettingsPreset } from "./settings-state.ts";
export function SettingsFields({ draft, setDraft, setNotice, setError }: SettingsSectionProps) {
  return (
    <>
      <Connections />
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
      <p className="panel-note">更换服务、保存或关闭窗口时会清空输入框。无需在聊天中发送密钥。</p>
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
        仅用于有完整问题的新会话，不支持追加指令；继续旧会话请先关闭。调查最多使用总时限的三分之一，届时停止调查请求；等待已开始的工具和记录收尾后独立成文。仍可能超时或证据不足；不增加预算、不保证正确。默认关闭。
      </p>
    </>
  );
}
