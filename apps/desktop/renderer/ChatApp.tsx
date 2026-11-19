import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { App as ChatApp } from "../../chat/ui/App.tsx";
import type { DesktopBridge } from "../shared.ts";
import {
  type ChatAppearance,
  readAppearance,
  useWindowTheme,
  writeAppearance,
} from "./chat-appearance.ts";
import { nativeControlReason } from "./chat-pages.ts";
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

/** macOS draws the traffic lights in the rail and the sidebar material behind the window. */
const MAC = typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");

/** The new view shares the existing controller/feature graph and validated native bridge. */
export function DesktopChatApp({ bridge }: { bridge: DesktopBridge }) {
  const ui = useRenderer(bridge);
  const current = useRef(ui);
  current.current = ui;
  const [panel, setPanel] = useState<ToolPanel | null>(null);
  const [appearance, setAppearance] = useState(readAppearance);
  const appearanceRef = useRef(appearance);
  const theme = useWindowTheme(appearance.theme);
  const [openSettingsRequest, setOpenSettingsRequest] = useState<{
    page: string;
    sequence: number;
  }>();
  const openModelSettings = () =>
    setOpenSettingsRequest((request) => ({
      page: "models",
      sequence: (request?.sequence ?? 0) + 1,
    }));
  const controls = useRef<(id: string) => void>(() => {});
  controls.current = (id) => {
    const live = current.current;
    const reason = live.state
      ? nativeControlReason(live.state, id, live.pending)
      : "本地服务尚未就绪。";
    if (reason) {
      live.setViewError(reason);
      return;
    }
    live.setViewError(null);
    if (id === "native.settings") {
      live.setSettingsOpen(true);
      return;
    }
    if (id === "native.help") {
      live.setHelpOpen(true);
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
      {
        read: () => appearanceRef.current,
        save(next: ChatAppearance) {
          writeAppearance(next);
          appearanceRef.current = next;
          setAppearance(next);
        },
      },
    ),
  );
  useLayoutEffect(
    () => adapter.update(ui.state, ui.viewError, ui.pending, appearance),
    [adapter, ui.state, ui.viewError, ui.pending, appearance],
  );
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
  // Session tools that have no place in the chat yet open the existing complete dialogs.
  const tool = (id: string, label: string, disabled = ui.busy) => (
    <button
      key={id}
      type="button"
      className="ch-native-tool"
      disabled={disabled}
      onClick={() => command(id)}
    >
      {label}
    </button>
  );
  const header = (
    <nav className="mc-glass ch-native-tools" aria-label="会话工具">
      {tool("native.materials", state.materials.length ? `材料 ${state.materials.length}` : "材料")}
      {tool("native.permissions", "权限")}
      <button
        type="button"
        className="ch-native-tool"
        aria-pressed={state.planMode}
        title="开启后只读调查并给出计划；批准计划前不会修改文件、运行命令或访问外部"
        disabled={!plan.canChange}
        onClick={() => setPlan(!state.planMode)}
      >
        计划模式
      </button>
      {tool("native.effects", "操作记录", false)}
      {tool("native.history", "完整历史")}
      {tool("native.sessions", "会话和回收站", false)}
    </nav>
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
    <section
      className="mc-wallpaper ch-conversation ch-empty ch-native-empty"
      aria-label="没选会话"
    >
      <span className="mc-av mc-av-ai ch-native-empty-mark" aria-hidden="true">
        m
      </span>
      <h1 className="ch-empty-title">选一个会话，或交代一件新事</h1>
      <p className="ch-sub">moyyi 在你选的文件夹里做事。新会话从只读开始，权限由你在会话里决定。</p>
      <div className="ch-native-empty-keys">
        <button
          type="button"
          className="mc-key mc-key-primary"
          disabled={ui.busy}
          onClick={newChat}
        >
          选文件夹，开始新会话
        </button>
        <button type="button" className="mc-key" onClick={() => command("native.sessions")}>
          会话和回收站
        </button>
      </div>
      <div className="desktop-tools ch-native-empty-notice">
        <FeatureSlot name="connection-notice" />
      </div>
    </section>
  );
  return (
    <RendererContext value={{ ...ui, state, openModelSettings } satisfies ReadyRendererUI}>
      <div className={`mc mc-${theme} desktop-chat-root${MAC ? " ch-native-mac" : ""}`}>
        <ChatApp
          port={adapter.port}
          theme={theme}
          fontSize={appearance.size}
          windowControls={MAC}
          integration={{
            activeChatId: state.activeSessionId,
            openSettingsRequest,
            pageNotice:
              state.status === "ready"
                ? undefined
                : (state.error ?? "本地服务暂不可用，请重新打开应用。"),
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
