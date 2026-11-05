// The window (boards S1, S7, S8, S12, S23–S34): rail, then either the chat list (全部, or 项目 and
// one project's chats) with the open chat and its side panel, or 自动化 / 插件 / 设置 with the open
// entry. Below 1200px the panel floats over
// the chat, below 900px the rail becomes chips above the list, below 700px one pane shows at a time
// and the panel opens as a bottom sheet.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChatAction, ChatPort, FolderId, Theme } from "../port.ts";
import { ChatList, chatsOf } from "./ChatList.tsx";
import { Conversation } from "./Conversation.tsx";
import { actionError, type ChatIntegration, supports } from "./integration.ts";

export type { ChatIntegration } from "./integration.ts";

import type { PageActions } from "./Pages.tsx";
import { PageList, PagePane } from "./Pages.tsx";
import type { PanelActions, PanelFrame } from "./Panel.tsx";
import { SidePanel } from "./Panel.tsx";
import { inFolder, isFolder, type PageView, Rail, type ViewId } from "./Rail.tsx";

export interface AppProps {
  readonly port: ChatPort;
  readonly theme: Theme;
  readonly initialChat?: string | undefined;
  readonly integration?: ChatIntegration | undefined;
  /** Opens a page or a project instead of 全部, e.g. "settings/permissions" or "project/p-lunwen". */
  readonly initialPage?: string | undefined;
  /** The host draws window controls at the top of the rail (macOS traffic lights). */
  readonly windowControls?: boolean | undefined;
}

