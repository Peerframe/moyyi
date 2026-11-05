// 成果 on the mock backend: one entry per result message, so the list always says what the chats
// say. The runtime will record results itself; this only reads the sample world.
import type { ChatWorld, Message, ResultItem } from "../port.ts";

type ResultMessage = Extract<Message, { kind: "result" }>;

const CLOCK = /^\d{1,2}:\d{2}$/;

/** Newer days first: today, yesterday, weekdays, then dates. */
function dayRank(day: string): number {
  if (day === "今天") return 0;
  if (day === "昨天") return 1;
  if (day.startsWith("周")) return 2;
  return 3;
}

function entries(chatId: string, messages: readonly Message[]): ResultItem[] {
  let day = "今天";
  const found: ResultItem[] = [];
  for (const message of messages) {
    if (message.kind === "service" && message.day) day = message.text;
    if (message.kind !== "result") continue;
    const result: ResultMessage = message;
    const time = result.time ?? "";
    const clock = CLOCK.test(time);
    found.push({
      id: `result:${result.id}`,
      chatId,
      messageId: result.id,
      title: result.job,
      by: result.from,
      day: clock ? day : time || day,
      time: clock ? time : "",
      files: result.files.map((file) => ({ name: file.name, note: file.count })),
      check: result.check,
      ...(result.claims ? { claims: result.claims } : {}),
      ...(result.skipped ? { skipped: result.skipped } : {}),
      ...(result.undo ? { undo: result.undo } : {}),
    });
  }
  return found;
}

export function resultsOf(world: Pick<ChatWorld, "chats" | "messages">): readonly ResultItem[] {
  return world.chats
    .flatMap((chat) => entries(chat.id, world.messages[chat.id] ?? []))
    .sort((a, b) => dayRank(a.day) - dayRank(b.day) || b.time.localeCompare(a.time));
}
