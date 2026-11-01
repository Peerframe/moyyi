// One renderer per message kind. Markup follows the canvas boards (S2–S4, S7–S18); classes come
// from the design system's bundle.css, layout helpers prefixed `ch-` from app.css.

import type { ReactNode } from "react";
import { useState } from "react";
import type { Chat, Claim, Member, Message, Role } from "../port.ts";
import { Icon, NowDot, PlayIcon } from "./icons.tsx";
import { Keys, MemberAvatar, Meta, Reactions, RepliesButton, SenderLine } from "./parts.tsx";

export interface MessageActions {
  answer(messageId: string, key: number): void;
  react(messageId: string, emoji: string): void;
  openReplies(messageId: string): void;
  openClaim(messageId: string, claimId: string): void;
  undo(changeIds: readonly string[]): void;
  openChat(chatId: string): void;
  retry(messageId: string): void;
  unschedule(messageId: string): void;
}

export interface Run {
  /** First bubble of a run from one sender: carries the sender line; later ones sit closer. */
  readonly first: boolean;
}

interface Props {
  readonly message: Message;
  readonly chat: Chat;
  readonly members: Readonly<Record<string, Member>>;
  readonly run: Run;
  readonly actions: MessageActions;
  readonly highlighted?: boolean;
  readonly sticker: string;
}

const STICKER_TILT: Record<string, string> = {
  开始了: "",
  等你: " ch-tilt-left",
  做完了: " ch-flip",
  撤回了: " ch-tilt-right",
};

export function MessageView(props: Props) {
  const { message, actions } = props;
  switch (message.kind) {
    case "service":
      return (
        <span className={`mc-service${message.tone === "danger" ? " ch-danger" : ""}`}>
          {message.text}
        </span>
      );
    case "unread-divider":
      return <span className="mc-unread-divider">以下是未读消息</span>;
    case "out":
      if (message.retracted)
        return (
          <span className="mc-service" data-message={message.id}>
            {message.retracted}
          </span>
        );
      return (
        <div className="ch-out-wrap" data-message={message.id}>
          <div className="mc-line mc-line-out">
            <div
              className={`mc-bubble mc-out${message.failed ? " ch-failed" : ""}${message.receipt === "sending" ? " ch-sending" : ""}`}
            >
              {message.supplement ? <span className="ch-supplement">补充</span> : null}
              {message.quote ? <span className="ch-quote">{message.quote}</span> : null}
              {message.text}
              <Meta
                time={message.edited ? `已改 ${message.time ?? ""}` : message.time}
                receipt={message.failed ? undefined : message.receipt}
              />
            </div>
          </div>
          {message.failed ? (
            <div className="ch-failed-line">
              没发出去：{message.failed}
              <button
                type="button"
                className="mc-key mc-key-danger ch-small-key"
                onClick={() => actions.retry(message.id)}
              >
                重发
              </button>
            </div>
          ) : null}
        </div>
      );
    case "file":
      return <FileMessage {...props} message={message} />;
    case "voice":
      return <VoiceMessage message={message} />;
    default:
      return <FromAI {...props} message={message} />;
  }
}

type AIMessage = Extract<Message, { from: string }>;

function FromAI({
  message,
  chat,
  members,
  run,
  actions,
  highlighted,
  sticker,
}: Props & { readonly message: AIMessage }) {
  const member = members[message.from];
  const name = member?.name ?? message.from;
  const role = chat.members?.find((m) => m.id === message.from)?.role;
  const showSender = Boolean(message.senderNote) || (run.first && chat.kind === "project");
  const avatar = member ? <MemberAvatar member={member} /> : <span className="ch-av-space" />;
  if (message.kind === "sticker") {
    return (
      <div className="mc-line">
        {avatar}
        <div className={`mc-sticker ch-sticker${STICKER_TILT[message.moment] ?? ""}`}>
          <img src={sticker} alt={message.moment} />
          <span className="mc-sticker-label">{message.moment}</span>
        </div>
      </div>
    );
  }
  const sender = showSender ? (
    <Sender message={message} name={name} role={chat.kind === "project" ? role : undefined} />
  ) : null;
  return (
    <div className={`mc-line${run.first ? "" : " ch-tight"}`} data-message={message.id}>
      {avatar}
      <div className={`ch-col${highlighted ? " ch-highlight" : ""}`}>
        <Body message={message} sender={sender} actions={actions} />
        {"reactions" in message && message.reactions?.length ? (
          <Reactions
            reactions={message.reactions}
            onReact={(emoji) => actions.react(message.id, emoji)}
          />
        ) : null}
        {"replies" in message && message.replies ? (
          <RepliesButton
            replies={message.replies}
            members={members}
            onOpen={() => actions.openReplies(message.id)}
          />
        ) : null}
        <After message={message} actions={actions} />
      </div>
    </div>
  );
}

