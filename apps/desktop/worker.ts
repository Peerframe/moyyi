import { productionConfiguration } from "./connection.ts";
import { createDesktopHost } from "./host/service.ts";
import { isWorkerRequest, type WorkerMessage } from "./wire.ts";

if (!process.send || !process.connected)
  throw Error("Desktop host requires its parent-owned IPC channel");
function publish(message: WorkerMessage): void {
  if (process.connected) process.send?.(message);
}
try {
  const configuration = productionConfiguration();
  const initial = await configuration.current();
  const host = await createDesktopHost({
    runtimeOptions: () => initial.runtimeOptions,
    settings: initial.settings,
    configure: configuration.save,
    connection: initial.connection,
    maxOutputTokens: 8192,
  });
  host.subscribe((state) => publish({ type: "state", state }));
  publish({ type: "state", state: host.getState() });
  let closing = false;
  let inFlight = 0;
  process.on("message", (message: unknown) => {
    if (!isWorkerRequest(message) || closing || inFlight >= 8) {
      publish({ type: "fatal", message: "桌面通讯无效，已停止接收操作。请重新打开应用。" });
      closing = true;
      void host.close().finally(() => process.disconnect?.());
      return;
    }
    inFlight++;
    void (async () => {
      try {
        await host.dispatch(message.command);
        publish({ type: "ack", id: message.id });
      } catch {
        publish({ type: "ack", id: message.id, error: host.getState().error ?? "操作未能完成。" });
      } finally {
        inFlight--;
      }
    })();
  });
  process.on("disconnect", () => {
    closing = true;
    void host.close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    closing = true;
    void host.close().finally(() => process.exit(0));
  });
} catch (error) {
  const locked = error instanceof Error && /lock|busy/i.test(error.message);
  publish({
    type: "fatal",
    message: locked
      ? "会话库正由另一个 moyyi 使用。请关闭 CLI 或另一桌面实例，再重新打开。"
      : "本地会话服务无法启动。请检查安装包与会话目录权限后重新打开；已有数据未删除。",
  });
  process.disconnect?.();
}
