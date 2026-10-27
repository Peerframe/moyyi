import type { DesktopState } from "../shared.ts";
import { workspaceName } from "./view-state.ts";

export function SessionSidebar({
  state,
  busy,
  newSession,
  askEachRead,
  onAskEachRead,
  onNew,
  onLoad,
  onList,
}: {
  state: DesktopState;
  busy: boolean;
  newSession: boolean;
  askEachRead: boolean;
  onAskEachRead(value: boolean): void;
  onNew(): void;
  onLoad(sessionId: string): void;
  onList(offset: number): void;
}) {
  return (
    <aside className="sidebar" aria-label="会话">
      <div className="brand">moyyi</div>
      <button className="new-session" type="button" disabled={busy} onClick={onNew}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        新会话
      </button>
      <div className="sidebar-heading">
        <span>最近会话</span>
        <button
          className="icon-button quiet"
          type="button"
          aria-label="刷新会话列表"
          title="刷新会话列表"
          disabled={busy}
          onClick={() => onList(state.sessions.offset)}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13 6a5 5 0 1 0 .2 3M13 2v4H9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <ul className="session-list">
        {state.sessions.items.map((session) => (
          <li key={session.sessionId}>
            <button
              className="session-item"
              type="button"
              disabled={busy}
              aria-current={
                !newSession && state.activeSessionId === session.sessionId ? "true" : undefined
              }
              title={session.workspaceRoot}
              onClick={() => onLoad(session.sessionId)}
            >
              <strong>{session.promptPreview || workspaceName(session.workspaceRoot)}</strong>
              <small>
                {workspaceName(session.workspaceRoot)}
                {session.lastActivityAt ? ` · ${dateLabel(session.lastActivityAt)}` : ""}
              </small>
            </button>
          </li>
        ))}
        {state.sessions.items.length === 0 ? (
          <li className="sidebar-empty">还没有会话。选择工作目录，开始第一次提问。</li>
        ) : null}
      </ul>
      {state.sessions.offset > 0 || state.sessions.hasMore ? (
        <div className="session-pagination">
          <button
            type="button"
            disabled={busy || state.sessions.offset === 0}
            onClick={() => onList(Math.max(0, state.sessions.offset - 20))}
          >
            上一页
          </button>
          <button
            type="button"
            disabled={busy || !state.sessions.hasMore}
            onClick={() => onList(state.sessions.offset + state.sessions.items.length)}
          >
            下一页
          </button>
        </div>
      ) : null}
      <div className="sidebar-foot">
        <label className="read-confirmation">
          <input
            type="checkbox"
            checked={askEachRead}
            disabled={busy}
            onChange={(event) => onAskEachRead(event.target.checked)}
          />
          <span>逐次批准工具读取</span>
        </label>
        <div>新建或恢复会话时生效</div>
        <div>会话记录保存在本机</div>
      </div>
    </aside>
  );
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}
