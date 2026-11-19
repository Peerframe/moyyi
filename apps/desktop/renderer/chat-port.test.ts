import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../shared.ts";
import { DEFAULT_APPEARANCE } from "./chat-appearance.ts";
import { createDesktopChatPort } from "./chat-port.ts";
import { chatTestState } from "./chat-test-state.ts";
import type { RendererUI } from "./ui.ts";

function fixture() {
  const state = chatTestState();
  const act = vi.fn(async () => state);
  const configure = vi.fn<DesktopBridge["configure"]>(async ({ settings }) => ({
    ...state,
    settings,
  }));
  const control = vi.fn();
  const ui = {
    state,
    bridge: { act, configure } as unknown as DesktopBridge,
    pending: false,
    composerBlocked: false,
    newSession: false,
    askEachRead: false,
    setNewSession: vi.fn(),
    setViewError: vi.fn(),
    perform: vi.fn(async (run) => run()),
  } as unknown as RendererUI;
  const appearance = { read: () => DEFAULT_APPEARANCE, save: vi.fn() };
  const adapter = createDesktopChatPort(() => ui, control, appearance);
  adapter.update(state, null, false);
  return { ui, act, configure, control, appearance, adapter };
}

describe("native Chat action routing", () => {
  it("sends only to the current ready session and waits for the native ACK", async () => {
    const f = fixture();
    await f.adapter.port.act({ type: "send", chatId: "session-a", text: " Read the project " });
    expect(f.act).toHaveBeenCalledWith({
      type: "start",
      sessionId: "session-a",
      text: "Read the project",
    });
    f.act.mockClear();
    await expect(
      f.adapter.port.act({ type: "send", chatId: "other", text: "wrong target" }),
    ).rejects.toThrow("可继续");
    expect(f.act).not.toHaveBeenCalled();
  });

  it("does not acknowledge a rejected send or invent a transcript", async () => {
    const f = fixture();
    f.ui.perform = vi.fn(async () => null);
    await expect(
      f.adapter.port.act({ type: "send", chatId: "session-a", text: "keep my draft" }),
    ).rejects.toThrow("草稿已保留");
    expect(f.adapter.port.world().messages["session-a"]).toEqual([]);
    expect(f.ui.setViewError).toHaveBeenCalled();
  });

  it("rejects send while running, read-only history, unavailable connection, or importing", async () => {
    for (const patch of [
      { run: { id: "run-a", state: "running" as const } },
      { historyOnly: true },
      { connection: { ready: false } },
      { importing: true },
    ]) {
      const f = fixture();
      f.ui.state = chatTestState(patch);
      await expect(
        f.adapter.port.act({ type: "send", chatId: "session-a", text: "blocked" }),
      ).rejects.toThrow();
      expect(f.act).not.toHaveBeenCalled();
    }
  });

  it("cancels the exact current run and refuses stale job identities", async () => {
    const f = fixture();
    f.ui.state = chatTestState({ run: { id: "run-a", state: "running" } });
    await expect(f.adapter.port.act({ type: "stop", jobId: "old" })).rejects.toThrow();
    expect(f.act).not.toHaveBeenCalled();
    await f.adapter.port.act({ type: "stop", jobId: "run-a" });
    expect(f.act).toHaveBeenCalledWith({ type: "cancel", runId: "run-a" });
  });

  it("never maps prototype attachments, archive, or checks into authority", async () => {
    const f = fixture();
    await expect(
      f.adapter.port.act({
        type: "attach",
        chatId: "session-a",
        name: "/private/secret",
        access: "edit",
      }),
    ).rejects.toThrow("尚不支持");
    await expect(
      f.adapter.port.act({ type: "archive", chatId: "session-a", archived: true }),
    ).rejects.toThrow("尚不支持");
    await expect(f.adapter.port.act({ type: "answer", messageId: "fake", key: 0 })).rejects.toThrow(
      "尚不支持",
    );
    expect(f.act).not.toHaveBeenCalled();
  });

  it("changes the model service, Kimi strength and key only through configure", async () => {
    const f = fixture();
    await f.adapter.port.act({ type: "choose", choiceId: "native.preset", option: 1 });
    expect(f.configure).toHaveBeenLastCalledWith({
      settings: expect.objectContaining({ preset: "kimi-cn" }),
    });
    // Choosing the service already in use saves nothing.
    f.configure.mockClear();
    await f.adapter.port.act({ type: "choose", choiceId: "native.preset", option: 0 });
    expect(f.configure).not.toHaveBeenCalled();
    // Flash has no strength to choose, and unknown options change nothing.
    await expect(
      f.adapter.port.act({ type: "choose", choiceId: "native.kimiEffort", option: 1 }),
    ).rejects.toThrow("只有 Kimi");
    await expect(
      f.adapter.port.act({ type: "choose", choiceId: "native.preset", option: 9 }),
    ).rejects.toThrow("没有这个模型服务");
    const secret = "sk-test-not-a-real-key-0001";
    await f.adapter.port.act({
      type: "save-key",
      providerId: "native.model.flash",
      key: ` ${secret} `,
    });
    expect(f.configure).toHaveBeenLastCalledWith({
      settings: expect.objectContaining({ preset: "flash" }),
      apiKey: secret,
    });
    expect(JSON.stringify(f.adapter.port.world())).not.toContain(secret);
    await expect(
      f.adapter.port.act({ type: "save-key", providerId: "native.model.flash", key: "has space" }),
    ).rejects.toThrow("API Key");
    expect(f.configure).toHaveBeenCalledTimes(1);
    expect(f.act).not.toHaveBeenCalled();
  });

  it("reports an unconfirmed key even if the host saved the settings", async () => {
    const f = fixture();
    f.configure.mockResolvedValue(chatTestState({ connection: { ready: false } }));
    await expect(
      f.adapter.port.act({ type: "save-key", providerId: "native.model.flash", key: "test-only" }),
    ).rejects.toThrow("钥匙串状态仍未就绪");
  });

  it("keeps stale service keys and history-only grants out of the bridge", async () => {
    const f = fixture();
    f.ui.state = chatTestState({
      settings: { ...chatTestState().settings, preset: "kimi-global" },
      historyOnly: true,
    });
    await expect(
      f.adapter.port.act({ type: "save-key", providerId: "native.model.flash", key: "test" }),
    ).rejects.toThrow("连接");
    await expect(
      f.adapter.port.act({ type: "control", controlId: "native.permissions" }),
    ).rejects.toThrow("只能查看历史");
    expect(f.control).not.toHaveBeenCalled();
    expect(f.configure).not.toHaveBeenCalled();
    await f.adapter.port.act({ type: "control", controlId: "native.history" });
    expect(f.control).toHaveBeenCalledWith("native.history");
  });

  it("changes window appearance during a run without reconfiguring the host", async () => {
    const f = fixture();
    f.ui.state = chatTestState({ run: { id: "run-a", state: "running" } });
    await f.adapter.port.act({ type: "choose", choiceId: "general.size", option: 2 });
    expect(f.appearance.save).toHaveBeenCalledWith({ theme: "system", size: 17 });
    expect(f.configure).not.toHaveBeenCalled();
  });

  it("refuses settings changes while a run is going", async () => {
    const f = fixture();
    f.ui.state = chatTestState({ run: { id: "run-a", state: "running" } });
    await expect(
      f.adapter.port.act({ type: "choose", choiceId: "native.preset", option: 1 }),
    ).rejects.toThrow("等待当前操作结束");
    expect(f.configure).not.toHaveBeenCalled();
  });

  it("does not replace a newer pushed snapshot with a delayed command return", async () => {
    const f = fixture();
    const newer = chatTestState({
      streamText: "new output",
      run: { id: "run-a", state: "running" },
    });
    f.act.mockImplementation(async () => {
      f.adapter.update(newer, null, false);
      return chatTestState();
    });
    await f.adapter.port.act({ type: "send", chatId: "session-a", text: "start" });
    expect(f.adapter.port.world().jobs[0]?.id).toBe("run-a");
    expect(JSON.stringify(f.adapter.port.world().messages)).toContain("new output");
  });
});
