import { useEffect, useRef, useState } from "react";
import type { DesktopWebAccess } from "../shared.ts";
import { createActionGate } from "./view-state.ts";

export function WebAccessDialog({
  workspace,
  webAccess,
  onConfigure,
  onClose,
}: {
  workspace: string;
  webAccess: DesktopWebAccess;
  onConfigure(options: DesktopWebAccess): Promise<DesktopWebAccess>;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const gate = useRef(createActionGate());
  const mounted = useRef(true);
  const [origins, setOrigins] = useState(webAccess.allowedOrigins.join("\n"));
  const [dns, setDns] = useState(webAccess.dns);
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
  async function save(clear = false) {
    if (!gate.current.begin()) return;
    setPending(true);
    setError(null);
    setNotice(null);
    const requested: DesktopWebAccess = {
      allowedOrigins: clear
        ? []
        : origins
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
      dns: clear ? "system" : dns,
    };
    try {
      const actual = await onConfigure(requested);
      if (!mounted.current) return;
      setOrigins(actual.allowedOrigins.join("\n"));
      setDns(actual.dns);
      setNotice(
        actual.dns === requested.dns &&
          JSON.stringify(actual.allowedOrigins) === JSON.stringify(requested.allowedOrigins)
          ? "当前网页访问设置已确认；尚未读取网页或调用模型。"
          : "本次选择未应用；系统确认可能已取消。下方显示当前授权。",
      );
    } catch {
      if (mounted.current)
        setError(
          "未能应用网页访问设置。请填写最多 8 个不重复的公开 HTTPS 来源，不含路径、端口、查询参数或登录信息，并核对当前会话状态。",
        );
    } finally {
      gate.current.end();
      if (mounted.current) setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="web-access-title"
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
          <h2 id="web-access-title">网页访问</h2>
          <button type="button" disabled={pending} onClick={close}>
            关闭
          </button>
        </header>
        <p className="preview-path">工作目录：{workspace}</p>
        <p className="panel-note">
          默认关闭。仅允许指定来源的公开网页，每次 GET
          仍需逐次批准。与报告位置、文件修改及命令检查权限独立。
        </p>
        <fieldset className="web-options" disabled={pending}>
          <label htmlFor="web-origins">允许的 HTTPS 来源（每行一个，最多 8 个）</label>
          <textarea
            id="web-origins"
            rows={4}
            maxLength={32776}
            spellCheck={false}
            placeholder="https://example.com"
            value={origins}
            onChange={(event) => {
              setOrigins(event.target.value);
              setNotice(null);
            }}
          />
          <p className="panel-note">
            填写确切来源，如
            https://example.com；不含页面路径、端口、通配符或查询参数。子域名需单独列出。留空表示关闭。
          </p>
          <label htmlFor="web-dns">主机名解析</label>
          <select
            id="web-dns"
            value={dns}
            onChange={(event) => {
              setDns(event.target.value as DesktopWebAccess["dns"]);
              setNotice(null);
            }}
          >
            <option value="system">系统 DNS</option>
            <option value="cloudflare-doh">Cloudflare DoH</option>
          </select>
          <p className="panel-note">
            系统 DNS 使用本机配置的解析服务。选择 Cloudflare DoH 会将网页主机名发送给
            Cloudflare，不向其发送页面路径或查询参数；目标网站仍会收到路径和查询参数。
          </p>
        </fieldset>
        <p className="panel-note">
          应用后，在任务中提供完整网页 URL
          和问题。返回正文会发送给所选模型服务。来源面板展示实际记录，仍需人工核对；不执行网页脚本、不登录、不跟随跳转。
        </p>
        <p className="panel-note">
          运行中需先停止并等待收尾。重新打开会话或修改模型设置后关闭；历史来源只读展示，不重新联网。
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
          <button type="button" disabled={pending} onClick={() => void save(true)}>
            关闭网页访问
          </button>
          <button type="submit" className="primary" disabled={pending}>
            {pending ? "正在确认…" : "确认网页访问"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