function Sender({
  message,
  name,
  role,
}: {
  readonly message: AIMessage;
  readonly name: string;
  readonly role?: Role | undefined;
}) {
  const kindNote: Partial<Record<AIMessage["kind"], string>> = {
    plan: "计划",
    result: "做完了",
  };
  const note = message.senderNote ?? kindNote[message.kind];
  return (
    <SenderLine
      name={name}
      role={note && message.kind !== "decision" ? undefined : role}
      state={message.kind === "decision" && !message.answered ? "attention" : message.state}
      note={note}
    />
  );
}

function Body({
  message,
  sender,
  actions,
}: {
  readonly message: AIMessage;
  readonly sender: ReactNode;
  readonly actions: MessageActions;
}) {
  switch (message.kind) {
    case "text":
      return (
        <div className={`mc-bubble mc-in${message.flag ? ` mc-flag-${message.flag}` : ""}`}>
          {sender}
          {message.forwarded ? (
            <span className="ch-forwarded">转发自 {message.forwarded}</span>
          ) : null}
          {message.quote ? <span className="ch-quote">{message.quote}</span> : null}
          {message.text}
          {message.tag ? (
            <span className={`mc-tag mc-tag-${message.tag.kind} ch-tag-inline`}>
              {message.tag.text}
            </span>
          ) : null}
          <Meta time={message.time} />
        </div>
      );
    case "decision":
    case "options":
      return (
        <div
          className={`mc-bubble mc-in${message.kind === "decision" && !message.answered ? " mc-flag-attention" : ""}`}
        >
          {sender}
          {message.text}
          <Meta time={message.time} />
        </div>
      );
    case "status":
      return (
        <div className="mc-bubble mc-in">
          {sender}
          <strong className="ch-title">{message.job}</strong>
          <ol className="mc-steps ch-steps">
            {message.steps.map((step) => (
              <li
                key={step.text}
                className={`mc-step${step.state === "now" || step.state === "waiting" ? " mc-step-now" : step.state === "todo" ? " mc-step-todo" : ""}`}
              >
                {step.state === "done" ? (
                  <Icon.done size={14} />
                ) : step.state === "todo" ? (
                  <Icon.todo size={14} />
                ) : (
                  <NowDot />
                )}
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
          <span className="mc-meta ch-meta-split">
            <span>{message.budget}</span>
            <span className="num">{message.time}</span>
          </span>
        </div>
      );
    case "plan":
      return (
        <div className="mc-bubble mc-in mc-plan">
          {sender}
          <span className="mc-plan-title">{message.title}</span>
          <dl>
            <dt>会读</dt>
            <dd>{message.reads}</dd>
            <dt>会改</dt>
            <dd>{message.changes}</dd>
            <dt>找谁</dt>
            <dd>
              {message.who.map((who, index) => (
                <span key={who}>
                  {index ? " " : ""}
                  <span className="mc-chip">{who}</span>
                </span>
              ))}
            </dd>
            <dt>预算</dt>
            <dd>{message.budget}</dd>
            <dt>找你</dt>
            <dd>{message.comeBack}</dd>
          </dl>
          <span className="mc-plan-not">不会做：{message.not}</span>
          <Meta time={message.time} />
        </div>
      );
    case "change":
      return <ChangeBody message={message} sender={sender} actions={actions} />;
    case "result":
      return (
        <div className="mc-bubble mc-in">
          {sender}
          <strong className="ch-title">{message.job}</strong>
          <ul className="mc-result-list">
            {message.files.map((file) => (
              <li key={file.name}>
                <span>{file.name}</span>
                <span className="muted">{file.count}</span>
              </li>
            ))}
          </ul>
          <span className="ch-line">
            {message.check.text}{" "}
            <span className={`mc-tag mc-tag-${message.check.kind}`}>
              {message.check.kind === "cited" ? "有原文" : "要你看"}
            </span>
          </span>
          {message.claims?.length ? (
            <span className="ch-claims">
              {message.claims.map((claim, index) => (
                <button
                  key={claim.id}
                  type="button"
                  className="mc-claim"
                  aria-pressed={false}
                  onClick={() => actions.openClaim(message.id, claim.id)}
                >
                  <span className="num ch-claim-n">{index + 1}</span>
                  <span className="ch-grow">{claim.text}</span>
                  <ClaimTag claim={claim} />
                </button>
              ))}
            </span>
          ) : null}
          {message.skipped ? <span className="ch-line muted">没做：{message.skipped}</span> : null}
          <Meta time={message.time} />
        </div>
      );
    case "link":
      return (
        <button
          type="button"
          className="mc-bubble mc-in ch-link"
          onClick={() => actions.openChat(message.chatId)}
        >
          <span className="ch-link-where">{message.where}</span>
          <span className="ch-link-text">{message.text}</span>
        </button>
      );
    default:
      return null;
  }
}

export function ClaimTag({ claim }: { readonly claim: Claim }) {
  if (claim.check === "checked")
    return (
      <span className="mc-tag mc-tag-cited ch-tag-gap">
        <Icon.taken size={18} label="已接手" /> 你已核对
      </span>
    );
  if (claim.check === "wrong") return <span className="mc-tag ch-danger">你标了不对</span>;
  return <span className={`mc-tag mc-tag-${claim.kind}`}>{claim.tag}</span>;
}

function ChangeBody({
  message,
  sender,
  actions,
}: {
  readonly message: Extract<Message, { kind: "change" }>;
  readonly sender: ReactNode;
  readonly actions: MessageActions;
}) {
  const [value, setValue] = useState(0);
  const irreversible = message.undo === "irreversible";
  return (
    <div
      className={`mc-bubble mc-in ch-change${irreversible ? " mc-flag-attention" : value > 0 ? " mc-flag-accent" : ""}`}
    >
      {sender}
      <span className="ch-change-head">
        {message.command ? <Icon.command size={14} /> : <Icon.file size={14} />}
        <span className="mc-mono">{message.command ?? message.file}</span>
      </span>
      <span className="ch-sub">{message.summary}</span>
      {message.undo === "reversible" ? (
        <>
          <label className="ch-sr" htmlFor={`undo-${message.id}`}>
            拖到最右撤回
          </label>
          <input
            id={`undo-${message.id}`}
            className="mc-undo"
            type="range"
            min={0}
            max={100}
            value={value}
            aria-valuetext={value === 0 ? "向右拖到底撤回这次改动" : "再拖一点 · 松手不会撤回"}
            onChange={(event) => setValue(Number(event.target.value))}
            onPointerUp={() =>
              value >= 100 ? actions.undo([message.changeId ?? message.id]) : setValue(0)
            }
            onKeyUp={(event) => {
              if (event.key === "End" || value >= 100)
                actions.undo([message.changeId ?? message.id]);
            }}
          />
          <span className="ch-sub ch-sub-gap">
            {value === 0 ? "向右拖到底撤回这次改动" : "再拖一点 · 松手不会撤回"}
          </span>
        </>
      ) : null}
      {message.undo === "undone" ? <span className="ch-sub ch-sub-gap">已撤回</span> : null}
      {irreversible ? (
        <>
          <span className="ch-warn">撤不回：{message.reason}</span>
          <span className="ch-sub">以后跑这条命令前会先问你</span>
        </>
      ) : null}
      {message.undo === "conflict" ? (
        <span className="ch-danger-line">没撤回：{message.reason}</span>
      ) : null}
    </div>
  );
}

function After({
  message,
  actions,
}: {
  readonly message: AIMessage;
  readonly actions: MessageActions;
}) {
  const answer = (index: number) => actions.answer(message.id, index);
  if (message.kind === "options" && !message.answered)
    return (
      <div className="ch-options">
        {message.keys.map((key, index) => (
          <button
            key={key.label}
            type="button"
            className={`mc-key${key.tone ? ` mc-key-${key.tone}` : ""}`}
            onClick={() => answer(index)}
          >
            {key.label}
          </button>
        ))}
      </div>
    );
  if (message.kind === "decision" || message.kind === "options") {
    if (message.answered) return <span className="mc-answered">{message.answered}</span>;
    return (
      <>
        <Keys keys={message.keys} onAnswer={answer} />
        {message.kind === "decision" && message.note ? (
          <span className="ch-caption">{message.note}</span>
        ) : null}
      </>
    );
  }
  if (message.kind === "text" && message.answered)
    return <span className="mc-answered">{message.answered}</span>;
  if (message.kind === "plan") {
    if (message.scheduled)
      return (
        <span className="mc-answered">
          已定时 · {message.scheduled} ·{" "}
          <button
            type="button"
            className="ch-text-button"
            onClick={() => actions.unschedule(message.id)}
          >
            取消
          </button>
        </span>
      );
    if (message.answered) return <span className="mc-answered">{message.answered}</span>;
    return (
      <Keys
        keys={[{ label: "开始", tone: "primary" }, { label: "明早 9 点开始" }, { label: "改一下" }]}
        onAnswer={answer}
      />
    );
  }
  if (message.kind === "result")
    return (
      <Keys
        keys={[{ label: "对账", tone: "primary" }, { label: "打开文件夹" }]}
        onAnswer={answer}
      />
    );
  if (message.kind === "status" && message.stopped)
    return (
      <Keys
        keys={[{ label: "接着做", tone: "primary" }, { label: "撤回全部改动" }]}
        onAnswer={answer}
      />
    );
  if (message.kind === "change" && message.undo === "conflict")
    return (
      <Keys
        keys={[{ label: "先看两边差别", tone: "primary" }, { label: "只撤我没碰的" }]}
        onAnswer={answer}
      />
    );
  return null;
}

function FileMessage({
  message,
  members,
}: Props & { readonly message: Extract<Message, { kind: "file" }> }) {
  const sender = message.from ? members[message.from] : undefined;
  const bubble = (
    <div className={`mc-bubble ${message.mine ? "mc-out" : "mc-in"}`}>
      <span className="mc-file">
        <span className="mc-file-icon">{message.ext}</span>
        <span className="ch-min">
          <span className="mc-file-name">{message.name}</span>
          <span className="mc-file-sub">{message.size}</span>
        </span>
      </span>
      <span className="mc-access">
        {message.access === "view" ? "只给看 · AI 不能改它" : "可以改 · 会先留底"}
      </span>
      <Meta time={message.time} receipt={message.receipt} />
    </div>
  );
  return (
    <div className="ch-out-wrap" data-message={message.id}>
      <div className={`mc-line${message.mine ? " mc-line-out" : ""}`}>
        {!message.mine && sender ? <MemberAvatar member={sender} /> : null}
        {bubble}
      </div>
      {message.readBy ? (
        <span className={`ch-caption${message.mine ? " ch-right" : ""}`}>{message.readBy}</span>
      ) : null}
    </div>
  );
}

const WAVE = [6, 12, 18, 10, 22, 14, 8, 16, 20, 12, 6, 14, 18, 10, 8, 12, 16, 6];

function VoiceMessage({ message }: { readonly message: Extract<Message, { kind: "voice" }> }) {
  return (
    <div className="ch-out-wrap" data-message={message.id}>
      <div className="mc-line mc-line-out">
        <div className="mc-bubble mc-out">
          <span className="mc-voice">
            <span className="mc-voice-row">
              <button type="button" className="mc-voice-play" aria-label="播放语音">
                <PlayIcon />
              </button>
              <span className="mc-wave" aria-hidden="true">
                {WAVE.map((height, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative bars
                  <span key={index} style={{ height }} />
                ))}
              </span>
              <span className="num">{message.length}</span>
            </span>
            <span className="mc-transcript">
              {message.transcript}
              {message.corrected ? <span className="ch-sub">已改</span> : null}
            </span>
          </span>
          <Meta time={message.time} receipt={message.receipt} />
        </div>
      </div>
      <span className="ch-caption ch-right">AI 按这段文字理解 · 改文字</span>
    </div>
  );
}
