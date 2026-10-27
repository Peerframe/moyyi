/* Presentation and pending/error feedback adapted from OpenBot ArtifactCard.tsx and
 * artifact-shell-save.ts at 010439bb9002fabb7e1facd8450ee85edbafa309.
 * Copyright (c) 2026 OpenBot contributors. MIT; see OPENBOT-LICENSE.txt.
 * moyyi resolves receipt identities in the host; no arbitrary URL or file path is opened. */
import { useEffect, useRef, useState } from "react";
import type { DesktopArtifact } from "../shared.ts";
import { artifactStateLabel, createActionGate } from "./view-state.ts";

export function ArtifactCard({
  artifact,
  busy,
  onOpen,
  onReveal,
}: {
  artifact: DesktopArtifact;
  busy: boolean;
  onOpen(): Promise<void>;
  onReveal(): Promise<void>;
}) {
  const gate = useRef(createActionGate());
  const mounted = useRef(true);
  const [action, setAction] = useState<"open" | "reveal" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function operate(next: "open" | "reveal") {
    if (busy || !gate.current.begin()) return;
    setAction(next);
    setError(null);
    setNotice(null);
    try {
      await (next === "open" ? onOpen() : onReveal());
      if (mounted.current && next === "reveal") setNotice("已请求在访达中显示，请查看访达窗口。");
    } catch {
      if (mounted.current) setError("操作未完成，请查看文件状态后重试。");
    } finally {
      gate.current.end();
      if (mounted.current) setAction(null);
    }
  }

  return (
    <article className="artifact-card" aria-label={`报告回执 ${artifact.path}`}>
      <div className="artifact-document-icon" aria-hidden="true">
        文档
      </div>
      <div className="artifact-card-label">
        <strong>{artifact.path}</strong>
        <small>{artifactStateLabel(artifact.state)}</small>
        <details>
          <summary>生成回执</summary>
          <p className="hash-label">生成时 SHA-256：{artifact.afterHash}</p>
        </details>
        <div className="material-actions">
          <button
            type="button"
            disabled={busy || action !== null}
            onClick={() => void operate("open")}
          >
            {action === "open" ? "正在检查文件…" : "打开报告"}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy || action !== null}
            onClick={() => void operate("reveal")}
          >
            {action === "reveal" ? "正在请求…" : "在访达显示"}
          </button>
        </div>
        {notice ? (
          <p className="panel-note" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}
