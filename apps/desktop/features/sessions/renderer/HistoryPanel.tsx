import { useState } from "react";
import { MessageList } from "../../../renderer/MessageList.tsx";
import type { DesktopState } from "../../../shared.ts";

export function HistoryPanel({
  state,
  busy,
  onPage,
  onMessage,
  onClose,
}: {
  state: DesktopState;
  busy: boolean;
  onPage(cursor?: string): void;
  onMessage(messageId: string, offset: number): void;
  onClose(): void;
}) {
  const [pages, setPages] = useState<(string | undefined)[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const history = state.history;
  return (
    <section aria-label="完整会话历史" className="history-panel">
      <div className="history-controls">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPages([]);
            setSelected(null);
            onPage();
          }}
        >
          查看完整历史
        </button>
        {history ? (
          <button type="button" disabled={busy || state.historyOnly} onClick={onClose}>
            返回当前对话
          </button>
        ) : null}
      </div>
      {history ? (
        <>
          <p className="panel-note">
            只读记录，按时间排列。翻页不会运行任务或恢复权限；长消息可以逐段查看。
          </p>
          <div className="history-controls">
            <button
              type="button"
              disabled={busy || !history.nextCursor}
              onClick={() => {
                setPages((current) => [...current, history.nextCursor ?? undefined]);
                setSelected(null);
                onPage(history.nextCursor ?? undefined);
              }}
            >
              更早记录
            </button>
            <button
              type="button"
              disabled={busy || pages.length === 0}
              onClick={() => {
                const next = pages.slice(0, -1);
                setPages(next);
                setSelected(null);
                onPage(next.at(-1));
              }}
            >
              较新记录
            </button>
            <span className="panel-note">
              第 {pages.length + 1} 页 · {history.items.length} 条显示记录
            </span>
          </div>
          {history.items.map((message) => (
            <div key={message.id}>
              <MessageList
                messages={[message]}
                historyTruncated={false}
                streamText=""
                running={false}
              />
              {message.truncated ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(message.id);
                    onMessage(message.id, 0);
                  }}
                >
                  逐段查看完整消息（{message.textLength} 字符）
                </button>
              ) : null}
              {selected === message.id && state.messageDetail?.messageId === message.id ? (
                <section aria-label="完整消息分段">
                  <pre>{state.messageDetail.text}</pre>
                  <button
                    type="button"
                    disabled={busy || state.messageDetail.nextOffset === null}
                    onClick={() => onMessage(message.id, state.messageDetail?.nextOffset ?? 0)}
                  >
                    下一段正文
                  </button>
                  <button type="button" disabled={busy} onClick={() => onMessage(message.id, 0)}>
                    回到首段
                  </button>
                  {state.messageDetail.nextOffset === null ? <p>已到消息末尾。</p> : null}
                </section>
              ) : null}
            </div>
          ))}
          {!history.items.length ? <p className="panel-note">这个会话尚无记录。</p> : null}
        </>
      ) : null}
    </section>
  );
}
