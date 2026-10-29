// Organization controls adapted from OpenBot sidebar-organization.ts / SidebarItemMenu.tsx
// at 010439bb9002fabb7e1facd8450ee85edbafa309. MIT; see OPENBOT-LICENSE.txt.
import { useState } from "react";
import { workspaceName } from "../../../renderer/view-state.ts";
import type { DesktopSessionQuery, DesktopSessionUpdate, DesktopState } from "../../../shared.ts";

export function SessionSidebar({
  state,
  busy,
  newSession,
  askEachRead,
  onAskEachRead,
  onNew,
  onLoad,
  onList,
  onQuery,
  onUpdate,
}: {
  state: DesktopState;
  busy: boolean;
  newSession: boolean;
  askEachRead: boolean;
  onAskEachRead(value: boolean): void;
  onNew(): void;
  onLoad(sessionId: string): void;
  onList(offset: number): void;
  onQuery?(query: DesktopSessionQuery): void;
  onUpdate?(change: DesktopSessionUpdate): void;
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [removed, setRemoved] = useState(false);
  const query = {
    search,
    ...(group ? { group } : {}),
    removed: removed ? ("removed" as const) : ("active" as const),
  };
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
          onClick={() => (onQuery ? onQuery(query) : onList(state.sessions.offset))}
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
      {onQuery ? (
        <form
          className="session-filter"
          onSubmit={(event) => {
            event.preventDefault();
            onQuery(query);
          }}
        >
          <input
            aria-label="搜索会话名称"
            placeholder="搜索名称或标题摘录"
            maxLength={160}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            aria-label="筛选分组"
            placeholder="分组（可选）"
            maxLength={80}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
          <label>
            <input
              type="checkbox"
              checked={removed}
              onChange={(e) => {
                setRemoved(e.target.checked);
                onQuery({ ...query, removed: e.target.checked ? "removed" : "active" });
              }}
            />
            会话回收站
          </label>
          <button disabled={busy} type="submit">
            查找会话
          </button>
        </form>
      ) : null}
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
              <strong>
                {session.metadata?.pinned ? "置顶 · " : ""}
                {session.metadata?.title ||
                  session.promptPreview ||
                  workspaceName(session.workspaceRoot)}
              </strong>
              <small>
                {workspaceName(session.workspaceRoot)}
                {session.lastActivityAt ? ` · ${dateLabel(session.lastActivityAt)}` : ""}
              </small>
            </button>
            {session.metadata && onUpdate ? (
              <details className="session-organize">
                <summary>
                  整理会话{session.metadata.group ? ` · ${session.metadata.group}` : ""}
                  {session.metadata.muted ? " · 静音" : ""}
                </summary>
                <form
                  key={session.metadata.revision}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    onUpdate({
                      sessionId: session.sessionId,
                      expectedRevision: session.metadata?.revision ?? 0,
                      patch: {
                        title: String(data.get("title") || "") || null,
                        group: String(data.get("group") || "") || null,
                      },
                    });
                  }}
                >
                  <input
                    name="title"
                    aria-label="会话名称"
                    maxLength={160}
                    defaultValue={session.metadata.title ?? ""}
                    placeholder="会话名称"
                  />
                  <input
                    name="group"
                    aria-label="会话分组"
                    maxLength={80}
                    defaultValue={session.metadata.group ?? ""}
                    placeholder="分组"
                  />
                  <button disabled={busy} type="submit">
                    保存名称与分组
                  </button>
                </form>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    onUpdate({
                      sessionId: session.sessionId,
                      expectedRevision: session.metadata?.revision ?? 0,
                      patch: { pinned: !session.metadata?.pinned },
                    })
                  }
                >
                  {session.metadata.pinned ? "取消置顶" : "置顶"}
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    onUpdate({
                      sessionId: session.sessionId,
                      expectedRevision: session.metadata?.revision ?? 0,
                      patch: { muted: !session.metadata?.muted },
                    })
                  }
                >
                  {session.metadata.muted ? "开启完成提醒" : "静音完成提醒"}
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    onUpdate({
                      sessionId: session.sessionId,
                      expectedRevision: session.metadata?.revision ?? 0,
                      patch: { removed: !session.metadata?.removedAt },
                    })
                  }
                >
                  {session.metadata.removedAt ? "恢复会话" : "移入回收站"}
                </button>
                <p>回收仅从列表隐藏，记录与材料引用保留。静音只关闭应用内完成提醒。</p>
              </details>
            ) : null}
          </li>
        ))}
        {state.sessions.items.length === 0 ? (
          <li className="sidebar-empty">还没有会话。选择工作目录，开始第一次提问。</li>
        ) : null}
      </ul>
      {state.catalog && onQuery ? (
        <div className="session-pagination">
          <button disabled={busy} type="button" onClick={() => onQuery(query)}>
            回到首屏
          </button>
          <button
            disabled={busy || !state.catalog.nextCursor}
            type="button"
            onClick={() =>
              onQuery({
                ...query,
                ...(state.catalog?.nextCursor ? { cursor: state.catalog.nextCursor } : {}),
              })
            }
          >
            下一页会话
          </button>
        </div>
      ) : state.sessions.offset > 0 || state.sessions.hasMore ? (
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
