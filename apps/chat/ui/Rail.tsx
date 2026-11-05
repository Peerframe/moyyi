// Rail (boards S1, S7, S8, S12, S33, S34): only places, never states. 全部 lists every chat by
// time, 项目 lists the working folders and 自动化 the jobs that start on their own; 插件 and 设置
// sit at the bottom. 更多 is a slot under 自动化 for places used less often; it stays hidden
// until something is put in it. What waits on you or is running shows as a badge, the row's prefix and the
// avatar's dot. The rail is frosted glass over the window material; in the desktop app the system
// draws the traffic lights in its top strip, which also drags the window.
// Below 900px the rail becomes a strip of chips above whichever list is showing.
import { useEffect, useRef, useState } from "react";
import type { Chat, ChatWorld, FolderId } from "../port.ts";
import { Icon } from "./icons.tsx";
import { Badge } from "./parts.tsx";

/** What the rail opens: chats, or one of the pages that replace the list. */
export type ViewId = FolderId | "automations" | "plugins" | "settings";
export type PageView = Exclude<ViewId, FolderId>;

export interface RailItem<Id extends ViewId = ViewId> {
  readonly id: Id;
  readonly label: string;
  readonly icon: keyof typeof Icon;
  readonly title?: string;
}

export const FOLDERS: readonly RailItem<FolderId>[] = [
  { id: "all", label: "全部", icon: "all" },
  { id: "project", label: "项目", icon: "project" },
];
const AUTOMATIONS: RailItem<"automations"> = {
  id: "automations",
  label: "自动化",
  icon: "automation",
};
/** At the bottom of the rail. */
const TOOLS: readonly RailItem<"plugins" | "settings">[] = [
  { id: "plugins", label: "插件", icon: "plugins" },
  { id: "settings", label: "设置", icon: "settings", title: "⌘," },
];
/**
 * What 更多 opens. Empty for now: the owner has not decided what goes here (2026-11-05), and a
 * button that opens nothing is not shown.
 */
export const MORE: readonly RailItem[] = [];
const ITEMS: readonly RailItem[] = [...FOLDERS, AUTOMATIONS, ...MORE, ...TOOLS];

export function viewLabel(view: ViewId): string {
  return ITEMS.find((item) => item.id === view)?.label ?? "";
}

export function isFolder(view: ViewId): view is FolderId {
  return FOLDERS.some((folder) => folder.id === view);
}

/** 全部 holds every chat; 项目 holds the chats that work in a folder. */
export function inFolder(chat: Chat, folder: FolderId): boolean {
  if (chat.archived) return false;
  return folder === "all" || chat.project !== undefined;
}

/** Open decisions if any (attention), otherwise chats with unread messages. */
export function chatsBadge(
  chats: readonly Chat[],
): { kind: "decide" | "unread"; count: number } | null {
  const decisions = chats.reduce((sum, chat) => sum + chat.decisions, 0);
  if (decisions) return { kind: "decide", count: decisions };
  const unread = chats.filter((chat) => chat.unread > 0 && !chat.muted).length;
  return unread ? { kind: "unread", count: unread } : null;
}

export function folderBadge(world: Pick<ChatWorld, "chats">, folder: FolderId) {
  return chatsBadge(world.chats.filter((chat) => inFolder(chat, folder)));
}

interface RailProps {
  readonly world: ChatWorld;
  readonly view: ViewId;
  readonly onView: (view: ViewId) => void;
  /** The host draws window controls in the rail's top strip (macOS traffic lights). */
  readonly windowControls?: boolean | undefined;
  /** What 更多 opens; 更多 is hidden while this is empty. */
  readonly more?: readonly RailItem[];
}

export function Rail({ world, view, onView, windowControls, more = MORE }: RailProps) {
  /** The 更多 button while its menu is open. */
  const [open, setOpen] = useState<HTMLButtonElement | null>(null);
  const item = ({ id, label, icon, title }: RailItem) => {
    const ItemIcon = Icon[icon];
    const badge = isFolder(id) ? folderBadge(world, id) : null;
    return (
      <button
        key={id}
        type="button"
        className="mc-rail-item"
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
    <>
      <nav className="mc-rail ch-rail" aria-label="导航">
        {windowControls ? (
          <span className="ch-rail-lights" aria-hidden="true" />
        ) : (
          <span className="ch-wordmark">moyyi</span>
        )}
        {FOLDERS.map((folder) => item(folder))}
        {item(AUTOMATIONS)}
        {more.length ? (
          <button
            type="button"
            className="mc-rail-item"
            aria-haspopup="menu"
            aria-expanded={open !== null}
            aria-current={more.some((entry) => entry.id === view) ? "true" : undefined}
            onClick={(event) => setOpen((now) => (now ? null : event.currentTarget))}
          >
            <Icon.more size={20} />
            <span>更多</span>
          </button>
        ) : null}
        <div className="ch-rail-bottom">{TOOLS.map((tool) => item(tool))}</div>
      </nav>
      {open ? (
        <MoreMenu
          anchor={open}
          items={more}
          onPick={(id) => {
            setOpen(null);
            onView(id);
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

/**
 * 更多's menu, beside the rail. Esc or a click outside closes it and hands focus back to 更多.
 * The rail's glass blur makes it the containing block of anything fixed inside it, and its scroll
 * would clip the menu, so the menu is the rail's sibling, fixed beside the button.
 */
function MoreMenu({
  anchor,
  items,
  onPick,
  onClose,
}: {
  readonly anchor: HTMLButtonElement;
  readonly items: readonly RailItem[];
  readonly onPick: (id: ViewId) => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchor.focus();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [anchor, onClose]);
  const box = anchor.getBoundingClientRect();
  return (
    <div
      ref={ref}
      className="mc-attach ch-more-menu"
      role="menu"
      aria-label="更多"
      style={{ left: box.right + 8, top: box.top }}
    >
      {items.map(({ id, label, icon, title }) => {
        const ItemIcon = Icon[icon];
        return (
          <button
            key={id}
            type="button"
            className="mc-attach-item"
            role="menuitem"
            onClick={() => onPick(id)}
          >
            <ItemIcon size={18} />
            <span className="mc-attach-text ch-grow">{label}</span>
            {title ? <span className="ch-more-key">{title}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Below 900px: the same places as chips (更多's among them), with 插件 and 设置 at the end. */
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
    <nav className="ch-strip" aria-label="导航">
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
