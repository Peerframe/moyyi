import type { Chat, ChatInfo, ChatWorld, Message } from "../../chat/port.ts";
import type { DesktopMessage, DesktopSessionSummary, DesktopState } from "../shared.ts";
import { chatBudgetLabel, chatModelLabel, projectChatPages } from "./chat-pages.ts";
import { permissionLabel } from "./effects-state.ts";
import { noticeLabel, outcomeLabel, toolStateLabel, workspaceName } from "./view-state.ts";

export interface ChatProjectionOptions {
  readonly error?: string | null;
  readonly pending?: boolean;
}

function message(entry: DesktopMessage): Message {
  switch (entry.role) {
    case "user":
      return { id: entry.id, kind: "out", text: entry.text, receipt: "recorded" };
    case "assistant":
      return { id: entry.id, kind: "text", from: "moyyi", text: entry.text };
    case "tool":
      return {
        id: entry.id,
        kind: "service",
        text: `${entry.tool ?? "工具活动"} · ${toolStateLabel(entry.state)}`,
        ...(entry.text ? { detail: entry.text } : {}),
        ...(entry.state === "failed" || entry.state === "unknown"
          ? { tone: "danger" as const }
          : {}),
      };
    case "notice":
      return { id: entry.id, kind: "service", text: noticeLabel(entry.text) };
  }
}

function runLabel(state: DesktopState): string {
  if (state.run?.state === "cancelling") return "正在停止，等待运行时确认";
  if (state.pendingApproval) return "等待你批准本次操作";
  return "正在处理当前任务";
}

function activeEntries(state: DesktopState): readonly DesktopMessage[] {
  if (!state.historyOnly) return state.messages;
  return state.history?.sessionId === state.activeSessionId ? state.history.items : [];
}

function activeMessages(state: DesktopState, options: ChatProjectionOptions): readonly Message[] {
  const messages = activeEntries(state).map(message);
  if (state.historyOnly)
    messages.unshift({
      id: "desktop:history-only",
      kind: "service",
      text: "当前只能查看历史。工作目录不可用或会话已移入回收站，不能继续任务。",
    });
  if (state.historyTruncated || state.historyOnly)
    messages.push({
      id: "desktop:history-limit",
      kind: "service",
      text: "这里显示已加载的历史片段。打开完整历史可翻页并读取完整消息。",
    });
  if (state.streamText && !state.historyOnly)
    messages.push({
      id: `desktop:stream:${state.run?.id ?? state.activeSessionId}`,
      kind: "text",
      from: "moyyi",
      text: state.streamText,
      ...(state.run ? { state: "working" as const } : {}),
    });
  if (state.run && !state.historyOnly)
    messages.push({
      id: `desktop:run:${state.run.id}`,
      kind: "status",
      from: "moyyi",
      job: "当前任务",
      steps: [{ text: runLabel(state), state: "now" }],
      budget: chatBudgetLabel(state),
    });
  else if (state.outcome && !state.historyOnly)
    messages.push({
      id: `desktop:outcome:${state.activeSessionId}`,
      kind: "service",
      text: outcomeLabel(state.outcome),
      ...(state.outcome.kind === "failed" ? { tone: "danger" as const } : {}),
    });
  if (options.pending)
    messages.push({ id: "desktop:pending", kind: "service", text: "正在处理本机操作…" });
  const error = options.error ?? state.error;
  if (error) messages.push({ id: "desktop:error", kind: "service", text: error, tone: "danger" });
  return messages;
}

function sessionInfo(state: DesktopState, summary: DesktopSessionSummary): ChatInfo {
  const active = summary.sessionId === state.activeSessionId;
  return {
    kindLine: active && state.historyOnly ? "本机会话 · 仅查看历史" : "本机会话",
    sections: [
      { title: "工作目录", note: summary.workspaceRoot },
      ...(active
        ? [
            { title: "模型", note: chatModelLabel(state) },
            { title: "预算", note: chatBudgetLabel(state) },
            {
              title: "当前权限",
              note: state.historyOnly
                ? "只能查看历史，不能继续任务。"
                : permissionLabel(state.permissions, state.reportTarget, state.webAccess),
            },
            {
              title: "当前材料",
              note: state.materials.length
                ? state.materials.map((material) => material.path).join("\n")
                : "未选择材料。",
            },
            {
              title: "操作记录",
              note: `当前操作页有 ${state.effects.items.length} 项${state.effects.hasMore ? "，还有更多" : ""}。详细回执和撤销入口在操作面板。`,
            },
          ]
        : [{ title: "访问", note: "打开后读取真实历史；重新打开会话时关闭执行权限。" }]),
    ],
  };
}

