// The right-hand panel (boards S8, S14, S15, S17, S18). One panel, used as a stack: 资料 is the
// first level; evidence, reply threads, running jobs and the undo list stack on top with "← 资料".
// Evidence opened from a message replaces the stack and shows only ×.
import type { Chat, ChatWorld, Claim, Member, Message } from "../port.ts";
import { Icon } from "./icons.tsx";
import { ClaimTag } from "./messages.tsx";
import { Avatar, Keys, Meta, SenderLine } from "./parts.tsx";

export type PanelFrame =
  | { readonly kind: "info" }
  | { readonly kind: "claim"; readonly messageId: string; readonly claimId: string }
  | { readonly kind: "thread"; readonly messageId: string }
  | { readonly kind: "jobs" }
  | { readonly kind: "undo" };

export interface PanelActions {
  push(frame: PanelFrame): void;
  back(): void;
  close(): void;
  check(claimId: string, verdict: "checked" | "wrong"): void;
  answerThread(messageId: string, key: number): void;
  stop(jobId: string): void;
  undo(changeIds: readonly string[]): void;
}

export function findClaim(world: ChatWorld, messageId: string, claimId: string): Claim | undefined {
  for (const messages of Object.values(world.messages)) {
    const message = messages.find((m) => m.id === messageId);
    if (message?.kind === "result") return message.claims?.find((claim) => claim.id === claimId);
  }
  return undefined;
}

function findMessage(world: ChatWorld, messageId: string): Message | undefined {
  for (const messages of Object.values(world.messages)) {
    const message = messages.find((m) => m.id === messageId);
    if (message) return message;
  }
  return undefined;
}

export function SidePanel({
  world,
  chat,
  stack,
  actions,
}: {
  readonly world: ChatWorld;
  readonly chat: Chat;
  readonly stack: readonly PanelFrame[];
  readonly actions: PanelActions;
}) {
  const frame = stack.at(-1);
  if (!frame) return null;
  const stacked = stack.length > 1;
  const title = panelTitle(world, chat, frame);
  return (
    <aside
      className="mc-info ch-info"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape") (stacked ? actions.back : actions.close)();
      }}
    >
      <div className="mc-panel-head">
        {stacked ? (
          <button type="button" className="mc-panel-back" onClick={actions.back}>
            <Icon.back />
            资料
          </button>
        ) : null}
        <h2>{title}</h2>
        {stacked ? null : (
          <button
            type="button"
            className="mc-icon-btn"
            aria-label="关闭面板"
            title="关闭面板"
            onClick={actions.close}
          >
            <Icon.close />
          </button>
        )}
      </div>
      <PanelBody world={world} chat={chat} frame={frame} actions={actions} />
    </aside>
  );
}

function panelTitle(world: ChatWorld, chat: Chat, frame: PanelFrame): string {
  switch (frame.kind) {
    case "info":
      return `${chat.name}的资料`;
    case "claim": {
      const message = findMessage(world, frame.messageId);
      const index =
        message?.kind === "result"
          ? (message.claims?.findIndex((c) => c.id === frame.claimId) ?? -1)
          : -1;
      return index >= 0 ? `出处：第 ${index + 1} 条` : "出处";
    }
    case "thread":
      return `${world.threads[frame.messageId]?.replies.length ?? 0} 条回复`;
    case "jobs":
      return `在做的事 · ${world.jobs.filter((job) => job.chatId === chat.id).length} 件`;
    case "undo":
      return `能撤回的改动 · ${world.changes[chat.id]?.length ?? 0} 处`;
  }
}

function PanelBody({
  world,
  chat,
  frame,
  actions,
}: {
  readonly world: ChatWorld;
  readonly chat: Chat;
  readonly frame: PanelFrame;
  readonly actions: PanelActions;
}) {
  switch (frame.kind) {
    case "info":
      return <Info world={world} chat={chat} actions={actions} />;
    case "claim": {
      const claim = findClaim(world, frame.messageId, frame.claimId);
      return claim ? (
        <Evidence claim={claim} onCheck={(verdict) => actions.check(claim.id, verdict)} />
      ) : (
        <p className="ch-caption">这条结论已经不在记录里。</p>
      );
    }
    case "thread":
      return <ThreadView world={world} messageId={frame.messageId} actions={actions} />;
    case "jobs":
      return (
        <div className="ch-jobs">
          {world.jobs
            .filter((job) => job.chatId === chat.id)
            .map((job) => (
              <div key={job.id} className={`ch-job${job.waiting ? " mc-pinned-attention" : ""}`}>
                <span className="mc-pinned-bar" />
                <span className="ch-grow ch-min">
                  <span className="ch-job-name">{job.name}</span>
                  <span className="ch-sub">
                    {job.waiting ? `等你决定：${job.waiting}` : job.step}
                  </span>
                </span>
                <button type="button" className="mc-stop" onClick={() => actions.stop(job.id)}>
                  停下
                </button>
              </div>
            ))}
        </div>
      );
    case "undo":
      return (
        <div className="ch-undo-list">
          {(world.changes[chat.id] ?? []).map((change) => (
            <div key={change.id} className={`ch-undo-row${change.dependsOn ? " ch-indent" : ""}`}>
              <span className="ch-grow ch-min">
                <span className="ch-undo-file">
                  {change.dependsOn ? <span className="muted">└</span> : null}
                  <span className="mc-mono">{change.file}</span>
                </span>
                <span className="ch-sub">
                  {change.by}
                  {change.dependsOn ? " · 依赖上面这处" : ""} · {change.time}
                </span>
              </span>
              <button
                type="button"
                className="mc-key ch-small-key"
                onClick={() => actions.undo([change.id])}
              >
                撤回
              </button>
            </div>
          ))}
          {(world.changes[chat.id] ?? []).length === 0 ? (
            <p className="ch-caption">这个对话里没有能撤回的改动。</p>
          ) : null}
        </div>
      );
  }
}

