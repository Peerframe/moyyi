// The message field (boards S5, S10, S16, S18). The right slot shows send while there is text,
// 停下 while a job runs, otherwise the microphone. `/` lists actions, `@` lists the project's AIs,
// the paperclip asks what a file or folder grants before anything is sent.
import { useEffect, useRef, useState } from "react";
import type { Chat, Member } from "../port.ts";
import { Icon } from "./icons.tsx";
import { Avatar } from "./parts.tsx";

const COMMANDS = [
  { name: "/对账", note: "逐条核对结论" },
  { name: "/撤回", note: "列出能撤回的改动" },
  { name: "/预算", note: "这周用了多少次" },
  { name: "/新项目", note: "建个群，拉 AI 进来" },
] as const;

const ATTACH = [
  { id: "file", label: "文件", sub: "给看或给改，发之前问", icon: "file" },
  { id: "image", label: "图片", sub: "", icon: "image" },
  { id: "screenshot", label: "截屏", sub: "截一块屏幕发进来", icon: "screenshot" },
  { id: "folder", label: "整个文件夹", sub: "会给这个项目开这个文件夹的权限", icon: "folder" },
  { id: "link", label: "网页链接", sub: "说清 AI 能不能打开", icon: "link" },
  { id: "memory", label: "从记忆里引用", sub: "带着出处引一条记忆", icon: "bookmark" },
] as const;

const EMOJI = ["👍", "👎", "❓", "📌", "🦈", "😂", "🙏", "🎉"];
const STICKERS = ["开始了", "等你", "做完了", "撤回了"] as const;

type Popup = "attach" | "emoji" | "menu" | null;
interface Grant {
  readonly what: string;
  readonly title: string;
  readonly note: string;
}

export interface ComposerProps {
  readonly chat: Chat;
  readonly members: Readonly<Record<string, Member>>;
  readonly draft: string;
  readonly running: { readonly who: string; readonly step: string } | null;
  readonly sticker: string;
  readonly onDraft: (text: string) => void;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly onAttach: (name: string, access: "view" | "edit") => void;
  readonly onCommand: (command: string) => void;
  readonly onVoice: (seconds: number) => void;
  readonly onReopen: () => void;
  /** The message being answered: the reply goes to its sender (N16). */
  readonly replyTo: { readonly name: string; readonly text: string } | null;
  readonly onCancelReply: () => void;
  /** Editing the last message in place, allowed only before anyone took it (N1). */
  readonly editing: boolean;
  readonly onEditLast: () => void;
  readonly onCancelEdit: () => void;
}

