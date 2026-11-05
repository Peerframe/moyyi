// One open chat (boards S3, S7, S10, S11, S17): header, the pinned job bar, the message column on
// the wallpaper, jump buttons and the composer. Right-click or long-press opens the
// message menu; selecting turns the composer into an action bar (N7); ⌘F searches here (N9).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Chat, ChatAction, ChatWorld, Job, Message } from "../port.ts";
import { author, textOf } from "../text.ts";
import { Composer } from "./Composer.tsx";
import { Icon } from "./icons.tsx";
import { actionError, type ChatIntegration, supports } from "./integration.ts";
import type { MessageActions, Run } from "./messages.tsx";
import { MessageView } from "./messages.tsx";
import type { PanelFrame } from "./Panel.tsx";
import { Avatar, Badge } from "./parts.tsx";

const FILTERS = ["AI", "文件", "改动", "出处", "决定"] as const;
type Filter = (typeof FILTERS)[number];

export interface ConversationProps {
  readonly world: ChatWorld;
  readonly chat: Chat;
  readonly draft: string;
  readonly sticker: string;
  readonly infoOpen: boolean;
  readonly narrow: boolean;
  readonly searchOpen: boolean;
  readonly onSearch: (open: boolean) => void;
  readonly onDraft: (text: string) => void;
  readonly onInfo: () => void;
  readonly onPanel: (frame: PanelFrame) => void;
  readonly onBack: () => void;
  readonly onOpenChat: (chatId: string) => void;
  readonly act: (action: ChatAction) => Promise<void>;
  readonly integration?: ChatIntegration | undefined;
  readonly feedback?: string | null | undefined;
}

const CARDS = new Set<Message["kind"]>(["status", "plan", "result", "decision", "change"]);

/** Bubbles from one sender form a run under one sender line; cards always start their own. */
export function runs(messages: readonly Message[]): Run[] {
  const key = (message: Message | undefined) =>
    message && author(message) !== null
      ? `${author(message)}${CARDS.has(message.kind) ? `#${message.id}` : ""}`
      : undefined;
  return messages.map((message, index) => {
    const own = key(message);
    return { first: own === undefined || key(messages[index - 1]) !== own };
  });
}

function matchesFilter(message: Message, filter: Filter | null): boolean {
  switch (filter) {
    case null:
      return true;
    case "AI":
      return "from" in message && message.kind !== "file";
    case "文件":
      return message.kind === "file";
    case "改动":
      return message.kind === "change";
    case "出处":
      return (
        (message.kind === "result" && Boolean(message.claims?.length)) ||
        (message.kind === "text" && Boolean(message.tag))
      );
    case "决定":
      return message.kind === "decision" || message.kind === "options" || message.kind === "plan";
  }
}

/** Open decisions in this chat, oldest first: what the orange jump button walks through. */
export function openDecisions(messages: readonly Message[]): Message[] {
  return messages.filter(
    (message) =>
      ((message.kind === "decision" || message.kind === "options") && !message.answered) ||
      (message.kind === "plan" && !message.answered && !message.scheduled),
  );
}

function orderJobs(jobs: readonly Job[], chatId: string): Job[] {
  const here = jobs.filter((job) => job.chatId === chatId);
  return [...here.filter((job) => job.waiting), ...here.filter((job) => !job.waiting)];
}

interface Menu {
  readonly x: number;
  readonly y: number;
  readonly messageId: string;
}

