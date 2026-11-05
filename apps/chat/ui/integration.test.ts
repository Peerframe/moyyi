import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createMockPort } from "../mock/port.ts";
import { xiaowenWorld } from "../mock/world.ts";
import type { Message } from "../port.ts";
import { textOf } from "../text.ts";
import { App, type ChatIntegration } from "./App.tsx";
import { Composer, type ComposerProps, submitComposerMessage } from "./Composer.tsx";

const integration: ChatIntegration = {
  activeChatId: "moyyi",
  onNew: () => undefined,
  onAttach: () => undefined,
  canSend: true,
  busy: false,
  supportedActions: ["open", "send", "stop", "control"],
};

describe("host-backed Chat interface", () => {
  it("uses host rich text only for assistant bodies and keeps raw tool details collapsed and searchable", () => {
    const tool: Message = {
      id: "tool-output",
      kind: "service",
      text: "fs.read · 完成",
      detail: '<script>alert("not executable")</script>\nunique tool evidence',
    };
    const messages: readonly Message[] = [
      { id: "user", kind: "out", text: "**my request**" },
      tool,
      {
        id: "assistant",
        kind: "text",
        from: "moyyi",
        text: "| Name | Value |\n| --- | --- |\n| A | B |",
      },
    ];
    const world = { ...xiaowenWorld(), messages: { moyyi: messages } };
    const renderText = vi.fn((value: string) =>
      createElement("div", { className: "safe-rich-text" }, value),
    );
    const html = renderToString(
      createElement(App, {
        port: createMockPort(world),
        theme: "dark",
        sticker: "sticker.png",
        integration: { ...integration, renderText },
      }),
    );
    expect(renderText).toHaveBeenCalledTimes(1);
    expect(renderText).toHaveBeenCalledWith("| Name | Value |\n| --- | --- |\n| A | B |");
    expect(html).toContain('class="safe-rich-text"');
    expect(html).toContain(
      '<details class="ch-tool-details"><summary>fs.read · 完成</summary><pre>',
    );
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(textOf(tool)).toContain("unique tool evidence");
  });

  it("follows the host session and mounts real controls without a fake voice or archive action", () => {
    const world = xiaowenWorld();
    const html = renderToString(
      createElement(App, {
        port: createMockPort(world),
        theme: "dark",
        sticker: "sticker.png",
        initialChat: "lunwen",
        integration: {
          ...integration,
          header: createElement("button", { type: "button" }, "真实会话权限"),
          beforeComposer: createElement("div", {}, "真实材料与审批"),
        },
      }),
    );
    expect(html).toContain('aria-label="moyyi"');
    expect(html).toContain("真实会话权限");
    expect(html).toContain("真实材料与审批");
    expect(html).toContain('aria-label="语音尚未接入"');
    expect(html).not.toContain('aria-label="按住说话"');
    expect(html).not.toContain("ch-archive-row");
  });

  it("keeps host errors visible even before any session has been selected", () => {
    const world = {
      ...xiaowenWorld(),
      connection: { state: "offline" as const, note: "本机会话连接已关闭，请重新打开应用。" },
    };
    const html = renderToString(
      createElement(App, {
        port: createMockPort(world),
        theme: "light",
        sticker: "sticker.png",
        integration: {
          ...integration,
          activeChatId: null,
          empty: createElement("button", { type: "button" }, "选择工作目录"),
        },
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(world.connection.note);
    expect(html).toContain("选择工作目录");
    expect(html).not.toContain("本机的事继续做");
  });

  it("renders installed plugin facts without inventing an enable switch", () => {
    const world = {
      ...xiaowenWorld(),
      plugins: [
        {
          id: "files",
          name: "文件",
          icon: "folder" as const,
          enabled: true,
          summary: "受限文件操作",
          groups: [],
        },
      ],
    };
    const html = renderToString(
      createElement(App, {
        port: createMockPort(world),
        theme: "dark",
        sticker: "sticker.png",
        initialPage: "plugins",
        integration,
      }),
    );
    expect(html).toContain("在用");
    expect(html).not.toContain("停用");
    expect(html).not.toContain("预览版");
  });

  it("disables sending while the host is busy", () => {
    const world = xiaowenWorld();
    const chat = world.chats.find((entry) => entry.id === "moyyi");
    if (!chat) throw new Error("fixture chat missing");
    const props: ComposerProps = {
      chat,
      members: world.members,
      draft: `保留这条草稿\n${"多行内容".repeat(1200)}`,
      running: null,
      sticker: "sticker.png",
      onDraft: () => undefined,
      onSend: async () => undefined,
      onStop: () => undefined,
      onAttach: () => undefined,
      onCommand: () => undefined,
      onVoice: () => undefined,
      onReopen: () => undefined,
      replyTo: null,
      onCancelReply: () => undefined,
      editing: false,
      onEditLast: () => undefined,
      onCancelEdit: () => undefined,
      integration: { ...integration, busy: true },
    };
    const html = renderToString(createElement(Composer, props));
    expect(html).toMatch(/aria-label="发送"[^>]*disabled=""/);
    expect(html).toContain("保留这条草稿");
    expect(html).toContain("多行内容".repeat(1200));
    expect(html).toMatch(/<textarea[^>]*maxLength="16000"/);
    expect(html).not.toContain("做完这一步就看你的话");
  });

  it("clears a draft only after acceptance, and keeps it on rejection", async () => {
    const clear = vi.fn();
    let accept: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      accept = resolve;
    });
    const sending = submitComposerMessage("hello", () => pending, clear);
    expect(clear).not.toHaveBeenCalled();
    accept?.();
    await sending;
    expect(clear).toHaveBeenCalledTimes(1);

    clear.mockClear();
    await expect(
      submitComposerMessage(
        "keep me",
        async () => {
          throw new Error("closed");
        },
        clear,
      ),
    ).rejects.toThrow("closed");
    expect(clear).not.toHaveBeenCalled();
  });

  it("does not clear text added while the host acknowledgement is pending", async () => {
    let draft = "original";
    let accept: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      accept = resolve;
    });
    const clear = vi.fn(() => {
      draft = "";
    });
    const sending = submitComposerMessage(
      "original",
      () => pending,
      clear,
      () => draft === "original",
    );
    draft = "original\nnew information";
    accept?.();
    await sending;
    expect(clear).not.toHaveBeenCalled();
    expect(draft).toBe("original\nnew information");
  });
});
