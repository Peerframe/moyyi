// Small pieces shared by the list, the conversation and the panel. Markup and class names follow
// the moyyi Chat design system (components/bundle.css) so the boards and the app render alike.
import type {
  Avatar as AvatarData,
  Key,
  Member,
  Reaction,
  Receipt,
  Replies,
  Role,
} from "../port.ts";
import { Icon } from "./icons.tsx";

const TONE: Record<AvatarData["tone"], string> = {
  accent: "",
  key: " mc-av-key",
  ink: " mc-av-ink",
  quiet: " mc-av-quiet",
};

export function Avatar({
  avatar,
  shape,
  size,
  presence,
}: {
  readonly avatar: AvatarData;
  readonly shape: "ai" | "project";
  readonly size: 32 | 48 | 72;
  readonly presence?: "working" | "idle" | undefined;
}) {
  const face = (
    <span className={`mc-av mc-av-${shape}${TONE[avatar.tone]} mc-av-${size}`} aria-hidden="true">
      {avatar.icon === "bookmark" ? <Icon.bookmark size={size === 48 ? 22 : 16} /> : avatar.text}
    </span>
  );
  if (!presence) return face;
  return (
    <span className="mc-av-wrap">
      {face}
      <span
        className={`mc-dot mc-dot-${presence}`}
        title={presence === "working" ? "正在做" : "已暂停"}
      />
    </span>
  );
}

export function MemberAvatar({
  member,
  size = 32,
}: {
  readonly member: Member;
  readonly size?: 32 | 72;
}) {
  return <Avatar avatar={member.avatar} shape="ai" size={size} />;
}

export function ReceiptMark({ receipt }: { readonly receipt: Receipt }) {
  if (receipt === "sending") return <Icon.sending size={12} label="发送中" />;
  if (receipt === "recorded") return <Icon.recorded size={16} label="已记录" />;
  return <Icon.taken size={18} label="已接手" />;
}

export function Meta({
  time,
  receipt,
}: {
  readonly time?: string | undefined;
  readonly receipt?: Receipt | undefined;
}) {
  if (!time) return null;
  return (
    <span className="mc-meta num">
      {time}
      {receipt ? (
        <>
          {" "}
          <ReceiptMark receipt={receipt} />
        </>
      ) : null}
    </span>
  );
}

/** Full count up to 9999; the design system never shortens counts. */
export function Badge({
  kind,
  count,
}: {
  readonly kind: "decide" | "unread" | "quiet";
  readonly count: number;
}) {
  if (count <= 0) return null;
  return <span className={`mc-badge mc-badge-${kind} num`}>{count}</span>;
}

export function SenderLine({
  name,
  role,
  state,
  note,
}: {
  readonly name: string;
  readonly role?: Role | undefined;
  readonly state?: "working" | "attention" | undefined;
  readonly note?: string | undefined;
}) {
  return (
    <span className={`mc-sender${state === "attention" ? " mc-sender-attention" : ""}`}>
      {note ? `${name} · ${note}` : name}
      {role ? (
        <>
          {" "}
          <span className="mc-role">{role}</span>
        </>
      ) : null}
      {state === "working" ? <span className="mc-role mc-role-working">正在做</span> : null}
      {state === "attention" ? <span className="mc-role mc-role-attention">等你决定</span> : null}
    </span>
  );
}

export function Reactions({
  reactions,
  onReact,
}: {
  readonly reactions: readonly Reaction[];
  readonly onReact: (emoji: string) => void;
}) {
  return (
    <div className="mc-reactions">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          className="mc-reaction"
          aria-pressed={reaction.mine}
          aria-label={`${reaction.label}，${reaction.count} 次${reaction.mine ? "，包括你" : ""}`}
          onClick={() => onReact(reaction.emoji)}
        >
          {reaction.emoji} <span className="num">{reaction.count}</span>
        </button>
      ))}
    </div>
  );
}

export function RepliesButton({
  replies,
  members,
  onOpen,
}: {
  readonly replies: Replies;
  readonly members: Readonly<Record<string, Member>>;
  readonly onOpen: () => void;
}) {
  return (
    <button type="button" className="mc-replies" onClick={onOpen}>
      <span className="mc-replies-avs">
        {replies.from.slice(0, 3).map((id) => {
          const member = members[id];
          return member ? <MemberAvatar key={id} member={member} /> : null;
        })}
      </span>
      ↩ {replies.count} 条回复
      {replies.verdict ? <span className="mc-replies-verdict">· {replies.verdict}</span> : null}
    </button>
  );
}

export function Keys({
  keys,
  onAnswer,
}: {
  readonly keys: readonly Key[];
  readonly onAnswer: (index: number) => void;
}) {
  return (
    <div className={`mc-keys mc-keys-${Math.min(3, Math.max(2, keys.length))}`}>
      {keys.map((key, index) => (
        <button
          key={key.label}
          type="button"
          className={`mc-key${key.tone ? ` mc-key-${key.tone}` : ""}`}
          onClick={() => onAnswer(index)}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