export function Conversation(props: ConversationProps) {
  const { world, chat, integration } = props;
  const act = (action: ChatAction) => void props.act(action).catch(() => undefined);
  const all = world.messages[chat.id] ?? [];
  const [pinnedAt, setPinnedAt] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<readonly string[] | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [hit, setHit] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const column = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [topHeight, setTopHeight] = useState(0);
  const [bottomHeight, setBottomHeight] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messages = all;
  const grouped = runs(messages);
  const jobs = orderJobs(world.jobs, chat.id);
  const shownJob = jobs.length ? jobs[pinnedAt % jobs.length] : undefined;
  const decisions = openDecisions(all);
  const needle = query.trim();
  const hits =
    props.searchOpen && (needle || filter)
      ? messages.filter((m) => matchesFilter(m, filter) && (!needle || textOf(m).includes(needle)))
      : [];
  const currentHit = hits.length ? hits[Math.min(hit, hits.length - 1)] : undefined;

  // Opening a chat lands on the unread line if there is one, otherwise at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per opened chat
  useLayoutEffect(() => {
    setPinnedAt(0);
    setReplyTo(null);
    setEditing(null);
    setSelected(null);
    setMenu(null);
    const element = column.current;
    if (!element) return;
    const divider = element.querySelector(".mc-unread-divider");
    const covered = top.current?.offsetHeight ?? 0;
    if (divider instanceof HTMLElement)
      element.scrollTop = Math.max(0, divider.offsetTop - covered - 24);
    else element.scrollTop = element.scrollHeight;
  }, [chat.id]);

  // The header and pinned bar float over the top of the messages and the composer over the bottom;
  // the column pads itself by their heights so every message can still scroll clear of both.
  useLayoutEffect(() => {
    const observed = [
      [top.current, setTopHeight],
      [bottom.current, setBottomHeight],
    ] as const;
    const observer = new ResizeObserver(() => {
      for (const [element, set] of observed) if (element) set(element.offsetHeight);
    });
    for (const [element, set] of observed)
      if (element) {
        set(element.offsetHeight);
        observer.observe(element);
      }
    return () => observer.disconnect();
  }, []);
  // Top padding moves the content; scroll by the same amount so what was in view stays put. A taller
  // composer keeps a view that was at the bottom at the bottom.
  const padded = useRef(0);
  useLayoutEffect(() => {
    const element = column.current;
    if (element) element.scrollTop += topHeight - padded.current;
    padded.current = topHeight;
  }, [topHeight]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the composer height only
  useLayoutEffect(() => {
    const element = column.current;
    if (element && atBottom) element.scrollTop = element.scrollHeight;
  }, [bottomHeight]);

  // A streamed answer updates in place, sometimes before an unchanged status or error row.
  const contentRevision = all.map((message) => `${message.id}:${textOf(message).length}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only follow new content while already at the bottom
  useLayoutEffect(() => {
    const element = column.current;
    if (element && atBottom) element.scrollTop = element.scrollHeight;
  }, [contentRevision]);

  useEffect(() => {
    if (props.searchOpen) searchInput.current?.focus();
    else {
      setQuery("");
      setFilter(null);
    }
  }, [props.searchOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls only when the hit changes
  useEffect(() => {
    if (currentHit) reveal(currentHit.id, false);
  }, [currentHit?.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(timer);
  }, [notice]);

  function reveal(messageId: string, blink = true) {
    const element = column.current?.querySelector(`[data-wrap="${CSS.escape(messageId)}"]`);
    if (element instanceof HTMLElement)
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    if (blink) {
      setFlash(messageId);
      setTimeout(() => setFlash((value) => (value === messageId ? null : value)), 1600);
    }
  }

  const find = (messageId: string) => all.find((message) => message.id === messageId);
  const senderName = (message: Message): string => {
    const from = author(message);
    if (from === "me") return "你";
    return (from && world.members[from]?.name) ?? "moyyi";
  };
  const copy = (text: string, done: string) => {
    if (!navigator.clipboard) {
      setNotice("当前无法访问剪贴板。");
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => setNotice(done),
      (cause: unknown) => setNotice(actionError(cause)),
    );
  };

  const actions: MessageActions = {
    answer: (messageId, key) => {
      const message = find(messageId);
      if (message?.kind === "result" && !integration) {
        const claim = message.claims?.find((c) => !c.check) ?? message.claims?.[0];
        if (key === 1) setNotice("在 Finder 里打开了论文文件夹");
        else if (claim) props.onPanel({ kind: "claim", messageId, claimId: claim.id });
        else setNotice("核查已经对过了 · 这次没有要你核对的结论");
        return;
      }
      act({ type: "answer", messageId, key });
      if (
        !integration &&
        message?.kind === "decision" &&
        message.text.includes("毕业论文") &&
        key === 0
      )
        props.onOpenChat("lunwen");
    },
    react: (messageId, emoji) => act({ type: "react", messageId, emoji }),
    openReplies: (messageId) => props.onPanel({ kind: "thread", messageId }),
    openClaim: (messageId, claimId) => props.onPanel({ kind: "claim", messageId, claimId }),
    undo: (changeIds) => act({ type: "undo", changeIds }),
    openChat: props.onOpenChat,
    retry: (messageId) => {
      const message = find(messageId);
      if (message?.kind === "out") act({ type: "send", chatId: chat.id, text: message.text });
    },
    unschedule: (messageId) => act({ type: "unschedule", messageId }),
  };

  const command = (name: string) => {
    if (name === "/新会话" && integration) integration.onNew();
    else if (name === "/撤回") props.onPanel({ kind: "undo" });
    else if (name === "/预算") props.onInfo();
    else if (name === "/对账") {
      const result = all.find(
        (m) => m.kind === "result" && m.claims?.some((claim) => !claim.check),
      );
      const claim = result?.kind === "result" ? result.claims?.find((c) => !c.check) : undefined;
      if (result && claim)
        props.onPanel({ kind: "claim", messageId: result.id, claimId: claim.id });
      else setNotice("这个对话里没有要对账的结论");
    } else act({ type: "send", chatId: chat.id, text: name });
  };

  const editLast = () => {
    if (!supports(integration, "edit")) return;
    const last = [...all].reverse().find((m) => m.kind === "out" && !m.retracted && !m.failed);
    if (last?.kind !== "out") return;
    setEditing(last.id);
    props.onDraft(last.text);
    if (last.receipt === "taken")
      setNotice("已经有人接手了 · 改的话会作为一条补充发出去，原话不变");
  };

  const toggleSelect = (messageId: string) =>
    setSelected((value) => {
      const now = value ?? [];
      const next = now.includes(messageId)
        ? now.filter((id) => id !== messageId)
        : [...now, messageId];
      return next.length ? next : null;
    });

  const openMenu = (x: number, y: number, messageId: string) => {
    const message = find(messageId);
    if (!message || message.kind === "unread-divider") return;
    const bounds = column.current?.getBoundingClientRect();
    if (!bounds) return;
    // Keep the menu inside the column: 180px wide, at most seven 34px items.
    setMenu({
      x: Math.max(8, Math.min(x - bounds.left, bounds.width - 188)),
      y: Math.max(8, Math.min(y - bounds.top, bounds.height - 260)),
      messageId,
    });
  };

  const menuMessage = menu ? find(menu.messageId) : undefined;
  const replyMessage = replyTo ? find(replyTo) : undefined;
  const projects = world.chats.filter(
    (c) => c.kind === "project" && c.id !== chat.id && !c.archived,
  );

  return (
    <section className="mc-wallpaper ch-conversation" aria-label={chat.name}>
      <div ref={top} className="mc-chat-top">
        <header className="mc-head">
          {props.narrow ? (
            <button
              type="button"
              className="mc-icon-btn mc-glass mc-round"
              aria-label="返回列表"
              title="返回列表"
              onClick={props.onBack}
            >
              <Icon.back size={18} />
            </button>
          ) : null}
          <button
            type="button"
            className="mc-glass mc-head-main"
            title="资料"
            onClick={props.onInfo}
          >
            <Avatar
              avatar={chat.avatar}
              shape={chat.kind === "project" ? "project" : "ai"}
              size={32}
            />
            <span className="mc-head-text">
              <span className="mc-head-name">{chat.name}</span>
              <span className="mc-head-sub">{chat.subtitle}</span>
            </span>
          </button>
          <div className="mc-glass mc-head-tools">
            <button
              type="button"
              className="mc-icon-btn"
              aria-label="搜索这个对话"
              title="搜索这个对话 ⌘F"
              aria-pressed={props.searchOpen}
              onClick={() => props.onSearch(!props.searchOpen)}
            >
              <Icon.search size={18} />
            </button>
            <button
              type="button"
              className="mc-icon-btn"
              aria-label="资料"
              title="资料"
              aria-pressed={props.infoOpen}
              onClick={props.onInfo}
            >
              <Icon.info size={18} />
            </button>
          </div>
        </header>
        {integration?.header}
        {props.feedback ? (
          <p className="ch-integration-error" role="alert">
            {props.feedback}
          </p>
        ) : null}
        {props.searchOpen ? (
          <search className="mc-glass ch-search-bar">
            <div className="mc-composer ch-search">
              <Icon.search />
              <label htmlFor={`find-${chat.id}`} className="ch-sr">
                在这个对话里找
              </label>
              <input
                ref={searchInput}
                id={`find-${chat.id}`}
                type="search"
                placeholder="在这个对话里找"
                value={query}
                onChange={(event) => {
                  setHit(0);
                  setQuery(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && hits.length) {
                    event.preventDefault();
                    setHit(
                      (value) => (value + (event.shiftKey ? hits.length - 1 : 1)) % hits.length,
                    );
                  } else if (event.key === "Escape") {
                    event.stopPropagation();
                    props.onSearch(false);
                  }
                }}
              />
              <span className="ch-sub num" aria-live="polite">
                {needle || filter
                  ? hits.length
                    ? `第 ${Math.min(hit, hits.length - 1) + 1}/${hits.length} 处`
                    : "没找到"
                  : ""}
              </span>
            </div>
            <fieldset className="ch-filters">
              <legend className="ch-sr">只看</legend>
              {FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="ch-tab"
                  aria-pressed={filter === item}
                  onClick={() => {
                    setHit(0);
                    setFilter(filter === item ? null : item);
                  }}
                >
                  {item}
                </button>
              ))}
            </fieldset>
          </search>
        ) : null}
        {shownJob ? (
          <PinnedBar
            job={shownJob}
            index={pinnedAt % jobs.length}
            jobs={jobs}
            onJump={() => {
              reveal(shownJob.messageId);
              setPinnedAt((value) => value + 1);
            }}
            onList={() => props.onPanel({ kind: "jobs" })}
            onStop={() => act({ type: "stop", jobId: shownJob.id })}
          />
        ) : null}
        {world.connection.state === "offline" && !integration ? (
          <div className="ch-offline" role="status">
            <span className="ch-offline-title">没连上网络</span>
            <span className="muted">
              {world.connection.note ?? "本机的事继续做；消息连上后再发"}
            </span>
          </div>
        ) : null}
      </div>
      <div className="ch-column">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the column delegates the message menu; the ContextMenu key and Shift+F10 reach it from the keyboard */}
        <div
          ref={column}
          className="mc-msgs ch-msgs"
          style={{
            paddingTop: `calc(${topHeight}px + var(--space-16))`,
            paddingBottom: `calc(${bottomHeight}px + var(--space-8))`,
            scrollPaddingTop: `calc(${topHeight}px + var(--space-8))`,
            scrollPaddingBottom: `calc(${bottomHeight}px + var(--space-8))`,
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 48);
            setMenu(null);
          }}
          onContextMenu={(event) => {
            const wrap = (event.target as HTMLElement).closest<HTMLElement>("[data-wrap]");
            if (!wrap?.dataset.wrap) return;
            event.preventDefault();
            openMenu(event.clientX, event.clientY, wrap.dataset.wrap);
          }}
          onPointerDown={(event) => {
            if (event.pointerType !== "touch") return;
            const wrap = (event.target as HTMLElement).closest<HTMLElement>("[data-wrap]");
            const { clientX, clientY } = event;
            if (wrap?.dataset.wrap)
              press.current = setTimeout(
                () => openMenu(clientX, clientY, wrap.dataset.wrap ?? ""),
                500,
              );
          }}
          onPointerUp={() => press.current && clearTimeout(press.current)}
          onPointerCancel={() => press.current && clearTimeout(press.current)}
        >
          {messages.length === 0 ? <span className="mc-service">还没有消息</span> : null}
          {messages.map((message, index) => {
            const isSelected = selected?.includes(message.id) ?? false;
            return (
              <div
                key={message.id}
                className={`ch-msg${flash === message.id || currentHit?.id === message.id ? " ch-flash" : ""}${message.kind === "service" && message.day ? " ch-day" : ""}`}
                data-wrap={message.id}
                data-selected={selected ? String(isSelected) : undefined}
                onClickCapture={(event) => {
                  if (message.kind === "unread-divider" || message.kind === "service") return;
                  if (selected || event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleSelect(message.id);
                  }
                }}
              >
                <MessageView
                  message={message}
                  chat={chat}
                  members={world.members}
                  run={grouped[index] ?? { first: true }}
                  actions={actions}
                  sticker={props.sticker}
                  renderText={integration?.renderText}
                />
              </div>
            );
          })}
        </div>
        {menu && menuMessage ? (
          <MessageMenu
            menu={menu}
            message={menuMessage}
            integration={integration}
            onClose={() => setMenu(null)}
            onReply={() => setReplyTo(menuMessage.id)}
            onCopy={() => copy(textOf(menuMessage), "已复制")}
            onLink={() =>
              copy(
                `moyyi://chat/${chat.id}/${menuMessage.id}`,
                "已复制链接 · 粘贴到记忆或别的聊天里会变成引用",
              )
            }
            onSelect={() => toggleSelect(menuMessage.id)}
            onEdit={() => {
              if (menuMessage.kind !== "out") return;
              setEditing(menuMessage.id);
              props.onDraft(menuMessage.text);
            }}
            onRetract={() => act({ type: "retract", messageId: menuMessage.id })}
            onForward={() => {
              setSelected([menuMessage.id]);
              setForwarding(true);
            }}
          />
        ) : null}
        {!atBottom || decisions.length ? (
          <div className="mc-jumps" style={{ bottom: `calc(${bottomHeight}px + var(--space-12))` }}>
            {decisions.length && !atBottom ? (
              <button
                type="button"
                className="mc-jump mc-jump-attention"
                aria-label={`跳到下一个要你决定的，${decisions.length} 个`}
                title="下一个要你决定的"
                onClick={() => {
                  const next = decisions[0];
                  if (next) reveal(next.id);
                }}
              >
                <Icon.attention size={18} />
                <Badge kind="decide" count={decisions.length} />
              </button>
            ) : null}
            {!atBottom ? (
              <button
                type="button"
                className="mc-jump"
                aria-label={chat.unread ? `跳到最新，${chat.unread} 条未读` : "跳到最新"}
                title="跳到最新"
                onClick={() => {
                  const element = column.current;
                  if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
                  act({ type: "open", chatId: chat.id });
                }}
              >
                <Icon.down size={18} />
                <Badge kind="unread" count={chat.unread} />
              </button>
            ) : null}
          </div>
        ) : null}
        {notice ? (
          <span
            className="mc-service ch-toast"
            role="status"
            style={{ bottom: `calc(${bottomHeight}px + var(--space-12))` }}
          >
            {notice}
          </span>
        ) : null}
      </div>
      <div ref={bottom} className="mc-chat-bottom">
        {integration?.beforeComposer}
        {selected ? (
          <SelectionBar
            count={selected.length}
            forwarding={forwarding}
            projects={projects}
            integration={integration}
            onCheck={() => {
              const result = selected
                .map(find)
                .find((m) => m?.kind === "result" && m.claims?.length);
              const claim =
                result?.kind === "result"
                  ? (result.claims?.find((c) => !c.check) ?? result.claims?.[0])
                  : undefined;
              if (result && claim)
                props.onPanel({ kind: "claim", messageId: result.id, claimId: claim.id });
              else setNotice("选中的消息里没有带出处的结论");
            }}
            onMemory={() => {
              void props
                .act({ type: "save-memory", messageIds: selected })
                .then(() => {
                  setSelected(null);
                  if (!integration) setNotice(`存进记忆了 · ${selected.length} 条，带着出处`);
                })
                .catch(() => undefined);
            }}
            onForward={() => setForwarding(true)}
            onForwardTo={(chatId) => {
              void props
                .act({ type: "forward", messageIds: selected, chatId })
                .then(() => {
                  setSelected(null);
                  setForwarding(false);
                  if (!integration) setNotice("转过去了 · 出处跟着走，文件权限不跟着走");
                })
                .catch(() => undefined);
            }}
            onCopy={() => {
              copy(
                selected
                  .map(find)
                  .filter((m): m is Message => Boolean(m))
                  .map((m) => `${senderName(m)}：${textOf(m)}`)
                  .join("\n"),
                `已复制 ${selected.length} 条`,
              );
              setSelected(null);
            }}
            onCancel={() => {
              setSelected(null);
              setForwarding(false);
            }}
          />
        ) : (
          <Composer
            chat={chat}
            members={world.members}
            integration={integration}
            draft={props.draft}
            running={
              shownJob
                ? { who: chat.kind === "project" ? "负责人 moyyi" : chat.name, step: shownJob.step }
                : null
            }
            sticker={props.sticker}
            onDraft={props.onDraft}
            onSend={async (text) => {
              if (editing) await props.act({ type: "edit", messageId: editing, text });
              else
                await props.act({
                  type: "send",
                  chatId: chat.id,
                  text,
                  ...(replyTo ? { replyTo } : {}),
                });
              setEditing(null);
              setReplyTo(null);
              setAtBottom(true);
            }}
            onStop={() => shownJob && act({ type: "stop", jobId: shownJob.id })}
            onAttach={(name, access) => act({ type: "attach", chatId: chat.id, name, access })}
            onCommand={command}
            onVoice={(seconds) =>
              act({
                type: "send",
                chatId: chat.id,
                text: `[语音 0:${String(seconds).padStart(2, "0")}]`,
              })
            }
            onReopen={() => act({ type: "archive", chatId: chat.id, archived: false })}
            replyTo={
              replyMessage ? { name: senderName(replyMessage), text: textOf(replyMessage) } : null
            }
            onCancelReply={() => setReplyTo(null)}
            editing={editing !== null}
            onEditLast={editLast}
            onCancelEdit={() => {
              if (editing) props.onDraft("");
              setEditing(null);
            }}
          />
        )}
      </div>
    </section>
  );
}

