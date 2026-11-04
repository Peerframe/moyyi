// Folder rail (boards S1, S7, S8, S12): state folders, a hairline, kinds, then 插件 and 设置 at the
// bottom. Folders filter one chat list; their badge counts open decisions if any, otherwise chats
// with unread messages (muted chats never count). 在做 counts running jobs and can wait.
// Below 900px the rail becomes a strip of chips above whichever list is showing.
import type { Chat, ChatWorld, FolderId } from "../port.ts";
import { Icon } from "./icons.tsx";
import { Badge } from "./parts.tsx";

/** What the rail opens: a folder of chats, or one of the two pages that replace the list. */
export type ViewId = FolderId | "plugins" | "settings";

interface RailItem<Id extends ViewId> {
  readonly id: Id;
  readonly label: string;
  readonly icon: keyof typeof Icon;
  readonly title?: string;
}

export const STATE_FOLDERS: readonly RailItem<FolderId>[] = [
  { id: "all", label: "全部", icon: "all" },
  { id: "mine", label: "等我的", icon: "clock" },
  { id: "running", label: "在做", icon: "running" },
];
export const KIND_FOLDERS: readonly RailItem<FolderId>[] = [
  { id: "ai", label: "AI", icon: "ai" },
  { id: "project", label: "项目", icon: "project" },
];
const TOOLS: readonly RailItem<"plugins" | "settings">[] = [
  { id: "plugins", label: "插件", icon: "plugins", title: "插件" },
  { id: "settings", label: "设置", icon: "settings", title: "设置 ⌘," },
];
export const FOLDERS = [...STATE_FOLDERS, ...KIND_FOLDERS];

export function viewLabel(view: ViewId): string {
  return [...FOLDERS, ...TOOLS].find((item) => item.id === view)?.label ?? "";
}

export function isFolder(view: ViewId): view is FolderId {
  return view !== "plugins" && view !== "settings";
}

/** A chat is running when one of its jobs is, or when it is an AI that is working. */
function running(world: Pick<ChatWorld, "jobs">, chat: Chat): boolean {
  return chat.presence === "working" || world.jobs.some((job) => job.chatId === chat.id);
}

export function inFolder(world: Pick<ChatWorld, "jobs">, chat: Chat, folder: FolderId): boolean {
  if (chat.archived) return false;
  switch (folder) {
    case "all":
      return true;
    case "mine":
      return chat.decisions > 0;
    case "running":
      return running(world, chat);
    case "ai":
      return chat.kind === "ai" || chat.kind === "moyyi";
    case "project":
      return chat.kind === "project";
  }
}

export function folderBadge(
  world: Pick<ChatWorld, "jobs" | "chats">,
  folder: FolderId,
): { kind: "decide" | "unread" | "quiet"; count: number } | null {
  if (folder === "running") {
    const count = world.jobs.filter((job) => !job.stopping).length;
    return count ? { kind: "quiet", count } : null;
  }
  const inside = world.chats.filter((chat) => inFolder(world, chat, folder));
  const decisions = inside.reduce((sum, chat) => sum + chat.decisions, 0);
  if (decisions) return { kind: "decide", count: decisions };
  const unread = inside.filter((chat) => chat.unread > 0 && !chat.muted).length;
  return unread ? { kind: "unread", count: unread } : null;
}

export function Rail({
  world,
  view,
  onView,
}: {
  readonly world: ChatWorld;
  readonly view: ViewId;
  readonly onView: (view: ViewId) => void;
}) {
  const item = ({ id, label, icon, title }: RailItem<ViewId>, bottom = false) => {
    const ItemIcon = Icon[icon];
    const badge = isFolder(id) ? folderBadge(world, id) : null;
    return (
      <button
        key={id}
        type="button"
        className={`mc-rail-item${bottom ? " ch-rail-bottom" : ""}`}
        title={title}
        aria-current={view === id ? "true" : undefined}
        onClick={() => onView(id)}
      >
        <ItemIcon size={20} />
        <span>{label}</span>
        {badge ? <Badge kind={badge.kind} count={badge.count} /> : null}
      </button>
    );
  };
  return (
    <nav className="mc-rail ch-rail" aria-label="文件夹">
      <span className="ch-wordmark">moyyi</span>
      {STATE_FOLDERS.map((folder) => item(folder))}
      <span className="ch-rail-rule" aria-hidden="true" />
      {KIND_FOLDERS.map((folder) => item(folder))}
      {TOOLS.map((tool, index) => item(tool, index === 0))}
    </nav>
  );
}

/** Below 900px: the same items as chips; 插件 and 设置 end the strip. */
export function FolderStrip({
  world,
  view,
  onView,
}: {
  readonly world: ChatWorld;
  readonly view: ViewId;
  readonly onView: (view: ViewId) => void;
}) {
  return (
    <nav className="ch-strip" aria-label="文件夹">
      {[...FOLDERS, ...TOOLS].map((item) => {
        const badge = isFolder(item.id) ? folderBadge(world, item.id) : null;
        return (
          <button
            key={item.id}
            type="button"
            className="mc-key ch-strip-key"
            aria-current={view === item.id ? "true" : undefined}
            onClick={() => onView(item.id)}
          >
            {item.label}
            {badge ? <Badge kind={badge.kind} count={badge.count} /> : null}
          </button>
        );
      })}
    </nav>
  );
}