function Info({
  world,
  chat,
  actions,
}: {
  readonly world: ChatWorld;
  readonly chat: Chat;
  readonly actions: PanelActions;
}) {
  const info = world.info[chat.id];
  return (
    <>
      <div className="ch-profile">
        <Avatar
          avatar={chat.avatar}
          shape={chat.kind === "project" ? "project" : "ai"}
          size={72}
          presence={chat.presence}
        />
        <span className="ch-profile-name">{chat.name}</span>
        {info ? <span className="ch-sub">{info.kindLine}</span> : null}
      </div>
      {info?.sections.map((section) => (
        <div key={section.title} className="ch-section">
          <span className="mc-section-h ch-section-h">
            {section.title}
            {section.meter ? (
              <span className="num muted ch-normal">{section.meter.label}</span>
            ) : null}
          </span>
          {section.meter ? (
            <span className="mc-meter">
              <span style={{ width: `${Math.round(section.meter.value * 100)}%` }} />
            </span>
          ) : null}
          {section.members?.map((id) => {
            const member: Member | undefined = world.members[id];
            return member ? (
              <span key={id} className="ch-member">
                <Avatar avatar={member.avatar} shape="ai" size={32} presence={member.presence} />
                {member.name}
                {member.model ? ` · ${member.model}` : ""}
              </span>
            ) : null;
          })}
          {section.rows?.map((row) => (
            <span key={row.label} className="ch-info-row">
              <span>{row.label}</span>
              <span className="muted">{row.value}</span>
            </span>
          ))}
          {section.segment ? (
            <div className="mc-seg">
              {section.segment.options.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={index === section.segment?.selected}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          {section.chips ? (
            <div className="ch-chips">
              {section.chips.map((chip) => (
                <span key={chip} className="mc-chip">
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
          {section.evidence ? (
            <button
              type="button"
              className="mc-claim"
              onClick={() =>
                section.evidence &&
                actions.push({
                  kind: "claim",
                  messageId: section.evidence.messageId,
                  claimId: section.evidence.claimId,
                })
              }
            >
              <span className="ch-grow">{section.evidence.label}</span>
              <span className="muted">›</span>
            </button>
          ) : null}
          {section.note ? <span className="ch-caption">{section.note}</span> : null}
        </div>
      ))}
      {info?.danger ? (
        <button type="button" className="mc-key mc-key-danger ch-start">
          {info.danger}
        </button>
      ) : null}
    </>
  );
}

function Evidence({
  claim,
  onCheck,
}: {
  readonly claim: Claim;
  readonly onCheck: (verdict: "checked" | "wrong") => void;
}) {
  return (
    <>
      <span className="ch-claim-text">{claim.text}</span>
      <span className="ch-start">
        <ClaimTag claim={claim} />
      </span>
      {claim.note ? <span className="ch-sub">{claim.note}</span> : null}
      {claim.kind === "partial" && claim.unsupported ? (
        <span className="ch-sub">
          <span className="ch-accent">有原文</span> ·{" "}
          <span className="ch-attention">没有原文：{claim.unsupported}</span>
        </span>
      ) : null}
      {claim.quote ? <blockquote className="mc-quote">{claim.quote}</blockquote> : null}
      {claim.source ? (
        <span className="ch-caption">出处：{claim.source}</span>
      ) : (
        <span className="ch-caption">没有出处：这条是建议，不是原文。</span>
      )}
      {claim.check ? (
        <span className="mc-answered">
          {claim.check === "checked" ? "你已核对：这条没问题" : "你标了不对 · 已退回给它重做这一条"}
        </span>
      ) : (
        <Keys
          keys={[
            { label: "这条没问题", tone: "primary" },
            { label: "这条不对", tone: "danger" },
          ]}
          onAnswer={(index) => onCheck(index === 0 ? "checked" : "wrong")}
        />
      )}
    </>
  );
}

function ThreadView({
  world,
  messageId,
  actions,
}: {
  readonly world: ChatWorld;
  readonly messageId: string;
  readonly actions: PanelActions;
}) {
  const root = findMessage(world, messageId);
  const thread = world.threads[messageId];
  if (!root || !thread) return null;
  const rootFrom = "from" in root ? world.members[root.from]?.name : "你";
  return (
    <>
      <div className="mc-thread-root">
        <strong>{rootFrom}：</strong>
        {"text" in root ? root.text : ""}
      </div>
      {thread.replies.map((reply) =>
        reply.kind === "text" ? (
          <div key={reply.id} className="mc-bubble mc-in ch-full">
            <SenderLine
              name={world.members[reply.from]?.name ?? reply.from}
              note={reply.senderNote}
              state={reply.state}
            />
            {reply.text}
            {reply.tag ? (
              <span className={`mc-tag mc-tag-${reply.tag.kind} ch-tag-inline`}>
                {reply.tag.text}
              </span>
            ) : null}
            <Meta time={reply.time} />
          </div>
        ) : null,
      )}
      {thread.answered ? (
        <span className="mc-answered">{thread.answered}</span>
      ) : thread.keys ? (
        <Keys keys={thread.keys} onAnswer={(index) => actions.answerThread(messageId, index)} />
      ) : null}
    </>
  );
}
