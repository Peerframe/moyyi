// Folder rail and chat list (boards S1, S7, S8). Folders are filters over one list; a folder's
// badge counts open decisions if any, otherwise chats with unread messages (muted chats never count).
import { useState } from "react";
import type { Chat, ChatWorld, FolderId } from "../port.ts";
import { Icon } from "./icons.tsx";
import { Avatar, Badge, ReceiptMark } from "./parts.tsx";

const EMPTY: Record<FolderId, readonly [string, string]> = {
  all: ["这里没有对话", "跟 moyyi 说一件想做的事，项目和 AI 会出现在这里"],
  ai: ["还没有 AI", "交代第一件事之后，moyyi 会拉合适的 AI 进来"],
  project: ["还没有项目", "计划卡上点开始，才会建项目群"],
  mine: ["没有等你的事", "有决定要你做时，这里会出现橙色数字"],
  ledger: ["没有要对账的结论", "AI 给出结论后，没核对的会列在这里"],
};

const FOLDERS: readonly {
  readonly id: FolderId;
  readonly label: string;
  readonly icon: keyof typeof Icon;
}[] = [
  { id: "all", label: "全部", icon: "all" },
  { id: "ai", label: "AI", icon: "ai" },
  { id: "project", label: "项目", icon: "project" },
  { id: "mine", label: "等我的", icon: "clock" },
  { id: "ledger", label: "待对账", icon: "ledger" },
];

export function inFolder(chat: Chat, folder: FolderId): boolean {
  if (chat.archived) return false;
  switch (folder) {
    case "all":
      return true;
    case "ai":
      return chat.kind === "ai" || chat.kind === "moyyi";
    case "project":
      return chat.kind === "project";
    case "mine":
      return chat.decisions > 0;
    case "ledger":
      return (chat.toCheck ?? 0) > 0;
  }
}

export function folderBadge(
  chats: readonly Chat[],
  folder: FolderId,
): { kind: "decide" | "unread" | "quiet"; count: number } | null {
  const inside = chats.filter((chat) => inFolder(chat, folder));
  if (folder === "ledger") {
    const count = inside.reduce((sum, chat) => sum + (chat.toCheck ?? 0), 0);
    return count ? { kind: "quiet", count } : null;
  }
  const decisions = inside.reduce((sum, chat) => sum + chat.decisions, 0);
  if (decisions) return { kind: "decide", count: decisions };
  const unread = inside.filter((chat) => chat.unread > 0 && !chat.muted).length;
  return unread ? { kind: "unread", count: unread } : null;
}

export function Rail({
  world,
  folder,
  onFolder,
}: {
  readonly world: ChatWorld;
  readonly folder: FolderId;
  readonly onFolder: (folder: FolderId) => void;
}) {
  return (
    <nav className="mc-rail ch-rail" aria-label="文件夹">
      <span className="ch-wordmark">moyyi</span>
      {FOLDERS.map((item) => {
        const FolderIcon = Icon[item.icon];
        const badge = folderBadge(world.chats, item.id);
        return (
          <button
            key={item.id}
            type="button"
            className="mc-rail-item"
            aria-current={folder === item.id ? "true" : undefined}
            onClick={() => onFolder(item.id)}
          >
            <FolderIcon size={20} />
            <span>{item.label}</span>
            {badge ? <Badge kind={badge.kind} count={badge.count} /> : null}
          </button>
        );
      })}
    </nav>
  );
}

/** Below 900px the rail becomes a strip of chips above the list. */
function FolderStrip({
  world,
  folder,
  onFolder,
}: {
  readonly world: ChatWorld;
  readonly folder: FolderId;
  readonly onFolder: (folder: FolderId) => void;
}) {
  return (
    <nav className="ch-strip" aria-label="文件夹">
      {FOLDERS.map((item) => {
        const badge = folderBadge(world.chats, item.id);
        return (
          <button
            key={item.id}
            type="button"
            className="mc-key ch-strip-key"
            aria-current={folder === item.id ? "true" : undefined}
            onClick={() => onFolder(item.id)}
          >
            {item.label}
            {badge ? <Badge kind={badge.kind} count={badge.count} /> : null}
          </button>
        );
      })}
    </nav>
  );
}

export function ChatList({
  world,
  folder,
  openId,
  drafts,
  onFolder,
  onOpen,
}: {
  readonly world: ChatWorld;
  readonly folder: FolderId;
  readonly openId: string | null;
  readonly drafts: Readonly<Record<string, string>>;
  readonly onFolder: (folder: FolderId) => void;
  readonly onOpen: (chatId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [archive, setArchive] = useState(false);
  const needle = query.trim();
  const archived = world.chats.filter((chat) => chat.archived);
  const chats = world.chats.filter(
    (chat) =>
      (archive ? chat.archived : inFolder(chat, folder)) &&
      (!needle || chat.name.includes(needle) || chat.preview.text.includes(needle)),
  );
  const [emptyTitle, emptyNote] = needle
    ? [`没找到“${needle}”`, "试试搜文件名，或者到项目里 /对账"]
    : EMPTY[folder];
  return (
    <section className="mc-panel ch-list" aria-label="对话列表">
      <FolderStrip world={world} folder={folder} onFolder={onFolder} />
      <div className="mc-composer ch-search">
        <Icon.search />
        <label htmlFor="chat-search" className="ch-sr">
          搜索
        </label>
        <input
          id="chat-search"
          type="search"
          placeholder="搜索 AI、项目、结论"
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
            mixed={folder === "all" || folder === "mine" || folder === "ledger"}
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
        {world.firstRun && !needle ? (
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
