// What the mock backend does when a settings or plugin control is used. Pure functions over the
// world, so the port only commits their result and tests can call them directly.
import type {
  ChatWorld,
  Control,
  Message,
  PageBlock,
  PageLine,
  PluginPage,
  Provider,
  SettingsPage,
} from "../port.ts";

type Page = SettingsPage | PluginPage;

function mapBlocks(page: Page, change: (block: PageBlock) => PageBlock | null): Page {
  return {
    ...page,
    groups: page.groups.map((group) => ({
      ...group,
      blocks: group.blocks.flatMap((block) => {
        const next = change(block);
        return next ? [next] : [];
      }),
    })),
  };
}

function mapPages(world: ChatWorld, change: (page: Page) => Page): ChatWorld {
  return {
    ...world,
    settings: world.settings.map((page) => change(page) as SettingsPage),
    plugins: world.plugins.map((page) => change(page) as PluginPage),
  };
}

const mapLines = (page: Page, change: (line: PageLine) => PageLine | null): Page =>
  mapBlocks(page, (block) => {
    if (block.kind !== "lines") return block;
    const lines = block.lines.flatMap((line) => {
      const next = change(line);
      return next ? [next] : [];
    });
    return lines.length ? { ...block, lines } : null;
  });

const mapProviders = (page: Page, change: (provider: Provider) => Provider): Page =>
  mapBlocks(page, (block) =>
    block.kind === "providers" ? { ...block, providers: block.providers.map(change) } : block,
  );

/** The option chosen for a choice anywhere on the pages, or undefined if there is none. */
export function chosen(world: ChatWorld, choiceId: string): string | undefined {
  for (const page of [...world.settings, ...world.plugins])
    for (const group of page.groups)
      for (const block of group.blocks) {
        const choices =
          block.kind === "choice" ? [block.choice] : block.kind === "choices" ? block.choices : [];
        const found = choices.find((choice) => choice.id === choiceId);
        if (found) return found.options[found.selected];
      }
  return undefined;
}

const linesOf = (page: Page | undefined): readonly PageLine[] =>
  page?.groups.flatMap((group) =>
    group.blocks.flatMap((block) => (block.kind === "lines" ? block.lines : [])),
  ) ?? [];

/** Keeps each list row's second line true to the page it opens. */
function summarize(world: ChatWorld): ChatWorld {
  const page = (id: string) => world.settings.find((p) => p.id === id);
  const summary: Record<string, string | undefined> = {
    models: (() => {
      const connected = page("models")
        ?.groups.flatMap((g) => g.blocks)
        .flatMap((b) => (b.kind === "providers" ? b.providers : []))
        .filter((p) => p.connected)
        .map((p) => p.name);
      const model = chosen(world, "models.default");
      const who = connected?.length ? `${connected.join("、")} 已连上` : "还没连上模型";
      return model === "每次问我"
        ? `${who} · 新对话每次问你`
        : `${who} · 新对话用 ${model?.replace("DeepSeek ", "")}`;
    })(),
    background: (() => {
      const timers = linesOf(page("background")).filter((l) => l.id.startsWith("timer.") && !l.off);
      return `同时做 ${chosen(world, "jobs.parallel")} · ${timers.length} 件定时`;
    })(),
    budget:
      chosen(world, "budget.default") === "每次问我"
        ? "新项目每次问你给多少"
        : `新项目默认每周 ${chosen(world, "budget.default")}`,
    general: `${chosen(world, "general.theme")} · 字号 ${chosen(world, "general.size")} · ${chosen(world, "notify.messages")}`,
  };
  const skills = linesOf(world.plugins.find((p) => p.id === "skills")).filter(
    (l) => l.id.startsWith("skill.") && !l.off,
  ).length;
  return {
    ...world,
    settings: world.settings.map((p) => {
      const next = summary[p.id];
      return next ? { ...p, summary: next } : p;
    }),
    plugins: world.plugins.map((p) =>
      p.id === "skills" && p.enabled
        ? { ...p, summary: `照你写好的做法做事 · 开着 ${skills} 个` }
        : p,
    ),
  };
}

export function choose(world: ChatWorld, choiceId: string, option: number): ChatWorld {
  return summarize(
    mapPages(world, (page) =>
      mapBlocks(page, (block) => {
        const pick = <T extends { id: string; options: readonly string[]; selected: number }>(
          choice: T,
        ): T =>
          choice.id === choiceId && option >= 0 && option < choice.options.length
            ? { ...choice, selected: option }
            : choice;
        if (block.kind === "choice") return { ...block, choice: pick(block.choice) };
        if (block.kind === "choices") return { ...block, choices: block.choices.map(pick) };
        return block;
      }),
    ),
  );
}

const relabel = (controls: readonly Control[] | undefined, id: string, label: string) =>
  controls?.map((control) => (control.id === id ? { ...control, label } : control));

