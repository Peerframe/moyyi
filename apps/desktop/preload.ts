import { contextBridge, ipcRenderer, webUtils } from "electron";
import { channels, stateChannel } from "./native/channels.ts";
import type { DesktopBridge, DesktopMaintenanceResult, DesktopState } from "./shared.ts";
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
const methods = Object.fromEntries(
  [...channels].map(([method, channel]) => [
    method,
    (options: unknown) => {
      if (channel.result === "maintenance") return maintenance(channel.name);
      if (channel.input === "files") {
        const input = options as Parameters<DesktopBridge["importFiles"]>[0];
        if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 8)
          return Promise.reject(Error("最多导入8份文件。"));
        const paths = input.files.map((file) => webUtils.getPathForFile(file));
        if (paths.some((path) => !path)) return Promise.reject(Error("请拖放本机实际文件。"));
        return state(ipcRenderer.invoke(channel.name, { sessionId: input.sessionId, paths }));
      }
      return state(
        channel.input === "none"
          ? ipcRenderer.invoke(channel.name)
          : ipcRenderer.invoke(channel.name, options),
      );
    },
  ]),
);
const bridge = {
  ...methods,
  subscribe(listener: (snapshot: DesktopState) => void) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isDesktopState(value)) listener(value);
    };
    ipcRenderer.on(stateChannel.name, handler);
    return () => {
      ipcRenderer.removeListener(stateChannel.name, handler);
    };
  },
} as DesktopBridge;
contextBridge.exposeInMainWorld("moyyi", bridge);
