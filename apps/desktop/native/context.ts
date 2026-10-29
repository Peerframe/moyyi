import type { DesktopProcess } from "../bridge.ts";
import type { FeatureContract, IpcChannel } from "./contract.ts";

/** Main-owned lifetime and native selection gate; features never bypass the sending-window check. */
export interface NativeContext {
  readonly directory: string;
  readonly node: string;
  readonly window: Electron.BrowserWindow;
  host: DesktopProcess;
  selecting: boolean;
  readonly quitting: boolean;
  maintenanceDone: Promise<void> | undefined;
  startWorker(): DesktopProcess;
  releaseWorker(): void;
}
export interface NativeFeature<Contract extends FeatureContract> {
  readonly contract: Contract;
  readonly handlers: {
    [Method in keyof Contract["channels"]]: (
      context: NativeContext,
      value: Contract["channels"][Method] extends IpcChannel
        ? ReturnType<Contract["channels"][Method]["validate"]>
        : never,
    ) => Promise<unknown>;
  };
}
export async function currentSession(context: NativeContext, sessionId: string) {
  const state = await context.host.getState();
  if (
    context.selecting ||
    context.quitting ||
    state.run ||
    state.historyOnly ||
    state.status !== "ready" ||
    state.activeSessionId !== sessionId ||
    !state.workspaceRoot
  )
    throw Error("请先结束当前任务，并选择当前会话。 ");
  return state;
}
export function claimSelection(context: NativeContext): void {
  if (context.selecting || context.quitting) throw Error("请先完成或取消当前选择。 ");
  context.selecting = true;
}
