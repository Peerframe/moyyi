import type { DesktopMaterial, DesktopPermissions } from "../shared.ts";
import { formatBytes } from "./view-state.ts";

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
}) {
  return (
    <section className="materials-panel" aria-label="材料与报告">
      <div className="material-actions">
        <button type="button" disabled={busy} onClick={onSelect}>
          选择材料
        </button>
        <button type="button" disabled={busy} onClick={onSelectReport}>
          {reportTarget ? "更换报告位置" : "选择报告位置"}
        </button>
        <span className="panel-note">{materials.length} / 8 份材料</span>
      </div>
      <p className="panel-note">
        仅选择工作目录内的
        PDF、DOCX、XLSX、PPTX、ODT、ODS、ODP。选中后尚未读取正文，发送任务后由工具读取。
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
