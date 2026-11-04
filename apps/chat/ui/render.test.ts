import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMockPort } from "../mock/port.ts";
import { firstRunWorld, xiaowenWorld } from "../mock/world.ts";
import type { ChatWorld } from "../port.ts";
import { App } from "./App.tsx";
import { openDecisions, runs } from "./Conversation.tsx";
import { folderBadge, inFolder } from "./Rail.tsx";

function render(world: ChatWorld, chat?: string, theme: "dark" | "light" = "dark") {
  const port = createMockPort(world, { schedule: () => undefined });
  return renderToString(
    createElement(App, { port, theme, sticker: "sticker.png", initialChat: chat }),
  );
}

function renderPage(world: ChatWorld, page: string, theme: "dark" | "light" = "dark") {
  const port = createMockPort(world, { schedule: () => undefined });
  return renderToString(
    createElement(App, { port, theme, sticker: "sticker.png", initialPage: page }),
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
      "在做",
      "插件",
      "设置",
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

  it("puts first-task suggestions in the composer and keeps answers short (S12)", () => {
    const html = render(firstRunWorld());
    const composer = html.slice(html.indexOf("ch-compose-suggest"));
    expect(text(composer)).toContain(
      "可以这样开头把论文格式按模板改了对一下租房合同每天早上告诉我要做什么",
    );
    expect(html).not.toMatch(/class="mc-key"[^>]*>把论文格式按模板改了/);
    const seen = text(html);
    expect(seen).toContain("你选了 DeepSeek");
    expect(seen).toContain("已连上 DeepSeek Flash · 密钥存进了钥匙串");
    expect(seen).toContain("能看 2 个文件夹 · 只看不改");
    expect(html).toContain('placeholder="说一件想做的事"');
  });

  it("opens 设置 in place of the chat list, first section by default (S23)", () => {
    const html = renderPage(xiaowenWorld(), "settings");
    const seen = text(html);
    for (const name of [
      "模型和密钥",
      "关于我",
      "权限和确认",
      "后台和定时",
      "预算",
      "记录和数据",
      "通用",
      "关于 moyyi",
    ])
      expect(seen).toContain(name);
    expect(seen).toContain("AI 用哪些模型，密钥放在哪");
    expect(seen).toContain("这里只放管全部 AI 的事。");
    expect(html).not.toContain('aria-label="对话列表"');
    expect(html).toContain('type="password"');
    expect(html).toMatch(
      /<button[^>]*aria-current="true"[^>]*title="设置 ⌘,"|title="设置 ⌘,"[^>]*aria-current="true"/,
    );
  });

  it("shows guarantees as locked lines, never as switches (S25)", () => {
    const html = renderPage(xiaowenWorld(), "settings/permissions", "light");
    const seen = text(html);
    expect(seen).toContain("~/论文");
    expect(seen).toContain("动没给过的文件夹之前，先问你");
    expect(seen).toContain("这些是 moyyi 的保证，设置里关不掉。");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("ch-lock");
  });

  it("opens a plugin with what it can do and its own options (S31)", () => {
    const html = renderPage(xiaowenWorld(), "plugins/shell", "light");
    const seen = text(html);
    for (const words of [
      "插件",
      "内置 · 5 个",
      "命令行",
      "内置插件 · 让 AI 在这台电脑上跑命令",
      "在用",
      "停用",
      "一条命令最多跑",
      "5 分钟",
    ])
      expect(seen).toContain(words);
    expect(seen).toContain("预览版只有这些内置插件。");
  });

  it("no longer scores AIs in their info panel", () => {
    const sections = xiaowenWorld().info.hecha?.sections.map((s) => s.title) ?? [];
    expect(sections).not.toContain("本周表现");
    for (const chat of xiaowenWorld().chats) expect(chat.placeholder).not.toContain("表现");
  });

  it("shows the empty conversation and the loading list (S6)", () => {
    expect(text(render(xiaowenWorld()))).toContain("选一个对话开始");
    const loading = render({ ...xiaowenWorld(), connection: { state: "loading" }, chats: [] });
    expect(loading).toContain("正在加载");
  });

  it("counts folders by the row rule: decisions first, then chats with unread", () => {
    const world = xiaowenWorld();
    const { chats } = world;
    expect(folderBadge(world, "all")).toEqual({ kind: "decide", count: 3 });
    expect(folderBadge(world, "running")).toEqual({ kind: "quiet", count: world.jobs.length });
    expect(folderBadge({ ...world, chats: chats.filter((c) => !c.decisions) }, "all")).toEqual({
      kind: "unread",
      count: 1,
    });
    expect(chats.filter((c) => inFolder(world, c, "mine")).map((c) => c.id)).toEqual([
      "lunwen",
      "moyyi",
    ]);
    expect(chats.some((c) => c.archived && inFolder(world, c, "all"))).toBe(false);
    // 在做: chats with a running job, and AIs that are working.
    const running = chats.filter((c) => inFolder(world, c, "running")).map((c) => c.id);
    for (const job of world.jobs) expect(running).toContain(job.chatId);
    expect(folderBadge({ ...world, jobs: [] }, "running")).toBeNull();
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
