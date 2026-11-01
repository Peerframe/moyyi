import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";
import { SearchCard } from "./SearchCard.tsx";
import { SourcesPanel } from "./SourcesPanel.tsx";
import { WebAccessDialog } from "./WebAccessDialog.tsx";

function useController() {
  const [webAccessOpen, setWebAccessOpen] = useState(false);
  return { webAccessOpen, setWebAccessOpen };
}
function WebButton() {
  const { setWebAccessOpen, busy, configuring } = useDesktopUI();

  return (
    <>
      {!configuring ? (
        <button type="button" disabled={busy} onClick={() => setWebAccessOpen(true)}>
          网页访问
        </button>
      ) : null}
    </>
  );
}
function Sources() {
  const { state } = useDesktopUI();

  return <SourcesPanel sources={state.sources} />;
}
function WebDialog() {
  const { state, bridge, perform, webAccessOpen, setWebAccessOpen } = useDesktopUI();
  const searchConnection = state.connections.find(
    (connection) =>
      connection.id === state.searchConnectionId && connection.provider === "deepseek",
  );

  return (
    <>
      {webAccessOpen && state.activeSessionId && state.workspaceRoot ? (
        <WebAccessDialog
          key={state.activeSessionId}
          workspace={state.workspaceRoot}
          webAccess={state.webAccess}
          searchAvailable={searchConnection?.configured === true}
          {...(searchConnection ? { searchConnectionName: searchConnection.name } : {})}
          onConfigure={async (webAccess) => {
            const result = await perform(
              () =>
                bridge.configureWebAccess({
                  sessionId: state.activeSessionId as string,
                  ...webAccess,
                }),
              "未能确认网页访问变更，请核对当前状态。",
            );
            if (!result) throw Error("未能确认网页访问变更。");
            return result.webAccess;
          }}
          onClose={() => setWebAccessOpen(false)}
        />
      ) : null}
    </>
  );
}
declare module "../../../renderer/ui.ts" {
  interface FeatureUI {
    webAccessOpen: boolean;
    setWebAccessOpen: Dispatch<SetStateAction<boolean>>;
  }
}

export const rendererFeature: RendererFeature = {
  id: "web",
  useController,
  blocksComposer: (ui) => ui.webAccessOpen,
  messages: [{ id: "web.search", tool: "web_search", Component: SearchCard }],
  slots: [
    { id: "web.WebButton", slot: "header-actions", order: 10, Component: WebButton },
    { id: "web.Sources", slot: "after-messages", order: 40, Component: Sources },
    { id: "web.WebDialog", slot: "dialogs", order: 40, Component: WebDialog },
  ],
};
