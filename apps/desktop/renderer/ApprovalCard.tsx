/* Pending/error presentation adapted from OpenBot ApprovalCard.tsx at
 * 010439bb9002fabb7e1facd8450ee85edbafa309. Copyright (c) 2026 OpenBot contributors.
 * MIT; see OPENBOT-LICENSE.txt. Authority and digest binding remain in moyyi's host. */
import { useEffect, useRef, useState } from "react";
import type { DesktopState } from "../shared.ts";
import { createActionGate } from "./view-state.ts";

type Approval = NonNullable<DesktopState["pendingApproval"]>;

export function ApprovalCard({
  approval,
  hostError,
  onDecide,
}: {
  approval: Approval;
  hostError: string | null;
  onDecide(approval: Approval, decision: "approve" | "deny"): Promise<void>;
}) {
  const gate = useRef(createActionGate());
  const [decision, setDecision] = useState<"approve" | "deny" | null>(null);
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

  async function decide(next: "approve" | "deny") {
    if (!gate.current.begin()) return;
    setDecision(next);
    setError(null);
    try {
      await onDecide(approval, next);
      // An ACK does not prove the effect ran. Wait for the host to replace this card.
    } catch (cause) {
      if (!mounted.current) return;
      gate.current.end();
      setDecision(null);
      setError(cause instanceof Error ? cause.message : "审批未能送达，请稍后重试。");
    }
  }

  return (
    <article className="approval-card" aria-label="待批准的读取">
      <header>需要你批准这次读取</header>
      <h2>{approval.summary}</h2>
      {approval.preview ? <pre>{approval.preview}</pre> : null}
      <p className="approval-note">本次选择只针对上面显示的动作。</p>
      <div className="approval-actions">
        <button type="button" disabled={decision !== null} onClick={() => void decide("deny")}>
          {decision === "deny" ? "正在拒绝…" : "拒绝"}
        </button>
        <button
          className="primary"
          type="button"
          disabled={decision !== null}
          onClick={() => void decide("approve")}
        >
          {decision === "approve" ? "正在批准…" : "批准这次读取"}
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
