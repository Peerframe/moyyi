import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Theme } from "../../chat/port.ts";
import { App as ChatApp } from "../../chat/ui/App.tsx";
import type { DesktopBridge } from "../shared.ts";
import { PlanModeNotice, planAvailability } from "./chat-plan.tsx";
import { CHAT_ACTIONS, createDesktopChatPort } from "./chat-port.ts";
import { RichMessage } from "./RichMessage.tsx";
import { useRenderer } from "./runtime.ts";
import { FeatureSlot } from "./slots.ts";
import { type ReadyRendererUI, RendererContext } from "./ui.ts";

type ToolPanel = "materials" | "results" | "sessions" | "history" | "new";
const panelTitles: Record<ToolPanel, string> = {
  materials: "材料与报告目标",
  results: "成果、来源与操作记录",
  sessions: "全部会话与回收站",
  history: "完整会话历史",
  new: "开始新会话",
};

function Tools({
  panel,
  error,
  onClose,
}: {
  panel: ToolPanel;
  error: string | null;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <div className="desktop-tools">
      <dialog
        ref={dialog}
        className="settings-dialog desktop-tool-dialog"
        aria-label={panelTitles[panel]}
        onCancel={onClose}
      >
        <header className="dialog-header">
          <h2>{panelTitles[panel]}</h2>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </header>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {panel === "sessions" ? <FeatureSlot name="sidebar" /> : null}
        {panel === "new" ? <FeatureSlot name="setup" /> : null}
        {panel === "materials" ? (
          <FeatureSlot name="before-messages" only={["materials.Materials"]} />
        ) : null}
        {panel === "history" ? (
          <FeatureSlot name="before-messages" only={["sessions.History"]} />
        ) : null}
        {panel === "results" ? (
          <FeatureSlot
            name="after-messages"
            only={["effects.CheckEntry", "web.Sources", "effects.Effects", "artifacts.Artifacts"]}
          />
        ) : null}
      </dialog>
    </div>
  );
}

