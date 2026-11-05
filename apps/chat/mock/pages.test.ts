import { describe, expect, it } from "vitest";
import type { ChatWorld, PageLine, PluginPage, SettingsPage } from "../port.ts";
import { chosen, switchedOn } from "./page-actions.ts";
import { createMockPort } from "./port.ts";
import { firstRunWorld, xiaowenWorld } from "./world.ts";

function setup(world: ChatWorld = xiaowenWorld()) {
  const port = createMockPort(world, { schedule: () => undefined, now: () => "21:50" });
  const page = (id: string) =>
    [...port.world().settings, ...port.world().plugins].find((p) => p.id === id);
  const lines = (id: string): readonly PageLine[] =>
    page(id)?.groups.flatMap((g) => g.blocks.flatMap((b) => (b.kind === "lines" ? b.lines : []))) ??
    [];
  return { port, page, lines };
}

const providers = (page: (id: string) => SettingsPage | PluginPage | undefined) =>
  page("models")
    ?.groups.flatMap((g) => g.blocks)
    .flatMap((b) => (b.kind === "providers" ? b.providers : [])) ?? [];

describe("设置, 自动化 and 插件 on the mock backend", () => {
  it("holds ten sections under their headings, three automations and five plugins", () => {
    const { settings, plugins, automations } = xiaowenWorld();
    expect(settings.map((p) => `${p.section ?? "-"} ${p.name}`)).toEqual([
      "- 通用",
      "- 快捷键",
      "AI 模型",
      "AI 个性化",
      "AI 记忆",
      "AI 后台",
      "AI 预算",
      "数据与安全 权限和确认",
      "数据与安全 记录和数据",
      " 关于 moyyi",
    ]);
    expect(plugins.map((p) => p.name)).toEqual(["文件", "命令行", "网页", "文档", "技能"]);
    expect(automations.map((p) => p.name)).toEqual(["早报", "查论文格式", "读书会摘录"]);
    // Every choice and control id is unique: the runtime keys actions by them.
    const ids = [...settings, ...automations, ...plugins].flatMap((page) => [
      ...("toggle" in page && (page as PluginPage).toggle ? [(page as PluginPage).toggle?.id] : []),
      ...page.groups.flatMap((g) => [
        ...(g.action ? [g.action.id] : []),
        ...g.blocks.flatMap((b) => {
          if (b.kind === "choice") return [b.choice.id];
          if (b.kind === "choices") return b.choices.map((c) => c.id);
          if (b.kind === "lines")
            return b.lines.flatMap((l) => (l.controls ?? []).map((c) => c.id));
          if (b.kind === "providers")
            return b.providers.flatMap((p) => [
              ...p.controls.map((c) => c.id),
              ...(p.keyField ? [p.keyField.save.id] : []),
            ]);
          if (b.kind === "switches") return b.switches.map((x) => x.id);
          if (b.kind === "numbers") return b.fields.map((x) => x.id);
          if (b.kind === "add") return [b.control.id];
          return [];
        }),
      ]),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("changes a choice and keeps the list row's summary true", async () => {
    const { port, page } = setup();
    await port.act({ type: "choose", choiceId: "general.theme", option: 1 });
    expect(chosen(port.world(), "general.theme")).toBe("浅色");
    expect(page("general")?.summary).toBe("浅色 · 字号 15 · 只提醒决定");
    await port.act({ type: "choose", choiceId: "budget.default", option: 2 });
    expect(page("budget")?.summary).toBe("新项目每次问你给多少");
    // An option that does not exist changes nothing.
    await port.act({ type: "choose", choiceId: "general.theme", option: 9 });
    expect(chosen(port.world(), "general.theme")).toBe("浅色");
  });

  it("revokes a folder here and says so in the chat it was given in", async () => {
    const { port, page, lines } = setup();
    await port.act({ type: "control", controlId: "folder.lunwen.revoke" });
    expect(lines("permissions").map((l) => l.id)).toEqual(["folder.zufang"]);
    expect(port.world().messages.lunwen?.at(-1)).toMatchObject({
      kind: "service",
      text: "你在设置里收回了 ~/论文：这个群的 AI 不能再看它",
    });
    expect(page("permissions")?.summary).toBe("给过 1 个文件夹 · 改动先问你");
  });

  it("drops the key once it is saved: only 已连上 reaches the world", async () => {
    const { port, page } = setup();
    const secret = "sk-test-not-a-real-key-0001";
    await port.act({ type: "save-key", providerId: "kimi", key: secret });
    expect(JSON.stringify(port.world())).not.toContain(secret);
    const kimi = page("models")
      ?.groups.flatMap((g) => g.blocks)
      .flatMap((b) => (b.kind === "providers" ? b.providers : []))
      .find((p) => p.id === "kimi");
    expect(kimi).toMatchObject({ connected: true, status: "密钥在系统钥匙串里" });
    expect(kimi?.keyField).toBeUndefined();
    expect(page("models")?.summary).toBe("3 个连接 · 新对话用 Flash");
    // An empty key connects nothing.
    await port.act({ type: "control", controlId: "models.add" });
    const added = providers(page).at(-1);
    expect(added).toMatchObject({ name: "DeepSeek · 新连接", connected: false });
    await port.act({ type: "save-key", providerId: added?.id ?? "", key: "  " });
    expect(page("models")?.summary).toBe("3 个连接 · 新对话用 Flash");
  });

  it("adds and removes model connections like cards (two keys for one maker)", async () => {
    const { port, page } = setup();
    expect(providers(page).map((p) => p.name)).toEqual([
      "DeepSeek · 主力",
      "DeepSeek · 备用",
      "Kimi",
    ]);
    await port.act({ type: "control", controlId: "deepseek-spare.remove" });
    await port.act({ type: "control", controlId: "deepseek-main.remove" });
    expect(providers(page).map((p) => p.name)).toEqual(["Kimi"]);
    expect(page("models")?.summary).toBe("还没连上模型 · 新对话用 Flash");
  });

  it("flips switches, keeps numbers in range and manages memories (记忆)", async () => {
    const { port, page, lines } = setup();
    expect(page("memory")?.summary).toBe("自动记忆开着 · 记下 2 条");
    await port.act({ type: "control", controlId: "memory.auto" });
    expect(switchedOn(port.world(), "memory.auto")).toBe(false);
    expect(page("memory")?.summary).toBe("自动记忆关着 · 记下 2 条");
    await port.act({ type: "control", controlId: "memory.cite.delete" });
    expect(lines("memory").map((l) => l.id)).toEqual(["memory.rent"]);
    expect(page("memory")?.summary).toBe("自动记忆关着 · 记下 1 条");

    await port.act({ type: "control", controlId: "long.subagents" });
    expect(switchedOn(port.world(), "long.subagents")).toBe(true);
    const requests = () =>
      page("budget")
        ?.groups.flatMap((g) => g.blocks)
        .flatMap((b) => (b.kind === "numbers" ? b.fields : []))
        .find((f) => f.id === "budget.requests")?.value;
    await port.act({ type: "set-number", fieldId: "budget.requests", value: 80 });
    expect(requests()).toBe(80);
    for (const value of [0, 201, 2.5])
      await port.act({ type: "set-number", fieldId: "budget.requests", value });
    expect(requests()).toBe(80);
  });

  it("switches skills and plugins", async () => {
    const { port, page, lines } = setup();
    await port.act({ type: "control", controlId: "skill.weekly.toggle" });
    expect(lines("skills").find((l) => l.id === "skill.weekly")).toMatchObject({
      tag: "开着",
      off: false,
    });
    expect(page("skills")?.summary).toBe("照你写好的做法做事 · 开着 3 个");

    await port.act({ type: "control", controlId: "shell.toggle" });
    expect(page("shell")).toMatchObject({
      enabled: false,
      toggle: { label: "启用", tone: "primary" },
      summary: "已停用 · 在这台电脑上跑命令 · 跑前问你",
    });
  });

  it("leaves the world alone for host-only controls", async () => {
    const { port } = setup();
    const before = port.world();
    await port.act({ type: "control", controlId: "records.export" });
    expect(port.world()).toBe(before);
  });

  it("drops first-task suggestions once the person has said something (S12)", async () => {
    const { port } = setup(firstRunWorld());
    expect(port.world().chats.find((c) => c.id === "moyyi")?.suggestions).toHaveLength(3);
    await port.act({ type: "send", chatId: "moyyi", text: "对一下租房合同" });
    expect(port.world().chats.find((c) => c.id === "moyyi")?.suggestions).toBeUndefined();
  });

  it("pauses, runs and deletes an automation in its own chat (S34)", () => {
    const port = createMockPort(xiaowenWorld(), { schedule: () => undefined, now: () => "21:50" });
    const brief = () => port.world().automations.find((a) => a.id === "brief");
    void port.act({ type: "control", controlId: "automation.brief.toggle" });
    expect(brief()).toMatchObject({ enabled: false, summary: "已暂停 · 每天 8:00 · 在「moyyi」" });
    expect(brief()?.toggle).toMatchObject({ label: "继续", tone: "primary" });
    void port.act({ type: "control", controlId: "automation.brief.toggle" });
    expect(brief()).toMatchObject({ enabled: true, summary: "每天 8:00 · 在「moyyi」" });
    void port.act({ type: "control", controlId: "automation.brief.run" });
    expect(port.world().messages.moyyi?.at(-1)).toMatchObject({
      kind: "service",
      text: "你让「早报」现在跑一次 · 计划卡马上到",
    });
    void port.act({ type: "control", controlId: "automation.brief.delete" });
    expect(brief()).toBeUndefined();
  });

  it("keeps 后台 to how AIs work unattended; schedules live in 自动化", () => {
    const background = xiaowenWorld().settings.find((p) => p.id === "background");
    expect(background).toMatchObject({ name: "后台", summary: "同时做 3 件" });
    expect(JSON.stringify(background)).not.toContain("timer.");
  });
});
