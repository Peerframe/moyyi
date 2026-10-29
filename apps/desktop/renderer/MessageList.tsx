import type { DesktopState } from "../shared.ts";
import { ConversationNode } from "./slots.ts";

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
      {messages.map((message) => (
        <ConversationNode key={message.id} message={message} />
      ))}
      {streamText ? (
        <article className="message assistant">
          <p className="message-label">moyyi{running ? " · 正在回答" : " · 部分回答"}</p>
          <p className="message-text">{streamText}</p>
        </article>
      ) : null}
    </>
  );
}
