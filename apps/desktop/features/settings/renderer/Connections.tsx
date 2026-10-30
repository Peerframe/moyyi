import { useState } from "react";
import { useDesktopUI } from "../../../renderer/ui.ts";
import type { ConnectionChange, DesktopConnection } from "../../../shared.ts";

export function ConnectionSelector() {
  const { state, bridge, perform, busy } = useDesktopUI();
  if (!state.connections.length) return null;
  return (
    <label>
      <span className="sr-only">当前连接</span>
      <select
        aria-label="当前连接"
        disabled={busy}
        value={state.activeConnectionId}
        onChange={(e) => {
          void perform(
            () => bridge.changeConnection({ action: "select", id: e.target.value }),
            "连接切换未完成，请核对当前连接。",
          );
        }}
      >
        {state.connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Connections() {
  const { state, bridge, perform, busy } = useDesktopUI();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<DesktopConnection["provider"]>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function change(c: ConnectionChange) {
    if (pending) return;
    setPending(true);
    setError(null);
    setApiKey("");
    try {
      const result = await perform(
        () => bridge.changeConnection(c),
        "连接未能确认更新，请重新打开设置核对。",
      );
      if (!result) setError("连接未能确认更新。已有会话保留。");
      else setName("");
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label="模型连接">
      <h3>模型连接</h3>
      <p className="panel-note">
        切换连接或保存设置后，写入、检查和网页权限回到只读，需要重新开启。
      </p>
      {state.connections.map((c) => (
        <div className="artifact-card" key={c.id}>
          <strong>{c.name}</strong>
          <p className="panel-note">
            {c.provider} · {c.configured ? "已配置" : "未配置密钥"}
            {c.id === state.activeConnectionId ? " · 当前默认连接" : ""}
          </p>
          <label>
            <span>新名称</span>
            <input
              aria-label={`重命名 ${c.name}`}
              maxLength={80}
              defaultValue={c.name}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== c.name)
                  void change({ action: "rename", id: c.id, name: next });
              }}
              disabled={pending || busy}
            />
          </label>
          <button
            type="button"
            disabled={pending || busy || c.id === state.activeConnectionId}
            onClick={() => void change({ action: "select", id: c.id })}
          >
            设为默认并切换
          </button>
          <button
            type="button"
            disabled={pending || busy || c.id === state.activeConnectionId}
            onClick={() => void change({ action: "delete", id: c.id })}
          >
            删除连接
          </button>
          {c.provider === "deepseek" ? (
            <button
              type="button"
              disabled={pending || busy || c.id === state.searchConnectionId}
              onClick={() => void change({ action: "search", id: c.id })}
            >
              {c.id === state.searchConnectionId ? "搜索使用此连接" : "用于网页搜索"}
            </button>
          ) : null}
        </div>
      ))}
      <label>
        <span>连接名称</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        <span>厂商</span>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as DesktopConnection["provider"]);
            setApiKey("");
          }}
        >
          <option value="deepseek">DeepSeek Flash</option>
          <option value="kimi-cn">Kimi · 中国</option>
          <option value="kimi-global">Kimi · 全球</option>
        </select>
      </label>
      <label>
        <span>新连接 API Key</span>
        <input
          type="password"
          autoComplete="new-password"
          value={apiKey}
          maxLength={4096}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={pending || busy || !name.trim() || state.connections.length >= 16}
        onClick={() =>
          void change({ action: "add", name: name.trim(), provider, ...(apiKey ? { apiKey } : {}) })
        }
      >
        {pending ? "正在保存…" : "添加连接"}
      </button>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {!state.connections.some((c) => c.provider === "deepseek") ? (
        <p className="panel-note">没有 DeepSeek 连接，网页搜索不可用。</p>
      ) : null}
    </section>
  );
}
