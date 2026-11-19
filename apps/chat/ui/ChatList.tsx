// The chat list (boards S1, S7, S8, S33). 全部 lists every chat by time. 项目 lists the working
// folders first; opening one lists its own chats, archived ones included. Chats that wait on you
// carry the 等你决定 prefix and an attention badge wherever they are listed.
import { useState } from "react";
import type { Chat, ChatWorld, FolderId, Project } from "../port.ts";
import { Icon } from "./icons.tsx";
import { Avatar, Badge, ReceiptMark } from "./parts.tsx";
import { chatsBadge, FolderStrip, inFolder, type ViewId, viewLabel } from "./Rail.tsx";

const EMPTY: Record<FolderId, readonly [string, string]> = {
  all: ["这里没有对话", "跟 moyyi 说一件想做的事，项目会出现在这里"],
  project: ["还没有项目", "计划卡上点开始，moyyi 才会在你选的文件夹里开工"],
};
/** The desktop app: every session works in one folder, and the folder is its project. */
const NATIVE_EMPTY: Record<FolderId, readonly [string, string]> = {
  all: ["还没有会话", "点右上角的笔，选一个文件夹，交代第一件事"],
  project: ["还没有项目", "点右上角的笔，选一个文件夹，它就成了一个项目"],
};

/** A project's chats, newest first as the world lists them. */
export function chatsOf(world: Pick<ChatWorld, "chats">, projectId: string): readonly Chat[] {
  return world.chats.filter((chat) => chat.project === projectId);
}

export function ChatList({
  world,
  folder,
  project,
  openId,
  drafts,
  onView,
  onOpen,
  onProject,
  onCompose,
  native = false,
  showArchive = true,
}: {
  readonly native?: boolean;
  readonly showArchive?: boolean;
  readonly world: ChatWorld;
  readonly folder: FolderId;
  /** The open project under 项目; null lists the projects themselves. */
  readonly project: Project | null;
  readonly onProject: (projectId: string | null) => void;
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
  const projects = folder === "project" && !project;
  const archived =
    showArchive && folder === "all" ? world.chats.filter((chat) => chat.archived) : [];
  const matches = (chat: Chat) =>
    !needle || chat.name.includes(needle) || chat.preview.text.includes(needle);
  const chats = projects
    ? []
    : (project ? chatsOf(world, project.id) : world.chats).filter(
        (chat) => (project || (archive ? chat.archived : inFolder(chat, folder))) && matches(chat),
      );
  const shownProjects = projects
    ? world.projects.filter((p) => !needle || p.name.includes(needle) || p.path.includes(needle))
    : [];
  const [emptyTitle, emptyNote] = needle
    ? [`没找到“${needle}”`, "试试搜文件名"]
    : project
      ? ["这个项目还没有对话", "点右上角的笔，在这个文件夹里交代一件事"]
      : (native ? NATIVE_EMPTY : EMPTY)[folder];
  const empty = projects ? shownProjects.length === 0 : chats.length === 0;
  return (
    <section className="mc-panel ch-list" aria-label={project ? project.name : "对话列表"}>
      {project ? (
        <button
          type="button"
          className="mc-panel-back ch-list-back"
          onClick={() => onProject(null)}
        >
          <Icon.back />
          项目
        </button>
      ) : null}
      <div className="ch-list-head">
        <h1 className="ch-list-title">
          {archive ? "归档" : project ? project.name : viewLabel(folder)}
        </h1>
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
          placeholder={projects ? "搜索项目或文件夹" : native ? "搜索会话" : "搜索对话、结论、文件"}
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
        ) : archived.length && !needle ? (
          <button type="button" className="mc-row ch-archive-row" onClick={() => setArchive(true)}>
            <span className="ch-archive-icon">
              <Icon.folder size={18} />
            </span>
            <span className="mc-row-name ch-grow">归档</span>
            <Badge kind="quiet" count={archived.length} />
          </button>
        ) : null}
        {project ? <span className="mc-mono ch-list-path">{project.path}</span> : null}
        {shownProjects.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            chats={chatsOf(world, p.id)}
            onOpen={() => onProject(p.id)}
          />
        ))}
        {chats.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            draft={drafts[chat.id]}
            mixed={folder === "all"}
            open={chat.id === openId}
            onOpen={() => onOpen(chat.id)}
          />
        ))}
        {empty && world.connection.state !== "loading" ? (
          <div className="ch-empty-list">
            <span className="ch-empty-title">{emptyTitle}</span>
            <span className="ch-sub">{emptyNote}</span>
          </div>
        ) : null}
        {world.firstRun && !needle && !native ? (
          <span className="ch-caption ch-first-run">项目会在你交代第一件事之后出现</span>
        ) : null}
      </div>
    </section>
  );
}

function ProjectRow({
  project,
  chats,
  onOpen,
}: {
  readonly project: Project;
  readonly chats: readonly Chat[];
  readonly onOpen: () => void;
}) {
  const badge = chatsBadge(chats.filter((chat) => !chat.archived));
  return (
    <a
      className="mc-row"
      href={`#project/${project.id}`}
      onClick={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      <Avatar avatar={project.avatar} shape="project" size={48} />
      <span className="mc-row-body">
        <span className="mc-row-top">
          <span className="mc-row-name">{project.name}</span>
          <span className="mc-row-time">{chats[0]?.time ?? ""}</span>
        </span>
        <span className="mc-row-bottom">
          <span className="mc-row-preview ch-one-line">
            <span className="mc-mono">{project.path}</span> · {chats.length} 个对话
          </span>
          {badge ? <Badge kind={badge.kind} count={badge.count} /> : null}
        </span>
      </span>
    </a>
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
