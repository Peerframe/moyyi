import type { ChatAction, ChatPort } from "../../chat/port.ts";
import {
  newSettingsDraft,
  type SettingsDraft,
  saveSettingsDraft,
  selectKimiReasoningEffort,
  selectSettingsPreset,
} from "../features/settings/renderer/settings-state.ts";
import type { DesktopState } from "../shared.ts";
import { type ChatAppearance, chooseAppearance } from "./chat-appearance.ts";
import {
  KIMI_EFFORTS,
  modelFieldId,
  NATIVE_KIMI_EFFORT,
  NATIVE_PRESET,
  nativeControlReason,
  PRESETS,
} from "./chat-pages.ts";
import { projectChatWorld } from "./chat-world.ts";
import type { RendererUI } from "./ui.ts";
import { errorMessage } from "./ui.ts";

export const CHAT_ACTIONS = [
  "open",
  "send",
  "stop",
  "mute",
  "control",
  "choose",
  "save-key",
] as const;

/** Display adapter only. The existing bridge remains the sole authority for every effect. */
export function createDesktopChatPort(
  current: () => RendererUI,
  control: (id: string) => void,
  appearance: { read: () => ChatAppearance; save: (next: ChatAppearance) => void },
) {
  let world = projectChatWorld(null);
  const listeners = new Set<Parameters<ChatPort["subscribe"]>[0]>();
  async function dispatch(action: ChatAction): Promise<void> {
    const ui = current();
    const state = ui.state;
    if (action.type === "choose") {
      const next = chooseAppearance(appearance.read(), action.choiceId, action.option);
      if (next) {
        appearance.save(next);
        return;
      }
    }
    if (state?.status !== "ready") throw Error("本地服务还未就绪，请稍后重试。");
    if (action.type === "control") {
      const reason = nativeControlReason(state, action.controlId, ui.pending);
      if (reason) throw Error(reason);
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
    if (action.type === "choose" || action.type === "save-key") {
      // The same validation and keychain path as the settings window; the key leaves this
      // function only inside the configure call.
      let draft: SettingsDraft = newSettingsDraft(state.settings);
      if (action.type === "save-key") {
        if (action.providerId !== modelFieldId(state.settings.preset))
          throw Error("这个连接已不在设置里，请重新打开。");
        draft = { ...draft, apiKey: action.key.trim() };
        if (!draft.apiKey) throw Error("请先粘贴密钥。");
      } else if (action.choiceId === NATIVE_PRESET) {
        const preset = PRESETS[action.option];
        if (!preset) throw Error("没有这个模型服务。");
        if (preset === state.settings.preset) return;
        draft = selectSettingsPreset(draft, preset);
      } else if (action.choiceId === NATIVE_KIMI_EFFORT) {
        const effort = KIMI_EFFORTS[action.option];
        if (!effort || state.settings.preset === "flash") throw Error("只有 Kimi 能选推理强度。");
        if (effort === (state.settings.kimiReasoningEffort ?? "low")) return;
        draft = selectKimiReasoningEffort(draft, effort);
      } else throw Error("当前本地版本尚不支持这项操作。");
      const result = await saveSettingsDraft(
        draft,
        () => undefined,
        (options) =>
          ui.perform(
            () => ui.bridge.configure(options),
            "设置未能确认应用，请核对当前设置后重试。",
          ),
      );
      if (
        !result ||
        result.settings.preset !== draft.settings.preset ||
        (result.settings.kimiReasoningEffort ?? "low") !==
          (draft.settings.kimiReasoningEffort ?? "low")
      )
        throw Error("设置未能确认应用。请核对模型设置，或处理系统授权后重试。");
      if (action.type === "save-key" && !result.connection.ready)
        throw Error("设置已保存，钥匙串状态仍未就绪。请核对系统授权。");
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
        if (action.type !== "choose" && action.type !== "save-key" && action.type !== "control")
          current().setViewError(errorMessage(cause));
        throw cause;
      }
    },
  };
  return {
    port,
    update(
      state: DesktopState | null,
      error: string | null,
      pending: boolean,
      currentAppearance = appearance.read(),
    ) {
      world = projectChatWorld(state, { error, pending, appearance: currentAppearance });
      for (const listener of listeners) listener(world);
    },
  };
}
