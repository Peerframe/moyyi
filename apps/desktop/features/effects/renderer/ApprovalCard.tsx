/* Pending/error presentation adapted from OpenBot ApprovalCard.tsx at
 * 010439bb9002fabb7e1facd8450ee85edbafa309. Copyright (c) 2026 OpenBot contributors.
 * MIT; see OPENBOT-LICENSE.txt. Authority and digest binding remain in moyyi's host. */
import { useEffect, useRef, useState } from "react";
import { createActionGate } from "../../../renderer/view-state.ts";
import type { DesktopState } from "../../../shared.ts";

type Approval = NonNullable<DesktopState["pendingApproval"]>;

export function ApprovalCard({
  approval,
  hostError,
  onDecide,
}: {
  approval: Approval;
  hostError: string | null;
  onDecide(approval: Approval, decision: "approve" | "deny", scope?: "session"): Promise<void>;
}) {
  const gate = useRef(createActionGate());
  const [decision, setDecision] = useState<"approve" | "deny" | "always" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!hostError) return;
    gate.current.end();
    setDecision(null);
  }, [hostError]);

  async function decide(next: "approve" | "deny" | "always") {
    if (!gate.current.begin()) return;
    setDecision(next);
    setError(null);
    try {
      if (next === "always") await onDecide(approval, "approve", "session");
      else await onDecide(approval, next);
      // An ACK does not prove the effect ran. Wait for the host to replace this card.
    } catch (cause) {
      if (!mounted.current) return;
      gate.current.end();
      setDecision(null);
      setError(cause instanceof Error ? cause.message : "审批未能送达，请稍后重试。");
    }
  }

  return (
    <article className="approval-card" aria-label="待批准的操作">
      <header>需要你批准本次操作</header>
      <h2>{approval.summary}</h2>
      {approval.preview ? <pre>{approval.preview}</pre> : null}
      <p className="approval-note">本次选择只针对上面显示的动作。</p>
      <div className="approval-actions">
        <button type="button" disabled={decision !== null} onClick={() => void decide("deny")}>
          {decision === "deny" ? "正在拒绝…" : "拒绝"}
        </button>
        <button type="button" disabled={decision !== null} onClick={() => void decide("always")}>
          {decision === "always" ? "正在批准…" : "本会话始终允许"}
        </button>
        <button
          className="primary"
          type="button"
          disabled={decision !== null}
          onClick={() => void decide("approve")}
        >
          {decision === "approve" ? "正在批准…" : "批准本次操作"}
        </button>
      </div>
      <p className="approval-note">
        “本会话始终允许”会批准本次，并在本会话内不再询问同一工具（命令只限完全相同的一条）；重新打开会话即失效，拒绝和撤销授权仍然有效。
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
