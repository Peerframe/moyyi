import type { ChatAction, ChatPort } from "../../chat/port.ts";
import type { DesktopState } from "../shared.ts";
import { projectChatWorld } from "./chat-world.ts";
import type { RendererUI } from "./ui.ts";
import { errorMessage } from "./ui.ts";

export const CHAT_ACTIONS = ["open", "send", "stop", "mute", "control"] as const;

/** Display adapter only. The existing bridge remains the sole authority for every effect. */
export function createDesktopChatPort(current: () => RendererUI, control: (id: string) => void) {
  let world = projectChatWorld(null);
  const listeners = new Set<Parameters<ChatPort["subscribe"]>[0]>();
  async function dispatch(action: ChatAction): Promise<void> {
    const ui = current();
    const state = ui.state;
    if (state?.status !== "ready") throw Error("本地服务还未就绪，请稍后重试。");
    if (action.type === "control") {
      control(action.controlId);
      return;
    }
    if (action.type === "stop") {
      if (state.run?.id !== action.jobId || state.run.state !== "running")
        throw Error("这次运行已结束或正在停止，请核对当前状态。");
      const result = await ui.perform(() => ui.bridge.act({ type: "cancel", runId: action.jobId }));
      if (!result) throw Error("未能确认停止，请核对当前运行状态。");
      return;
    }
    if (ui.pending || state.run || state.importing)
      throw Error("请先等待当前操作结束，或停止运行。");
    if (action.type === "open") {
      if (state.activeSessionId === action.chatId) return;
      if (!state.sessions.items.some((item) => item.sessionId === action.chatId))
        throw Error("会话列表已更新，请重新选择会话。");
      const result = await ui.perform(() =>
        ui.bridge.act({
          type: "load",
          sessionId: action.chatId,
          askEachRead: ui.askEachRead,
        }),
      );
      if (!result || result.activeSessionId !== action.chatId) throw Error("未能打开这段会话。");
      ui.setNewSession(false);
      return;
    }
    if (action.type === "send") {
      if (state.activeSessionId !== action.chatId || state.historyOnly || ui.newSession)
        throw Error("请先打开一个可继续的会话。");
      if (!state.connection.ready || ui.composerBlocked)
        throw Error("请先完成模型设置或关闭正在编辑的窗口。");
      let text = action.text.trim();
      if (!text) throw Error("请先输入任务内容。");
      if (action.replyTo) {
        const quoted = state.messages.find((item) => item.id === action.replyTo);
        if (!quoted) throw Error("引用的消息已不在当前历史页，请重新选择。");
        text = `引用消息：\n${quoted.text}\n\n${text}`;
      }
      if (text.length > 16_000)
        throw Error("任务内容（含引用）不能超过 16000 字符，请缩短后重试。");
      const result = await ui.perform(() =>
        ui.bridge.act({ type: "start", sessionId: action.chatId, text }),
      );
      if (!result) throw Error("消息未能确认发送，草稿已保留。");
      return;
    }
    if (action.type === "mute") {
      const item = state.sessions.items.find((entry) => entry.sessionId === action.chatId);
      const metadata =
        action.chatId === state.activeSessionId
          ? (state.activeMetadata ?? item?.metadata)
          : item?.metadata;
      if (!metadata) throw Error("会话信息已变化，请刷新列表后重试。");
      const result = await ui.perform(() =>
        ui.bridge.act({
          type: "session.update",
          update: {
            sessionId: action.chatId,
            expectedRevision: metadata.revision,
            patch: { muted: action.muted },
          },
        }),
      );
      if (!result) throw Error("未能确认静音设置。");
      return;
    }
    throw Error("当前本地版本尚不支持这项操作。");
  }
  const port: ChatPort = {
    world: () => world,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async act(action) {
      try {
        await dispatch(action);
      } catch (cause) {
        current().setViewError(errorMessage(cause));
        throw cause;
      }
    },
  };
  return {
    port,
    update(state: DesktopState | null, error: string | null, pending: boolean) {
      world = projectChatWorld(state, { error, pending });
      for (const listener of listeners) listener(world);
    },
  };
}
