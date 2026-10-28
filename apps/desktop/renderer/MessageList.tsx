import type { DesktopState } from "../shared.ts";
import { RichMessage } from "./RichMessage.tsx";
import { noticeLabel, toolStateLabel } from "./view-state.ts";

export function MessageList({
  messages,
  historyTruncated,
  streamText,
  running,
}: {
  messages: DesktopState["messages"];
  historyTruncated: boolean;
  streamText: string;
  running: boolean;
}) {
  return (
    <>
      {historyTruncated ? <p className="outcome">较早的记录未在本页显示；原会话仍保留。</p> : null}
      {messages.map((message) =>
        message.role === "tool" ? (
          <details className="tool-message" key={message.id}>
            <summary>
              {message.tool ?? "工具活动"} · {toolStateLabel(message.state)}
            </summary>
            <pre>{message.text || "没有文本结果。"}</pre>
          </details>
        ) : (
          <article className={`message ${message.role}`} key={message.id}>
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
        ),
      )}
      {streamText ? (
        <article className="message assistant">
          <p className="message-label">moyyi{running ? " · 正在回答" : " · 部分回答"}</p>
          <p className="message-text">{streamText}</p>
        </article>
      ) : null}
    </>
  );
}
