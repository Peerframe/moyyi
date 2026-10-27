/* List/fold presentation narrowly adapted from OpenBot TaskSteps.tsx at
 * 010439bb9002fabb7e1facd8450ee85edbafa309. Copyright (c) 2026 OpenBot contributors.
 * MIT; see OPENBOT-LICENSE.txt. No upstream polling, domain state or authority is imported. */
import { Fragment, useState } from "react";
import type { DesktopEffect, DesktopState } from "../shared.ts";
import {
  effectsPageIdentity,
  inspectionLabel,
  processTerminationLabel,
  undoDraft,
  visibleEffects,
} from "./effects-state.ts";
import { toolStateLabel } from "./view-state.ts";

export function EffectsPanel({
  sessionId,
  effects,
  inspection,
  busy,
  onPage,
  onInspect,
  onDraft,
}: {
  sessionId: string;
  effects: DesktopState["effects"];
  inspection: DesktopState["effectInspection"];
  busy: boolean;
  onPage(offset: number): void;
  onInspect(effectId: string): void;
  onDraft(text: string): void;
}) {
  const unknown = effects.items.filter((effect) => effect.state === "unknown").length;
  return (
    <section className="effects-panel" aria-label="操作记录">
      <header className="panel-heading">
        <h2>操作记录</h2>
        <button type="button" disabled={busy} onClick={() => onPage(effects.offset)}>
          刷新记录
        </button>
      </header>
      <p className="panel-note">
        来自实际执行记录。历史回执不代表当前文件仍相同；命令退出码 0 不代表任务已全部通过。
      </p>
      {unknown ? (
        <p className="preview-warning" role="status">
          本页有 {unknown} 项结果未知，不能视为成功。可只读核对；后续修改可能被保护性阻止，
          重新授权也不会自动解锁。不要强制重试；恢复会话不会自动重放。
        </p>
      ) : null}
      <EffectRows
        key={effectsPageIdentity(sessionId, effects)}
        effects={effects}
        inspection={inspection}
        busy={busy}
        onInspect={onInspect}
        onDraft={onDraft}
      />
      {effects.offset > 0 || effects.hasMore ? (
        <div className="artifact-pagination">
          <button
            type="button"
            disabled={busy || effects.offset === 0}
            onClick={() => onPage(Math.max(0, effects.offset - 20))}
          >
            上一页操作
          </button>
          <span className="panel-note">第 {Math.floor(effects.offset / 20) + 1} 页</span>
          <button
            type="button"
            disabled={busy || !effects.hasMore}
            onClick={() => onPage(effects.offset + 20)}
          >
            下一页操作
          </button>
        </div>
      ) : null}
      <p className="panel-note">
        “准备撤销”只填入可编辑草稿，不执行操作。发送后会使用本轮模型预算；仍需开启文件修改权限并逐次批准。
      </p>
    </section>
  );
}

function EffectRows({
  effects,
  inspection,
  busy,
  onInspect,
  onDraft,
}: {
  effects: DesktopState["effects"];
  inspection: DesktopState["effectInspection"];
  busy: boolean;
  onInspect(effectId: string): void;
  onDraft(text: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = visibleEffects(effects.items, expanded);
  const hidden = effects.items.length - visible.length;
  if (!visible.length) return <p className="panel-note">本页没有操作记录。</p>;
  return (
    <ol className="effect-list">
      {visible.map((effect, index) => (
        <Fragment key={JSON.stringify([effect.runId, effect.effectId])}>
          <EffectRow
            effect={effect}
            inspection={inspection?.effectId === effect.effectId ? inspection : null}
            busy={busy}
            onInspect={onInspect}
            onDraft={onDraft}
          />
          {hidden > 0 && index === 2 ? (
            <li className="effect-fold">
              <button type="button" onClick={() => setExpanded(true)}>
                展开中间 {hidden} 项操作
              </button>
            </li>
          ) : null}
        </Fragment>
      ))}
    </ol>
  );
}

function EffectRow({
  effect,
  inspection,
  busy,
  onInspect,
  onDraft,
}: {
  effect: DesktopEffect;
  inspection: DesktopState["effectInspection"];
  busy: boolean;
  onInspect(effectId: string): void;
  onDraft(text: string): void;
}) {
  const receipt = effect.receipt;
  const draft = undoDraft(effect);
  return (
    <li className={`effect-row${effect.state === "unknown" ? " effect-unknown" : ""}`}>
      <div className="effect-row-heading">
        <strong>{effect.tool}</strong>
        <span>{toolStateLabel(effect.state)}</span>
      </div>
      {receipt?.kind === "file" ? (
        <>
          <p className="preview-path">{receipt.path}</p>
          <div className="material-actions">
            <button type="button" disabled={busy} onClick={() => onInspect(effect.effectId)}>
              核对当前文件
            </button>
            {draft ? (
              <button type="button" disabled={busy} onClick={() => onDraft(draft)}>
                准备撤销
              </button>
            ) : null}
          </div>
          {inspection ? (
            <p className="panel-note" role="status">
              {inspectionLabel(inspection.state)}
            </p>
          ) : null}
        </>
      ) : receipt?.kind === "process" ? (
        <p className="panel-note">
          {processTerminationLabel(receipt.termination)} · 退出码：{receipt.exitCode ?? "未确认"}
          {receipt.outputTruncated ? " · 输出已截断" : ""}
        </p>
      ) : (
        <p className="panel-note">没有可核验的文件或命令回执；请结合工具记录检查。</p>
      )}
      <details>
        <summary>记录详情</summary>
        <p className="hash-label">
          操作：{effect.effectId}
          <br />
          执行轮次：{effect.runId}
          <br />
          记录时间：{effect.updatedAt}
        </p>
        {receipt?.kind === "file" ? (
          <p className="hash-label">
            快照：{receipt.snapshotId}
            <br />
            修改前：{receipt.beforeHash ?? "文件不存在"}
            <br />
            修改后：{receipt.afterHash ?? "文件不存在"}
          </p>
        ) : null}
        {inspection ? (
          <p className="hash-label">
            预期 SHA-256：{inspection.expectedHash ?? "文件不存在"}
            <br />
            本次实际 SHA-256：{inspection.actualHash ?? "未取得文件哈希"}
          </p>
        ) : null}
      </details>
    </li>
  );
}