/** The new view shares the existing controller/feature graph and validated native bridge. */
export function DesktopChatApp({ bridge }: { bridge: DesktopBridge }) {
  const ui = useRenderer(bridge);
  const current = useRef(ui);
  current.current = ui;
  const [panel, setPanel] = useState<ToolPanel | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const controls = useRef<(id: string) => void>(() => {});
  controls.current = (id) => {
    const live = current.current;
    if (live.busy && !["native.artifacts", "native.effects", "native.materials"].includes(id)) {
      live.setViewError("请先等待当前操作结束，或停止运行。");
      return;
    }
    live.setViewError(null);
    if (id === "native.settings") {
      live.setSettingsOpen(true);
      return;
    }
    if (id === "native.maintenance") {
      live.setMaintenanceOpen(true);
      return;
    }
    if (id === "native.sessions") {
      setPanel("sessions");
      return;
    }
    if (id === "native.new") {
      live.setNewSession(true);
      setPanel("new");
      return;
    }
    if (!live.state?.activeSessionId) {
      live.setViewError("请先打开或创建一个会话。");
      return;
    }
    if (id === "native.permissions") live.setPermissionsOpen(true);
    else if (id === "native.web") live.setWebAccessOpen(true);
    else if (id === "native.materials") setPanel("materials");
    else if (id === "native.artifacts" || id === "native.effects") setPanel("results");
    else if (id === "native.history") {
      setPanel("history");
      live.act({ type: "history", sessionId: live.state.activeSessionId });
    } else live.setViewError("当前本地版本尚不支持这项操作。");
  };
  const [adapter] = useState(() =>
    createDesktopChatPort(
      () => current.current,
      (id) => controls.current(id),
    ),
  );
  useLayoutEffect(
    () => adapter.update(ui.state, ui.viewError, ui.pending),
    [adapter, ui.state, ui.viewError, ui.pending],
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    document.documentElement.className = `mc-${theme}`;
  }, [theme]);
  useEffect(() => {
    if (ui.newSession && panel !== "new") setPanel("new");
    if (panel === "new" && !ui.newSession && ui.state?.activeSessionId) setPanel(null);
  }, [panel, ui.newSession, ui.state?.activeSessionId]);
  useEffect(() => {
    if (ui.draft && panel === "results") setPanel(null);
  }, [ui.draft, panel]);
  if (!ui.state)
    return (
      <main className={`mc mc-${theme} desktop-boot`}>
        <h1>moyyi</h1>
        <p role={ui.viewError ? "alert" : "status"}>{ui.viewError ?? "正在打开本机会话…"}</p>
      </main>
    );
  const state = ui.state;
  const command = (id: string) => controls.current(id);
  const newChat = () => command("native.new");
  const canSend =
    !ui.pending &&
    !state.run &&
    !state.importing &&
    state.status === "ready" &&
    !state.historyOnly &&
    !ui.newSession &&
    !ui.composerBlocked &&
    !!state.connection.ready;
  const sessionId = state.activeSessionId;
  const plan = planAvailability(state, ui);
  const setPlan = (enabled: boolean) => {
    if (sessionId) ui.act({ type: "plan", sessionId, enabled });
  };
  const attach = () => {
    if (state.activeSessionId)
      void ui.perform(() => bridge.selectDocuments({ sessionId: state.activeSessionId as string }));
  };
  const header = (
    <div className="ch-native-toolbar">
      <button
        type="button"
        className="mc-btn"
        disabled={ui.busy}
        onClick={() => command("native.materials")}
      >
        材料 {state.materials.length || ""}
      </button>
      <button
        type="button"
        className="mc-btn"
        disabled={ui.busy}
        onClick={() => command("native.permissions")}
      >
        会话权限
      </button>
      <button
        type="button"
        className="mc-btn"
        aria-pressed={state.planMode}
        title="开启后只读调查并给出计划；批准计划前不会修改文件、运行命令或访问外部"
        disabled={!plan.canChange}
        onClick={() => setPlan(!state.planMode)}
      >
        计划模式
      </button>
      <button type="button" className="mc-btn" onClick={() => command("native.artifacts")}>
        成果与记录
      </button>
      <button
        type="button"
        className="mc-btn"
        disabled={ui.busy}
        onClick={() => command("native.history")}
      >
        完整历史
      </button>
      <button type="button" className="mc-btn" onClick={() => command("native.sessions")}>
        管理会话
      </button>
    </div>
  );
  const beforeComposer = (
    <div className="desktop-tools ch-native-notices">
      <FeatureSlot name="connection-notice" />
      <FeatureSlot name="after-messages" only={["effects.Approval"]} />
      {state.historyOnly ? (
        <p role="status">当前只能查看历史。工作目录不可用或会话已在回收站。</p>
      ) : null}
      <PlanModeNotice
        state={state}
        availability={plan}
        onExecute={() => sessionId && ui.act({ type: "execute", sessionId })}
        onExit={() => setPlan(false)}
      />
      {ui.draft ? (
        <div className="ch-prepared-draft">
          <p>已准备可编辑请求。发送后使用当前模型预算，权限与审批照常生效。</p>
          <textarea
            aria-label="准备的检查或撤销请求"
            value={ui.draft}
            maxLength={16000}
            onChange={(event) => ui.setDraft(event.target.value)}
          />
          <button type="button" disabled={!ui.canSend} onClick={() => void ui.send()}>
            发送准备的请求
          </button>
          <button type="button" onClick={() => ui.setDraft("")}>
            放弃草稿
          </button>
        </div>
      ) : null}
    </div>
  );
  const empty = (
    <section className="mc-wallpaper ch-conversation ch-empty">
      <img src="./character.png" alt="" className="ch-empty-sticker" />
      <h1 className="ch-empty-title">从你的工作目录开始</h1>
      <p className="ch-sub">打开已有会话，或选择一个目录开始只读任务。</p>
      <div className="ch-native-toolbar">
        <button type="button" className="mc-btn" disabled={ui.busy} onClick={newChat}>
          选择工作目录
        </button>
        <button type="button" className="mc-btn" onClick={() => command("native.sessions")}>
          全部会话与回收站
        </button>
      </div>
      <div className="desktop-tools">
        <FeatureSlot name="connection-notice" />
      </div>
    </section>
  );
  return (
    <RendererContext value={ui as ReadyRendererUI}>
      <div className={`mc mc-${theme} desktop-chat-root`}>
        <ChatApp
          port={adapter.port}
          theme={theme}
          sticker="./character.png"
          integration={{
            activeChatId: state.activeSessionId,
            onNew: newChat,
            canSend,
            busy: ui.busy,
            onAttach: attach,
            header,
            beforeComposer,
            empty,
            supportedActions: CHAT_ACTIONS,
            renderText: (text) => (
              <div className="desktop-tools ch-native-rich">
                <RichMessage content={text} />
              </div>
            ),
          }}
        />
        {panel ? (
          <Tools
            panel={panel}
            error={ui.viewError ?? state.error}
            onClose={() => {
              setPanel(null);
              if (panel === "new") ui.setNewSession(false);
            }}
          />
        ) : null}
        <div className="desktop-tools">
          <FeatureSlot name="dialogs" />
        </div>
      </div>
    </RendererContext>
  );
}
