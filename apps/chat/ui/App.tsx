// The window (boards S1, S7, S8, S12): folder rail, chat list, the open chat and the side panel.
// Below 1200px the panel floats over the chat, below 900px the rail becomes chips above the list,
// below 700px one pane shows at a time and the panel opens as a bottom sheet.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatPort, FolderId, Theme } from "../port.ts";
import { ChatList, inFolder, Rail } from "./ChatList.tsx";
import { Conversation } from "./Conversation.tsx";
import type { PanelActions, PanelFrame } from "./Panel.tsx";
import { SidePanel } from "./Panel.tsx";

export interface AppProps {
  readonly port: ChatPort;
  readonly theme: Theme;
  readonly sticker: string;
  readonly initialChat?: string | undefined;
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

export function App({ port, theme, sticker, initialChat }: AppProps) {
  const world = useSyncExternalStore(port.subscribe, port.world, port.world);
  const narrow = useNarrow();
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
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (narrow) setOpenId(null);
        requestAnimationFrame(() => document.getElementById("chat-search")?.focus());
      } else if (mod && event.key.toLowerCase() === "f" && chat) {
        event.preventDefault();
        setSearchOpen(true);
      } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const list = world.chats.filter((c) => inFolder(c, folder));
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

  const showList = !narrow || !chat;
  const showChat = !narrow || Boolean(chat);
  const layout = narrow ? "narrow" : "wide";

  return (
    <div className={`mc mc-${theme} mc-window ch-app`} data-layout={layout}>
      {narrow ? null : <Rail world={world} folder={folder} onFolder={setFolder} />}
      {showList ? (
        <ChatList
          world={world}
          folder={folder}
          openId={openId}
          drafts={drafts}
          onFolder={setFolder}
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