export function Composer(props: ComposerProps) {
  const { chat, members, draft, running, onDraft, onSend } = props;
  const [popup, setPopup] = useState<Popup>(null);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [selected, setSelected] = useState(0);
  const [recording, setRecording] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const attachButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (recording === null) return;
    const timer = setInterval(
      () => setRecording((value) => (value === null ? null : value + 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [recording]);

  if (chat.archived)
    return (
      <div className="ch-composer-wrap">
        <div className="mc-composer ch-archived">
          <span className="muted">项目已归档，只能看 · </span>
          <button type="button" className="mc-key" onClick={props.onReopen}>
            重新打开
          </button>
        </div>
      </div>
    );

  const mention = /(^|\s)@([^\s@]*)$/.exec(draft);
  const projectMembers = (chat.members ?? [])
    .filter((m) => m.role !== "负责人")
    .map((m) => members[m.id])
    .filter((m): m is Member => Boolean(m));
  const commands =
    draft.startsWith("/") && !draft.includes(" ")
      ? COMMANDS.filter((c) => c.name.startsWith(draft))
      : [];
  const mentions =
    mention && chat.kind === "project"
      ? projectMembers.filter((m) => m.name.startsWith(mention[2] ?? ""))
      : [];
  const suggestions = commands.length ? commands.length : mentions.length;
  const pick = (index: number) => {
    const command = commands[index];
    if (command) {
      setSelected(0);
      onDraft("");
      props.onCommand(command.name);
      return;
    }
    const member = mentions[index];
    if (member && mention) {
      setSelected(0);
      onDraft(`${draft.slice(0, draft.length - (mention[2]?.length ?? 0) - 1)}@${member.name} `);
      input.current?.focus();
    }
  };
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    onDraft("");
  };
  const closePopup = () => {
    setPopup(null);
    attachButton.current?.focus();
  };

  return (
    <div className="ch-composer-wrap">
      {popup === "menu" ? (
        <div className="mc-suggest ch-popup" role="menu" aria-label="操作">
          {COMMANDS.map((command) => (
            <button
              key={command.name}
              type="button"
              className="mc-suggest-item"
              role="menuitem"
              onClick={() => {
                setPopup(null);
                props.onCommand(command.name);
              }}
            >
              <strong>{command.name}</strong>
              <span className="muted">{command.note}</span>
            </button>
          ))}
        </div>
      ) : null}
      {commands.length ? (
        <div className="mc-suggest ch-popup" role="listbox" aria-label="操作">
          {commands.map((command, index) => (
            <div
              key={command.name}
              className="mc-suggest-item"
              role="option"
              tabIndex={-1}
              aria-selected={index === selected}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(index);
              }}
            >
              <strong>{command.name}</strong>
              <span className="muted">{command.note}</span>
            </div>
          ))}
        </div>
      ) : null}
      {mentions.length ? (
        <div className="mc-suggest ch-popup" role="listbox" aria-label="成员">
          {mentions.map((member, index) => (
            <div
              key={member.id}
              className="mc-suggest-item ch-suggest-member"
              role="option"
              tabIndex={-1}
              aria-selected={index === selected}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(index);
              }}
            >
              <Avatar avatar={member.avatar} shape="ai" size={32} presence={member.presence} />
              <strong>{member.name}</strong>
              <span className="muted">
                {member.presence === "working"
                  ? "正在做"
                  : member.presence === "idle"
                    ? "已暂停"
                    : "空着"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {popup === "attach" ? (
        <AttachMenu
          chat={chat}
          onClose={closePopup}
          onPick={(item) => {
            setPopup(null);
            if (item === "folder")
              setGrant({
                what: "论文",
                title: `把「论文」文件夹交给${chat.name}`,
                note: `${memberNames(chat, members)}都能用。资料里看得到，随时可以收回。`,
              });
            else if (item === "file" || item === "image" || item === "screenshot")
              setGrant({
                what: item === "file" ? "租房合同.pdf" : item === "image" ? "图片.png" : "截屏.png",
                title: "发之前选一下 AI 能对它做什么",
                note: "默认只给看。可以改的文件，改之前会先留底。",
              });
          }}
        />
      ) : null}
      {popup === "emoji" ? (
        <div className="mc-suggest ch-popup ch-emoji" role="dialog" aria-label="表情和贴纸">
          <div className="ch-emoji-tabs">
            <span className="mc-chip">贴纸</span>
            <span className="mc-chip">表情</span>
          </div>
          <div className="ch-sticker-row">
            {STICKERS.map((moment) => (
              <button
                key={moment}
                type="button"
                aria-label={`贴纸：${moment}`}
                title={moment}
                onClick={() => {
                  setPopup(null);
                  onSend(`[贴纸：${moment}]`);
                }}
              >
                <img src={props.sticker} alt="" />
              </button>
            ))}
          </div>
          <div className="ch-emoji-row">
            {EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setPopup(null);
                  onDraft(draft + emoji);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {grant ? (
        <div className="mc-grant ch-popup">
          <strong>{grant.title}</strong>
          <span className="muted">{grant.note}</span>
          <div className="mc-keys mc-keys-2">
            <button
              type="button"
              className="mc-key mc-key-primary"
              onClick={() => {
                props.onAttach(grant.what, "view");
                setGrant(null);
              }}
            >
              只给看
            </button>
            <button
              type="button"
              className="mc-key"
              onClick={() => {
                props.onAttach(grant.what, "edit");
                setGrant(null);
              }}
            >
              可以改
            </button>
          </div>
          <button type="button" className="ch-text-button" onClick={() => setGrant(null)}>
            先不发
          </button>
        </div>
      ) : null}
      {props.replyTo ? (
        <div className="ch-reply">
          <span className="ch-reply-bar" />
          <span className="ch-grow ch-min">
            <span className="ch-reply-name">回复 {props.replyTo.name}</span>
            <span className="ch-reply-text">{props.replyTo.text}</span>
          </span>
          <button
            type="button"
            className="mc-icon-btn"
            aria-label="不回复了"
            title="不回复了"
            onClick={props.onCancelReply}
          >
            <Icon.close />
          </button>
        </div>
      ) : null}
      {props.editing ? (
        <div className="ch-reply">
          <span className="ch-reply-bar" />
          <span className="ch-grow ch-min">
            <span className="ch-reply-name">改这句</span>
            <span className="ch-reply-text">还没人接手，原地改；接手以后会变成一条补充</span>
          </span>
          <button
            type="button"
            className="mc-icon-btn"
            aria-label="不改了"
            title="不改了"
            onClick={props.onCancelEdit}
          >
            <Icon.close />
          </button>
        </div>
      ) : null}
      <div className="mc-composer">
        <button
          type="button"
          className="mc-icon-btn"
          aria-label="全部操作"
          title="全部操作"
          aria-expanded={popup === "menu"}
          onClick={() => setPopup(popup === "menu" ? null : "menu")}
        >
          <Icon.command size={18} />
        </button>
        <button
          ref={attachButton}
          type="button"
          className="mc-icon-btn"
          aria-label="添加文件"
          title="添加文件"
          aria-expanded={popup === "attach"}
          onClick={() => setPopup(popup === "attach" ? null : "attach")}
        >
          <Icon.attach size={18} />
        </button>
        {recording !== null ? (
          <span className="mc-recording" role="status">
            <span className="mc-recording-dot" />
            <span className="num">0:{String(recording).padStart(2, "0")}</span>
            <span className="mc-wave" aria-hidden="true">
              {[8, 14, 20, 12, 18, 10, 16, 22, 12, 8, 14, 18, 10].map((h, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative bars
                <span key={i} style={{ height: h }} />
              ))}
            </span>
            <span className="muted">上滑取消</span>
          </span>
        ) : (
          <>
            <label htmlFor={`compose-${chat.id}`} className="ch-sr">
              发消息
            </label>
            <input
              ref={input}
              id={`compose-${chat.id}`}
              type="text"
              placeholder={chat.placeholder}
              value={draft}
              maxLength={4000}
              autoComplete="off"
              onChange={(event) => {
                setSelected(0);
                onDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (suggestions && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault();
                  setSelected(
                    (value) =>
                      (value + (event.key === "ArrowDown" ? 1 : suggestions - 1)) % suggestions,
                  );
                } else if (suggestions && (event.key === "Enter" || event.key === "Tab")) {
                  event.preventDefault();
                  pick(selected);
                } else if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  // The design system sends on ⌘ Enter only, never on plain Enter.
                  event.preventDefault();
                  send();
                } else if (event.key === "ArrowUp" && !draft) {
                  event.preventDefault();
                  props.onEditLast();
                } else if (event.key === "Escape") {
                  if (popup || grant) {
                    event.stopPropagation();
                    setPopup(null);
                    setGrant(null);
                  } else if (props.replyTo || props.editing) {
                    event.stopPropagation();
                    props.onCancelReply();
                    props.onCancelEdit();
                  }
                }
              }}
            />
            {running && !draft ? (
              <MicButton
                inside
                onRecord={setRecording}
                onRelease={props.onVoice}
                recording={recording}
              />
            ) : null}
            <button
              type="button"
              className="mc-icon-btn"
              aria-label="表情和贴纸"
              title="表情和贴纸"
              aria-expanded={popup === "emoji"}
              onClick={() => setPopup(popup === "emoji" ? null : "emoji")}
            >
              <Icon.emoji size={18} />
            </button>
          </>
        )}
        {draft.trim() ? (
          <button type="button" className="mc-send" title="⌘ Enter 发送" onClick={send}>
            发送
          </button>
        ) : running ? (
          <button type="button" className="mc-stop" onClick={props.onStop}>
            停下
          </button>
        ) : (
          <MicButton onRecord={setRecording} onRelease={props.onVoice} recording={recording} />
        )}
      </div>
      {running && draft.trim() ? (
        <span className="ch-caption">{withSpace(running.who)}做完这一步就看你的话</span>
      ) : null}
    </div>
  );
}

/** A Latin name before Chinese text takes a space ("moyyi 做完"); a Chinese name does not. */
function withSpace(name: string): string {
  return /[A-Za-z0-9]$/.test(name) ? `${name} ` : name;
}

function memberNames(chat: Chat, members: Readonly<Record<string, Member>>): string {
  return (chat.members ?? [])
    .filter((m) => m.role !== "负责人")
    .map((m) => members[m.id]?.name)
    .filter(Boolean)
    .join("、");
}

/** Hold to record, release to send; a tap records nothing. */
function MicButton({
  inside,
  recording,
  onRecord,
  onRelease,
}: {
  readonly inside?: boolean;
  readonly recording: number | null;
  readonly onRecord: (value: number | null) => void;
  readonly onRelease: (seconds: number) => void;
}) {
  const release = (send: boolean) => {
    if (recording === null) return;
    onRecord(null);
    if (send && recording > 0) onRelease(recording);
  };
  return (
    <button
      type="button"
      className={inside ? "mc-icon-btn" : "mc-mic"}
      aria-label={recording === null ? "按住说话" : "松开发送"}
      title={recording === null ? "按住说话" : undefined}
      onPointerDown={() => onRecord(0)}
      onPointerUp={() => release(true)}
      onPointerLeave={() => release(false)}
    >
      <Icon.mic size={inside ? 18 : 16} />
    </button>
  );
}

function AttachMenu({
  chat,
  onPick,
  onClose,
}: {
  readonly chat: Chat;
  readonly onPick: (item: (typeof ATTACH)[number]["id"]) => void;
  readonly onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const items = chat.kind === "project" ? ATTACH : ATTACH.filter((item) => item.id !== "folder");
  return (
    <div
      className="mc-attach ch-popup"
      role="menu"
      aria-label="添加"
      tabIndex={-1}
      onKeyDown={(event) => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") onClose();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          buttons[
            (at + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length
          ]?.focus();
        }
      }}
    >
      {items.map((item, index) => {
        const ItemIcon = Icon[item.icon];
        return (
          <div key={item.id} className="ch-contents">
            {item.id === "folder" || (item.id === "link" && chat.kind !== "project") ? (
              <div className="mc-attach-sep" aria-hidden="true" />
            ) : null}
            <button
              ref={index === 0 ? first : undefined}
              type="button"
              className="mc-attach-item"
              role="menuitem"
              onClick={() => onPick(item.id)}
            >
              <ItemIcon size={18} />
              <span className="mc-attach-text">
                <span>{item.label}</span>
                {item.sub ? <span className="mc-attach-sub">{item.sub}</span> : null}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
