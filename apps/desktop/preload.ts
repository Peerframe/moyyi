import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopAction,
  DesktopBridge,
  DesktopMaintenanceResult,
  DesktopState,
} from "./shared.ts";
import { isDesktopState, isMaintenanceResult } from "./wire.ts";

async function maintenance(channel: string): Promise<DesktopMaintenanceResult | null> {
  const value: unknown = await ipcRenderer.invoke(channel);
  if (value === null || isMaintenanceResult(value)) return value;
  throw Error("维护服务返回了无效结果。请重新打开应用核对。");
}

async function state(promise: Promise<unknown>): Promise<DesktopState> {
  const value = await promise;
  if (!isDesktopState(value)) throw Error("桌面服务返回了无效状态。");
  return value;
}
const bridge: DesktopBridge = {
  createBackup: () => maintenance("moyyi:backup"),
  restoreBackup: () => maintenance("moyyi:restore"),
  rollbackApplication: () => maintenance("moyyi:rollback"),
  getState: () => state(ipcRenderer.invoke("moyyi:state")),
  selectWorkspace: (options: { askEachRead: boolean }) =>
    state(ipcRenderer.invoke("moyyi:workspace", options)),
  act: (command: DesktopAction) => state(ipcRenderer.invoke("moyyi:act", command)),
  configure: (options) => state(ipcRenderer.invoke("moyyi:configure", options)),
  selectDocuments: (options) => state(ipcRenderer.invoke("moyyi:documents", options)),
  selectReportTarget: (options) => state(ipcRenderer.invoke("moyyi:report-target", options)),
  configurePermissions: (options) => state(ipcRenderer.invoke("moyyi:permissions", options)),
  revealArtifact: (options) => state(ipcRenderer.invoke("moyyi:reveal-artifact", options)),
  subscribe(listener: (snapshot: DesktopState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isDesktopState(value)) listener(value);
    };
    ipcRenderer.on("moyyi:state", handler);
    return () => {
      ipcRenderer.removeListener("moyyi:state", handler);
    };
  },
};
contextBridge.exposeInMainWorld("moyyi", bridge);
