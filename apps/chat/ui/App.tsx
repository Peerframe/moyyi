// The window (boards S1, S7, S8, S12, S23–S32): folder rail, then either the chat list with the open
// chat and its side panel, or 设置 / 插件 with the open section. Below 1200px the panel floats over
// the chat, below 900px the rail becomes chips above the list, below 700px one pane shows at a time
// and the panel opens as a bottom sheet.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatPort, FolderId, Theme } from "../port.ts";
import { ChatList } from "./ChatList.tsx";
import { Conversation } from "./Conversation.tsx";
import type { PageActions } from "./Pages.tsx";
import { PageList, PagePane } from "./Pages.tsx";
import type { PanelActions, PanelFrame } from "./Panel.tsx";
import { SidePanel } from "./Panel.tsx";
import { inFolder, isFolder, Rail, type ViewId } from "./Rail.tsx";

export interface AppProps {
  readonly port: ChatPort;
  readonly theme: Theme;
  readonly sticker: string;
  readonly initialChat?: string | undefined;
  /** Opens 设置 or 插件 instead of the chats, e.g. "settings/permissions". */
  readonly initialPage?: string | undefined;
}

function parsePage(value: string | undefined): { view: ViewId; page: string | null } | null {
  const [view, page = null] = value?.split("/") ?? [];
  return view === "settings" || view === "plugins" ? { view, page } : null;
}