function parsePage(value: string | undefined): { view: ViewId; page: string | null } | null {
  const [view, page = null] = value?.split("/") ?? [];
  return view === "project" || view === "automations" || view === "settings" || view === "plugins"
    ? { view, page }
    : null;
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

export function App({
  port,
  theme,
  initialChat,
  initialPage,
  integration,
  windowControls,
}: AppProps) {
  const world = useSyncExternalStore(port.subscribe, port.world, port.world);
  const narrow = useNarrow();
  const start = parsePage(initialPage);
  const [view, setView] = useState<ViewId>(start?.view ?? "all");
  /** The open section of each page list; null shows only the list on narrow layouts. */
  const startOf = (of: ViewId) => (start?.view === of ? (start.page ?? null) : null);
  const [pageOf, setPageOf] = useState<Readonly<Record<PageView, string | null>>>({
    automations: startOf("automations"),
    settings: startOf("settings"),
    plugins: startOf("plugins"),
  });
  /** The last folder of chats, so 设置 and back keeps the list where it was. */
  const [folder, setFolder] = useState<FolderId>(start?.view === "project" ? "project" : "all");
  /** The open project under 项目. */
  const [projectId, setProjectId] = useState<string | null>(startOf("project"));
  const project = world.projects.find((p) => p.id === projectId) ?? null;
  const [openId, setOpenId] = useState<string | null>(
    integration ? integration.activeChatId : (initialChat ?? (world.firstRun ? "moyyi" : null)),
  );
  const [stack, setStack] = useState<readonly PanelFrame[]>([]);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chat = world.chats.find((c) => c.id === openId);
  const nativeActive = integration?.activeChatId;
  useEffect(() => {
    if (nativeActive === undefined) return;
    setOpenId(nativeActive);
    setStack([]);
    setSearchOpen(false);
  }, [nativeActive]);

  async function perform(action: ChatAction): Promise<void> {
    setError(null);
    try {
      if (!supports(integration, action.type)) throw new Error("当前版本尚不支持这个操作。");
      await port.act(action);
    } catch (cause) {
      setError(actionError(cause));
      throw cause;
    }
  }
  const dispatch = (action: ChatAction) => void perform(action).catch(() => undefined);
  const feedback = error ?? (integration ? world.connection.note : undefined);

  const open = (chatId: string) => {
    if (!integration || integration.activeChatId === chatId) setOpenId(chatId);
    setStack([]);
    setSearchOpen(false);
    if (integration?.activeChatId === chatId) return;
    dispatch({ type: "open", chatId });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: marks the first chat read once
  useEffect(() => {
    if (openId && !integration) dispatch({ type: "open", chatId: openId });
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
        const list = project
          ? chatsOf(world, project.id)
          : world.chats.filter((c) => inFolder(c, folder));
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
    check: (claimId, verdict) => dispatch({ type: "check", claimId, verdict }),
    answerThread: (messageId, key) => dispatch({ type: "answer-thread", messageId, key }),
    stop: (jobId) => dispatch({ type: "stop", jobId }),
    undo: (changeIds) => dispatch({ type: "undo", changeIds }),
  };

  const pageActions: PageActions = {
    choose: (choiceId, option) => dispatch({ type: "choose", choiceId, option }),
    press: (controlId) => dispatch({ type: "control", controlId }),
    saveKey: (providerId, key) => dispatch({ type: "save-key", providerId, key }),
    saveText: (fieldId, text) => dispatch({ type: "save-text", fieldId, text }),
  };

  const onView = (next: ViewId) => {
    setView(next);
    if (isFolder(next)) setFolder(next);
    // 项目 again goes back to the projects, like a second tap on a tab.
    if (next === "project" && view === "project") setProjectId(null);
    integration?.onView?.(next);
  };

  const layout = narrow ? "narrow" : "wide";
  const rail = narrow ? null : (
    <Rail world={world} view={view} onView={onView} windowControls={windowControls} />
  );

  if (!isFolder(view)) {
    const pages =
      view === "settings" ? world.settings : view === "plugins" ? world.plugins : world.automations;
    const chosen = pageOf[view];
    // Wide layouts always show a section; the first one until another is picked.
    const page = pages.find((p) => p.id === chosen) ?? (narrow ? undefined : pages[0]);
    const openPage = (pageId: string) => setPageOf((value) => ({ ...value, [view]: pageId }));
    return (
      <div className={`mc mc-${theme} mc-window ch-app`} data-layout={layout}>
        {rail}
        {!narrow || !page ? (
          <PageList
            world={world}
            kind={view}
            pages={pages}
            current={page?.id ?? null}
            onOpen={openPage}
            onView={onView}
            native={Boolean(integration)}
          />
        ) : null}
        {page ? (
          <PagePane
            world={world}
            kind={view}
            page={page}
            actions={pageActions}
            feedback={feedback}
            onBack={narrow ? () => setPageOf((value) => ({ ...value, [view]: null })) : undefined}
          />
        ) : narrow || view !== "automations" ? null : (
          <section className="mc-panel ch-pane ch-empty" aria-label="没有自动化">
            <span className="ch-empty-title">
              {integration ? "本机版本还不能定时运行" : "还没有自动化"}
            </span>
            <span className="ch-sub">
              {integration
                ? "到点自动开工要等后台运行做好；现在每件事都由你在会话里交代。"
                : "在任意对话里说 /定时，或者让 moyyi “每天早上做一件事”"}
            </span>
          </section>
        )}
      </div>
    );
  }

  const showList = !narrow || !chat;
  const showChat = !narrow || Boolean(chat);

  return (
    <div className={`mc mc-${theme} mc-window ch-app`} data-layout={layout}>
      {rail}
      {showList ? (
        <ChatList
          world={world}
          folder={view}
          project={view === "project" ? project : null}
          onProject={setProjectId}
          openId={openId}
          drafts={drafts}
          onView={onView}
          onOpen={open}
          native={Boolean(integration)}
          showArchive={supports(integration, "archive")}
          onCompose={() => {
            if (integration) {
              integration.onNew();
              return;
            }
            open("moyyi");
            requestAnimationFrame(() => document.getElementById("compose-moyyi")?.focus());
          }}
        />
      ) : null}
      {showChat ? (
        chat ? (
          <Conversation
            key={integration ? chat.id : undefined}
            world={world}
            chat={chat}
            draft={drafts[chat.id] ?? ""}
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
            act={perform}
            integration={integration}
            feedback={feedback}
          />
        ) : (
          <section className="mc-wallpaper ch-conversation ch-empty" aria-label="没选对话">
            {feedback ? (
              <p className="ch-integration-error" role="alert">
                {feedback}
              </p>
            ) : null}
            {integration?.empty ?? <EmptyChat />}
          </section>
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

function EmptyChat() {
  return (
    <>
      <span className="ch-empty-title">选一个对话开始</span>
      <span className="ch-sub">或者直接跟 moyyi 说想做什么</span>
    </>
  );
}
