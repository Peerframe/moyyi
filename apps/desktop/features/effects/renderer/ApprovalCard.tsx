/* Pending/error presentation adapted from OpenBot ApprovalCard.tsx at
 * 010439bb9002fabb7e1facd8450ee85edbafa309. Copyright (c) 2026 OpenBot contributors.
 * MIT; see OPENBOT-LICENSE.txt. Authority and digest binding remain in moyyi's host. */
import { useEffect, useRef, useState } from "react";
import { createActionGate } from "../../../renderer/view-state.ts";
import type { DesktopState } from "../../../shared.ts";

type Approval = NonNullable<DesktopState["pendingApproval"]>;

function searchPreview(preview: string | undefined) {
  if (!preview) return null;
  try {
    const value: unknown = JSON.parse(preview);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("kind" in value) ||
      value.kind !== "search" ||
      !("destination" in value) ||
      value.destination !== "https://api.deepseek.com/anthropic/v1/messages" ||
      !("query" in value) ||
      typeof value.query !== "string" ||
      value.query.length < 1 ||
      value.query.length > 2048 ||
      !("count" in value) ||
      typeof value.count !== "number" ||
      !Number.isInteger(value.count) ||
      value.count < 1 ||
      value.count > 10
    )
      return null;
    return { query: value.query, count: value.count, destination: value.destination };
  } catch {
    return null;
  }
}

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
  const search = searchPreview(approval.preview);

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
    <article className="approval-card" aria-label="待批准的操作">
      <header>需要你批准本次操作</header>
      <h2>{approval.summary}</h2>
      {search ? (
        <>
          <p className="approval-note">搜索词</p>
          <pre>{search.query}</pre>
          <dl className="source-metadata">
            <dt>最多返回结果</dt>
            <dd>{search.count} 条</dd>
            <dt>目标服务</dt>
            <dd className="preview-path">DeepSeek · {search.destination}</dd>
          </dl>
          <details>
            <summary>完整操作预览</summary>
            <pre>{approval.preview}</pre>
          </details>
        </>
      ) : approval.preview ? (
        <pre>{approval.preview}</pre>
      ) : null}
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
          {decision === "approve" ? "正在批准…" : "批准本次操作"}
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
