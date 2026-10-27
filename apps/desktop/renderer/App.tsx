import { useEffect, useRef, useState } from "react";
import type { DesktopAction, DesktopApproval, DesktopBridge, DesktopState } from "../shared.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { MessageList } from "./MessageList.tsx";
import { SessionSidebar } from "./SessionSidebar.tsx";
import {
  approvalIdentity,
  createActionGate,
  createSnapshotReceiver,
  outcomeLabel,
  workspaceName,
} from "./view-state.ts";

export function App({ bridge }: { bridge: DesktopBridge }) {
  const [state, setState] = useState<DesktopState | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newSession, setNewSession] = useState(false);
  const [askEachRead, setAskEachRead] = useState(false);
  const [draft, setDraft] = useState("");
  const gate = useRef(createActionGate());
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

  async function perform(operation: () => Promise<DesktopState>): Promise<DesktopState | null> {
    if (!gate.current.begin()) return null;
    setPending(true);
    setViewError(null);
    try {
      // State is delivered through the subscription; a delayed ACK cannot overwrite it.
      return await operation();
    } catch (cause) {
      if (mounted.current) setViewError(errorMessage(cause));
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
  const canSend = !busy && !configuring && state.connection.ready && draft.trim().length > 0;
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
          {!configuring ? (
            <button type="button" disabled={busy} onClick={() => setNewSession(true)}>
              切换目录
            </button>
          ) : null}
        </header>
        <p className="permission-line">
          Flash · low · {requestBudget}
          <br />
          只读所选工作目录 · 不写入文件、不执行命令、不访问网页
          {!configuring ? ` · ${state.askEachRead ? "工具读取逐次审批" : "工具读取已授权"}` : ""}
        </p>
        {!state.connection.ready ? (
          <p className="error error-banner" role="alert">
            {state.connection.message ??
              "尚未配置 Flash 连接。请使用 moyyi-deepseek setup-key 完成配置，再重新打开应用；已有会话仍可查看。"}
          </p>
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
                    {pending ? "正在打开…" : "发送"}
                  </button>
                )}
              </div>
            </div>
            <p className="composer-footer">回答需结合来源核对；停止不会删除已经收到的内容。</p>
          </div>
        </form>
      </main>
    </div>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作未能完成，请稍后重试。";
}
