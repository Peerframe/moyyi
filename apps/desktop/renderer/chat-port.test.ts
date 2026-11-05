import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../shared.ts";
import { createDesktopChatPort } from "./chat-port.ts";
import { chatTestState } from "./chat-test-state.ts";
import type { RendererUI } from "./ui.ts";

function fixture() {
  const state = chatTestState();
  const act = vi.fn(async () => state);
  const control = vi.fn();
  const ui = {
    state,
    bridge: { act } as unknown as DesktopBridge,
    pending: false,
    composerBlocked: false,
    newSession: false,
    askEachRead: false,
    setNewSession: vi.fn(),
    setViewError: vi.fn(),
    perform: vi.fn(async (run) => run()),
  } as unknown as RendererUI;
  const adapter = createDesktopChatPort(() => ui, control);
  adapter.update(state, null, false);
  return { ui, act, control, adapter };
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
