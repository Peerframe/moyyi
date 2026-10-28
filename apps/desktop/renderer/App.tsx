import { useEffect, useRef, useState } from "react";
import type {
  DesktopAction,
  DesktopApproval,
  DesktopArtifact,
  DesktopBridge,
  DesktopState,
} from "../shared.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ArtifactsPanel } from "./ArtifactsPanel.tsx";
import { EffectsPanel } from "./EffectsPanel.tsx";
import { appendReviewDraft, CHECK_DRAFT, permissionLabel } from "./effects-state.ts";
import { MaintenanceDialog } from "./MaintenanceDialog.tsx";
import { MaterialsPanel } from "./MaterialsPanel.tsx";
import { MessageList } from "./MessageList.tsx";
import { PermissionsDialog } from "./PermissionsDialog.tsx";
import { SessionSidebar } from "./SessionSidebar.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { SourcesPanel } from "./SourcesPanel.tsx";
import { presetLabel } from "./settings-state.ts";
import { UsageGuide } from "./UsageGuide.tsx";
import {
  approvalIdentity,
  createActionGate,
  createSnapshotReceiver,
  outcomeLabel,
  workspaceName,
} from "./view-state.ts";
import { WebAccessDialog } from "./WebAccessDialog.tsx";

export function App({ bridge }: { bridge: DesktopBridge }) {
  const [state, setState] = useState<DesktopState | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newSession, setNewSession] = useState(false);
  const [askEachRead, setAskEachRead] = useState(false);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [webAccessOpen, setWebAccessOpen] = useState(false);
  const gate = useRef(createActionGate());
  const composer = useRef<HTMLTextAreaElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const receiver = createSnapshotReceiver<DesktopState>(setState);
    const unsubscribe = bridge.subscribe(receiver.receive);
    void receiver
      .hydrate(() => bridge.getState())
      .catch((cause: unknown) => {
        if (mounted.current) setViewError(errorMessage(cause));
      });
    return () => {
      mounted.current = false;
      receiver.dispose();
      unsubscribe();
    };
  }, [bridge]);

  const lastMessage = state?.messages.at(-1);
  const scrollMarker = `${lastMessage?.id ?? ""}:${lastMessage?.text.length ?? 0}:${state?.streamText.length ?? 0}:${state?.pendingApproval?.digest ?? ""}`;
  useEffect(() => {
    if (!scrollMarker || !followOutput.current || !scrollArea.current) return;
    scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [scrollMarker]);

  async function perform(
    operation: () => Promise<DesktopState>,
    failureMessage?: string,
  ): Promise<DesktopState | null> {
    if (!gate.current.begin()) return null;
    setPending(true);
    setViewError(null);
    try {
      // State is delivered through the subscription; a delayed ACK cannot overwrite it.
      return await operation();
    } catch (cause) {
      if (mounted.current) setViewError(failureMessage ?? errorMessage(cause));
      return null;
    } finally {
      gate.current.end();
      if (mounted.current) setPending(false);
    }
  }

  async function selectWorkspace() {
    const result = await perform(() => bridge.selectWorkspace({ askEachRead }));
    if (result?.activeSessionId && result.activeSessionId !== state?.activeSessionId) {
      setNewSession(false);
      setDraft("");
      followOutput.current = true;
    }
  }

  async function loadSession(sessionId: string) {
    const result = await perform(() => bridge.act({ type: "load", sessionId, askEachRead }));
    if (result?.activeSessionId === sessionId) {
      setNewSession(false);
      setDraft("");
      followOutput.current = true;
    }
  }

  async function send() {
    if (
      !state?.activeSessionId ||
      state.run ||
      !state.connection.ready ||
      settingsOpen ||
      helpOpen ||
      maintenanceOpen ||
      permissionsOpen ||
      webAccessOpen ||
      newSession ||
      !draft.trim()
    )
      return;
    const text = draft;
    const result = await perform(() =>
      bridge.act({ type: "start", sessionId: state.activeSessionId as string, text }),
    );
    if (result) {
      setDraft((current) => (current === text ? "" : current));
      followOutput.current = true;
    }
  }

  async function approve(approval: DesktopApproval, decision: "approve" | "deny") {
    setViewError(null);
    await bridge.act({
      type: "approve",
      effectId: approval.effectId,
      digest: approval.digest,
      decision,
    });
  }

  function act(command: DesktopAction) {
    void perform(() => bridge.act(command));
  }

  function prepareDraft(text: string) {
    if (!state?.activeSessionId || state.run || pending || state.status !== "ready") return;
    const next = appendReviewDraft(draft, text);
    if (next.length > 16_000) {
      setViewError("当前草稿太长，请先整理内容后再准备新的请求。");
      return;
    }
    setDraft(next);
    setViewError(null);
    composer.current?.focus();
  }

  async function artifactAction(artifact: DesktopArtifact, reveal: boolean) {
    if (!state?.activeSessionId) throw Error("请先打开会话。");
    const identity = { sessionId: state.activeSessionId, effectId: artifact.effectId };
    const result = await perform(() =>
      reveal ? bridge.revealArtifact(identity) : bridge.act({ type: "artifact.open", ...identity }),
    );
    if (!result) throw Error("报告操作未完成。");
  }

  if (!state)
    return (
      <main className="boot-screen">
        <h1>moyyi</h1>
        <p role="status">
          {viewError ? "桌面连接未能就绪。请关闭并重新打开应用。" : "正在打开本机会话…"}
        </p>
        {viewError ? (
          <p className="error" role="alert">
            {viewError}
          </p>
        ) : null}
      </main>
    );

  const busy = pending || state.run !== null || state.status !== "ready";
  const configuring = newSession || !state.activeSessionId;
  const error = viewError ?? state.error;
  const canSend =
    !busy &&
    !configuring &&
    !settingsOpen &&
    !helpOpen &&
    !maintenanceOpen &&
    !permissionsOpen &&
    !webAccessOpen &&
    state.connection.ready &&
    draft.trim().length > 0;
  const requestBudget =
    state.budgets.maxRequests === null
      ? "请求预算尚未加载"
      : `每轮最多 ${state.budgets.maxRequests} 次请求`;
  const runStatus =
    state.run?.state === "cancelling"
      ? "正在停止…"
      : state.pendingApproval
        ? "等待你的批准"
        : state.run
          ? "正在处理…"
          : "";

  return (
    <div className="app-shell">
      <SessionSidebar
        state={state}
        busy={busy}
        newSession={configuring}
        askEachRead={askEachRead}
        onAskEachRead={setAskEachRead}
        onNew={() => {
          setNewSession(true);
          setViewError(null);
        }}
        onLoad={(id) => void loadSession(id)}
        onList={(offset) => act({ type: "list", offset })}
      />
      <main className="conversation">
        <header className="conversation-header">
          <div>
            <h1>{configuring ? "新会话" : workspaceName(state.workspaceRoot)}</h1>
            <p className="workspace-label">
              {configuring ? "选择一个目录，开始只读任务" : state.workspaceRoot}
            </p>
          </div>
          <div className="header-actions">
            <button type="button" disabled={busy} onClick={() => setHelpOpen(true)}>
              使用帮助
            </button>
            {!configuring ? (
              <button type="button" disabled={busy} onClick={() => setWebAccessOpen(true)}>
                网页访问
              </button>
            ) : null}
            {!configuring ? (
              <button type="button" disabled={busy} onClick={() => setPermissionsOpen(true)}>
                会话权限
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => setSettingsOpen(true)}>
              模型设置
            </button>
            {!configuring ? (
              <button type="button" disabled={busy} onClick={() => setNewSession(true)}>
                切换目录
              </button>
            ) : null}
          </div>
        </header>
        <p className="permission-line">
          {presetLabel(state.settings.preset)} ·{" "}
          {state.settings.preset === "flash"
            ? "low"
            : (state.settings.kimiReasoningEffort ?? "low")}{" "}
          · {requestBudget} · {state.settings.timeoutMs / 1000} 秒 · 输出 8192 tokens · 重试 0 次
          {state.settings.evidenceAnswer ? " · 独立证据成文（实验）" : ""}
          <br />
          {configuring
            ? "只读所选工作目录 · 不写入文件、不执行命令、不访问网页"
            : permissionLabel(state.permissions, state.reportTarget, state.webAccess)}
          {!configuring ? ` · ${state.askEachRead ? "工具读取逐次审批" : "工具读取已授权"}` : ""}
        </p>
        {!state.connection.ready ? (
          <div className="error error-banner" role="alert">
            <span>当前模型连接未就绪。已有会话仍可查看，材料仍可选择。</span>
            {state.connection.message ? <p>{state.connection.message}</p> : null}
            <button type="button" disabled={busy} onClick={() => setSettingsOpen(true)}>
              打开模型设置
            </button>
          </div>
        ) : null}
        {error ? (
          <p className="error error-banner" role="alert">
            {error}
          </p>
        ) : null}
        {state.status !== "ready" ? (
          <p className="error-banner" role="status">
            {state.status === "closing" ? "正在安全关闭会话…" : "连接已关闭，请重新打开应用。"}
          </p>
        ) : null}
        <div
          className="messages"
          ref={scrollArea}
          onScroll={() => {
            const area = scrollArea.current;
            if (area)
              followOutput.current = area.scrollHeight - area.scrollTop - area.clientHeight < 90;
          }}
        >
          <div className="message-column">
            {configuring ? (
              <section className="empty-state">
                <h2>从你的工作目录开始</h2>
                <p>选择需要分析的项目或材料目录。moyyi 可以读取其中的文件，回答问题并给出来源。</p>
                <div className="workspace-choice">
                  <button
                    className="primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void selectWorkspace()}
                  >
                    选择工作目录
                  </button>
                </div>
                <p className="setup-note">
                  {askEachRead ? "工具读取会逐次请求你的批准。" : "目录内的工具读取将直接执行。"}{" "}
                  可在左侧调整后再打开会话。
                </p>
              </section>
            ) : (
              <>
                {state.openedHistory ? (
                  <p className="history-notice" role="status">
                    已打开历史会话。打开时已关闭文件修改、命令检查与网页访问权限，历史动作不会自动重放。
                    当前权限以上方状态为准；已停止不代表已撤销，结果未知时需先检查。
                  </p>
                ) : null}
                <MaterialsPanel
                  materials={state.materials}
                  reportTarget={state.reportTarget}
                  permissions={state.permissions}
                  busy={busy}
                  running={state.run !== null}
                  onSelect={() =>
                    void perform(() =>
                      bridge.selectDocuments({ sessionId: state.activeSessionId as string }),
                    )
                  }
                  onRemove={(path) =>
                    act({
                      type: "material.remove",
                      sessionId: state.activeSessionId as string,
                      path,
                    })
                  }
                  onSelectReport={() =>
                    void perform(() =>
                      bridge.selectReportTarget({ sessionId: state.activeSessionId as string }),
                    )
                  }
                  onClearReport={() =>
                    act({ type: "report.clear", sessionId: state.activeSessionId as string })
                  }
                />
                {state.messages.length === 0 && !state.run ? (
                  <section className="empty-state">
                    <h2>想了解这个目录里的什么？</h2>
                    <p>说明要分析的问题，moyyi 会在本轮预算内读取文件并回答。</p>
                  </section>
                ) : null}
                <MessageList
                  messages={state.messages}
                  historyTruncated={state.historyTruncated}
                  streamText={state.streamText}
                  running={state.run !== null}
                />
                {state.pendingApproval && state.run?.state === "running" ? (
                  <ApprovalCard
                    key={approvalIdentity(state.pendingApproval)}
                    approval={state.pendingApproval}
                    hostError={state.error}
                    onDecide={approve}
                  />
                ) : null}
                {state.outcome && !state.run ? (
                  <p className="outcome" role="status">
                    {outcomeLabel(state.outcome)}
                  </p>
                ) : null}
                <div className="check-entry">
                  <button type="button" disabled={busy} onClick={() => prepareDraft(CHECK_DRAFT)}>
                    准备检查
                  </button>
                  <span className="panel-note">
                    只填入可编辑请求，发送后使用模型预算；命令检查需另行授权和批准。
                  </span>
                </div>
                <SourcesPanel sources={state.sources} />
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
                <ArtifactsPanel
                  artifacts={state.artifacts}
                  preview={state.artifactPreview}
                  busy={busy}
                  onPage={(offset) =>
                    act({ type: "artifacts", sessionId: state.activeSessionId as string, offset })
                  }
                  onOpen={(artifact) => artifactAction(artifact, false)}
                  onReveal={(artifact) => artifactAction(artifact, true)}
                  onClose={() => act({ type: "artifact.close" })}
                />
              </>
            )}
          </div>
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="compose-column">
            <div className="composer-box">
              <textarea
                ref={composer}
                aria-label="任务内容"
                placeholder={configuring ? "先选择工作目录" : "描述你想分析的问题…"}
                value={draft}
                disabled={configuring || state.status !== "ready"}
                maxLength={16000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey) &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (canSend) void send();
                  }
                }}
              />
              <div className="composer-actions">
                <span className="composer-hint" role="status">
                  {runStatus || "⌘ Enter 发送 · Enter 换行"}
                </span>
                {state.run ? (
                  <button
                    type="button"
                    className="danger"
                    disabled={pending || state.run.state === "cancelling"}
                    onClick={() => state.run && act({ type: "cancel", runId: state.run.id })}
                  >
                    {state.run.state === "cancelling" ? "正在停止…" : "停止"}
                  </button>
                ) : (
                  <button className="primary" type="submit" disabled={!canSend}>
                    {pending ? "正在处理…" : "发送"}
                  </button>
                )}
              </div>
            </div>
            <p className="composer-footer">
              回答需结合来源核对；停止保留记录，也不会撤销已经完成的修改。
            </p>
          </div>
        </form>
      </main>
      {helpOpen ? (
        <UsageGuide
          onClose={() => setHelpOpen(false)}
          onSettings={() => {
            setHelpOpen(false);
            setSettingsOpen(true);
          }}
          onMaintenance={() => {
            setHelpOpen(false);
            setMaintenanceOpen(true);
          }}
        />
      ) : null}
      {maintenanceOpen ? (
        <MaintenanceDialog bridge={bridge} onClose={() => setMaintenanceOpen(false)} />
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          settings={state.settings}
          onConfigure={async (options) => {
            const result = await perform(
              () => bridge.configure(options),
              "设置未能确认应用。请重新打开模型设置核对，或处理系统授权后重试；已有密钥和会话未删除。",
            );
            if (!result) throw Error("设置未能确认应用。");
            return result;
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {permissionsOpen && state.activeSessionId && state.workspaceRoot ? (
        <PermissionsDialog
          key={state.activeSessionId}
          workspace={state.workspaceRoot}
          permissions={state.permissions}
          onConfigure={async (permissions) => {
            const result = await perform(
              () =>
                bridge.configurePermissions({
                  sessionId: state.activeSessionId as string,
                  ...permissions,
                }),
              "未能确认权限变更，请核对当前状态。",
            );
            if (!result) throw Error("未能确认权限变更。");
            return result.permissions;
          }}
          onClose={() => setPermissionsOpen(false)}
        />
      ) : null}
      {webAccessOpen && state.activeSessionId && state.workspaceRoot ? (
        <WebAccessDialog
          key={state.activeSessionId}
          workspace={state.workspaceRoot}
          webAccess={state.webAccess}
          onConfigure={async (webAccess) => {
            const result = await perform(
              () =>
                bridge.configureWebAccess({
                  sessionId: state.activeSessionId as string,
                  ...webAccess,
                }),
              "未能确认网页访问变更，请核对当前状态。",
            );
            if (!result) throw Error("未能确认网页访问变更。");
            return result.webAccess;
          }}
          onClose={() => setWebAccessOpen(false)}
        />
      ) : null}
    </div>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作未能完成，请稍后重试。";
}
