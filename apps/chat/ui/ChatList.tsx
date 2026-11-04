// The chat list (boards S1, S7, S8): one list, filtered by the folder the rail picked.
import { useState } from "react";
import type { Chat, ChatWorld, FolderId } from "../port.ts";
import { Icon } from "./icons.tsx";
import { Avatar, Badge, ReceiptMark } from "./parts.tsx";
import { FolderStrip, inFolder, type ViewId, viewLabel } from "./Rail.tsx";

const EMPTY: Record<FolderId, readonly [string, string]> = {
  all: ["这里没有对话", "跟 moyyi 说一件想做的事，项目和 AI 会出现在这里"],
  ai: ["还没有 AI", "交代第一件事之后，moyyi 会拉合适的 AI 进来"],
  project: ["还没有项目", "计划卡上点开始，才会建项目群"],
  mine: ["没有等你的事", "有决定要你做时，这里会出现橙色数字"],
  running: ["没有在做的事", "计划卡上点开始之后，正在做的项目和 AI 会列在这里"],
};

export function ChatList({
  world,
  folder,
  openId,
  drafts,
  onView,
  onOpen,
  onCompose,
  native = false,
  showArchive = true,
}: {
  readonly native?: boolean;
  readonly showArchive?: boolean;
  readonly world: ChatWorld;
  readonly folder: FolderId;
  readonly openId: string | null;
  readonly drafts: Readonly<Record<string, string>>;
  readonly onView: (view: ViewId) => void;
  readonly onOpen: (chatId: string) => void;
  /** New work always starts by telling moyyi, so composing opens moyyi's chat. */
  readonly onCompose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [archive, setArchive] = useState(false);
  const needle = query.trim();
  const archived = showArchive ? world.chats.filter((chat) => chat.archived) : [];
  const chats = world.chats.filter(
    (chat) =>
      (archive ? chat.archived : inFolder(world, chat, folder)) &&
      (!needle || chat.name.includes(needle) || chat.preview.text.includes(needle)),
  );
  const [emptyTitle, emptyNote] = needle
    ? [`没找到“${needle}”`, "试试搜文件名，或者到项目里 /对账"]
    : native
      ? [
          folder === "mine"
            ? "没有等你确认的操作"
            : folder === "running"
              ? "没有正在运行的任务"
              : "这里没有会话",
          "选择已有会话，或点击右上角开始新会话",
        ]
      : EMPTY[folder];
  return (
    <section className="mc-panel ch-list" aria-label="对话列表">
      <div className="ch-list-head">
        <h1 className="ch-list-title">{archive ? "归档" : viewLabel(folder)}</h1>
        <button
          type="button"
          className="mc-icon-btn ch-list-compose"
          aria-label="跟 moyyi 说一件新事"
          title="跟 moyyi 说一件新事"
          onClick={onCompose}
        >
          <Icon.compose size={20} />
        </button>
      </div>
      <FolderStrip world={world} view={folder} onView={onView} />
      <div className="mc-composer ch-search">
        <Icon.search />
        <label htmlFor="chat-search" className="ch-sr">
          搜索
        </label>
        <input
          id="chat-search"
          type="search"
          placeholder={native ? "搜索会话" : "搜索 AI、项目、结论"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="ch-rows">
        {world.connection.state === "loading" ? <Skeleton /> : null}
        {archive ? (
          <button type="button" className="mc-row ch-archive-row" onClick={() => setArchive(false)}>
            <span className="ch-archive-icon">
              <Icon.back size={18} />
            </span>
            <span className="mc-row-name">归档</span>
          </button>
        ) : archived.length && folder === "all" && !needle ? (
          <button type="button" className="mc-row ch-archive-row" onClick={() => setArchive(true)}>
            <span className="ch-archive-icon">
              <Icon.folder size={18} />
            </span>
            <span className="mc-row-name ch-grow">归档</span>
            <Badge kind="quiet" count={archived.length} />
          </button>
        ) : null}
        {chats.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            draft={drafts[chat.id]}
            mixed={folder === "all" || folder === "mine" || folder === "running"}
            open={chat.id === openId}
            onOpen={() => onOpen(chat.id)}
          />
        ))}
        {chats.length === 0 && world.connection.state !== "loading" ? (
          <div className="ch-empty-list">
            <span className="ch-empty-title">{emptyTitle}</span>
            <span className="ch-sub">{emptyNote}</span>
          </div>
        ) : null}
        {world.firstRun && !needle && !native ? (
          <span className="ch-caption ch-first-run">项目和 AI 会在你交代第一件事之后出现</span>
        ) : null}
      </div>
    </section>
  );
}

function ChatRow({
  chat,
  draft,
  mixed,
  open,
  onOpen,
}: {
  readonly chat: Chat;
  readonly draft: string | undefined;
  readonly mixed: boolean;
  readonly open: boolean;
  readonly onOpen: () => void;
}) {
  const preview = draft ? { prefix: "draft" as const, text: draft } : chat.preview;
  return (
    <a
      className="mc-row"
      href={`#${chat.id}`}
      aria-current={open ? "true" : undefined}
      onClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      <Avatar
        avatar={chat.avatar}
        shape={chat.kind === "project" ? "project" : "ai"}
        size={48}
        presence={chat.presence}
      />
      <span className="mc-row-body">
        <span className="mc-row-top">
          <span className="mc-row-name">{chat.name}</span>
          {chat.pinned ? <Icon.pin size={13} label="置顶" /> : null}
          {chat.muted ? <Icon.muted size={13} label="已静音" /> : null}
          {chat.receipt && !draft ? (
            <span className="mc-row-receipt">
              <ReceiptMark receipt={chat.receipt} />
            </span>
          ) : null}
          {mixed && chat.kind === "ai" ? <span className="mc-kind">AI</span> : null}
          <span className="mc-row-time">{chat.time}</span>
        </span>
        <span className="mc-row-bottom">
          <span className="mc-row-preview">
            {preview.prefix === "decide" ? (
              <span className="mc-prefix-decide">等你决定：</span>
            ) : null}
            {preview.prefix === "draft" ? <span className="mc-prefix-draft">草稿：</span> : null}
            {preview.text}
          </span>
          {chat.decisions ? (
            <Badge kind="decide" count={chat.decisions} />
          ) : (
            <Badge kind={chat.muted ? "quiet" : "unread"} count={chat.unread} />
          )}
        </span>
      </span>
    </a>
  );
}

function Skeleton() {
  return (
    <div className="ch-skeleton" aria-label="正在加载" role="status">
      {[46, 30, 52].map((width) => (
        <div key={width} className="ch-skeleton-row">
          <span className="ch-skeleton-av" />
          <span className="ch-grow ch-skeleton-lines">
            <span style={{ width: `${width}%` }} />
            <span style={{ width: `${width + 24}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