/** A browser-safe projection of recorded desktop state. It contains no sample world or effects. */
export function projectChatWorld(
  state: DesktopState | null,
  options: ChatProjectionOptions = {},
): ChatWorld {
  if (!state)
    return {
      connection: {
        state: options.error ? "offline" : "loading",
        note: options.error ?? "正在读取本机会话…",
      },
      members: {},
      chats: [],
      messages: {},
      jobs: [],
      info: {},
      changes: {},
      threads: {},
      settings: [],
      plugins: [],
    };

  const summaries = [...state.sessions.items];
  if (state.activeSessionId && !summaries.some((item) => item.sessionId === state.activeSessionId))
    summaries.unshift({
      sessionId: state.activeSessionId,
      workspaceRoot: state.workspaceRoot ?? "",
      lastActivityAt: null,
      promptPreview: null,
      ...(state.activeMetadata ? { metadata: state.activeMetadata } : {}),
    });
  const chats: Chat[] = summaries.map((summary) => {
    const active = summary.sessionId === state.activeSessionId;
    const metadata = active ? (state.activeMetadata ?? summary.metadata) : summary.metadata;
    const last = active ? activeEntries(state).at(-1) : undefined;
    return {
      id: summary.sessionId,
      kind: "project",
      name: metadata?.title ?? workspaceName(summary.workspaceRoot),
      avatar: { text: "m", tone: "key" },
      time: summary.lastActivityAt?.slice(0, 10) ?? "",
      preview: {
        text:
          active && state.run && !state.historyOnly
            ? runLabel(state)
            : (last?.text ?? summary.promptPreview ?? "尚无消息"),
      },
      decisions: active && !state.historyOnly && state.pendingApproval ? 1 : 0,
      unread: 0,
      ...(metadata ? { pinned: metadata.pinned, muted: metadata.muted } : {}),
      subtitle:
        active && state.historyOnly
          ? "仅查看历史"
          : metadata?.removedAt
            ? "回收站中的会话"
            : summary.workspaceRoot,
      placeholder: active && state.historyOnly ? "当前只能查看历史" : "描述要完成的任务…",
    };
  });
  const messages = Object.fromEntries(
    summaries.map((summary) => [
      summary.sessionId,
      summary.sessionId === state.activeSessionId ? activeMessages(state, options) : [],
    ]),
  );
  const error = options.error ?? state.error;
  const unavailable = state.status !== "ready" || !state.connection.ready;
  const note =
    error ??
    (state.status === "closing"
      ? "正在安全关闭本机会话…"
      : state.status === "closed"
        ? "本机连接已关闭，请重新打开应用。"
        : !state.connection.ready
          ? (state.connection.message ?? "模型配置未就绪；已有会话仍可查看。")
          : options.pending
            ? "正在处理本机操作…"
            : undefined);
  return {
    connection: { state: unavailable ? "offline" : "online", ...(note ? { note } : {}) },
    members: {
      moyyi: {
        id: "moyyi",
        name: "moyyi",
        avatar: { text: "m", tone: "accent" },
        ...(state.model ? { model: state.model.model } : {}),
        presence: state.run && !state.historyOnly ? "working" : "idle",
      },
    },
    chats,
    messages,
    jobs:
      state.run && state.activeSessionId && !state.historyOnly
        ? [
            {
              id: state.run.id,
              chatId: state.activeSessionId,
              name: "当前任务",
              step: runLabel(state),
              messageId: `desktop:run:${state.run.id}`,
              ...(state.pendingApproval ? { waiting: "等待本次操作审批" } : {}),
              ...(state.run.state === "cancelling" ? { stopping: true } : {}),
            },
          ]
        : [],
    info: Object.fromEntries(
      summaries.map((summary) => [summary.sessionId, sessionInfo(state, summary)]),
    ),
    changes: {},
    threads: {},
    ...projectChatPages(state),
  };
}
