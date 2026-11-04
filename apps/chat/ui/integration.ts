import type { ReactNode } from "react";
import type { ChatAction } from "../port.ts";

/** Optional host-owned controls. They never grant authority on their own. */
export interface ChatIntegration {
  readonly activeChatId: string | null;
  readonly onNew: () => void;
  readonly canSend: boolean;
  readonly busy: boolean;
  readonly onAttach: () => void;
  readonly header?: ReactNode;
  readonly beforeComposer?: ReactNode;
  readonly empty?: ReactNode;
  /** The host's safe rich-text renderer for assistant message bodies. */
  readonly renderText?: (text: string) => ReactNode;
  readonly supportedActions: readonly ChatAction["type"][];
}

export function supports(
  integration: ChatIntegration | undefined,
  action: ChatAction["type"],
): boolean {
  return !integration || integration.supportedActions.includes(action);
}

export function actionError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作没有完成，请重试。";
}
