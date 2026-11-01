import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMockPort } from "../mock/port.ts";
import { firstRunWorld, xiaowenWorld } from "../mock/world.ts";
import type { ChatWorld } from "../port.ts";
import { App } from "./App.tsx";
import { folderBadge, inFolder } from "./ChatList.tsx";
import { openDecisions, runs } from "./Conversation.tsx";

function render(world: ChatWorld, chat?: string, theme: "dark" | "light" = "dark") {
  const port = createMockPort(world, { schedule: () => undefined });
  return renderToString(
    createElement(App, { port, theme, sticker: "sticker.png", initialChat: chat }),
  );
}

/** Text content only, so assertions read like what the person sees. */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "");

describe("moyyi Chat interface", () => {
  it("renders the S7 moment: list, the open project, the pinned bar and the decision", () => {
    const html = render(xiaowenWorld(), "lunwen");
    const seen = text(html);
    for (const words of [
      "全部",
      "等我的",
      "待对账",
      "等你决定：参考文献用哪种格式",
      "9101",
      "4 位 AI · 1 位在做 · 等你决定 1 件",
      "等你 · 第 1/2 件 · 改论文格式",
      "等你决定：参考文献用哪种格式 · 写作停在第 3 章 7/12",
      "参考文献用 GB/T 7714 还是 APA？学校模板没写。",
      "用 GB/T 7714",
      "↩ 2 条回复",
    ])
      expect(seen).toContain(words);
    expect(html).toContain('placeholder="发给负责人 moyyi，或 @ 一位 AI"');
    expect(html).toContain('class="mc mc-dark mc-window ch-app"');
    expect(html).toContain("mc-badge mc-badge-quiet num");
  });

  it("renders every chat of the day and the light theme without losing a message", () => {
    const world = xiaowenWorld();
    for (const chat of world.chats) {
      const html = render(world, chat.id, "light");
      expect(html).toContain("mc-light");
      for (const message of world.messages[chat.id] ?? [])
        if (message.kind === "text" || message.kind === "out")
          expect(text(html)).toContain(message.text);
    }
  });

  it("opens on first run with only moyyi and 记忆 (S12)", () => {
    const html = text(render(firstRunWorld()));
    expect(html).toContain("项目和 AI 会在你交代第一件事之后出现");
    expect(html).toContain("你好，我是 moyyi。");
    expect(html).toContain("每天早上告诉我要做什么");
    expect(html).not.toContain("毕业论文");
  });

  it("shows the empty conversation and the loading list (S6)", () => {
    expect(text(render(xiaowenWorld()))).toContain("选一个对话开始");
    const loading = render({ ...xiaowenWorld(), connection: { state: "loading" }, chats: [] });
    expect(loading).toContain("正在加载");
  });

  it("counts folders by the row rule: decisions first, then chats with unread", () => {
    const { chats } = xiaowenWorld();
    expect(folderBadge(chats, "all")).toEqual({ kind: "decide", count: 3 });
    expect(folderBadge(chats, "ledger")).toEqual({ kind: "quiet", count: 4 });
    expect(
      folderBadge(
        chats.filter((c) => !c.decisions),
        "all",
      ),
    ).toEqual({ kind: "unread", count: 1 });
    expect(chats.filter((c) => inFolder(c, "mine")).map((c) => c.id)).toEqual(["lunwen", "moyyi"]);
    expect(chats.some((c) => c.archived && inFolder(c, "all"))).toBe(false);
  });

  it("groups bubbles into runs and finds open decisions", () => {
    const messages = xiaowenWorld().messages.lunwen ?? [];
    const grouped = runs(messages);
    expect(grouped[0]).toEqual({ first: true });
    const decide = messages.findIndex((m) => m.id === "l-decide");
    expect(grouped[decide]).toEqual({ first: true });
    expect(openDecisions(messages).map((m) => m.id)).toEqual(["l-decide"]);
  });
});
