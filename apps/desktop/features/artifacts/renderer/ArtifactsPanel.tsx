import { useLayoutEffect, useRef } from "react";
import type { DesktopArtifact, DesktopState } from "../../../shared.ts";
import { ArtifactCard } from "./ArtifactCard.tsx";
import { BoundedImage } from "../../../renderer/BoundedImage.tsx";
import { RichMessage } from "../../../renderer/RichMessage.tsx";
import { formatBytes } from "../../../renderer/view-state.ts";

export function ArtifactsPanel({
  artifacts,
  preview,
  busy,
  onPage,
  onOpen,
  onReveal,
  onClose,
  onSave,
}: {
  artifacts: DesktopState["artifacts"];
  preview: DesktopState["artifactPreview"];
  busy: boolean;
  onPage(offset: number): void;
  onOpen(artifact: DesktopArtifact): Promise<void>;
  onReveal(artifact: DesktopArtifact): Promise<void>;
  onClose(): void;
  onSave?(artifact: DesktopArtifact): Promise<void>;
}) {
  const previewSection = useRef<HTMLElement>(null);
  const previewEffectId = preview?.effectId;
  useLayoutEffect(() => {
    if (!previewEffectId) return;
    previewSection.current?.scrollIntoView({ behavior: "auto", block: "start" });
    previewSection.current?.focus({ preventScroll: true });
  }, [previewEffectId]);

  return (
    <section className="artifacts-panel" aria-label="报告成果">
      <div className="panel-heading">
        <h2>报告成果</h2>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => onPage(artifacts.offset)}
        >
          刷新回执
        </button>
      </div>
      <p className="panel-note">
        只显示实际创建的报告回执。打开时重新核对当前文件；生成回执不代表内容正确或完整。
      </p>
      {artifacts.items.length ? (
        artifacts.items.map((artifact) => (
          <ArtifactCard
            key={artifact.effectId}
            artifact={artifact}
            busy={busy}
            onOpen={() => onOpen(artifact)}
            onReveal={() => onReveal(artifact)}
            {...(onSave ? { onSave: () => onSave(artifact) } : {})}
          />
        ))
      ) : (
        <p className="panel-note">本页没有报告回执。</p>
      )}
      {artifacts.offset > 0 || artifacts.hasMore ? (
        <div className="artifact-pagination">
          <button
            type="button"
            disabled={busy || artifacts.offset === 0}
            onClick={() => onPage(Math.max(0, artifacts.offset - 20))}
          >
            上一页回执
          </button>
          <span className="panel-note">第 {Math.floor(artifacts.offset / 20) + 1} 页</span>
          <button
            type="button"
            disabled={busy || !artifacts.hasMore}
            onClick={() => onPage(artifacts.offset + 20)}
          >
            下一页回执
          </button>
        </div>
      ) : null}
      {preview ? (
        <section
          className="artifact-preview"
          aria-label="实际文件内容"
          ref={previewSection}
          tabIndex={-1}
        >
          <div className="panel-heading">
            <h3>实际文件内容</h3>
            <button type="button" disabled={busy} onClick={onClose}>
              关闭正文
            </button>
          </div>
          <p className="preview-path">
            {preview.path} · {formatBytes(preview.sourceBytes)}
          </p>
          <p className="hash-label">读取时 SHA-256：{preview.sha256}</p>
          <p className="panel-note">
            以下内容来自本次核对哈希后的文件；HTML、链接和远程图片不会执行或加载。
          </p>
          {preview.truncated ? (
            <p className="preview-warning" role="status">
              正文显示已截断，以下不是完整文件内容。
            </p>
          ) : null}
          {preview.image ? (
            <BoundedImage key={preview.sha256} image={preview.image} name={preview.path} />
          ) : preview.path.toLowerCase().endsWith(".md") ? (
            <RichMessage content={preview.text} />
          ) : (
            <pre>{preview.text}</pre>
          )}
        </section>
      ) : null}
    </section>
  );
}
