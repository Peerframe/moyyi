// What the mock backend does when a settings, automation or plugin control is used. Pure functions over the
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
    automations: world.automations.map((page) => change(page) as PluginPage),
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

const mapProviders = (page: Page, change: (provider: Provider) => Provider | null): Page =>
  mapBlocks(page, (block) =>
    block.kind === "providers"
      ? {
          ...block,
          providers: block.providers.flatMap((provider) => {
            const next = change(provider);
            return next ? [next] : [];
          }),
        }
      : block,
  );

/** Flips the switch with this id anywhere on the pages; false if there is none. */
function flip(world: ChatWorld, id: string): ChatWorld | null {
  let found = false;
  const next = mapPages(world, (page) =>
    mapBlocks(page, (block) =>
      block.kind === "switches"
        ? {
            ...block,
            switches: block.switches.map((entry) => {
              if (entry.id !== id) return entry;
              found = true;
              return { ...entry, on: !entry.on };
            }),
          }
        : block,
    ),
  );
  return found ? next : null;
}

/** Whether a switch is on anywhere on the pages. */
export function switchedOn(world: ChatWorld, id: string): boolean | undefined {
  for (const page of [...world.settings, ...world.automations, ...world.plugins])
    for (const group of page.groups)
      for (const block of group.blocks)
        if (block.kind === "switches") {
          const found = block.switches.find((entry) => entry.id === id);
          if (found) return found.on;
        }
  return undefined;
}

/** A number field set within its range; anything else changes nothing. */
export function setNumber(world: ChatWorld, fieldId: string, value: number): ChatWorld {
  return mapPages(world, (page) =>
    mapBlocks(page, (block) =>
      block.kind === "numbers"
        ? {
            ...block,
            fields: block.fields.map((field) =>
              field.id === fieldId &&
              Number.isSafeInteger(value) &&
              value >= field.min &&
              value <= field.max
                ? { ...field, value }
                : field,
            ),
          }
        : block,
    ),
  );
}

/** The option chosen for a choice anywhere on the pages, or undefined if there is none. */
export function chosen(world: ChatWorld, choiceId: string): string | undefined {
  for (const page of [...world.settings, ...world.automations, ...world.plugins])
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
        .filter((p) => p.connected).length;
      const model = chosen(world, "models.default");
      const who = connected ? `${connected} 个连接` : "还没连上模型";
      // The default model is named without its maker.
      return model === "每次问我"
        ? `${who} · 新对话每次问你`
        : `${who} · 新对话用 ${model?.replace("DeepSeek ", "")}`;
    })(),
    background: `同时做 ${chosen(world, "jobs.parallel")}`,
    memory: `自动记忆${switchedOn(world, "memory.auto") ? "开着" : "关着"} · 记下 ${
      linesOf(page("memory")).length
    } 条`,
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

const CONNECTED = "密钥在系统钥匙串里";
function connectedControls(id: string): readonly Control[] {
  return [
    { id: `${id}.test`, label: "测一下" },
    { id: `${id}.rekey`, label: "换密钥" },
    { id: `${id}.remove`, label: "删掉", tone: "danger" },
  ];
}

/** The chat each sample automation starts its work in. */
const AUTOMATION_CHAT: Record<string, string> = {
  brief: "moyyi",
  format: "lunwen",
  excerpt: "dushu",
};

function automate(
  world: ChatWorld,
  id: string,
  verb: string,
  ids: { next: (prefix: string) => string },
): ChatWorld {
  const found = world.automations.find((a) => a.id === id);
  if (!found) return world;
  if (verb === "delete")
    return { ...world, automations: world.automations.filter((a) => a !== found) };
  if (verb === "run") {
    const chatId = AUTOMATION_CHAT[id];
    if (!chatId) return world;
    const notice: Message = {
      id: ids.next("s"),
      kind: "service",
      text: `你让「${found.name}」现在跑一次 · 计划卡马上到`,
    };
    return {
      ...world,
      messages: { ...world.messages, [chatId]: [...(world.messages[chatId] ?? []), notice] },
    };
  }
  const toggle = found.toggle;
  if (verb !== "toggle" || !toggle) return world;
  const enabled = !found.enabled;
  const when = found.summary.replace(/^已暂停 · /, "");
  return {
    ...world,
    automations: world.automations.map((a) =>
      a === found
        ? {
            ...a,
            enabled,
            summary: enabled ? when : `已暂停 · ${when}`,
            toggle: enabled
              ? { id: toggle.id, label: "暂停" }
              : { id: toggle.id, label: "继续", tone: "primary" },
          }
        : a,
    ),
  };
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
  const flipped = flip(world, controlId);
  if (flipped) return summarize(flipped);
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
    return summarize(
      mapPages(world, (page) => mapLines(page, (line) => (line.id === lineId ? null : line))),
    );

  if (controlId === "models.add") {
    const id = ids.next("conn");
    return summarize(
      mapPages(world, (page) =>
        mapBlocks(page, (block) =>
          block.kind === "providers" && page.id === "models"
            ? {
                ...block,
                providers: [
                  ...block.providers,
                  {
                    id,
                    letter: "D",
                    name: "DeepSeek · 新连接",
                    status: "没连上",
                    connected: false,
                    controls: [{ id: `${id}.remove`, label: "删掉", tone: "danger" }],
                    keyField: {
                      placeholder: "粘贴 DeepSeek 的密钥",
                      save: { id: `${id}.save`, label: "存进钥匙串", tone: "primary" },
                    },
                  },
                ],
              }
            : block,
        ),
      ),
    );
  }

  if (scope === "automation") return automate(world, item, verb, ids);

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

  const plugin = world.plugins.find((p) => p.toggle?.id === controlId);
  if (plugin) {
    const enabled = !plugin.enabled;
    return summarize({
      ...world,
      plugins: world.plugins.map((p) =>
        p.id === plugin.id && p.toggle
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
  const provider = (id: string, change: (p: Provider) => Provider | null) =>
    summarize(mapPages(world, (page) => mapProviders(page, (p) => (p.id === id ? change(p) : p))));
  if (item === "remove") return provider(scope, () => null);
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
