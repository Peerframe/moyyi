import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { SettingsFields } from "./SettingsFields.tsx";
import { UsageGuide } from "./UsageGuide.tsx";

function useController() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  return { settingsOpen, setSettingsOpen, helpOpen, setHelpOpen };
}
function HelpButton() {
  const { setHelpOpen, busy } = useDesktopUI();

  return (
    <button type="button" disabled={busy} onClick={() => setHelpOpen(true)}>
      使用帮助
    </button>
  );
}
function SettingsButton() {
  const { setSettingsOpen, busy } = useDesktopUI();

  return (
    <button type="button" disabled={busy} onClick={() => setSettingsOpen(true)}>
      模型设置
    </button>
  );
}
function Help() {
  const { setSettingsOpen, helpOpen, setHelpOpen, setMaintenanceOpen } = useDesktopUI();

  return (
    <>
      {helpOpen ? (
        <UsageGuide
          onClose={() => setHelpOpen(false)}
          onSettings={() => {
            setHelpOpen(false);
            setSettingsOpen(true);
          }}
          onMaintenance={() => {
            setHelpOpen(false);
            setMaintenanceOpen(true);
          }}
        />
      ) : null}
    </>
  );
}
function Settings() {
  const { state, bridge, perform, settingsOpen, setSettingsOpen } = useDesktopUI();

  return (
    <>
      {settingsOpen ? (
        <SettingsDialog
          settings={state.settings}
          onConfigure={async (options) => {
            const result = await perform(
              () => bridge.configure(options),
              "设置未能确认应用。请重新打开模型设置核对，或处理系统授权后重试；已有密钥和会话未删除。",
            );
            if (!result) throw Error("设置未能确认应用。");
            return result;
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}
function ConnectionNotice() {
  const { state, setSettingsOpen, busy } = useDesktopUI();

  return (
    <>
      {!state.connection.ready ? (
        <div className="error error-banner" role="alert">
          <span>当前模型连接未就绪。已有会话仍可查看，材料仍可选择。</span>
          {state.connection.message ? <p>{state.connection.message}</p> : null}
          <button type="button" disabled={busy} onClick={() => setSettingsOpen(true)}>
            打开模型设置
          </button>
        </div>
      ) : null}
    </>
  );
}
declare module "../../../renderer/ui.ts" {
  interface FeatureUI {
    settingsOpen: boolean;
    setSettingsOpen: Dispatch<SetStateAction<boolean>>;
    helpOpen: boolean;
    setHelpOpen: Dispatch<SetStateAction<boolean>>;
  }
}

export const rendererFeature: RendererFeature = {
  id: "settings",
  useController,
  slots: [
    { id: "settings.HelpButton", slot: "header-actions", order: 0, Component: HelpButton },
    { id: "settings.SettingsButton", slot: "header-actions", order: 30, Component: SettingsButton },
    { id: "settings.Help", slot: "dialogs", order: 0, Component: Help },
    { id: "settings.Settings", slot: "dialogs", order: 20, Component: Settings },
    {
      id: "settings.ConnectionNotice",
      slot: "connection-notice",
      order: 0,
      Component: ConnectionNotice,
    },
  ],
  settingsSections: [{ id: "settings.connection", order: 0, Component: SettingsFields }],
};
