import { CHECK_DRAFT } from "../../../renderer/effects-state.ts";
import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";
import { approvalIdentity } from "../../../renderer/view-state.ts";
import type { DesktopApproval } from "../../../shared.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { EffectsPanel } from "./EffectsPanel.tsx";

function Approval() {
  const { state, bridge, setViewError } = useDesktopUI();
  async function approve(approval: DesktopApproval, decision: "approve" | "deny") {
    setViewError(null);
    await bridge.act({
      type: "approve",
      effectId: approval.effectId,
      digest: approval.digest,
      decision,
    });
  }
  return (
    <>
      {state.pendingApproval && state.run?.state === "running" ? (
        <ApprovalCard
          key={approvalIdentity(state.pendingApproval)}
          approval={state.pendingApproval}
          hostError={state.error}
          onDecide={approve}
        />
      ) : null}
    </>
  );
}
function CheckEntry() {
  const { prepareDraft, busy } = useDesktopUI();

  return (
    <div className="check-entry">
      <button type="button" disabled={busy} onClick={() => prepareDraft(CHECK_DRAFT)}>
        准备检查
      </button>
      <span className="panel-note">
        只填入可编辑请求，发送后使用模型预算；命令检查需另行授权和批准。
      </span>
    </div>
  );
}
function Effects() {
  const { state, act, prepareDraft, busy } = useDesktopUI();

  return (
    <EffectsPanel
      sessionId={state.activeSessionId as string}
      effects={state.effects}
      inspection={state.effectInspection}
      busy={busy}
      onPage={(offset) =>
        act({ type: "effects", sessionId: state.activeSessionId as string, offset })
      }
      onInspect={(effectId) =>
        act({
          type: "effect.inspect",
          sessionId: state.activeSessionId as string,
          effectId,
        })
      }
      onDraft={prepareDraft}
    />
  );
}
export const rendererFeature: RendererFeature = {
  id: "effects",
  slots: [
    { id: "effects.Approval", slot: "after-messages", order: 10, Component: Approval },
    { id: "effects.CheckEntry", slot: "after-messages", order: 30, Component: CheckEntry },
    { id: "effects.Effects", slot: "after-messages", order: 50, Component: Effects },
  ],
};
