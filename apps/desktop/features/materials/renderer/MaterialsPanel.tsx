import { BoundedImage } from "../../../renderer/BoundedImage.tsx";
import { RichMessage } from "../../../renderer/RichMessage.tsx";
import { formatBytes } from "../../../renderer/view-state.ts";
import type {
  DesktopManagedMaterial,
  DesktopMaterial,
  DesktopPermissions,
  DesktopState,
} from "../../../shared.ts";

export function MaterialsPanel({
  materials,
  reportTarget,
  permissions,
  busy,
  running,
  onSelect,
  onRemove,
  onSelectReport,
  onClearReport,
  library,
  preview,
  onLibrary,
  onManage,
  onAttach,
  onHousekeeping,
  onDrop,
  onPaste,
}: {
  materials: readonly DesktopMaterial[];
  reportTarget: string | null;
  permissions: DesktopPermissions;
  busy: boolean;
  running: boolean;
  onSelect(): void;
  onRemove(path: string): void;
  onSelectReport(): void;
  onClearReport(): void;
  library?: DesktopState["library"];
  preview?: DesktopState["materialPreview"];
  onLibrary?(offset: number): void;
  onManage?(
    item: DesktopManagedMaterial,
    action: "recycle" | "restore" | "purge" | "preview",
  ): void;
  onAttach?(ids: readonly string[]): void;
  onHousekeeping?(enabled: boolean): void;
  onDrop?(files: readonly File[]): void;
  onPaste?(): void;
}) {
  return (
    <section
      className="materials-panel"
      aria-label="材料与报告"
      onDragOver={(event) => {
        if (onDrop && !busy) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!busy && event.dataTransfer.files.length)
          onDrop?.(Array.from(event.dataTransfer.files));
      }}
      onPaste={(event) => {
        if (
          !busy &&
          Array.from(event.clipboardData.items).some((item) => item.type.startsWith("image/"))
        ) {
          event.preventDefault();
          onPaste?.();
        }
      }}
    >
      <div className="material-actions">
        <button type="button" disabled={busy} onClick={onSelect}>
          导入材料
        </button>
        <button type="button" disabled={busy} onClick={onSelectReport}>
          {reportTarget ? "更换报告位置" : "选择报告位置"}
        </button>
        {onPaste ? (
          <button type="button" disabled={busy} onClick={onPaste}>
            粘贴图片
          </button>
        ) : null}
        <span className="panel-note">{materials.length} / 8 份材料</span>
      </div>
      <p className="panel-note">
        可选择或拖入外部文档、文本、PNG/JPEG。每份最多10MiB，选中最多8份；原件按哈希保存并生成工作区副本，不自动上传。尚未读取正文，发送后由工具读取。支持
        PDF、DOCX、XLSX、PPTX、ODT、ODS、ODP 及文本。图片目前仅供本地预览，不做OCR或发送给模型。
      </p>
      <p className="panel-note">
        选定报告位置后，会关闭文件修改与命令检查的会话授权，仅保留该报告的创建审批。
      </p>
      {materials.length ? (
        <ul className="material-list">
          {materials.map((material) => (
            <li key={material.path}>
              <details>
                <summary>
                  <span>{material.path}</span>
                  <small>
                    {material.format} · {formatBytes(material.sourceBytes)}
                  </small>
                </summary>
                <p className="hash-label">选择时 SHA-256：{material.sha256}</p>
              </details>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => onRemove(material.path)}
                aria-label={`移除材料 ${material.path}`}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {onLibrary ? (
        <details className="material-library">
          <summary>材料库与回收站</summary>
          <p className="panel-note">
            回收仅移出当前材料选择，原件与工作区副本仍保留，不撤销已有读取权限。已关联会话的原件不能清除；会话移入回收站仍保留引用。
          </p>
          <div className="library-controls">
            <button disabled={busy} type="button" onClick={() => onLibrary(library?.offset ?? 0)}>
              刷新材料库
            </button>
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={library?.housekeeping ?? false}
                onChange={(e) => onHousekeeping?.(e.target.checked)}
              />
              自动回收30天未关联材料（默认关闭）
            </label>
          </div>
          {library?.items.map((item) => (
            <article key={item.id} className="material-library-item">
              <strong>{item.name}</strong>
              <p className="panel-note">
                {item.state === "active"
                  ? "可用"
                  : item.state === "pending"
                    ? "导入中断，需恢复"
                    : "回收站"}{" "}
                · {formatBytes(item.sourceBytes)} · 已关联 {item.referenceCount} 个会话
              </p>
              <details>
                <summary>来源与哈希</summary>
                <p>{item.path}</p>
                <p className="hash-label">{item.sha256}</p>
              </details>
              <div className="library-controls">
                {item.state === "active" ? (
                  <>
                    <button
                      disabled={
                        busy || materials.length >= 8 || materials.some((m) => m.path === item.path)
                      }
                      type="button"
                      onClick={() => onAttach?.([item.id])}
                    >
                      加入当前任务
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() => onManage?.(item, "preview")}
                    >
                      预览材料
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() => onManage?.(item, "recycle")}
                    >
                      移入材料回收站
                    </button>
                  </>
                ) : (
                  <button disabled={busy} type="button" onClick={() => onManage?.(item, "restore")}>
                    恢复材料
                  </button>
                )}
                {item.state === "recycled" ? (
                  <button
                    disabled={busy || item.referenceCount > 0}
                    type="button"
                    onClick={() => onManage?.(item, "purge")}
                  >
                    移除无引用记录与副本
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          <div className="library-controls">
            <button
              disabled={busy || !library?.offset}
              type="button"
              onClick={() => onLibrary(Math.max(0, (library?.offset ?? 0) - 20))}
            >
              上一页材料
            </button>
            <button
              disabled={busy || !library?.hasMore}
              type="button"
              onClick={() => onLibrary((library?.offset ?? 0) + 20)}
            >
              下一页材料
            </button>
          </div>
          <p className="panel-note">
            清除不擦除共享存储字节；历史、撤销快照和备份可能仍引用相同内容。
          </p>
        </details>
      ) : null}
      {preview ? (
        <section className="artifact-preview" aria-label="材料预览">
          <h3>材料预览</h3>
          <p>{preview.path}</p>
          <p className="hash-label">SHA-256：{preview.sha256}</p>
          {preview.image ? (
            <BoundedImage key={preview.sha256} image={preview.image} name={preview.path} />
          ) : (
            <RichMessage content={preview.text} />
          )}
          {preview.truncated ? <p role="status">显示已截断；这不是完整正文。</p> : null}
        </section>
      ) : null}
      {reportTarget ? (
        <div className="report-target">
          <div>
            <strong>报告位置：{reportTarget}</strong>
            <p className="panel-note">
              仅允许创建这个新文件；实际创建仍需逐次批准。不能覆盖其他文件。
            </p>
            {running ? (
              <p className="panel-note">运行中需先停止，收尾完成后可撤销报告授权。</p>
            ) : null}
          </div>
          <button type="button" disabled={busy} onClick={onClearReport}>
            撤销报告授权
          </button>
        </div>
      ) : permissions.writes || permissions.checks ? (
        <p className="panel-note">
          当前已允许提议{permissions.writes ? "文件修改" : ""}
          {permissions.writes && permissions.checks ? "和" : ""}
          {permissions.checks ? "Node 命令检查" : ""}，每次操作仍需批准。 也可选择一个新的
          .md、.txt、.csv 或 .json 文件作为单独报告位置。
        </p>
      ) : (
        <p className="panel-note">
          当前为只读任务。需要生成报告时，先选择一个新的 .md、.txt、.csv 或 .json 文件位置。
        </p>
      )}
    </section>
  );
}