const CONNECTED = "已连上 · 密钥在系统钥匙串里";
function connectedControls(id: string): readonly Control[] {
  return [
    { id: `${id}.test`, label: "测一下" },
    { id: `${id}.rekey`, label: "换密钥" },
    { id: `${id}.disconnect`, label: "断开", tone: "danger" },
  ];
}

/** Folder grants: revoking one also leaves a line in the chat it was given in. */
const FOLDERS: Record<string, { readonly chatId: string; readonly path: string }> = {
  "folder.lunwen": { chatId: "lunwen", path: "~/论文" },
  "folder.zufang": { chatId: "zufang", path: "~/租房" },
};

export function press(
  world: ChatWorld,
  controlId: string,
  ids: { next: (prefix: string) => string },
): ChatWorld {
  const [scope = "", item = "", verb = ""] = controlId.split(".");
  const lineId = `${scope}.${item}`;

  if (scope === "folder" && verb === "revoke") {
    const grant = FOLDERS[lineId];
    let next = mapPages(world, (page) =>
      mapLines(page, (line) => (line.id === lineId ? null : line)),
    );
    if (grant) {
      const notice: Message = {
        id: ids.next("s"),
        kind: "service",
        text: `你在设置里收回了 ${grant.path}：这个群的 AI 不能再看它`,
      };
      next = {
        ...next,
        messages: {
          ...next.messages,
          [grant.chatId]: [...(next.messages[grant.chatId] ?? []), notice],
        },
      };
    }
    const left = linesOf(next.settings.find((p) => p.id === "permissions")).filter((l) =>
      l.id.startsWith("folder."),
    ).length;
    return {
      ...next,
      settings: next.settings.map((p) =>
        p.id === "permissions"
          ? {
              ...p,
              summary: left ? `给过 ${left} 个文件夹 · 改动先问你` : "没给过文件夹 · 改动先问你",
            }
          : p,
      ),
    };
  }

  if (scope === "memory" && verb === "delete")
    return mapPages(world, (page) => mapLines(page, (line) => (line.id === lineId ? null : line)));

  if (scope === "timer" && verb === "pause")
    return summarize(
      mapPages(world, (page) =>
        mapLines(page, (line) => {
          if (line.id !== lineId) return line;
          const paused = !line.off;
          const sub = (line.sub ?? "").replace(/^已暂停 · /, "");
          return {
            ...line,
            off: paused,
            sub: paused ? `已暂停 · ${sub}` : sub,
            controls: relabel(line.controls, controlId, paused ? "继续" : "暂停") ?? [],
          };
        }),
      ),
    );

  if (scope === "skill" && verb === "toggle")
    return summarize(
      mapPages(world, (page) =>
        mapLines(page, (line) => {
          if (line.id !== lineId) return line;
          const on = Boolean(line.off);
          return {
            ...line,
            off: !on,
            tag: on ? "开着" : "关着",
            controls: relabel(line.controls, controlId, on ? "关掉" : "打开") ?? [],
          };
        }),
      ),
    );

  const plugin = world.plugins.find((p) => p.toggle.id === controlId);
  if (plugin) {
    const enabled = !plugin.enabled;
    return summarize({
      ...world,
      plugins: world.plugins.map((p) =>
        p.id === plugin.id
          ? {
              ...p,
              enabled,
              toggle: enabled
                ? { ...p.toggle, label: "停用", tone: "danger" }
                : { id: p.toggle.id, label: "启用", tone: "primary" },
              summary: enabled ? p.summary.replace(/^已停用 · /, "") : `已停用 · ${p.summary}`,
            }
          : p,
      ),
    });
  }

  // Provider controls: the id's first part names the provider.
  const provider = (id: string, change: (p: Provider) => Provider) =>
    summarize(mapPages(world, (page) => mapProviders(page, (p) => (p.id === id ? change(p) : p))));
  if (item === "disconnect")
    return provider(scope, (p) => ({
      ...p,
      connected: false,
      status: "没连上",
      controls: [{ id: `${p.id}.connect`, label: "连上" }],
    }));
  if (item === "connect" || item === "rekey")
    return provider(scope, (p) => ({
      ...p,
      keyField: {
        placeholder: `粘贴 ${p.name} 的密钥`,
        save: { id: `${p.id}.save`, label: "存进钥匙串", tone: "primary" },
      },
    }));
  if (item === "test")
    return provider(scope, (p) => ({ ...p, status: `${CONNECTED} · 刚测过，能用` }));

  // Everything else (reveal, export, update, licenses, feedback, quiet hours, add a rule) is a
  // host action outside the mock; it changes nothing here.
  return world;
}

/** The key itself is dropped here: only "connected" reaches the world. */
export function saveKey(world: ChatWorld, providerId: string, key: string): ChatWorld {
  if (!key.trim()) return world;
  return summarize(
    mapPages(world, (page) =>
      mapProviders(page, (p) => {
        if (p.id !== providerId) return p;
        const { keyField: _, ...rest } = p;
        return { ...rest, connected: true, status: CONNECTED, controls: connectedControls(p.id) };
      }),
    ),
  );
}