function useNarrow(): boolean {
  const query = "(max-width: 699px)";
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const media = matchMedia(query);
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

export function App({ port, theme, sticker, initialChat, initialPage }: AppProps) {
  const world = useSyncExternalStore(port.subscribe, port.world, port.world);
  const narrow = useNarrow();
  const start = parsePage(initialPage);
  const [view, setView] = useState<ViewId>(start?.view ?? "all");
  /** The open section of each page list; null shows only the list on narrow layouts. */
  const [pageOf, setPageOf] = useState<Readonly<Record<"settings" | "plugins", string | null>>>({
    settings: start?.view === "settings" ? (start.page ?? null) : null,
    plugins: start?.view === "plugins" ? (start.page ?? null) : null,
  });
  /** The last folder of chats, so 设置 and back keeps the list where it was. */
  const [folder, setFolder] = useState<FolderId>("all");
  const [openId, setOpenId] = useState<string | null>(
    initialChat ?? (world.firstRun ? "moyyi" : null),
  );
  const [stack, setStack] = useState<readonly PanelFrame[]>([]);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const chat = world.chats.find((c) => c.id === openId);

  const open = (chatId: string) => {
    setOpenId(chatId);
    setStack([]);
    setSearchOpen(false);
    void port.act({ type: "open", chatId });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: marks the first chat read once
  useEffect(() => {
    if (openId) void port.act({ type: "open", chatId: openId });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === ",") {
        event.preventDefault();
        setView("settings");
      } else if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView(folder);
        if (narrow) setOpenId(null);
        requestAnimationFrame(() => document.getElementById("chat-search")?.focus());
      } else if (mod && event.key.toLowerCase() === "f" && chat) {
        event.preventDefault();
        setSearchOpen(true);
      } else if (
        isFolder(view) &&
        event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        const list = world.chats.filter((c) => inFolder(world, c, folder));
        const at = list.findIndex((c) => c.id === openId);
        const next =
          list[at < 0 ? 0 : (at + (event.key === "ArrowDown" ? 1 : list.length - 1)) % list.length];
        if (next) open(next.id);
      } else if (event.key === "Escape" && !event.defaultPrevented) {
        if (searchOpen) setSearchOpen(false);
        else if (stack.length) setStack((value) => value.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const panelActions: PanelActions = {
    push: (frame) => setStack((value) => [...value, frame]),
    back: () => setStack((value) => value.slice(0, -1)),
    close: () => setStack([]),
    check: (claimId, verdict) => void port.act({ type: "check", claimId, verdict }),
    answerThread: (messageId, key) => void port.act({ type: "answer-thread", messageId, key }),
    stop: (jobId) => void port.act({ type: "stop", jobId }),
    undo: (changeIds) => void port.act({ type: "undo", changeIds }),
  };

  const pageActions: PageActions = {
    choose: (choiceId, option) => void port.act({ type: "choose", choiceId, option }),
    press: (controlId) => void port.act({ type: "control", controlId }),
    saveKey: (providerId, key) => void port.act({ type: "save-key", providerId, key }),
  };

  const onView = (next: ViewId) => {
    setView(next);
    if (isFolder(next)) setFolder(next);
  };

  const layout = narrow ? "narrow" : "wide";

  if (!isFolder(view)) {
    const pages = view === "settings" ? world.settings : world.plugins;
    const chosen = pageOf[view];
    // Wide layouts always show a section; the first one until another is picked.
    const page = pages.find((p) => p.id === chosen) ?? (narrow ? undefined : pages[0]);
    const openPage = (pageId: string) => setPageOf((value) => ({ ...value, [view]: pageId }));
    return (
      <div className={`mc mc-${theme} mc-window ch-app`} data-layout={layout}>
        {narrow ? null : <Rail world={world} view={view} onView={onView} />}
        {!narrow || !page ? (
          <PageList
            world={world}
            kind={view}
            pages={pages}
            current={page?.id ?? null}
            onOpen={openPage}
            onView={onView}
          />
        ) : null}
        {page ? (
          <PagePane
            world={world}
            page={page}
            actions={pageActions}
            onBack={narrow ? () => setPageOf((value) => ({ ...value, [view]: null })) : undefined}
          />
        ) : null}
      </div>
    );
  }

  const showList = !narrow || !chat;
  const showChat = !narrow || Boolean(chat);

  return (
    <div className={`mc mc-${theme} mc-window ch-app`} data-layout={layout}>
      {narrow ? null : <Rail world={world} view={view} onView={onView} />}
      {showList ? (
        <ChatList
          world={world}
          folder={view}
          openId={openId}
          drafts={drafts}
          onView={onView}
          onOpen={open}
          onCompose={() => {
            open("moyyi");
            requestAnimationFrame(() => document.getElementById("compose-moyyi")?.focus());
          }}
        />
      ) : null}
      {showChat ? (
        chat ? (
          <Conversation
            world={world}
            chat={chat}
            draft={drafts[chat.id] ?? ""}
            sticker={sticker}
            infoOpen={stack[0]?.kind === "info"}
            narrow={narrow}
            searchOpen={searchOpen}
            onSearch={setSearchOpen}
            onDraft={(text) => setDrafts((value) => ({ ...value, [chat.id]: text }))}
            onInfo={() =>
              setStack((value) => (value[0]?.kind === "info" ? [] : [{ kind: "info" }]))
            }
            onPanel={(frame) => setStack([frame])}
            onBack={() => setOpenId(null)}
            onOpenChat={open}
            act={(action) => void port.act(action)}
          />
        ) : (
          <EmptyChat sticker={sticker} />
        )
      ) : null}
      {chat && stack.length ? (
        narrow ? (
          <div className="ch-sheet-wrap">
            <button
              type="button"
              className="ch-backdrop"
              aria-label="关闭面板"
              tabIndex={-1}
              onClick={panelActions.close}
            />
            <div className="ch-sheet">
              <span className="ch-grabber" aria-hidden="true" />
              <SidePanel world={world} chat={chat} stack={stack} actions={panelActions} />
            </div>
          </div>
        ) : (
          <SidePanel world={world} chat={chat} stack={stack} actions={panelActions} />
        )
      ) : null}
    </div>
  );
}

function EmptyChat({ sticker }: { readonly sticker: string }) {
  return (
    <section className="mc-wallpaper ch-conversation ch-empty" aria-label="没选对话">
      <img src={sticker} alt="" className="ch-empty-sticker" />
      <span className="ch-empty-title">选一个对话开始</span>
      <span className="ch-sub">或者直接跟 moyyi 说想做什么</span>
    </section>
  );
}
