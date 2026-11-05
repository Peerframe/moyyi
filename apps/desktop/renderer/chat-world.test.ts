import { describe, expect, it } from "vitest";
import { chatTestState as snapshot } from "./chat-test-state.ts";
import { projectChatWorld } from "./chat-world.ts";

describe("desktop Chat state projection", () => {
  it("loads without introducing sample chats, messages, providers or jobs", () => {
    const world = projectChatWorld(null);
    expect(world.connection.state).toBe("loading");
    expect(world.chats).toEqual([]);
    expect(world.members).toEqual({});
    expect(world.messages).toEqual({});
    expect(world.jobs).toEqual([]);
    expect(world.settings).toEqual([]);
    expect(world.plugins).toEqual([]);
    expect(projectChatWorld(null, { error: "桥接未就绪" }).connection).toEqual({
      state: "offline",
      note: "桥接未就绪",
    });
  });

  it("keeps the active session visible outside the current catalog page without inventing other history", () => {
    const state = snapshot({
      activeSessionId: "active-outside-page",
      workspaceRoot: "/projects/active",
      activeMetadata: {
        title: "当前真实会话",
        group: null,
        pinned: true,
        muted: false,
        removedAt: null,
        revision: 2,
      },
      messages: [{ id: "a1", role: "assistant", text: "当前会话真实内容" }],
    });
    const world = projectChatWorld(state);
    expect(world.chats.map((chat) => chat.id)).toEqual(["active-outside-page", "session-a"]);
    expect(world.chats[0]).toMatchObject({ name: "当前真实会话", pinned: true });
    expect(world.messages["active-outside-page"]).toMatchObject([
      { id: "a1", kind: "text", text: "当前会话真实内容" },
    ]);
    expect(world.messages["session-a"]).toEqual([]);
    expect(world.chats[1]?.preview.text).toBe("已记录的问题");
    expect(JSON.stringify(world.info["session-a"])).not.toContain("deepseek-v4-flash");
    expect(state.sessions.items).toHaveLength(1);
  });

  it("shows only recorded receipts and preserves tool uncertainty", () => {
    const world = projectChatWorld(
      snapshot({
        messages: [
          { id: "u1", role: "user", text: "检查这个文件" },
          { id: "t1", role: "tool", tool: "edit_file", state: "unknown", text: "中断" },
          { id: "a1", role: "assistant", text: "<script>source text</script>" },
          {
            id: "n1",
            role: "notice",
            text: "Model request budget: attempt 1 of 3; 3 request(s) remaining including this one.",
          },
        ],
      }),
    );
    expect(world.messages["session-a"]).toEqual([
      { id: "u1", kind: "out", text: "检查这个文件", receipt: "recorded" },
      { id: "t1", kind: "service", text: "edit_file · 结果未知", detail: "中断", tone: "danger" },
      { id: "a1", kind: "text", from: "moyyi", text: "<script>source text</script>" },
      { id: "n1", kind: "service", text: "本轮模型请求：第 1 / 3 次。剩余 3 次（含本次）。" },
    ]);
    expect(world.changes).toEqual({});
    expect(world.threads).toEqual({});
    expect(world.chats[0]?.receipt).toBeUndefined();
  });

  it("binds streaming and cancellation to the real run without manufacturing approval messages", () => {
    const world = projectChatWorld(
      snapshot({
        run: { id: "run-recorded", state: "cancelling" },
        streamText: "正在保留的回答",
        pendingApproval: { effectId: "effect-a", digest: "digest-a", summary: "读取文件" },
        outcome: { kind: "completed" },
      }),
    );
    expect(world.jobs).toEqual([
      {
        id: "run-recorded",
        chatId: "session-a",
        name: "当前任务",
        step: "正在停止，等待运行时确认",
        messageId: "desktop:run:run-recorded",
        waiting: "等待本次操作审批",
        stopping: true,
      },
    ]);
    expect(world.messages["session-a"]).toContainEqual({
      id: "desktop:stream:run-recorded",
      kind: "text",
      from: "moyyi",
      text: "正在保留的回答",
      state: "working",
    });
    expect(world.messages["session-a"]?.some((message) => message.kind === "decision")).toBe(false);
    expect(
      world.messages["session-a"]?.some((message) => message.id.startsWith("desktop:outcome")),
    ).toBe(false);
    expect(world.chats[0]?.decisions).toBe(1);
  });

  it("keeps pending, failed and completed states distinct from verified task success", () => {
    const state = snapshot({ outcome: { kind: "failed", detail: "连接中断" } });
    const world = projectChatWorld(state, { pending: true, error: "本机动作未能确认" });
    expect(world.messages["session-a"]).toEqual([
      {
        id: "desktop:outcome:session-a",
        kind: "service",
        text: "本轮未能完成，已保留收到的内容。 连接中断",
        tone: "danger",
      },
      { id: "desktop:pending", kind: "service", text: "正在处理本机操作…" },
      { id: "desktop:error", kind: "service", text: "本机动作未能确认", tone: "danger" },
    ]);
    const completed = projectChatWorld(snapshot({ outcome: { kind: "completed" } }));
    expect(completed.messages["session-a"]).toContainEqual({
      id: "desktop:outcome:session-a",
      kind: "service",
      text: "本轮已结束，请核对回答与来源。",
    });
  });

  it("uses the loaded history page for an unavailable session and describes its read-only boundary", () => {
    const world = projectChatWorld(
      snapshot({
        historyOnly: true,
        messages: [{ id: "stale", role: "user", text: "另一个会话的内容" }],
        streamText: "另一个会话的流式内容",
        run: { id: "stale-run", state: "running" },
        history: {
          sessionId: "session-a",
          workspaceRoot: "/projects/actual-project",
          items: [
            {
              id: "historic",
              role: "user",
              text: "已加载的历史",
              entryId: "entry-1",
              recordedAt: "2026-11-04T01:00:00.000Z",
              textLength: 6,
              truncated: false,
            },
          ],
          nextCursor: "next",
        },
      }),
    );
    expect(world.chats[0]?.subtitle).toBe("仅查看历史");
    expect(world.chats[0]?.preview.text).toBe("已加载的历史");
    expect(world.jobs).toEqual([]);
    expect(world.messages["session-a"]?.map((message) => message.id)).not.toContain("stale");
    expect(JSON.stringify(world.messages)).not.toContain("另一个会话");
    expect(world.messages["session-a"]).toContainEqual({
      id: "historic",
      kind: "out",
      text: "已加载的历史",
      receipt: "recorded",
    });
    expect(JSON.stringify(world.info["session-a"])).toContain("只能查看历史，不能继续任务");
    expect(world.plugins.every((plugin) => !plugin.enabled)).toBe(true);
  });

  it("offers real native controls without sample settings, fabricated usage or plugin toggles", () => {
    const world = projectChatWorld(snapshot());
    const ids = world.settings.flatMap((page) =>
      page.groups.flatMap((group) =>
        group.blocks.flatMap((block) =>
          block.kind === "lines"
            ? block.lines.flatMap((line) => [
                ...(line.link ? [line.id] : []),
                ...(line.controls ?? []).map((control) => control.id),
              ])
            : [],
        ),
      ),
    );
    expect(new Set(ids)).toEqual(
      new Set([
        "native.settings",
        "native.permissions",
        "native.web",
        "native.materials",
        "native.artifacts",
        "native.history",
        "native.maintenance",
        "native.sessions",
        "native.help",
      ]),
    );
    expect(world.plugins.every((plugin) => !plugin.toggle)).toBe(true);
    // The boards' groups, without 个性化 and 记忆 until those capabilities exist.
    expect(world.settings.map((page) => `${page.section} ${page.name}`)).toEqual([
      "设置 通用",
      "设置 快捷键",
      "功能 模型",
      "数据安全 权限",
      "数据安全 数据",
      " 获取帮助",
      " 关于 moyyi",
    ]);
    const text = JSON.stringify(world.settings);
    expect(text).toContain("DeepSeek Flash · 已连上");
    expect(text).toContain("还没发请求验证");
    expect(text).not.toContain("刚测过");
    expect(text).not.toMatch(/后台|预算|"kind":"switches"/);
    const models = world.settings.find((page) => page.id === "models");
    const choices = models?.groups.flatMap((g) =>
      g.blocks.flatMap((b) => (b.kind === "choice" ? [b.choice.id] : [])),
    );
    // Kimi's strength only shows for Kimi.
    expect(choices).toEqual(["native.preset"]);
    const kimi = projectChatWorld(
      snapshot({ settings: { ...snapshot().settings, preset: "kimi-cn" } }),
    ).settings.find((page) => page.id === "models");
    expect(JSON.stringify(kimi)).toContain("native.kimiEffort");
  });

  it("lists one project per working folder and nothing under 自动化", () => {
    const base = snapshot();
    const world = projectChatWorld(
      snapshot({
        sessions: {
          ...base.sessions,
          items: [
            ...base.sessions.items,
            {
              sessionId: "session-b",
              workspaceRoot: "/projects/other",
              lastActivityAt: "2026-11-03T01:00:00.000Z",
              promptPreview: null,
            },
            {
              sessionId: "session-c",
              workspaceRoot: "/projects/actual-project",
              lastActivityAt: "2026-11-02T01:00:00.000Z",
              promptPreview: null,
            },
          ],
        },
      }),
    );
    expect(world.projects.map((p) => [p.id, p.name, p.avatar.text])).toEqual([
      ["/projects/actual-project", "actual-project", "a"],
      ["/projects/other", "other", "o"],
    ]);
    expect(world.chats.map((chat) => chat.project)).toEqual([
      "/projects/actual-project",
      "/projects/other",
      "/projects/actual-project",
    ]);
    expect(world.automations).toEqual([]);
    expect(projectChatWorld(null).projects).toEqual([]);
  });
});
