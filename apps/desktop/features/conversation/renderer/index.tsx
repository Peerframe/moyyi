import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import { appendReviewDraft } from "../../../renderer/effects-state.ts";
import { MessageList } from "../../../renderer/MessageList.tsx";
import { RichMessage } from "../../../renderer/RichMessage.tsx";
import type { RendererFeature } from "../../../renderer/slot-types.ts";
import type { RendererBase, RendererUI } from "../../../renderer/ui.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";
import { noticeLabel, outcomeLabel, toolStateLabel } from "../../../renderer/view-state.ts";
import type { DesktopMessage } from "../../../shared.ts";

function useController(base: RendererBase, getUI: () => RendererUI) {
  const [draft, setDraft] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const lastMessage = base.state?.messages.at(-1);
  const scrollMarker = `${lastMessage?.id ?? ""}:${lastMessage?.text.length ?? 0}:${base.state?.streamText.length ?? 0}:${base.state?.pendingApproval?.digest ?? ""}`;
  useEffect(() => {
    if (!scrollMarker || !followOutput.current || !scrollArea.current) return;
    scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [scrollMarker]);
  async function send() {
    const {
      state,
      bridge,
      perform,
      settingsOpen,
      helpOpen,
      maintenanceOpen,
      permissionsOpen,
      webAccessOpen,
      newSession,
    } = getUI();
    if (
      !state?.activeSessionId ||
      state.run ||
      !state.connection.ready ||
      settingsOpen ||
      helpOpen ||
      maintenanceOpen ||
      permissionsOpen ||
      webAccessOpen ||
      newSession ||
      !draft.trim()
    )
      return;
    const text = draft;
    const result = await perform(() =>
      bridge.act({ type: "start", sessionId: state.activeSessionId as string, text }),
    );
    if (result) {
      setDraft((current) => (current === text ? "" : current));
      followOutput.current = true;
    }
  }
  function prepareDraft(text: string) {
    const { state, pending, setViewError } = getUI();
    if (!state?.activeSessionId || state.run || pending || state.status !== "ready") return;
    const next = appendReviewDraft(draft, text);
    if (next.length > 16_000) {
      setViewError("当前草稿太长，请先整理内容后再准备新的请求。");
      return;
    }
    setDraft(next);
    setViewError(null);
    composer.current?.focus();
  }
  return { draft, setDraft, composer, scrollArea, followOutput, send, prepareDraft };
}

function EmptyConversation() {
  const { state } = useDesktopUI();

  return (
    <>
      {state.messages.length === 0 && !state.run ? (
        <section className="empty-state">
          <h2>想了解这个目录里的什么？</h2>
          <p>说明要分析的问题，moyyi 会在本轮预算内读取文件并回答。</p>
        </section>
      ) : null}
    </>
  );
}
function Messages() {
  const { state } = useDesktopUI();

  return (
    <>
      {!state.history ? (
        <MessageList
          messages={state.messages}
          historyTruncated={state.historyTruncated}
          streamText={state.streamText}
          running={state.run !== null}
        />
      ) : null}
    </>
  );
}
function Outcome() {
  const { state } = useDesktopUI();
  const activeMetadata =
    state.activeMetadata ??
    state.sessions.items.find((s) => s.sessionId === state.activeSessionId)?.metadata;
  return (
    <>
      {state.outcome && !state.run ? (
        <p
          className="outcome"
          role={activeMetadata?.muted ? undefined : "status"}
          aria-live={activeMetadata?.muted ? "off" : "polite"}
        >
          {outcomeLabel(state.outcome)}
        </p>
      ) : null}
    </>
  );
}
function Composer() {
  const { state, pending, act, draft, setDraft, composer, send, configuring, canSend } =
    useDesktopUI();
  const runStatus =
    state.run?.state === "cancelling"
      ? "正在停止…"
      : state.pendingApproval
        ? "等待你的批准"
        : state.run
          ? "正在处理…"
          : "";
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <div className="compose-column">
        <div className="composer-box">
          <textarea
            ref={composer}
            aria-label="任务内容"
            placeholder={configuring ? "先选择工作目录" : "描述你想分析的问题…"}
            value={draft}
            disabled={configuring || state.status !== "ready"}
            maxLength={16000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (canSend) void send();
              }
            }}
          />
          <div className="composer-actions">
            <span className="composer-hint" role="status">
              {runStatus || "⌘ Enter 发送 · Enter 换行"}
            </span>
            {state.run ? (
              <button
                type="button"
                className="danger"
                disabled={pending || state.run.state === "cancelling"}
                onClick={() => state.run && act({ type: "cancel", runId: state.run.id })}
              >
                {state.run.state === "cancelling" ? "正在停止…" : "停止"}
              </button>
            ) : (
              <button className="primary" type="submit" disabled={!canSend}>
                {pending ? "正在处理…" : "发送"}
              </button>
            )}
          </div>
        </div>
        <p className="composer-footer">
          回答需结合来源核对；停止保留记录，也不会撤销已经完成的修改。
        </p>
      </div>
    </form>
  );
}
function DefaultMessage({ message }: { message: DesktopMessage }) {
  return message.role === "tool" ? (
    <details className="tool-message">
      <summary>
        {message.tool ?? "工具活动"} · {toolStateLabel(message.state)}
      </summary>
      <pre>{message.text || "没有文本结果。"}</pre>
    </details>
  ) : (
    <article className={`message ${message.role}`}>
      <p className="message-label">
        {message.role === "user" ? "你" : message.role === "assistant" ? "moyyi" : "会话记录"}
      </p>
      <div className="message-text">
        {message.role === "assistant" ? (
          <RichMessage content={message.text} />
        ) : message.role === "notice" ? (
          noticeLabel(message.text)
        ) : (
          message.text
        )}
      </div>
    </article>
  );
}
declare module "../../../renderer/ui.ts" {
  interface FeatureUI {
    draft: string;
    setDraft: Dispatch<SetStateAction<string>>;
    composer: RefObject<HTMLTextAreaElement | null>;
    scrollArea: RefObject<HTMLDivElement | null>;
    followOutput: RefObject<boolean>;
    send(): Promise<void>;
    prepareDraft(text: string): void;
  }
}

export const rendererFeature: RendererFeature = {
  id: "conversation",
  useController,
  slots: [
    {
      id: "conversation.EmptyConversation",
      slot: "before-messages",
      order: 20,
      Component: EmptyConversation,
    },
    { id: "conversation.Messages", slot: "messages", order: 0, Component: Messages },
    { id: "conversation.Outcome", slot: "after-messages", order: 20, Component: Outcome },
    { id: "conversation.Composer", slot: "composer", order: 0, Component: Composer },
  ],
  messages: ["user", "assistant", "tool", "notice"].map((role) => ({
    id: `conversation.${role}`,
    role: role as DesktopMessage["role"],
    Component: DefaultMessage,
  })),
};
