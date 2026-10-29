import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import type { RendererFeature } from "../../../renderer/slot-types.ts";
import type { RendererBase, RendererUI } from "../../../renderer/ui.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";
import { HistoryPanel } from "./HistoryPanel.tsx";
import { SessionSidebar } from "./SessionSidebar.tsx";

function useController({ bridge, state, perform }: RendererBase, getUI: () => RendererUI) {
  const [newSession, setNewSession] = useState(false);
  const [askEachRead, setAskEachRead] = useState(false);
  async function selectWorkspace() {
    const { setDraft, followOutput } = getUI();
    const result = await perform(() => bridge.selectWorkspace({ askEachRead }));
    if (result?.activeSessionId && result.activeSessionId !== state?.activeSessionId) {
      setNewSession(false);
      setDraft("");
      followOutput.current = true;
    }
  }
  async function loadSession(sessionId: string) {
    const { setDraft, followOutput } = getUI();
    const result = await perform(() => bridge.act({ type: "load", sessionId, askEachRead }));
    if (result?.activeSessionId === sessionId) {
      setNewSession(false);
      setDraft("");
      followOutput.current = true;
    }
  }
  return { newSession, setNewSession, askEachRead, setAskEachRead, selectWorkspace, loadSession };
}

function Sidebar() {
  const {
    state,
    setViewError,
    act,
    setNewSession,
    askEachRead,
    setAskEachRead,
    loadSession,
    busy,
    configuring,
  } = useDesktopUI();

  return (
    <SessionSidebar
      state={state}
      busy={busy}
      newSession={configuring}
      askEachRead={askEachRead}
      onAskEachRead={setAskEachRead}
      onNew={() => {
        setNewSession(true);
        setViewError(null);
      }}
      onLoad={(id) => void loadSession(id)}
      onList={(offset) => act({ type: "list", offset })}
      onQuery={(query) => act({ type: "catalog", query })}
      onUpdate={(update) => act({ type: "session.update", update })}
    />
  );
}
function Setup() {
  const { askEachRead, selectWorkspace, busy } = useDesktopUI();

  return (
    <section className="empty-state">
      <h2>从你的工作目录开始</h2>
      <p>选择需要分析的项目或材料目录。moyyi 可以读取其中的文件，回答问题并给出来源。</p>
      <div className="workspace-choice">
        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() => void selectWorkspace()}
        >
          选择工作目录
        </button>
      </div>
      <p className="setup-note">
        {askEachRead ? "工具读取会逐次请求你的批准。" : "目录内的工具读取将直接执行。"}{" "}
        可在左侧调整后再打开会话。
      </p>
    </section>
  );
}
function OpenedHistory() {
  const { state } = useDesktopUI();

  return (
    <>
      {state.openedHistory ? (
        <p className="history-notice" role="status">
          已打开历史会话。打开时已关闭文件修改、命令检查与网页访问权限，历史动作不会自动重放。
          当前权限以上方状态为准；已停止不代表已撤销，结果未知时需先检查。
        </p>
      ) : null}
    </>
  );
}
function HistoryNotice() {
  const { state } = useDesktopUI();

  return (
    <>
      {state.historyOnly ? (
        <p role="status">会话在回收站或工作目录不可用。当前只能查看完整历史，不能继续任务。</p>
      ) : null}
    </>
  );
}
function History() {
  const { state, act, busy } = useDesktopUI();

  return (
    <HistoryPanel
      key={state.activeSessionId}
      state={state}
      busy={busy}
      onPage={(cursor) =>
        act({
          type: "history",
          sessionId: state.activeSessionId as string,
          ...(cursor ? { cursor } : {}),
        })
      }
      onMessage={(messageId, offset) =>
        act({
          type: "history.message",
          sessionId: state.activeSessionId as string,
          messageId,
          offset,
        })
      }
      onClose={() => act({ type: "history.close" })}
    />
  );
}
function SwitchWorkspace() {
  const { setNewSession, busy, configuring } = useDesktopUI();

  return (
    <>
      {!configuring ? (
        <button type="button" disabled={busy} onClick={() => setNewSession(true)}>
          切换目录
        </button>
      ) : null}
    </>
  );
}
declare module "../../../renderer/ui.ts" {
  interface FeatureUI {
    newSession: boolean;
    setNewSession: Dispatch<SetStateAction<boolean>>;
    askEachRead: boolean;
    setAskEachRead: Dispatch<SetStateAction<boolean>>;
    selectWorkspace(): Promise<void>;
    loadSession(sessionId: string): Promise<void>;
  }
}

export const rendererFeature: RendererFeature = {
  id: "sessions",
  useController,
  slots: [
    { id: "sessions.Sidebar", slot: "sidebar", order: 0, Component: Sidebar },
    { id: "sessions.Setup", slot: "setup", order: 0, Component: Setup },
    { id: "sessions.OpenedHistory", slot: "before-messages", order: 0, Component: OpenedHistory },
    { id: "sessions.HistoryNotice", slot: "before-messages", order: 30, Component: HistoryNotice },
    { id: "sessions.History", slot: "before-messages", order: 40, Component: History },
    {
      id: "sessions.SwitchWorkspace",
      slot: "header-actions",
      order: 40,
      Component: SwitchWorkspace,
    },
  ],
};
