import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { RendererFeature } from "../../../renderer/slot-types.ts";
import { useDesktopUI } from "../../../renderer/ui.ts";

function useController() {
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  return { preferencesOpen, setPreferencesOpen };
}
function PreferencesButton() {
  const { busy, bridge, perform, setPreferencesOpen, setSettingsOpen } = useDesktopUI();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        void perform(
          () => bridge.act({ type: "preferences.load" }),
          "个人设置读取失败，请核对本机文件。",
        ).then((result) => {
          if (result) {
            setSettingsOpen(false);
            setPreferencesOpen(true);
          }
        });
      }}
    >
      个人指令与 Skills
    </button>
  );
}
function PreferencesDialog() {
  const { preferencesOpen, setPreferencesOpen } = useDesktopUI();
  return preferencesOpen ? <PreferencesContent close={() => setPreferencesOpen(false)} /> : null;
}
function PreferencesContent({ close }: { close(): void }) {
  const { state, bridge, perform } = useDesktopUI();
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(state.preferences.personalInstructions);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function action(operation: () => ReturnType<typeof bridge.selectSkill>, message: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const next = await perform(operation, "个人设置操作未完成，请核对文件和已保存状态。");
      if (next) setNotice(message);
      else setError("操作未能确认完成。请检查已保存状态后再继续。");
    } finally {
      setPending(false);
    }
  }
  const p = state.preferences,
    review = p.review;
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby="preferences-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) close();
      }}
    >
      <header className="panel-heading">
        <h2 id="preferences-title">个人指令与 Skills</h2>
        <button type="button" disabled={pending} onClick={close}>
          关闭
        </button>
      </header>
      <section className="settings-fields">
        <h3>个人指令</h3>
        <p className="panel-note">
          每个会话使用，保存后从下一次模型请求生效。指令不能授予权限，安全规则优先。
        </p>
        <label>
          <span>指令正文（最多 8 KiB）</span>
          <textarea
            rows={6}
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <p className="panel-note">{new TextEncoder().encode(text).length} / 8192 字节</p>
        <button
          type="button"
          disabled={pending || new TextEncoder().encode(text).length > 8192}
          onClick={() =>
            void action(
              () => bridge.act({ type: "personal.save", text }),
              "个人指令已保存，下次请求生效。",
            )
          }
        >
          保存个人指令
        </button>
      </section>
      <section>
        <h3>Skills 库</h3>
        <p className="panel-note">只导入本机 SKILL.md。启用后模型按需读取；撤销不删除历史请求。</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => void action(() => bridge.selectSkill(), "已载入审查页；确认后才导入。")}
        >
          从本机导入
        </button>
        {p.skills.length === 0 ? (
          <p className="panel-note">尚未导入 Skill。选择包含 SKILL.md 的目录开始。</p>
        ) : (
          p.skills.map((skill) => (
            <article key={skill.sha256} className="artifact-card">
              <strong>{skill.name}</strong>
              <p>{skill.description}</p>
              <p className="panel-note">SHA-256：{skill.sha256}</p>
              <p className="panel-note">
                {skill.importedAt} · {skill.enabled ? "已启用" : "未启用"}
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void action(
                    () =>
                      bridge.act({
                        type: "skill.enable",
                        sha256: skill.sha256,
                        enabled: !skill.enabled,
                      }),
                    skill.enabled ? "Skill 已撤销。" : "Skill 已启用，同名其他版本已撤销。",
                  )
                }
              >
                {skill.enabled ? "撤销" : "启用此版本"}
              </button>
            </article>
          ))
        )}
      </section>
      {review ? (
        <section aria-label="Skill 审查" className="artifact-card">
          <h3>审查 {review.name}</h3>
          <p>{review.description}</p>
          <p className="panel-note">SHA-256：{review.sha256}</p>
          <p>allowed-tools 不改变权限；引用和脚本不会读取或执行。</p>
          <pre className="skill-review-body">{review.text}</pre>
          <p className="panel-note">
            未导入：{review.omitted.length ? review.omitted.join("、") : "没有其他文件"}
            {review.omittedTruncated ? "（文件列表已截断）" : ""}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void action(
                () => bridge.act({ type: "skill.import", reviewId: review.id }),
                "已导入不可变副本，尚未启用。",
              )
            }
          >
            确认导入
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void action(() => bridge.act({ type: "skill.dismiss" }), "已取消导入。")}
          >
            取消
          </button>
        </section>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="panel-note" role="status">
          {notice}
        </p>
      ) : null}
    </dialog>
  );
}
declare module "../../../renderer/ui.ts" {
  interface FeatureUI {
    preferencesOpen: boolean;
    setPreferencesOpen: Dispatch<SetStateAction<boolean>>;
  }
}
export const rendererFeature: RendererFeature = {
  id: "preferences",
  useController,
  blocksComposer: (ui) => ui.preferencesOpen,
  slots: [
    { id: "preferences.button", slot: "header-actions", order: 31, Component: PreferencesButton },
    { id: "preferences.dialog", slot: "dialogs", order: 21, Component: PreferencesDialog },
  ],
  settingsSections: [{ id: "preferences.entry", order: 10, Component: PreferencesButton }],
};
