import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { permissionLabel } from "../../../renderer/effects-state.ts";
import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";
import { presetLabel } from "../../../renderer/view-state.ts";
import { PermissionsDialog } from "./PermissionsDialog.tsx";

function useController() {
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  return { permissionsOpen, setPermissionsOpen };
}
function PermissionsButton() {
  const { setPermissionsOpen, busy, configuring } = useDesktopUI();

  return (
    <>
      {!configuring ? (
        <button type="button" disabled={busy} onClick={() => setPermissionsOpen(true)}>
          会话权限
        </button>
      ) : null}
    </>
  );
}
function PermissionsDialogSlot() {
  const { state, bridge, perform, permissionsOpen, setPermissionsOpen } = useDesktopUI();

  return (
    <>
      {permissionsOpen && state.activeSessionId && state.workspaceRoot ? (
        <PermissionsDialog
          key={state.activeSessionId}
          workspace={state.workspaceRoot}
          permissions={state.permissions}
          onConfigure={async (permissions) => {
            const result = await perform(
              () =>
                bridge.configurePermissions({
                  sessionId: state.activeSessionId as string,
                  ...permissions,
                }),
              "未能确认权限变更，请核对当前状态。",
            );
            if (!result) throw Error("未能确认权限变更。");
            return result.permissions;
          }}
          onClose={() => setPermissionsOpen(false)}
        />
      ) : null}
    </>
  );
}
function PermissionLine() {
  const { state, configuring } = useDesktopUI();
  const requestBudget =
    state.budgets.maxRequests === null
      ? "请求预算尚未加载"
      : `每轮最多 ${state.budgets.maxRequests} 次请求`;
  return (
    <p className="permission-line">
      {presetLabel(state.settings.preset)} ·{" "}
      {state.settings.preset === "flash" ? "low" : (state.settings.kimiReasoningEffort ?? "low")} ·{" "}
      {requestBudget} · {state.settings.timeoutMs / 1000} 秒 · 输出 8192 tokens · 重试 0 次
      {state.settings.evidenceAnswer ? " · 独立证据成文（实验）" : ""}
      <br />
      {configuring
        ? "只读所选工作目录 · 不写入文件、不执行命令、不访问网页"
        : permissionLabel(state.permissions, state.reportTarget, state.webAccess)}
      {!configuring ? ` · ${state.askEachRead ? "工具读取逐次审批" : "工具读取已授权"}` : ""}
    </p>
  );
}
declare module "../../../renderer/ui.ts" {
  interface FeatureUI {
    permissionsOpen: boolean;
    setPermissionsOpen: Dispatch<SetStateAction<boolean>>;
  }
}

export const rendererFeature: RendererFeature = {
  id: "permissions",
  useController,
  slots: [
    {
      id: "permissions.PermissionsButton",
      slot: "header-actions",
      order: 20,
      Component: PermissionsButton,
    },
    {
      id: "permissions.PermissionsDialogSlot",
      slot: "dialogs",
      order: 30,
      Component: PermissionsDialogSlot,
    },
    {
      id: "permissions.PermissionLine",
      slot: "permission-line",
      order: 0,
      Component: PermissionLine,
    },
  ],
};
