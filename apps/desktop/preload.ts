import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAction, DesktopBridge, DesktopState } from "./shared.ts";
import { isDesktopState } from "./wire.ts";

async function state(promise: Promise<unknown>): Promise<DesktopState> {
  const value = await promise;
  if (!isDesktopState(value)) throw Error("桌面服务返回了无效状态。");
  return value;
}
const bridge: DesktopBridge = {
  getState: () => state(ipcRenderer.invoke("moyyi:state")),
  selectWorkspace: (options: { askEachRead: boolean }) =>
    state(ipcRenderer.invoke("moyyi:workspace", options)),
  act: (command: DesktopAction) => state(ipcRenderer.invoke("moyyi:act", command)),
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
