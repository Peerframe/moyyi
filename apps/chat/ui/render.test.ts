import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMockPort } from "../mock/port.ts";
import { firstRunWorld, xiaowenWorld } from "../mock/world.ts";
import type { ChatWorld } from "../port.ts";
import { App } from "./App.tsx";
import { openDecisions, runs } from "./Conversation.tsx";
import { folderBadge, inFolder, MORE, Rail } from "./Rail.tsx";

function render(world: ChatWorld, chat?: string, theme: "dark" | "light" = "dark") {
  const port = createMockPort(world, { schedule: () => undefined });
  return renderToString(createElement(App, { port, theme, initialChat: chat }));
}

function renderPage(world: ChatWorld, page: string, theme: "dark" | "light" = "dark") {
  const port = createMockPort(world, { schedule: () => undefined });
  return renderToString(createElement(App, { port, theme, initialPage: page }));
}

/** Text content only, so assertions read like what the person sees. */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "");

describe("moyyi Chat interface", () => {
  it("renders the S7 moment: list, the open project, the pinned bar and the decision", () => {
    const html = render(xiaowenWorld(), "lunwen");
    const seen = text(html);
    for (const words of [
      "全部",
      "项目",
      "自动化",
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
    expect(html).toContain("项目会在你交代第一件事之后出现");
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

  it("opens 设置 in place of the chat list, grouped like the boards, 通用 first (S23)", () => {
    const html = renderPage(xiaowenWorld(), "settings");
    const list = text(html.slice(html.indexOf('aria-label="设置"'), html.indexOf("ch-page-foot")));
    expect(list).toMatch(
      /通用.*快捷键.*AI模型.*个性化.*记忆.*后台.*预算.*数据与安全权限和确认.*记录和数据.*关于 moyyi/,
    );
    expect(html).toContain('class="ch-page-list-rule"');
    const seen = text(html);
    expect(seen).toContain("颜色、字号和通知。");
    expect(seen).toContain("这里只放管全部 AI 的事。");
    expect(html).not.toContain('aria-label="对话列表"');
    expect(html).toMatch(/title="⌘,"[^>]*aria-current="true"/);
  });

  it("draws 模型 as connection cards with a dashed card to add one (S23)", () => {
    const html = renderPage(xiaowenWorld(), "settings/models", "light");
    const seen = text(html);
    for (const words of [
      "DeepSeek · 主力",
      "默认",
      "DeepSeek · 备用",
      "添加模型连接",
      "网页搜索用",
      "额度用完的时候",
      "对话停在原处，不会自己换连接",
    ])
      expect(seen).toContain(words);
    expect(html).toContain('class="ch-group ch-group-bare"');
    expect(html).toContain('class="ch-add-card"');
    expect(html).toContain('aria-label="已连上"');
    expect(html).toContain('type="password"');
  });

  it("draws 记忆 with its switch, the 导入 action and where each memory came from", () => {
    const html = renderPage(xiaowenWorld(), "settings/memory");
    const seen = text(html);
    expect(seen).toContain("自动记忆");
    expect(seen).toContain("记的时候不打断你。");
    expect(seen).toContain("从「毕业论文」记下 · 10月30日");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(html).toMatch(/ch-group-head.*导入/);
    const budget = renderPage(xiaowenWorld(), "settings/budget");
    expect(budget).toMatch(/type="number"[^>]*min="1"[^>]*max="200"/);
    expect(text(budget)).toContain("子智能体帮忙查");
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
    expect(folderBadge(world, "project")).toEqual({ kind: "decide", count: 1 });
    expect(folderBadge({ ...world, chats: chats.filter((c) => !c.decisions) }, "all")).toEqual({
      kind: "unread",
      count: 1,
    });
    expect(chats.some((c) => c.archived && inFolder(c, "all"))).toBe(false);
    expect(chats.filter((c) => inFolder(c, "project")).every((c) => c.project)).toBe(true);
  });

  it("keeps the rail to places: 全部, 项目, 自动化, 插件, then 设置 (owner review)", () => {
    const html = render(xiaowenWorld(), "lunwen");
    const rail = html.slice(html.indexOf('aria-label="导航"'), html.indexOf("</nav>"));
    expect(text(rail)).not.toMatch(/等我的|在做|AI|成果|更多/);
    expect(text(rail)).toMatch(/全部.*项目.*自动化.*插件.*设置/);
    expect(rail.indexOf("插件")).toBeLessThan(rail.indexOf("ch-rail-bottom"));
    expect(rail.indexOf("ch-rail-bottom")).toBeLessThan(rail.indexOf("设置"));
  });

  it("keeps 更多 as a hidden slot under 插件 until something is put in it", () => {
    expect(MORE).toEqual([]);
    const world = xiaowenWorld();
    const rail = (more?: Parameters<typeof Rail>[0]["more"]) =>
      renderToString(createElement(Rail, { world, view: "all", onView: () => undefined, more }));
    expect(rail()).not.toContain("更多");
    const shown = rail([{ id: "settings", label: "设置", icon: "settings" }]);
    expect(text(shown)).toMatch(/自动化插件更多设置/);
    expect(shown).toContain('aria-haspopup="menu" aria-expanded="false"');
  });

  it("groups bubbles into runs and finds open decisions", () => {
    const messages = xiaowenWorld().messages.lunwen ?? [];
    const grouped = runs(messages);
    expect(grouped[0]).toEqual({ first: true });
    const decide = messages.findIndex((m) => m.id === "l-decide");
    expect(grouped[decide]).toEqual({ first: true });
    expect(openDecisions(messages).map((m) => m.id)).toEqual(["l-decide"]);
  });

  it("lists working folders under 项目, then one project's own chats (S33)", () => {
    const list = text(renderPage(xiaowenWorld(), "project"));
    for (const words of [
      "毕业论文",
      "~/论文 · 1 个对话",
      "租房",
      "~/租房",
      "读书会资料",
      "课程作业",
    ])
      expect(list).toContain(words);
    expect(list).not.toContain("核查");
    const inside = text(renderPage(xiaowenWorld(), "project/p-zuoye"));
    expect(inside).toContain("~/课程作业");
    // Archived chats stay listed inside their project.
    expect(inside).toContain("moyyi：交了，项目归档");
  });

  it("lists 自动化 and opens one with what, when and its last runs (S34)", () => {
    const seen = text(renderPage(xiaowenWorld(), "automations/brief"));
    for (const words of [
      "早报",
      "每天 8:00 · 在「moyyi」",
      "查论文格式",
      "已暂停 · 每周二 20:00 · 在「读书会资料」",
      "开着",
      "暂停",
      "做什么",
      "最近几次",
      "现在跑一次",
    ])
      expect(seen).toContain(words);
    expect(text(renderPage(firstRunWorld(), "automations"))).toContain("还没有自动化");
  });
});
