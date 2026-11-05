// Plain-text views of messages, shared by the interface (search, copy, runs) and the mock backend.
import type { Message } from "./port.ts";

/** Who a message belongs to, for grouping bubbles into runs; null breaks a run. */
export function author(message: Message): string | null {
  switch (message.kind) {
    case "service":
    case "unread-divider":
      return null;
    case "out":
    case "voice":
      return message.kind === "out" && message.retracted ? null : "me";
    case "file":
      return message.mine ? "me" : (message.from ?? null);
    default:
      return message.from;
  }
}

/** Plain text of a message: what search matches and what 复制 copies. */
export function textOf(message: Message): string {
  switch (message.kind) {
    case "unread-divider":
      return "";
    case "service":
      return message.detail === undefined ? message.text : `${message.text}\n${message.detail}`;
    case "out":
    case "text":
    case "decision":
    case "options":
    case "link":
      return message.text;
    case "status":
      return [message.job, ...message.steps.map((step) => step.text)].join("\n");
    case "plan":
      return [message.title, message.reads, message.changes, message.not].join("\n");
    case "change":
      return `${message.file}\n${message.summary}`;
    case "result":
      return [
        message.job,
        ...message.files.map((file) => `${file.name} ${file.count}`),
        ...(message.claims ?? []).map((claim) => claim.text),
      ].join("\n");
    case "file":
      return message.name;
    case "voice":
      return message.transcript;
    case "sticker":
      return `[贴纸：${message.moment}]`;
  }
}