function PinnedBar({
  job,
  index,
  jobs,
  onJump,
  onList,
  onStop,
}: {
  readonly job: Job;
  readonly index: number;
  readonly jobs: readonly Job[];
  readonly onJump: () => void;
  readonly onList: () => void;
  readonly onStop: () => void;
}) {
  const total = jobs.length;
  const count = total > 1 ? ` · 第 ${index + 1}/${total} 件` : "";
  const label = job.stopping
    ? `正在停${count} · ${job.name}`
    : `${job.waiting ? "等你" : "进度"}${count} · ${job.name}`;
  return (
    <div className={`mc-pinned mc-glass${job.waiting ? " mc-pinned-attention" : ""}`}>
      <button type="button" className="mc-pinned-jump" aria-label="跳到进度消息" onClick={onJump}>
        <span className="mc-pinned-segs">
          {jobs.map((each, at) => (
            <span
              key={each.id}
              className={each.waiting ? "mc-seg-attention" : undefined}
              aria-current={at === index ? "true" : undefined}
            />
          ))}
        </span>
        <span className="ch-min">
          <span className="mc-pinned-label">{label}</span>
          <span className="mc-pinned-body ch-block">
            {job.waiting ? `等你决定：${job.waiting} · ${job.step}` : job.step}
          </span>
        </span>
      </button>
      {total > 1 ? (
        <button
          type="button"
          className="mc-icon-btn mc-pinned-list"
          aria-label="全部在做的事"
          title="全部在做的事"
          onClick={onList}
        >
          <Icon.list size={18} />
        </button>
      ) : null}
      <button type="button" className="mc-stop" disabled={job.stopping} onClick={onStop}>
        {job.stopping ? "正在停…" : "停下"}
      </button>
    </div>
  );
}

