// Folder rail (boards S1, S7, S8, S12, S33): who you talk to (全部, AI, 项目), then 成果, what the
// AIs handed over; 插件 and 设置 sit at the bottom. What waits on you or is running is a state of a
// chat, so it shows as the folder's badge, the row's prefix and the avatar's dot, never as a folder.
// The rail is frosted glass over the window material; in the desktop app the system draws the
// traffic lights in its top strip, which also drags the window.
// Below 900px the rail becomes a strip of chips above whichever list is showing.
import type { Chat, ChatWorld, FolderId } from "../port.ts";
import { Icon } from "./icons.tsx";
import { Badge } from "./parts.tsx";

/** What the rail opens: a folder of chats, or one of the pages that replace the list. */
export type ViewId = FolderId | "results" | "plugins" | "settings";
export type PageView = Exclude<ViewId, FolderId>;

interface RailItem<Id extends ViewId> {
  readonly id: Id;
  readonly label: string;
  readonly icon: keyof typeof Icon;
  readonly title?: string;
}

export const FOLDERS: readonly RailItem<FolderId>[] = [
  { id: "all", label: "全部", icon: "all" },
  { id: "ai", label: "AI", icon: "ai" },
  { id: "project", label: "项目", icon: "project" },
];
const RESULTS: RailItem<"results"> = { id: "results", label: "成果", icon: "results" };
const TOOLS: readonly RailItem<"plugins" | "settings">[] = [
  { id: "plugins", label: "插件", icon: "plugins", title: "插件" },
  { id: "settings", label: "设置", icon: "settings", title: "设置 ⌘," },
];
const ITEMS: readonly RailItem<ViewId>[] = [...FOLDERS, RESULTS, ...TOOLS];

export function viewLabel(view: ViewId): string {
  return ITEMS.find((item) => item.id === view)?.label ?? "";
}

export function isFolder(view: ViewId): view is FolderId {
  return FOLDERS.some((folder) => folder.id === view);
}

export function inFolder(chat: Chat, folder: FolderId): boolean {
  if (chat.archived) return false;
  switch (folder) {
    case "all":
      return true;
    case "ai":
      return chat.kind === "ai" || chat.kind === "moyyi";
    case "project":
      return chat.kind === "project";
  }
}

/** Open decisions in the folder if any (attention), otherwise chats with unread messages. */
export function folderBadge(
  world: Pick<ChatWorld, "chats">,
  folder: FolderId,
): { kind: "decide" | "unread"; count: number } | null {
  const inside = world.chats.filter((chat) => inFolder(chat, folder));
  const decisions = inside.reduce((sum, chat) => sum + chat.decisions, 0);
  if (decisions) return { kind: "decide", count: decisions };
  const unread = inside.filter((chat) => chat.unread > 0 && !chat.muted).length;
  return unread ? { kind: "unread", count: unread } : null;
}

interface RailProps {
  readonly world: ChatWorld;
  readonly view: ViewId;
  readonly onView: (view: ViewId) => void;
  /** The host draws window controls in the rail's top strip (macOS traffic lights). */
  readonly windowControls?: boolean | undefined;
}

export function Rail({ world, view, onView, windowControls }: RailProps) {
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
      {windowControls ? (
        <span className="ch-rail-lights" aria-hidden="true" />
      ) : (
        <span className="ch-wordmark">moyyi</span>
      )}
      {FOLDERS.map((folder) => item(folder))}
      <span className="ch-rail-rule" aria-hidden="true" />
      {item(RESULTS)}
      {TOOLS.map((tool, index) => item(tool, index === 0))}
    </nav>
  );
}

/** Below 900px: the same items as chips; 成果, 插件 and 设置 end the strip. */
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
      {ITEMS.map((item) => {
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
