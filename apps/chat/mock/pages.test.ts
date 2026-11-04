import { describe, expect, it } from "vitest";
import type { ChatWorld, PageLine, PluginPage } from "../port.ts";
import { chosen } from "./page-actions.ts";
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

describe("设置 and 插件 on the mock backend", () => {
  it("holds the eight sections and five plugins in rail order (S23–S32)", () => {
    const { settings, plugins } = xiaowenWorld();
    expect(settings.map((p) => p.name)).toEqual([
      "模型和密钥",
      "关于我",
      "权限和确认",
      "后台和定时",
      "预算",
      "记录和数据",
      "通用",
      "关于 moyyi",
    ]);
    expect(plugins.map((p) => p.name)).toEqual(["文件", "命令行", "网页", "文档", "技能"]);
    // Every choice and control id is unique: the runtime keys actions by them.
    const ids = [...settings, ...plugins].flatMap((page) => [
      ...("toggle" in page ? [(page as PluginPage).toggle.id] : []),
      ...page.groups.flatMap((g) =>
        g.blocks.flatMap((b) => {
          if (b.kind === "choice") return [b.choice.id];
          if (b.kind === "choices") return b.choices.map((c) => c.id);
          if (b.kind === "lines")
            return b.lines.flatMap((l) => (l.controls ?? []).map((c) => c.id));
          if (b.kind === "providers")
            return b.providers.flatMap((p) => [
              ...p.controls.map((c) => c.id),
              ...(p.keyField ? [p.keyField.save.id] : []),
            ]);
          return [];
        }),
      ),
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
    expect(kimi).toMatchObject({ connected: true, status: "已连上 · 密钥在系统钥匙串里" });
    expect(kimi?.keyField).toBeUndefined();
    expect(page("models")?.summary).toBe("DeepSeek、Kimi 已连上 · 新对话用 Flash");
    // An empty key connects nothing.
    await port.act({ type: "control", controlId: "anthropic.connect" });
    await port.act({ type: "save-key", providerId: "anthropic", key: "  " });
    expect(page("models")?.summary).toBe("DeepSeek、Kimi 已连上 · 新对话用 Flash");
  });

  it("disconnects a provider and offers to connect it again", async () => {
    const { port, page } = setup();
    await port.act({ type: "control", controlId: "deepseek.disconnect" });
    expect(page("models")?.summary).toBe("还没连上模型 · 新对话用 Flash");
  });

  it("pauses a scheduled job, switches skills and plugins, and deletes a memory", async () => {
    const { port, page, lines } = setup();
    await port.act({ type: "control", controlId: "timer.brief.pause" });
    expect(lines("background").find((l) => l.id === "timer.brief")).toMatchObject({
      off: true,
      sub: "已暂停 · 在「moyyi」里做",
      controls: [{ label: "继续" }],
    });
    expect(page("background")?.summary).toBe("同时做 3 件 · 1 件定时");

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

    await port.act({ type: "control", controlId: "memory.cite.delete" });
    expect(lines("me").map((l) => l.id)).toEqual(["memory.rent"]);
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
});