function MessageMenu({
  menu,
  message,
  integration,
  onClose,
  onReply,
  onCopy,
  onLink,
  onSelect,
  onEdit,
  onRetract,
  onForward,
}: {
  readonly menu: Menu;
  readonly message: Message;
  readonly integration?: ChatIntegration | undefined;
  readonly onClose: () => void;
  readonly onReply: () => void;
  readonly onCopy: () => void;
  readonly onLink: () => void;
  readonly onSelect: () => void;
  readonly onEdit: () => void;
  readonly onRetract: () => void;
  readonly onForward: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  const own = message.kind === "out" && !message.retracted;
  const items: { label: string; run: () => void; danger?: boolean }[] = [
    ...(!integration ? [{ label: "回复", run: onReply }] : []),
    { label: "复制", run: onCopy },
    ...(!integration ? [{ label: "复制链接", run: onLink }] : []),
    ...((message.kind === "text" || message.kind === "result") && supports(integration, "forward")
      ? [{ label: "转发", run: onForward }]
      : []),
    { label: "选择", run: onSelect },
    ...(own && message.receipt !== "taken" && supports(integration, "edit")
      ? [{ label: "改这句", run: onEdit }]
      : []),
    ...(own && supports(integration, "retract")
      ? [{ label: "收回这句话", run: onRetract, danger: true }]
      : []),
  ];
  return (
    <>
      <button
        type="button"
        className="ch-scrim"
        aria-label="关闭菜单"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className="mc-attach ch-menu mc-glass"
        role="menu"
        aria-label="消息"
        style={{ left: menu.x, top: menu.y }}
        onKeyDown={(event) => {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            buttons[
              (at + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length
            ]?.focus();
          }
        }}
      >
        {items.map((item, index) => (
          <button
            key={item.label}
            ref={index === 0 ? first : undefined}
            type="button"
            className={`mc-attach-item${item.danger ? " ch-danger" : ""}`}
            role="menuitem"
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

function SelectionBar({
  count,
  forwarding,
  projects,
  integration,
  onCheck,
  onMemory,
  onForward,
  onForwardTo,
  onCopy,
  onCancel,
}: {
  readonly count: number;
  readonly forwarding: boolean;
  readonly projects: readonly Chat[];
  readonly integration?: ChatIntegration | undefined;
  readonly onCheck: () => void;
  readonly onMemory: () => void;
  readonly onForward: () => void;
  readonly onForwardTo: (chatId: string) => void;
  readonly onCopy: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="ch-composer-wrap">
      {forwarding ? (
        <div className="mc-suggest ch-popup mc-glass" role="menu" aria-label="转到哪个项目">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="mc-suggest-item"
              role="menuitem"
              onClick={() => onForwardTo(project.id)}
            >
              <Avatar avatar={project.avatar} shape="project" size={32} />
              <strong>{project.name}</strong>
              <span className="muted">出处跟着走，文件权限不跟着走</span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="mc-composer mc-glass ch-selection"
        role="toolbar"
        aria-label={`已选 ${count} 条`}
      >
        <span className="ch-grow num">已选 {count} 条</span>
        <button
          type="button"
          className="mc-key"
          disabled={!supports(integration, "check")}
          title={supports(integration, "check") ? undefined : "当前版本尚未接入逐条核对"}
          onClick={onCheck}
        >
          对账
        </button>
        <button
          type="button"
          className="mc-key mc-key-primary"
          disabled={!supports(integration, "save-memory")}
          title={supports(integration, "save-memory") ? undefined : "当前版本尚未接入记忆"}
          onClick={onMemory}
        >
          存进记忆
        </button>
        <button
          type="button"
          className="mc-key"
          disabled={!supports(integration, "forward")}
          title={supports(integration, "forward") ? undefined : "当前版本尚未接入转发"}
          onClick={onForward}
        >
          转发
        </button>
        <button type="button" className="mc-key" onClick={onCopy}>
          复制
        </button>
        <button
          type="button"
          className="mc-icon-btn"
          aria-label="取消选择"
          title="取消选择"
          onClick={onCancel}
        >
          <Icon.close />
        </button>
      </div>
    </div>
  );
}
