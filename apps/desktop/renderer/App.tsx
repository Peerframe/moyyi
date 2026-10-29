import type { DesktopBridge } from "../shared.ts";
import { useRenderer } from "./runtime.ts";
import { FeatureSlot } from "./slots.ts";
import { type ReadyRendererUI, RendererContext } from "./ui.ts";
import { workspaceName } from "./view-state.ts";
export function App({ bridge }: { bridge: DesktopBridge }) {
  const ui = useRenderer(bridge);
  const { state, viewError, configuring, scrollArea, followOutput } = ui;
  if (!state)
    return (
      <main className="boot-screen">
        <h1>moyyi</h1>
        <p role="status">
          {viewError ? "桌面连接未能就绪。请关闭并重新打开应用。" : "正在打开本机会话…"}
        </p>
        {viewError ? (
          <p className="error" role="alert">
            {viewError}
          </p>
        ) : null}
      </main>
    );

  const error = viewError ?? state.error;
  return (
    <RendererContext value={ui as ReadyRendererUI}>
      <div className="app-shell">
        <FeatureSlot name="sidebar" />
        <main className="conversation">
          <header className="conversation-header">
            <div>
              <h1>{configuring ? "新会话" : workspaceName(state.workspaceRoot)}</h1>
              <p className="workspace-label">
                {configuring ? "选择一个目录，开始只读任务" : state.workspaceRoot}
              </p>
            </div>
            <div className="header-actions">
              <FeatureSlot name="header-actions" />
            </div>
          </header>
          <FeatureSlot name="permission-line" />
          <FeatureSlot name="connection-notice" />
          {error ? (
            <p className="error error-banner" role="alert">
              {error}
            </p>
          ) : null}
          {state.status !== "ready" ? (
            <p className="error-banner" role="status">
              {state.status === "closing" ? "正在安全关闭会话…" : "连接已关闭，请重新打开应用。"}
            </p>
          ) : null}

          <div
            className="messages"
            ref={scrollArea}
            onScroll={() => {
              const area = scrollArea.current;
              if (area)
                followOutput.current = area.scrollHeight - area.scrollTop - area.clientHeight < 90;
            }}
          >
            <div className="message-column">
              {configuring ? (
                <FeatureSlot name="setup" />
              ) : (
                <>
                  <FeatureSlot name="before-messages" />
                  <FeatureSlot name="messages" />
                  <FeatureSlot name="after-messages" />
                </>
              )}
            </div>
          </div>
          <FeatureSlot name="composer" />
        </main>
        <FeatureSlot name="right-panel" />
        <FeatureSlot name="dialogs" />
      </div>
    </RendererContext>
  );
}
