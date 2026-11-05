import type { DesktopState } from "../shared.ts";

export interface PlanAvailability {
  /** The toggle can change: an open session that can continue, between runs. */
  readonly canChange: boolean;
  /** A plan-mode run has finished with an answer, so the plan can be executed. */
  readonly canExecute: boolean;
}

/** Plan mode (ADR 0054) changes only between runs, on a session that can continue. */
export function planAvailability(
  state: DesktopState,
  ui: { readonly busy: boolean; readonly newSession: boolean; readonly composerBlocked: boolean },
): PlanAvailability {
  const canChange =
    !!state.activeSessionId &&
    !ui.busy &&
    !state.historyOnly &&
    !ui.newSession &&
    !ui.composerBlocked &&
    state.status === "ready";
  return {
    canChange,
    canExecute:
      canChange && state.planMode && state.connection.ready && state.outcome?.kind === "completed",
  };
}

/** Shown above the composer while plan mode is on; executing is a host command. */
export function PlanModeNotice({
  state,
  availability,
  onExecute,
  onExit,
}: {
  state: DesktopState;
  availability: PlanAvailability;
  onExecute(): void;
  onExit(): void;
}) {
  if (!state.planMode || state.historyOnly) return null;
  return (
    <div className="ch-plan-mode" role="status">
      <p>
        计划模式：每条消息只做只读调查并给出计划；修改、命令和外部调用会被拒绝，不弹出审批。
        {state.outcome?.kind === "completed" && !state.run
          ? "核对上面的计划后，可以按计划执行。"
          : ""}
      </p>
      <div className="ch-plan-actions">
        <button
          type="button"
          className="primary"
          disabled={!availability.canExecute}
          onClick={onExecute}
        >
          按计划执行
        </button>
        <button type="button" disabled={!availability.canChange} onClick={onExit}>
          退出计划模式
        </button>
      </div>
    </div>
  );
}
